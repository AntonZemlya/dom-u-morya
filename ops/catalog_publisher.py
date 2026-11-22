#!/usr/bin/env python3
"""R2B local-only dom-private-v1 acceptance, CAS publication and recovery.

No transport, source requests, scheduler, SMTP or hosting installation is provided.
"""
import argparse
import copy
from datetime import datetime, timezone, timedelta
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time
import uuid
from urllib.parse import urlsplit, parse_qs
import catalog_package_media as media

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
import catalog_sync as sync
import catalog_source as source

R2A = 'db9963536daeb68ab9466684adb3df9da6bdc1e1'
NAMESPACE = ['sadovoe-kolco', '24', 'house-by-the-sea']
PROJECTION = {'schema', 'active', 'checked_at', 'published_checked_at', 'source_ok'}
MAX_TOTAL = 180 * 1024 * 1024
MAX_FILES = 1800


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def checksum(value):
    return isinstance(value, str) and re.fullmatch(r'[a-f0-9]{64}', value) is not None


def integer(value, low=0, high=10**12):
    return type(value) is int and low <= value <= high


def directory(path):
    st = path.lstat()
    require(path.is_absolute() and path.resolve() == path and stat.S_ISDIR(st.st_mode)
            and stat.S_IMODE(st.st_mode) == 0o700 and st.st_uid == os.getuid(), 'unsafe_directory')
    return path


def mkdir(path):
    if not path.exists() and not path.is_symlink():
        path.mkdir(mode=0o700)
        sync.sync_directory(path.parent)
    return directory(path)


def read(path, maximum):
    return sync.private_file(path, maximum)


def document(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'duplicate_json_key')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=unique,
                      parse_constant=lambda _: require(False, 'invalid_number'))


def verify_package(package, expected, node='node'):
    directory(package)
    require(checksum(expected), 'expected_manifest_sha_required')
    raw = read(package / 'manifest.json', sync.MAX_STATE)
    require(digest(raw) == expected, 'manifest_checksum')
    manifest = document(raw)
    require(set(manifest) == {'schema', 'format', 'namespace', 'source_sha256', 'observation_sha256',
                             'native_sha256', 'native_path', 'checked_at', 'files'}
            and type(manifest['schema']) is int and manifest['schema'] == 1
            and manifest['format'] == 'dom-private-v1' and manifest['namespace'] == NAMESPACE
            and all(checksum(manifest[k]) for k in ('source_sha256', 'observation_sha256', 'native_sha256')),
            'wrong_package')
    checked = manifest['checked_at']
    require(isinstance(checked, str) and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ', checked), 'invalid_checked_at')
    moment = datetime.strptime(checked, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
    epoch = int(moment.timestamp())
    native = manifest['native_sha256']
    primary = 'private/snapshots/' + native + '.json'
    files = manifest['files']
    require(isinstance(files, dict) and 3 <= len(files) <= MAX_FILES and manifest['native_path'] == primary,
            'invalid_inventory')
    expected_dirs = {Path('.')}
    for name in files:
        require(re.fullmatch(r'private/(?:state\.json|snapshots/[a-f0-9]{64}\.json|media/[a-f0-9]{64}\.(?:svg|preview\.webp))', name),
                'invalid_package_path')
        expected_dirs.update(Path(name).parents)
    paths, total, bodies = set(), 0, {}
    for parent, dirs, names in os.walk(package, followlinks=False):
        for name in dirs:
            child = Path(parent) / name
            require(child.relative_to(package) in expected_dirs, 'unexpected_directory')
            directory(child)
        for name in names:
            paths.add((Path(parent) / name).relative_to(package).as_posix())
    require(paths == set(files) | {'manifest.json'}, 'package_inventory')
    for name, info in files.items():
        limit = (sync.MAX_SNAPSHOT if name == primary else sync.MAX_STATE if name == 'private/state.json'
                 else 512 * 1024 if name.endswith('.webp') else source.MAX_SVG)
        body = read(package / name, limit)
        require(isinstance(info, dict) and set(info) == {'sha256', 'bytes'} and integer(info['bytes'], 1, limit)
                and info == {'sha256': digest(body), 'bytes': len(body)}, 'package_checksum')
        total += len(body)
        require(total <= MAX_TOTAL, 'package_too_large')
        bodies[name] = body
    require(primary in bodies and 'private/state.json' in bodies and digest(bodies[primary]) == native, 'native_checksum')
    projection = document(bodies['private/state.json'])
    require(set(projection) == PROJECTION and type(projection['schema']) is int and projection['schema'] == 1
            and projection['active'] == native and projection['source_ok'] is True
            and type(projection['checked_at']) is int and type(projection['published_checked_at']) is int
            and projection['checked_at'] == projection['published_checked_at'] == epoch, 'invalid_projection')
    catalog = document(bodies[primary])
    date = moment.astimezone(timezone(timedelta(hours=3))).date().isoformat()
    require(catalog.get('schema') == 1 and catalog.get('date') == date and isinstance(catalog.get('lots'), list)
            and 1 <= len(catalog['lots']) <= 500, 'invalid_native_catalog')
    ids, addresses, referenced = set(), set(), {primary, 'private/state.json'}
    for row in catalog['lots']:
        key = row['id']
        address = tuple(row[k] for k in ('building', 'section', 'number'))
        require(isinstance(key, str) and re.fullmatch(r'[1-9][0-9]{0,15}', key) and key not in ids
                and address not in addresses and integer(row['price_rub'], 1)
                and integer(row['number'], 1) and integer(row['bedrooms'], 0, 3)
                and integer(row['floor'], 1, 200) and integer(row['floors_total'], row['floor'], 200)
                and type(row['area_m2']) in (int, float) and 0 < row['area_m2'] <= 2000
                and row['snapshot_date'] == date and row['developer_availability'] == 'InStock'
                and row['source_url'] == source.PROJECT_URL + '/' + key + '?projectId=1', 'invalid_lot')
        ids.add(key)
        addresses.add(address)
        plans = row['plans']
        require(isinstance(plans, list) and 1 <= len(plans) <= 3, 'invalid_plans')
        views = set()
        for plan in plans:
            sha, view = plan['sha256'], plan['type']
            url = plan['local_path']
            match = re.fullmatch(r'api/catalog-plan\.php\?preview=([a-f0-9]{64})&file=' + re.escape(sha) + r'\.svg', url)
            require(checksum(sha) and view in ('furnished', 'unfurnished', 'floor') and view not in views
                    and (url == sync.public_path(sha) or match), 'plan_binding')
            views.add(view)
            source_url = plan['source_url']
            folder = {'furnished': 'plan-meb', 'unfurnished': 'plan', 'floor': 'plan-floor'}[view]
            require(isinstance(source_url, str) and re.fullmatch(re.escape(source.ORIGIN)
                    + '/upload/plans/house-by-the-sea/' + folder + r'/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,119}\.svg', source_url), 'invalid_plan_source')
            svg, webp = 'private/media/' + sha + '.svg', 'private/media/' + sha + '.preview.webp'
            require(svg in bodies and webp in bodies and digest(bodies[svg]) == sha, 'missing_plan')
            if match:
                require(match[1] == digest(bodies[webp]), 'preview_binding')
            media.svg(bodies[svg])
            media.webp(bodies[webp])
            referenced.update((svg, webp))
    require(referenced == set(files), 'unreferenced_payload')
    generated = subprocess.run([node, str(ROOT / 'scripts/catalog-snapshot.mjs')],
                               input=sync.encode({'date': date, 'lots': catalog['lots']}),
                               capture_output=True, timeout=30)
    require(generated.returncode == 0 and generated.stdout == bodies[primary], 'native_render_mismatch')
    return manifest, projection, bodies


class Publisher:
    def __init__(self, home, url, node='node', php='php'):
        # This PR intentionally cannot target a real account. No environment override.
        temp = Path(tempfile.gettempdir()).resolve()
        require(home.is_absolute() and home.resolve() == home and home.parent == temp
                and home.name.startswith('dom-publisher-'), 'temporary_local_home_required')
        directory(home)
        parsed = urlsplit(url)
        require(parsed.scheme == 'http' and parsed.hostname == '127.0.0.1' and parsed.port
                and not parsed.username and not parsed.password and parsed.path in ('', '/')
                and not parsed.query and not parsed.fragment, 'loopback_url_required')
        self.port, self.node = parsed.port, node
        self.store = sync.Store(home, node=node, php=php)
        self.root, self.state = self.store.root, self.store.state
        require(self.store.doc.resolve() == self.store.doc and self.store.doc.is_dir(), 'local_site_required')
        for path in (self.root.parent, self.root, self.store.media, self.store.snapshots,
                     self.store.website_lock.parent):
            mkdir(path)
        self.transactions = mkdir(self.root / 'publisher-transactions')
        mkdir(self.store.media / 'previews')
        # Exactly the existing lock paths and order used by the legacy worker.
        for path in (self.store.running, self.store.website_lock):
            with sync.lock(path, create=True):
                pass

    def locks(self):
        import contextlib
        stack = contextlib.ExitStack()
        try:
            stack.enter_context(sync.lock(self.store.running))
            stack.enter_context(sync.lock(self.store.website_lock))
        except BaseException:
            stack.close()
            raise
        return stack

    def current(self):
        return document(read(self.state, sync.MAX_STATE)) if self.state.exists() or self.state.is_symlink() else None

    def active(self, item):
        return item['active'] if item else 'empty'

    def status(self):
        item = self.current()
        trusted = item is not None and sync.website_status(item, int(time.time())) == 'confirmed'
        return dict(active=self.active(item), owner=(item or {}).get('publisher_owner', 'legacy'),
                    status='confirmed' if trusted else 'unconfirmed', trust_loss=not trusted,
                    pending=(item or {}).get('publisher_pending'), package=(item or {}).get('publisher_package'))

    def request(self, path, method):
        conn = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        try:
            conn.request(method, path)
            response = conn.getresponse()
            body = response.read(10 * 1024 * 1024 + 1)
            require(len(body) <= 10 * 1024 * 1024, 'http_body_limit')
            return response.status, {k.lower(): v for k, v in response.getheaders()}, body
        finally:
            conn.close()

    def check_http(self, item):
        version = self.active(item) if item else 'bundled'
        status = sync.website_status(item, int(time.time())) if item else 'confirmed'
        template = digest((self.store.doc / 'index.html').read_bytes())
        for method in ('GET', 'HEAD'):
            code, headers, body = self.request('/', method)
            require(code == 200 and headers.get('x-dom-catalog-snapshot') == version
                    and headers.get('x-dom-catalog-status') == status and 'no-store' in headers.get('cache-control', '')
                    and headers.get('x-dom-catalog-template') == template, 'http_verification_failed')
            if method == 'GET' and item:
                match = re.search(rb'<script id="site-data" type="application/json">(.*?)</script>', body, re.S)
                require(match is not None, 'browser_data_missing')
                data = document(match[1])
                snap = self.store.read_snapshot(item['active'])
                require(data['catalog_version'] == version and data['catalog_status'] == status
                        and [(r['id'], r['price_rub']) for r in data['apartments']]
                        == [(r['id'], r['price_rub']) for r in snap['lots']], 'http_catalog_mismatch')

    def owner(self, expected, owner):
        with self.locks():
            self.worker_guard()
            item = self.current()
            require(item is not None and self.active(item) == expected, 'base_conflict')
            require(not item.get('started_at') and not item.get('pending_verification')
                    and not item.get('publisher_pending'), 'unfinished_operation')
            self.check_http(item)
            item['publisher_owner'] = owner
            self.store.save(item)
        return self.status()

    def worker_guard(self):
        runtime = self.root / 'runtime'
        if runtime.exists() or runtime.is_symlink():
            directory(runtime)
            directory(runtime / 'scripts')
            for name in ('catalog_sync.py', 'catalog-cron.sh'):
                require(read(runtime / 'scripts' / name, 128 * 1024) == (ROOT / 'scripts' / name).read_bytes(),
                        'installed_worker_requires_guarded_migration')

    def installed_files(self, item):
        if item is None:
            return {}
        native = item['active']
        snap = self.store.read_snapshot(native)
        names = {'snapshots/' + native + '.json'}
        for row in snap['lots']:
            for plan in row['plans']:
                sha = plan['sha256']
                require(checksum(sha), 'invalid_installed_plan')
                names.add('media/' + sha + '.svg')
                url = plan['local_path']
                preview = parse_qs(urlsplit(url).query).get('preview', [])
                require(len(preview) <= 1 and (not preview or checksum(preview[0])), 'invalid_installed_preview')
                names.add('media/previews/' + preview[0] + '.webp' if preview else 'media/' + sha + '.preview.webp')
        files = {}
        for name in names:
            raw = read(self.root / name, sync.MAX_SNAPSHOT if name.startswith('snapshots/') else source.MAX_SVG)
            files[name] = dict(sha256=digest(raw), bytes=len(raw))
        self.verify_installed(item, files)
        return files

    def verify_installed(self, item, files):
        if item is None:
            require(files == {}, 'invalid_empty_inventory')
            return
        for name, info in files.items():
            require(re.fullmatch(r'(?:snapshots/[a-f0-9]{64}\.json|media/(?:[a-f0-9]{64}\.(?:svg|preview\.webp)|previews/[a-f0-9]{64}\.webp))', name),
                    'invalid_installed_path')
            raw = read(self.root / name, sync.MAX_SNAPSHOT if name.startswith('snapshots/') else source.MAX_SVG)
            require(info == dict(sha256=digest(raw), bytes=len(raw)), 'installed_checksum')
            if name.endswith('.svg'):
                require(digest(raw) == Path(name).stem, 'installed_svg_checksum')
                media.svg(raw)
            elif name.endswith('.webp'):
                media.webp(raw, legacy='/previews/' not in name)
                if '/previews/' in name:
                    require(digest(raw) == Path(name).stem, 'installed_preview_checksum')
        self.store.read_snapshot(item['active'])
        self.store.verify_render(read(self.store.snapshots / (item['active'] + '.json'), sync.MAX_SNAPSHOT))

    def invalidate(self, expected, expected_package):
        """Local source-loss signal, with the same lock/CAS as publication; never sends mail."""
        with self.locks():
            item = self.current()
            require(item and item['active'] == expected and item.get('publisher_package') == expected_package
                    and checksum(expected_package) and item.get('publisher_owner') == 'publisher', 'confirmation_conflict')
            require(not item.get('publisher_pending') and not item.get('started_at'), 'unfinished_operation')
            if item.get('source_ok') is True:
                item.update(source_ok=False, publisher_trust_loss={'at': int(time.time()), 'reason': 'source_unavailable'})
                self.store.save(item)
            self.check_http(item)
        return self.status()

    def immutable(self, path, raw):
        if path.exists() or path.is_symlink():
            require(read(path, max(len(raw), 1)) == raw, 'immutable_collision')
        else:
            sync.atomic(path, raw)

    def receipt(self, token):
        require(isinstance(token, str) and re.fullmatch(r'[a-f0-9]{32}', token), 'invalid_transaction')
        return document(read(self.transactions / (token + '.json'), 6 * 1024 * 1024))

    def rollback(self, candidate, before):
        # CAS covers all bytes, including any operational fields, not only native SHA.
        require(self.current() == candidate, 'rollback_conflict')
        if before is None:
            self.state.unlink()
            sync.sync_directory(self.root)
        else:
            self.store.save(before)

    def finish(self, candidate):
        self.check_http(candidate)
        require(self.current() == candidate, 'finalize_conflict')
        done = dict(candidate)
        done.pop('publisher_pending', None)
        self.store.save(done)

    def install(self, package, expected_sha, expected):
        manifest, projection, bodies = verify_package(package, expected_sha, self.node)
        with self.locks():
            self.worker_guard()
            before = self.current()
            require(before is None or before.get('publisher_owner', 'legacy') == 'publisher', 'legacy_owner_active')
            require(before is None or projection['checked_at'] >= before['checked_at'], 'stale_confirmation')
            same = before and before.get('publisher_package') == expected_sha and before['active'] == projection['active']
            require(same or 0 <= time.time() - projection['checked_at'] <= sync.CHECK_MAX_AGE, 'package_unconfirmed')
            require(before is None or same or projection['checked_at'] > before['checked_at'], 'new_confirmation_required')
            require(same or self.active(before) == expected, 'base_conflict')
            require(not (before or {}).get('started_at') and not (before or {}).get('pending_verification'), 'unfinished_worker')
            require(not (before or {}).get('publisher_pending') or same, 'pending_publisher')
            # Preflight ties loopback server to this exact copied site's current state.
            if not (same and before.get('publisher_pending')):
                self.check_http(before)
            before_files = self.installed_files(before)
            targets = {}
            preview_shas = {p['sha256'] for row in document(bodies[manifest['native_path']])['lots'] for p in row['plans']
                            if 'preview=' in p['local_path']}
            for name, raw in bodies.items():
                if name != 'private/state.json':
                    relative = name.removeprefix('private/')
                    if name.endswith('.preview.webp') and Path(name).name[:64] in preview_shas:
                        relative = 'media/previews/' + digest(raw) + '.webp'
                    targets[relative] = dict(sha256=digest(raw), bytes=len(raw))
                    self.immutable(self.root / relative, raw)
            if same:
                if before.get('publisher_pending'):
                    try:
                        self.finish(before)
                    except Exception:
                        record = self.receipt(before['publisher_pending'])
                        self.verify_installed(record['before'], record['before_files'])
                        self.rollback(before, record['before'])
                        raise
                else:
                    self.check_http(before)
                return self.status()
            self.store.verify_render(bodies[manifest['native_path']])
            token = uuid.uuid4().hex
            candidate = copy.deepcopy(before) if before else dict(history=[], etags={}, outbox=[], history_events=[], started_at=None)
            candidate.update(projection)
            candidate.pop('publisher_trust_loss', None)
            candidate.pop('publisher_restored_from', None)
            candidate.update(publisher_owner='publisher', publisher_package=expected_sha,
                             publisher_source=manifest['source_sha256'], publisher_observation=manifest['observation_sha256'],
                             publisher_txn=token, publisher_pending=token)
            candidate['history'] = [projection['active']] + [v for v in candidate['history'] if v != projection['active']]
            self.immutable(self.transactions / (token + '.json'), sync.encode(dict(schema=1, before=before, candidate=candidate,
                                                                                 before_files=before_files, files=targets)))
            self.store.save(candidate)  # Sole switch, fsync file + same-filesystem rename + fsync directory.
            try:
                self.finish(candidate)
            except Exception:
                self.verify_installed(before, before_files)
                self.rollback(candidate, before)
                raise
            return self.status()

    def restore(self, expected):
        with self.locks():
            self.worker_guard()
            item = self.current()
            if item is None:
                for path in self.transactions.glob('*.json'):
                    record = self.receipt(path.stem)
                    if record['before'] is None and record['candidate']['active'] == expected:
                        self.check_http(None)
                        return self.status()
                raise ValueError('restore_conflict')
            if item and item.get('publisher_restored_from') == expected:
                self.check_http(item)
                return self.status()
            require(item and item['active'] == expected and item.get('publisher_owner') == 'publisher', 'restore_conflict')
            require(not item.get('started_at') and not item.get('pending_verification'), 'unfinished_worker')
            record = self.receipt(item.get('publisher_txn'))
            before = record['before']
            self.verify_installed(before, record['before_files'])
            if before:
                self.store.read_snapshot(before['active'])
                # Keep current worker extensions and queues; restore only catalog projection and provenance.
                restored = copy.deepcopy(item)
                for key in PROJECTION | {k for k in item if k.startswith('publisher_')}:
                    restored.pop(key, None)
                restored.update({k: v for k, v in before.items() if k in PROJECTION or k.startswith('publisher_')})
                restored.update(publisher_owner='publisher', publisher_restored_from=expected)
                restored.pop('publisher_pending', None)
                if not item.get('publisher_pending'):
                    restored['source_ok'] = False  # Manual rollback is not a new source confirmation.
                restored['history'] = [before['active']] + [v for v in item['history'] if v != before['active']]
            else:
                restored = None
            self.rollback(item, restored)
            try:
                self.check_http(restored)
            except Exception:
                self.rollback(restored, item)
                raise
            return self.status()


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['verify', 'install', 'status', 'restore', 'owner', 'invalidate'])
    parser.add_argument('--package', type=Path)
    parser.add_argument('--sha')
    parser.add_argument('--home', type=Path)
    parser.add_argument('--url')
    parser.add_argument('--expect', help='Native SHA or empty; independent CAS baseline')
    parser.add_argument('--expect-package', help='Exact confirmation/package SHA for a source-loss signal')
    parser.add_argument('--owner', choices=['publisher', 'legacy'])
    args = parser.parse_args()
    if args.action == 'verify':
        manifest, _, _ = verify_package(args.package, args.sha)
        result = dict(package=args.sha, native=manifest['native_sha256'], r2a=R2A)
    else:
        require(args.home and args.url, 'local_home_and_url_required')
        publisher = Publisher(args.home, args.url)
        if args.action == 'install':
            require(args.package and args.sha and (args.expect == 'empty' or checksum(args.expect)), 'explicit_input_required')
            result = publisher.install(args.package, args.sha, args.expect)
        elif args.action == 'restore':
            require(checksum(args.expect), 'expected_native_sha_required')
            result = publisher.restore(args.expect)
        elif args.action == 'owner':
            require(checksum(args.expect) and args.owner, 'explicit_owner_and_base_required')
            result = publisher.owner(args.expect, args.owner)
        elif args.action == 'invalidate':
            require(checksum(args.expect) and checksum(args.expect_package), 'expected_confirmation_required')
            result = publisher.invalidate(args.expect, args.expect_package)
        else:
            result = publisher.status()
            publisher.check_http(publisher.current())
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 3 if args.action == 'status' and result['trust_loss'] else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, TypeError, AttributeError, subprocess.SubprocessError) as exc:
        print('publisher: ' + str(exc), file=sys.stderr)
        sys.exit(2)
