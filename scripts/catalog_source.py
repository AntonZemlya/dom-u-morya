"""Verify the developer's complete inventory and the plan files for individual IDs."""
import concurrent.futures
import datetime
import hashlib
import http.client
import json
import math
import os
import re
import ssl
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from check_official_prices import PROJECT_URL, USER_AGENT, confirm_detail, get_scripts, parse_offers

ORIGIN = 'https://sadovoe-kolco.ru'
PLAN_PATH = re.compile(r'/upload/plans/house-by-the-sea/(plan-meb|plan|plan-floor)/[A-Za-z0-9_-]+\.svg')
TABS = {'С мебелью': ('furnished', 'plan-meb'), 'Без мебели': ('unfurnished', 'plan'),
        'На этаже': ('floor', 'plan-floor')}
MAX_SVG = 2 * 1024 * 1024
IDENTITY = ('number', 'building', 'section', 'floor', 'floors_total', 'bedrooms')
SVG = '{http://www.w3.org/2000/svg}'
SVG_TAGS = frozenset('svg g path rect line polyline polygon ellipse circle'.split())
SVG_ATTRS = frozenset('style d x1 y1 x2 y2 points y x width height id transform cx cy rx ry r version viewBox'.split())
TRANSIENT = frozenset([408, 429, 500, 502, 503, 504])

def must(ok, message):
    if not ok:
        raise ValueError(message)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def day(now):
    return datetime.datetime.fromtimestamp(now, datetime.timezone(datetime.timedelta(hours=3))).date().isoformat()

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def read_https(url, max_bytes, headers=None, method='GET'):
    req = urllib.request.Request(url, method=method, headers=dict(
        {'User-Agent': USER_AGENT, 'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache'}, **(headers or {})))
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    for delay in (0, .35, .8):
        if delay:
            time.sleep(delay)
        try:
            with opener.open(req, timeout=8) as response:
                must(response.status == 200, 'Неожиданный ответ HTTPS')
                declared = response.headers.get('Content-Length')
                must(method == 'HEAD' or declared is None or int(declared) <= max_bytes, 'Ответ превышает лимит')
                data = response.read(max_bytes + 1)
                must(len(data) <= max_bytes, 'Ответ превышает лимит')
                must(method == 'HEAD' or declared is None or len(data) == int(declared), 'Ответ загружен частично')
                return 200, response.headers, data
        except urllib.error.HTTPError as exc:
            with exc:
                if exc.code == 304 and headers:
                    return 304, exc.headers, b''
                if exc.code not in TRANSIENT:
                    raise
                last = exc
        except (urllib.error.URLError, OSError, http.client.HTTPException) as exc:
            if isinstance(getattr(exc, 'reason', exc), ssl.SSLError):
                raise
            last = exc
    raise last

def page(url):
    must(url == PROJECT_URL or re.fullmatch(re.escape(PROJECT_URL) + r'/[1-9][0-9]{0,15}\?projectId=1', url),
         'Некорректный адрес карточки')
    _, headers, raw = read_https(url, 3_000_000, {'Accept': 'text/html'})
    must(headers.get_content_type() == 'text/html', 'Ожидалась страница HTML застройщика')
    return raw.decode('utf-8')

def public_text(value, max_length=140):
    must(isinstance(value, str) and len(value) <= max_length and not re.search(r'[\x00-\x1f\x7f<>]', value),
         'Некорректное поле в карточке')
    return value

def verify_lot(pair):
    key, listed = pair
    detail = confirm_detail(key, listed, page(listed['source_url']))
    must(str(detail['id']) == key and detail['code'] == 'house-by-the-sea'
         and detail['region_code'] == 'mariupol', 'Карточка из другого проекта '+key)
    for local, remote in zip(IDENTITY, ('number', 'corpus', 'section', 'floor', 'floorSize', 'rooms')):
        must(str(detail[remote]) == str(listed[local]), 'Расхождение параметров квартиры '+key)
    must(detail['price'] == listed['price'] and detail['square'] == listed['area_m2'], 'Расхождение цены или площади '+key)
    must(1 <= listed['number'] <= 10000 and all(re.fullmatch(r'[1-9][0-9]{0,3}', listed[k]) for k in ('building', 'section')),
         'Недопустимый номер, корпус или секция '+key)
    labels = detail['labels']
    must(isinstance(labels, list) and len(labels) <= 20 and sorted(labels) == sorted(listed['features']),
         'Расхождение особенностей '+key)
    features = [public_text(x) for x in labels]
    price_m2 = detail['price_m2']
    must(type(price_m2) is int and abs(price_m2 - listed['price']/listed['area_m2']) <= 1,
         'Расхождение цены за м² '+key)
    finishing = 'Чистовая отделка' if detail['renovation'] == 1 else ('Предчистовая отделка' if detail['whitebox'] == 1 else '')
    lot = {k: listed[k] for k in ('id', 'source_url', 'area_m2') + IDENTITY}
    lot.update(price_rub=listed['price'], price_per_m2_rub=price_m2, features=features, finishing=finishing,
               completion_display=public_text(detail['dateInfo']), developer_availability='InStock')
    return lot, detail.get('tabs')

def inventory():
    listed = parse_offers(page(PROJECT_URL))
    addresses = {(lot['building'], lot['section'], lot['number']) for lot in listed.values()}
    must(len(addresses) == len(listed), 'Дубли номеров в корпусе и секции')
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        lots = list(pool.map(verify_lot, sorted(listed.items())))
    must(listed == parse_offers(page(PROJECT_URL)), 'Список изменился во время сверки карточек')
    return lots

def confirm_withdrawal(lot):
    key = lot['id']
    try:
        document = page(lot['source_url'])
    except urllib.error.HTTPError as exc:
        if exc.code in (404, 410):
            return
        raise
    matches = []
    for _, kind, payload in get_scripts(document):
        if kind != 'application/ld+json':
            continue
        schema = json.loads(payload)
        if schema.get('@type') == 'ItemList':
            matches.extend(product for product in schema.get('itemListElement', [])
                           if product.get('@type') == 'Product'
                           and product.get('url', '').split('?')[0] == PROJECT_URL+'/'+key)
    must(len(matches) == 1 and matches[0].get('offers', {}).get('availability', '').rsplit('/', 1)[-1]
         in ('OutOfStock', 'SoldOut'), 'Исчезновение из списка противоречит карточке '+key)

def verify_changes(before, proposed):
    old, new = ({row['id']: row for row in rows} for rows in (before, proposed))
    missing = old.keys() - new.keys()
    added = new.keys() - old.keys()
    must(new and max(len(missing), len(added)) <= max(2, len(old)//4), 'Подозрительное изменение состава каталога')
    large_moves = 0
    for key in old.keys() & new.keys():
        a, b = old[key], new[key]
        must(all(a[k] == b[k] for k in IDENTITY) and abs(a['area_m2']-b['area_m2']) < 0.01,
             'Изменилась идентичность квартиры '+key)
        ratio = abs(b['price_rub']/a['price_rub'] - 1)
        must(ratio <= .30, 'Цена изменилась более чем на 30% у квартиры '+key)
        large_moves += ratio >= .10
    must(large_moves <= max(2, len(old)//3), 'Подозрительные массовые изменения цен')

def plan_urls(rows):
    must(isinstance(rows, list) and 1 <= len(rows) <= len(TABS), 'Индивидуальные ссылки на схемы отсутствуют')
    urls = {}
    for row in rows:
        must(isinstance(row, dict) and row.get('name') in TABS, 'Неизвестный тип схемы')
        view, folder = TABS[row['name']]
        url = urllib.parse.urljoin(ORIGIN, row['img'])
        must(url.startswith(ORIGIN+'/'), 'Другой хост схемы')
        match = PLAN_PATH.fullmatch(url[len(ORIGIN):])
        must(match and match[1] == folder and view not in urls, 'Неоднозначная ссылка на схему')
        urls[view] = url
    return urls

def validate_svg(data):
    must(len(data) <= MAX_SVG and b'\x00' not in data, 'Размер или кодировка SVG недопустимы')
    plain = data.decode('utf-8-sig')
    plain = re.sub(r'^<\?xml\s+version=["\']1\.0["\'][^?]*\?>', '', plain, count=1)
    must(not re.search(r'<\?\s*|<!\s*(?:DOCTYPE|ENTITY)', plain, re.I), 'Внешние зависимости в SVG')
    root = ET.fromstring(plain)
    must(root.tag == SVG+'svg', 'Ожидался SVG')
    view = [float(x) for x in re.split(r'[\s,]+', root.attrib['viewBox'].strip())]
    must(len(view) == 4 and all(math.isfinite(v) for v in view) and all(0 < v <= 50000 for v in view[2:]),
         'Недопустимые размеры SVG')
    for count, element in enumerate(root.iter(), 1):
        must(count <= 40000 and element.tag.startswith(SVG) and element.tag[len(SVG):] in SVG_TAGS, 'Недопустимый элемент SVG')
        for attr, value in element.attrib.items():
            if attr == '{http://www.w3.org/XML/1998/namespace}space' and value in ('default', 'preserve'):
                continue
            must(attr in SVG_ATTRS and not re.search(r'url\s*\(|@|\\|://|[<>]', value, re.I),
                 'Недопустимый атрибут SVG')
    return digest(data)

def create_preview(path, executable):
    result = subprocess.run([executable, '-limit', 'thread', '1', '-limit', 'memory', '64MiB',
                             '-limit', 'map', '96MiB', '-limit', 'disk', '0',
                             '-background', 'none', 'svg:'+str(path),
                             '-resize', '960x960>', '-strip', '-quality', '82', 'webp:-'],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15,
                            env=dict(os.environ, MAGICK_THREAD_LIMIT='1'))
    must(result.returncode == 0 and 16 < len(result.stdout) <= 512*1024
         and result.stdout.startswith(b'RIFF') and result.stdout[8:12] == b'WEBP', 'Не удалось создать WebP')
    return result.stdout
