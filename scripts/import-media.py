#!/usr/bin/env python3
"""Import an explicitly supplied, verified research snapshot for local review.

Requires Pillow. Does not fetch URLs, change hero assets, publish, or infer rights.
Usage: python3 scripts/import-media.py /absolute/path/to/research-package
The output directory defaults to this repository, never the current directory.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageOps

GALLERY = [
    ('gallery-02.jpg', 'Башня и территория'),
    ('gallery-01.jpg', 'Террасы верхних этажей'),
    ('gallery-04.jpg', 'Коммерческая галерея'),
    ('gallery-05.jpg', 'Вход со стороны двора'),
    ('gallery-08.jpg', 'Колясочная и велосипедная'),
    ('gallery-09.jpg', 'Лобби'),
    ('gallery_second-04.webp', 'Входная группа'),
    ('gallery-11.jpg', 'Лифтовой холл'),
]
WIDTHS = (640, 1280, 1920)
RIGHTS = 'permission_not_verified'

def sha(data):
    return hashlib.sha256(data).hexdigest()

def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package', type=Path)
    parser.add_argument('--output-root', type=Path, default=Path(__file__).resolve().parent.parent)
    args = parser.parse_args()
    package, out = args.package.resolve(), args.output_root.resolve()
    def read(name):
        return json.loads((package / 'data' / (name + '.json')).read_text())
    manifest = {x['local_path']: x for x in read('media-index')}
    apartments, groups, albums = read('apartments'), read('plan-groups'), read('construction')
    if len(apartments) != 28 or len({a['id'] for a in apartments}) != 28:
        raise ValueError('Expected 28 unique apartments; review changed snapshots before import')
    if len(groups) != 19 or [sum(a['bedrooms'] == n for a in apartments) for n in range(4)] != [4,16,6,2]:
        raise ValueError('Unexpected layout/category counts; review snapshot first')
    if any(a['project_slug'] != 'house-by-the-sea' or a['project_id'] != '24' for a in apartments):
        raise ValueError('Foreign project found')
    provenance, plan_assets, image_assets = [], {}, {}
    def source(relative):
        p = (package / relative).resolve()
        if not p.is_relative_to(package):
            raise ValueError('Path outside supplied package')
        data = p.read_bytes()
        meta = manifest[relative]
        if sha(data) != meta['sha256']:
            raise ValueError('Source checksum mismatch: ' + relative)
        return p, data, meta
    def plan(item):
        original = item['local_path']
        _, data, meta = source(original)
        # Keep Illustrator display:none groups and all geometry verbatim.
        if any(token in data.lower() for token in [b'<script', b'<foreignobject', b'javascript:']):
            raise ValueError('Unexpected active SVG content')
        target = 'assets/content/plans/' + meta['sha256'] + '.svg'
        if target not in plan_assets:
            (out / target).parent.mkdir(parents=True, exist_ok=True)
            (out / target).write_bytes(data)
            plan_assets[target] = meta['sha256']
        record = {**item, 'local_path': target, 'original_path': original,
                  'sha256': meta['sha256'], 'rights_status': RIGHTS}
        provenance.append({'original_path': original, 'source_url': item['source_url'],
                           'source_sha256': meta['sha256'], 'rights_status': RIGHTS,
                           'source_owner': meta['source_owner'], 'origin_page': meta.get('origin_page'),
                           'fetched_at': meta['fetched_at'], 'outputs': [{'path':target,'sha256':meta['sha256'],'bytes':len(data)}]})
        return record
    for apt in apartments:
        apt['plans'] = [plan(item) for item in apt['plans']]
        apt['snapshot_date'] = '2026-10-27'
    by_original = {p['original_path']:p for a in apartments for p in a['plans']}
    for group in groups:
        group['sample_plans'] = [copy.deepcopy(by_original[p['local_path']]) for p in group['sample_plans']]
    def raster(original, title, directory, item_id, classification):
        p, _, meta = source(original)
        key = (directory, meta['sha256'])
        if key not in image_assets:
            with Image.open(p) as opened:
                img = ImageOps.exif_transpose(opened).convert('RGB')
                native_w, native_h = img.size
                variants, outputs = [], []
                # Cap dimensions at original width; never invent image detail.
                for width in sorted(set(min(w, native_w) for w in WIDTHS)):
                    height = round(native_h * width / native_w)
                    target = f'assets/content/{directory}/{meta["sha256"][:16]}-{width}.webp'
                    (out / target).parent.mkdir(parents=True, exist_ok=True)
                    resized = img.resize((width, height), Image.Resampling.LANCZOS) if width != native_w else img
                    resized.save(out / target, 'WEBP', quality=84, method=6)
                    content = (out / target).read_bytes()
                    variants.append({'src':target,'width':width,'height':height})
                    outputs.append({'path':target,'sha256':sha(content),'bytes':len(content),'width':width,'height':height})
                default = min(variants, key=lambda v: abs(v['width']-1280))
                image_assets[key] = {**default, 'srcset': ', '.join(f'{v["src"]} {v["width"]}w' for v in variants),
                                     'variants': variants, 'outputs':outputs}
        generated = image_assets[key]
        record = {'id':item_id, 'title':title, **{k:v for k,v in generated.items() if k!='outputs'},
                  'source_url':meta['source_url'], 'origin_page':meta.get('origin_page'),
                  'rights_status':RIGHTS, 'original_path':original, 'sha256':meta['sha256'],
                  'classification':classification}
        provenance.append({'original_path':original, 'source_url':meta['source_url'],
                           'source_sha256':meta['sha256'], 'source_owner':meta['source_owner'],
                           'origin_page':meta.get('origin_page'), 'fetched_at':meta['fetched_at'],
                           'rights_status':RIGHTS, 'outputs':generated['outputs']})
        return record
    gallery = [raster('media/renders/'+filename, title, 'gallery', Path(filename).stem,
                      'Визуализация застройщика') for filename,title in GALLERY]
    construction = []
    for album in albums:
        images, seen = [], set()
        for i, item in enumerate(album['items']):
            record = raster(item['local_path'], f'{album["source_title"]} · фото {len(images)+1}',
                            'construction', Path(item['local_path']).stem, 'Фото строительства')
            record['capture_date'] = None
            record['album_month'] = album['period']
            # Preserve every original mapping in provenance; display duplicate covers once.
            if record['sha256'] in seen:
                continue
            seen.add(record['sha256'])
            record['is_cover'] = item['is_cover']
            images.append(record)
        construction.append({'month':album['period'], 'title':album['source_title'],
                             'source_url':album['source_url'], 'images':images,
                             'date_note':'Месяц альбома застройщика; точная дата съёмки не установлена.'})
    assert len(plan_assets) == 57
    assert len([k for k in image_assets if k[0]=='construction']) == 29
    write_json(out/'data/apartments.json', apartments)
    write_json(out/'data/plan-groups.json', groups)
    write_json(out/'data/media.json', {'snapshot_date':'2026-10-27', 'rights_status':RIGHTS,
                                      'gallery':gallery,'construction':construction})
    write_json(out/'data/media-provenance.json', {
        'snapshot_date':'2026-10-27', 'rights_status':RIGHTS,
        'usage':'Локальная разработка и визуальная приёмка разрешены владельцем. Публичное распространение отдельно не согласовано.',
        'transforms':{'plans':'Byte-identical SHA-256 deduplication; no SVG rewriting.',
                      'rasters':'EXIF orientation, proportional LANCZOS resize without upscaling, WebP quality 84, method 6; metadata removed.'},
        'sources':provenance})
    files = [p for p in (out/'assets/content').rglob('*') if p.is_file()]
    print(json.dumps({'apartments':len(apartments),'layout_groups':len(groups),'plan_references':84,
                      'unique_svg':len(plan_assets),'gallery_images':len(gallery),
                      'construction_source_references':sum(len(a['items']) for a in albums),
                      'construction_unique_images':29,'construction_album_display_items':sum(len(a['images']) for a in construction),
                      'asset_files':len(files),'asset_bytes':sum(p.stat().st_size for p in files)}, ensure_ascii=False))

if __name__ == '__main__':
    main()
