#!/usr/bin/env python3
"""CLI catalog synchronization. The web route only reads its private state."""
import argparse
import contextlib
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time

import catalog_source as source

ROOT = Path(__file__).resolve().parent.parent
DOMAIN = 'zhk-dom-umorya.ru'
ORIGIN = 'https://' + DOMAIN
KEEP = 6
MAX_EVENTS = 48
MAX_MEDIA_BYTES = 180 * 1024 * 1024
MAX_STATE = 2 * 1024 * 1024
MAX_SNAPSHOT = 8 * 1024 * 1024
NODE = '/opt/alt/alt-nodejs22/root/usr/bin/node'
PHP = '/usr/bin/php8.4'
CONVERT = '/usr/bin/convert'
HASH = re.compile(r'[a-f0-9]{64}')
MEDIA = re.compile(r'[a-f0-9]{64}(\.svg|\.preview\.webp)')
LOCALE = ('id', 'source_url', 'area_m2', 'number', 'building', 'section', 'floor',
          'floors_total', 'bedrooms', 'price_rub', 'price_per_m2_rub', 'features',
          'finishing', 'completion_display', 'developer_availability', 'plans', 'plan_group_id')

def encode(value):
    return (json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True)+'\n').encode('utf-8')

def private_file(path, maximum):
    st = path.lstat()
    source.must(stat.S_ISREG(st.st_mode) and stat.S_IMODE(st.st_mode) == 0o600 and st.st_nlink == 1
                and st.st_uid == os.getuid() and 0 < st.st_size <= maximum and path.resolve() == path,
                'Небезопасный служебный файл')
    return path.read_bytes()

def sync_directory(path):
    fd = os.open(str(path), os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def atomic(path, content):
    with tempfile.NamedTemporaryFile(dir=str(path.parent), prefix='.pending-', delete=False) as handle:
        temporary = Path(handle.name)
        try:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
            os.replace(str(temporary), str(path))
            sync_directory(path.parent)
        finally:
            if temporary.exists():
                temporary.unlink()

@contextlib.contextmanager
def lock(path, create=False):
    fd = os.open(str(path), os.O_RDWR | os.O_NOFOLLOW | (os.O_CREAT if create else 0), 0o600)
    try:
        st = os.fstat(fd)
        source.must(stat.S_ISREG(st.st_mode) and stat.S_IMODE(st.st_mode) == 0o600
                    and st.st_uid == os.getuid() and st.st_nlink == 1, 'Небезопасный файл блокировки')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(fd)

def public_path(hash_):
    return 'api/catalog-plan.php?file='+hash_+'.svg'

def normalize_plan(view, url, hash_):
    return {'type':view, 'source_url':url, 'sha256':hash_, 'local_path':public_path(hash_)}

def normalize_lot(lot, plans):
    result = dict(lot, plans=plans, plan_group_id='layout-'+plans[0]['sha256'][:12])
    return {key:result[key] for key in LOCALE}

def changes(before, after):
    old, new = ({row['id']: row for row in rows} for rows in (before, after))
    return {
        'prices': [(old[key], new[key]) for key in sorted(old.keys() & new.keys()) if old[key]['price_rub'] != new[key]['price_rub']],
        'added': [new[key] for key in sorted(new.keys() - old.keys())],
        'removed': [old[key] for key in sorted(old.keys() - new.keys())],
        'details': [new[key] for key in sorted(old.keys() & new.keys())
                    if {k:old[key][k] for k in LOCALE if k != 'price_rub' and k != 'price_per_m2_rub'}
                    != {k:new[key][k] for k in LOCALE if k != 'price_rub' and k != 'price_per_m2_rub'}],
    }

def message(now, label, lines):
    date = time.strftime('%Y-%m-%d %H:%M МСК', time.gmtime(now + 10800))
    body = '\n'.join(['ЖК «Дом у моря»', 'Проверка: '+date, ''] + lines)
    identifier = 'catalog-'+source.digest(encode([now, label, lines]))[:32]
    return {'id':identifier, 'subject':'ЖК «Дом у моря» — '+label, 'body':body}

def describe(change, count, version):
    def lot(row):
        return '№{number}, ID {id} — {source_url}'.format(**row)
    lines = ['Предложений на сайте: '+str(count), 'Опубликован снимок '+version, 'Сайт: '+ORIGIN+'/']
    for old, new in change['prices']:
        lines.append('Цена: '+str(old['price_rub'])+' → '+str(new['price_rub'])+' ₽. '+lot(new))
    for key, label in [('added','Добавлена'), ('removed','Исключена из публичной выдачи'), ('details','Обновлены параметры или планировка')]:
        for row in change[key]:
            price = ' · '+str(row['price_rub'])+' ₽' if key == 'added' else ''
            lines.append(label+': '+lot(row)+price)
    return lines

class Store:
    def __init__(self, home, node=NODE, php=PHP, convert=CONVERT):
        self.home = home.resolve()
        self.doc = self.home/'domains'/DOMAIN
        self.root = self.home/'.dom-u-morya'/'catalog-sync-v1'
        self.state = self.root/'state.json'
        self.media = self.root/'media'
        self.snapshots = self.root/'snapshots'
        self.website_lock = self.root.parent/'manager-v1'/'lock'
        self.node, self.php, self.convert = node, php, convert
        self.running = self.root/'sync.lock'

    def verify_root(self):
        for path in (self.root.parent, self.root, self.media, self.snapshots):
            st = path.lstat()
            source.must(path.resolve() == path and stat.S_ISDIR(st.st_mode)
                        and stat.S_IMODE(st.st_mode) == 0o700 and st.st_uid == os.getuid(),
                        'Служебный каталог должен быть приватным')

    def read_state(self):
        self.verify_root()
        item = json.loads(private_file(self.state, MAX_STATE).decode('utf-8'))
        source.must(item.get('schema') == 1 and HASH.fullmatch(item.get('active', '')), 'Неизвестное состояние каталога')
        return item

    def save(self, item):
        raw = encode(item)
        source.must(len(raw) <= MAX_STATE, 'Превышен лимит состояния')
        atomic(self.state, raw)

    def read_snapshot(self, version):
        source.must(isinstance(version, str) and HASH.fullmatch(version), 'Неправильный идентификатор снимка')
        raw = private_file(self.snapshots/(version+'.json'), MAX_SNAPSHOT)
        source.must(source.digest(raw) == version, 'Контрольная сумма снимка не совпадает')
        snapshot = json.loads(raw.decode('utf-8'))
        source.must(snapshot.get('schema') == 1 and snapshot.get('lots'), 'Неизвестный формат снимка')
        return snapshot

    def build_snapshot(self, lots, now):
        date = source.day(now)
        payload = {'date':date, 'lots':[dict(lot, snapshot_date=date) for lot in lots]}
        result = subprocess.run([self.node, str(ROOT/'scripts/catalog-snapshot.mjs')], input=encode(payload),
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
        source.must(result.returncode == 0 and 0 < len(result.stdout) <= MAX_SNAPSHOT, 'Не удалось отобразить каталог')
        raw = result.stdout
        return source.digest(raw), raw

    def verify_render(self, raw):
        program = """
        require $argv[1].'/api/catalog-view.php';
        $snapshot = json_decode(stream_get_contents(STDIN), true, 32, JSON_THROW_ON_ERROR);
        foreach ([true, false] as $confirmed) {
            DomCatalog\\render(file_get_contents($argv[1].'/index.html'),
                ['snapshot'=>$snapshot, 'version'=>'verification', 'confirmed'=>$confirmed]);
        }
        """
        result = subprocess.run([self.php, '-r', program, str(self.doc)], input=raw,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
        source.must(result.returncode == 0, 'Шаблон текущего релиза несовместим со снимком')

    def verify_live(self, version, confirmed):
        _, h, _ = source.read_https(ORIGIN+'/', 0, method='HEAD')
        source.must(h.get('X-Dom-Catalog-Snapshot') == version and 'no-store' in h.get('Cache-Control', '')
                    and h.get('X-Dom-Catalog-Status') == ('confirmed' if confirmed else 'unconfirmed'),
                    'Публичная проверка версии каталога завершилась ошибкой')

    def put_media(self, hash_, svg, preview=None):
        original = self.media/(hash_+'.svg')
        thumb = self.media/(hash_+'.preview.webp')
        if original.exists() and thumb.exists():
            source.must(source.digest(private_file(original, source.MAX_SVG)) == hash_
                        and private_file(thumb, 512*1024)[8:12] == b'WEBP', 'Повреждённый локальный файл планировки')
            return
        allocated = sum(p.stat().st_size for p in self.media.iterdir() if MEDIA.fullmatch(p.name))
        source.must(allocated+len(svg)+512*1024 <= MAX_MEDIA_BYTES, 'Исчерпан лимит хранилища планировок')
        if not original.exists():
            atomic(original, svg)
        try:
            source.must(source.digest(private_file(original, source.MAX_SVG)) == hash_, 'Контрольная сумма планировки не совпадает')
            if preview is None:
                preview = source.create_preview(original, self.convert)
            source.must(16 < len(preview) <= 512*1024 and preview.startswith(b'RIFF') and preview[8:12] == b'WEBP',
                        'Ошибочный формат превью')
            if not thumb.exists():
                atomic(thumb, preview)
        except Exception:
            if not thumb.exists():
                original.unlink()
            raise

    def seed(self, now):
        self.verify_root()
        source.must(not self.state.exists(), 'Каталог уже включён')
        with lock(self.running, create=True), lock(self.website_lock):
            self.verify_live('bundled', True)
            lots = []
            bundled = json.loads((ROOT/'data'/'apartments.json').read_text(encoding='utf-8'))
            for lot in bundled:
                plans = []
                for plan in lot['plans']:
                    svg_path = self.doc/plan['local_path']
                    data = svg_path.read_bytes()
                    hash_ = source.validate_svg(data)
                    source.must(hash_ == plan['sha256'], 'Планировка сайта отличается от проверенной исходной')
                    self.put_media(hash_, data, svg_path.with_suffix('.preview.webp').read_bytes())
                    plans.append(normalize_plan(plan['type'], plan['source_url'], hash_))
                lots.append(normalize_lot(lot, plans))
            # Seed the exact published baseline. The first live check establishes freshness.
            date = bundled[0]['snapshot_date']
            source.must(all(row['snapshot_date'] == date for row in bundled), 'Несогласованная дата начального снимка')
            seed_at = int(time.mktime(time.strptime(date+' 12:00', '%Y-%m-%d %H:%M')))
            version, raw = self.build_snapshot(lots, seed_at)
            self.verify_render(raw)
            atomic(self.snapshots/(version+'.json'), raw)
            item = dict(schema=1, active=version, history=[version], checked_at=0, source_ok=False,
                        etags={}, outbox=[], history_events=[], started_at=None)
            self.save(item)
            try:
                self.verify_live(version, False)
            except Exception:
                self.state.unlink()
                sync_directory(self.root)
                raise
            return version

    def download_plan(self, url, previous, now, dry):
        cached = previous.get(url, {})
        hash_ = cached.get('hash', '')
        local = (HASH.fullmatch(hash_) and (self.media/(hash_+'.svg')).exists()
                 and (self.media/(hash_+'.preview.webp')).exists())
        headers = {'Accept':'image/svg+xml'}
        if local and cached.get('etag'):
            headers['If-None-Match'] = cached['etag']
        if local and cached.get('last_modified'):
            headers['If-Modified-Since'] = cached['last_modified']
        if local and len(headers) == 1 and now - cached.get('fetched_at', 0) < 6*86400:
            return cached
        code, response, raw = source.read_https(url, source.MAX_SVG, headers)
        if code == 304:
            source.must(local and len(headers) > 1, 'Ответ 304 без локальной проверенной схемы')
            return cached
        source.must(response.get_content_type() in ('image/svg+xml', 'application/xml', 'text/xml'), 'Ответ не является SVG')
        hash_ = source.validate_svg(raw)
        if not dry:
            self.put_media(hash_, raw)
        elif not (self.media/(hash_+'.preview.webp')).exists():
            with tempfile.TemporaryDirectory() as temp:
                sample = Path(temp)/'plan.svg'
                sample.write_bytes(raw)
                source.create_preview(sample, self.convert)
        return dict(hash=hash_, fetched_at=now, etag=response.get('ETag','')[:300],
                    last_modified=response.get('Last-Modified','')[:100])

    def prepare(self, item, old, now, dry):
        official = source.inventory()
        before = {row['id']:row for row in old}
        source.verify_changes(old, [lot for lot, _ in official])
        official_ids = {lot['id'] for lot, _ in official}
        for key in sorted(before.keys() - official_ids):
            source.confirm_withdrawal(before[key])
        assets, failed, issues = {}, {}, []
        result = []
        for lot, tabs in sorted(official, key=lambda item: (item[0]['price_rub'], int(item[0]['id']))):
            key = lot['id']
            try:
                plans = []
                for view, url in source.plan_urls(tabs).items():
                    if url in failed:
                        raise ValueError(failed[url])
                    if url not in assets:
                        try:
                            assets[url] = self.download_plan(url, item['etags'], now, dry)
                        except Exception as exc:
                            failed[url] = safe_error(exc)
                            raise
                    plans.append(normalize_plan(view, url, assets[url]['hash']))
                result.append(normalize_lot(lot, plans))
            except Exception as exc:
                issues.append('№{number}, ID {id} — {source_url}. '.format(**lot)+safe_error(exc))
                if key in before:
                    result.append(dict(before[key], developer_availability=None))
        source.must(result and len(issues) <= max(2, len(official)//4), 'Массовая ошибка получения планировок')
        retained_urls = {plan['source_url'] for row in result for plan in row['plans']}
        assets = {url:(assets.get(url) or item['etags'][url]) for url in retained_urls
                  if url in assets or url in item['etags']}
        return sorted(result, key=lambda row: (row['price_rub'], int(row['id']))), assets, issues

    def queue(self, item, report):
        source.must(len(item['outbox']) < MAX_EVENTS, 'Очередь уведомлений заполнена')
        if not any(old['id'] == report['id'] for old in item['outbox']):
            item['outbox'].append(report)

    def record(self, item, now, outcome, issues=None):
        item['history_events'] = (item['history_events'] + [
            dict(time=now, outcome=outcome, issues=(issues or [])[:12])
        ])[-KEEP*5:]

    def flush(self, item):
        for event in item['outbox'][:4]:
            try:
                result = subprocess.run([self.php, str(ROOT/'scripts/catalog-notify.php'), str(self.doc)],
                                        input=encode(event), stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
            except (OSError, subprocess.TimeoutExpired):
                return False
            if result.returncode != 0:
                return False
            item['outbox'].pop(0)
            self.save(item)
        return not item['outbox']

    def activate(self, item, version, raw, now, change, issues, assets):
        old_version = item['active']
        original = encode(item)
        self.verify_render(raw)
        atomic(self.snapshots/(version+'.json'), raw)
        item.update(active=version, checked_at=now, source_ok=True, etags=assets,
                    history=([version]+[v for v in item['history'] if v != version])[:KEEP],
                    pending_verification=old_version)
        self.save(item)
        try:
            self.verify_live(version, True)
        except Exception:
            self.save(json.loads(original.decode('utf-8')))
            item.clear()
            item.update(json.loads(original.decode('utf-8')))
            raise
        item.pop('pending_verification')
        self.queue(item, message(now, 'каталог обновлён', describe(change, len(json.loads(raw)['lots']), version)))
        if issues:
            self.queue(item, message(now, 'ошибки проверки планировок', issues))
        self.record(item, now, 'published', issues)
        item['started_at'] = None
        self.save(item)

    def recover_interrupted(self, item, now):
        if item.get('pending_verification'):
            version = item.pop('pending_verification')
            self.read_snapshot(version)
            item['active'] = version
            item['history'] = [version]+[v for v in item['history'] if v != version]
        self.queue(item, message(now, 'запуск был прерван', ['Обнаружен незавершённый предыдущий запуск. Проверьте статус Cron.']))
        item['source_ok'] = False
        item['started_at'] = None
        self.save(item)

    def run(self, now, dry=False):
        self.verify_root()
        if dry:
            item = self.read_state()
            old = self.read_snapshot(item['active'])['lots']
            lots, _, issues = self.prepare(item, old, now, True)
            return dict(publish=bool(any(changes(old, lots).values())), count=len(lots), issues=issues,
                        changes={k:len(v) for k,v in changes(old,lots).items()})
        with lock(self.running):
            item = self.read_state()
            if item['started_at']:
                with lock(self.website_lock):
                    self.recover_interrupted(item, now)
            mail_ready = self.flush(item)
            source.must(len(item['outbox']) <= MAX_EVENTS-3, 'Очередь уведомлений заполнена')
            item['started_at'] = now
            self.save(item)
            try:
                old = self.read_snapshot(item['active'])['lots']
                lots, assets, issues = self.prepare(item, old, now, False)
                change = changes(old, lots)
                with lock(self.website_lock):
                    if any(change.values()):
                        version, raw = self.build_snapshot(lots, now)
                        self.activate(item, version, raw, now, change, issues, assets)
                    else:
                        if issues:
                            self.queue(item, message(now, 'ошибки проверки планировок', issues))
                        item.update(checked_at=now, source_ok=True, etags=assets, started_at=None)
                        self.record(item, now, 'checked', issues)
                        self.save(item)
                self.prune(item)
            except Exception as exc:
                reason = safe_error(exc)
                item = self.read_state()
                item.update(source_ok=False, started_at=None)
                if item.get('pending_verification'):
                    item['active'] = item.pop('pending_verification')
                self.queue(item, message(now, 'сбой синхронизации', [reason, 'Сохранён снимок '+item['active']]))
                self.record(item, now, 'failed', [reason])
                self.save(item)
                if mail_ready:
                    self.flush(item)
                raise ValueError(reason)
            return dict(active=item['active'], notification_ok=mail_ready and self.flush(item), count=len(lots), issues=issues)

    def prune(self, item):
        preserved = set(item['history']) | {item['active']}
        references = {plan['sha256'] for version in preserved for row in self.read_snapshot(version)['lots'] for plan in row['plans']}
        grace = time.time() - 86400
        for path in self.snapshots.iterdir():
            if HASH.fullmatch(path.stem) and path.name.endswith('.json') and path.stem not in preserved and path.stat().st_mtime < grace:
                path.unlink()
        for path in self.media.iterdir():
            if MEDIA.fullmatch(path.name) and path.name[:64] not in references and path.stat().st_mtime < grace:
                path.unlink()

    def restore(self, version, now):
        with lock(self.running), lock(self.website_lock):
            item = self.read_state()
            source.must(version in item['history'] and version != item['active'], 'Выберите сохранённый предыдущий снимок')
            raw = private_file(self.snapshots/(version+'.json'), MAX_SNAPSHOT)
            self.read_snapshot(version)
            self.verify_render(raw)
            old = item['active']
            rollback = encode(item)
            item.update(active=version, source_ok=False, started_at=None)
            self.queue(item, message(now, 'восстановлен предыдущий каталог', ['Снимок '+version, 'Предыдущая версия '+old]))
            self.record(item, now, 'restored')
            self.save(item)
            try:
                self.verify_live(version, False)
            except Exception:
                atomic(self.state, rollback)
                raise
            return dict(active=version, notification_ok=self.flush(item))

def safe_error(exc):
    text = str(exc).splitlines()[0] if str(exc) else type(exc).__name__
    return text[:240]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['seed','run','status','restore','mail-test','interrupted'])
    parser.add_argument('--home', type=Path, default=Path.home())
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--version')
    args = parser.parse_args()
    store = Store(args.home)
    now = int(time.time())
    if args.dry_run and args.command != 'run':
        parser.error('--dry-run can only be used with run')
    if args.command == 'seed':
        result = {'active':store.seed(now)}
    elif args.command == 'status':
        state = store.read_state()
        result = {k:state[k] for k in ('active','history','checked_at','source_ok','started_at','history_events')}
        result['count'] = len(store.read_snapshot(state['active'])['lots'])
        result['pending_notifications'] = len(state['outbox'])
    elif args.command == 'restore':
        result = store.restore(args.version, now)
    elif args.command == 'interrupted':
        with lock(store.running), lock(store.website_lock):
            state = store.read_state()
            if state['started_at']:
                store.recover_interrupted(state, now)
            result = {'notification_ok':store.flush(state)}
    elif args.command == 'mail-test':
        with lock(store.running):
            state = store.read_state()
            store.queue(state, message(now, 'проверка доставки', ['Тестовое уведомление синхронизации каталога. Заявка не создавалась.']))
            store.save(state)
            result = {'notification_ok':store.flush(state)}
    else:
        result = store.run(now, args.dry_run)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get('notification_ok', True) else 4

if __name__ == '__main__':
    try:
        sys.exit(main())
    except BlockingIOError:
        print('Другой запуск или релиз уже выполняется.', file=sys.stderr)
        sys.exit(5)
    except Exception as exc:
        print('Синхронизация остановлена: '+safe_error(exc), file=sys.stderr)
        sys.exit(3)
