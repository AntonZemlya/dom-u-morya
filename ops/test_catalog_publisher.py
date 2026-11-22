"""Required R2A integration: R2A_REPO=/clean/pinned/checkout python3 -B ops/test_catalog_publisher.py."""
import copy
import json
import os
from pathlib import Path
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import catalog_publisher as p
sys.path.insert(0, str(p.ROOT / 'tests'))
from r2b_fixtures import packages
from r2b_support import site, server, legacy_bootstrap, guarded_runtime


class PublisherTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = tempfile.TemporaryDirectory(prefix='dom-publisher-packages-')
        repo = Path(os.environ['R2A_REPO'])
        if os.environ.get('R2B_FIXTURES'):
            cls.packages = json.loads(Path(os.environ['R2B_FIXTURES']).read_bytes())['packages']
        else:
            cls.packages = packages(repo, Path(cls.fixture.name).resolve(), os.environ.get('R2B_CHECKED_AT'))

    @classmethod
    def tearDownClass(cls):
        cls.fixture.cleanup()

    def setUp(self):
        self.home = Path(self.enterContext(tempfile.TemporaryDirectory(prefix='dom-publisher-'))).resolve()
        self.public = site(self.home)
        self.url = self.enterContext(server(self.public))
        self.pub = p.Publisher(self.home, self.url)
        self.a, self.b, self.c = self.packages

    def install(self, bundle, expected='empty'):
        return self.pub.install(Path(bundle['directory']), bundle['package'], expected)

    def check_fields(self, key, price, version=None):
        path = '/_validate?id=' + key + '&price=' + str(price)
        if version:
            path += '&version=' + version
        return self.pub.request(path, 'GET')[0]

    def test_surfaces_headers_media_version_gate_and_trust_loss(self):
        # Old bundled public pages remain accepted before first private publication.
        self.assertEqual(self.check_fields('22825', 7117760), 200)
        self.install(self.a)
        v1, v2 = self.a['native'], self.b['native']
        self.assertEqual(self.check_fields('900001', 7000000, v1), 200)
        self.assertEqual(self.check_fields('900001', 7000000), 409)
        code, headers, body = self.pub.request('/', 'GET')
        self.assertEqual(code, 200)
        html = body.decode()
        self.assertIn('data-lot-id="900001"', html)
        self.assertIn('value="7000000" id="price-range"', html)
        import re
        data = json.loads(re.search(r'<script id="site-data" type="application/json">(.*?)</script>', html, re.S)[1])
        self.assertEqual(data['catalog_version'], v1)
        self.assertEqual(len(data['apartments']), 26)
        graph = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)[1])['@graph']
        offers = {r['itemOffered']['@id'].split('-')[-1]: r['price'] for node in graph for r in node.get('offers', [])}
        self.assertEqual(offers, {row['id']: row['price_rub'] for row in data['apartments']})
        old_media = '/' + data['apartments'][0]['plans'][0]['local_path']
        for method in ('GET', 'HEAD'):
            self.assertEqual(self.pub.request(old_media, method)[0], 200)
            self.assertEqual(self.pub.request(old_media.replace('.svg', '.preview.webp'), method)[0], 200)
        self.install(self.b, v1)
        self.assertEqual(self.pub.request(old_media, 'GET')[0], 200)
        self.assertEqual(self.check_fields('900001', 7000000, v2), 409)
        self.assertEqual(self.check_fields('900026', 7000000, v2), 409)
        self.assertEqual(self.check_fields('900002', 7000000, v1), 409)  # unchanged selected price, stale whole version
        self.assertEqual(self.check_fields('900002', 7000000, v2), 200)
        before = self.pub.current()
        self.pub.invalidate(v2, self.b['package'])
        lost = self.pub.current()
        self.assertFalse(lost['source_ok'])
        self.assertEqual((lost['active'], lost['published_checked_at']), (before['active'], before['published_checked_at']))
        self.assertEqual(self.check_fields('900002', 7000000, v2), 409)
        self.assertTrue(self.pub.status()['trust_loss'])
        self.pub.invalidate(v2, self.b['package'])
        self.assertEqual(self.pub.current(), lost)
        self.install(self.b, v1)  # identical replay never re-establishes lost confirmation
        self.assertEqual(self.pub.current(), lost)
        self.install(self.c, v2)  # real exporter: same native, later verified confirmation
        self.assertEqual(self.check_fields('900002', 7000000, v2), 200)
        self.assertNotIn('publisher_trust_loss', self.pub.current())
        confirmed = self.pub.state.read_bytes()
        with self.assertRaisesRegex(ValueError, 'confirmation_conflict'):
            self.pub.invalidate(v2, self.b['package'])  # delayed failed attempt cannot invalidate newer same-native check
        self.assertEqual(self.pub.state.read_bytes(), confirmed)
        # TTL independently expires even with source_ok still true; no JSON edits.
        at = self.pub.current()['checked_at'] + p.sync.CHECK_MAX_AGE + 1
        with patch.object(p.time, 'time', return_value=at):
            self.assertTrue(self.pub.status()['trust_loss'])
            with patch.object(self.pub, 'check_http'):
                self.assertEqual(self.install(self.c, v2)['status'], 'unconfirmed')
            self.assertEqual(self.pub.state.read_bytes(), confirmed)
        php = r'''namespace DomCatalog; function time(){return (int)$GLOBALS['argv'][2];}
require $argv[1].'/api/lead-core.php';
echo current()['status']."\n";
try { \DomLead\validate(json_encode(['name'=>'Fixture','phone'=>'+70000000000','consent'=>true,
'consentVersion'=>\DomLead\CONSENT_VERSION,'lotId'=>'900002','lotPrice'=>7000000,'catalogVersion'=>current()['version']])); }
catch (\DomLead\Rejection $e) { echo $e->status; }
'''
        actual = subprocess.check_output(['php', '-r', php, str(self.public), str(at)], text=True)
        self.assertEqual(actual, 'unconfirmed\n409')

    def test_operational_fields_preserved_owner_control_and_shared_locks(self):
        self.install(self.a)
        item = self.pub.current()
        item.update(outbox=[{'id': 'existing-not-delivered'}], etags={'untouched': {'etag': 'x'}},
                    history_events=[{'outcome': 'worker'}], future_worker_field={'keep': 1}, unresolved_count=7)
        self.pub.store.save(item)
        self.install(self.b, self.a['native'])
        current = self.pub.current()
        for key in ('outbox', 'etags', 'history_events', 'future_worker_field', 'unresolved_count'):
            self.assertEqual(current[key], item[key])
        with patch.object(self.pub.store, 'flush') as delivery:
            with self.assertRaisesRegex(ValueError, 'публикатору'):
                self.pub.store.run()
            delivery.assert_not_called()
        for lock in (self.pub.store.running, self.pub.store.website_lock):
            with p.sync.lock(lock):
                with self.assertRaises(BlockingIOError):
                    self.install(self.c, self.b['native'])
        self.pub.owner(self.b['native'], 'legacy')
        with self.assertRaisesRegex(ValueError, 'legacy_owner_active'):
            self.install(self.c, self.b['native'])
        self.pub.owner(self.b['native'], 'publisher')
        self.install(self.c, self.b['native'])

    def test_repeat_conflict_collision_and_stale(self):
        self.install(self.a)
        initial = self.pub.state.read_bytes()
        self.install(self.a)
        self.assertEqual(self.pub.state.read_bytes(), initial)
        with self.assertRaisesRegex(ValueError, 'base_conflict'):
            self.install(self.b, '0' * 64)
        self.assertEqual(self.pub.state.read_bytes(), initial)
        media = next(self.pub.store.media.glob('*.svg'))
        media.write_bytes(b'damaged')
        with self.assertRaises(ValueError):
            self.install(self.a)
        self.assertEqual(self.pub.state.read_bytes(), initial)

    def test_manifest_inventory_types_hashes_and_safe_svg_guard(self):
        bundle = Path(self.a['directory'])
        for defect in ('snapshot', 'plan', 'namespace', 'missing', 'symlink', 'extra', 'type', 'projection', 'render'):
            with self.subTest(defect=defect), tempfile.TemporaryDirectory(prefix='dom-publisher-input-') as temp:
                target = Path(temp).resolve() / 'package'
                shutil.copytree(bundle, target)
                manifest = json.loads((target / 'manifest.json').read_bytes())
                if defect in ('snapshot', 'plan'):
                    name = manifest['native_path'] if defect == 'snapshot' else next(n for n in manifest['files'] if n.endswith('.svg'))
                    (target / name).write_bytes(b'damage')
                elif defect == 'namespace':
                    manifest['namespace'][1] = '22'
                elif defect == 'missing':
                    (target / 'private/state.json').unlink()
                elif defect == 'symlink':
                    (target / 'private/state.json').unlink()
                    (target / 'private/state.json').symlink_to(bundle / 'private/state.json')
                elif defect == 'extra':
                    (target / 'extra.txt').write_text('safe unexpected file')
                elif defect == 'type':
                    manifest['schema'] = True
                elif defect == 'projection':
                    path = target / 'private/state.json'
                    doc = json.loads(path.read_bytes())
                    doc['checked_at'] += 1
                    path.write_bytes(p.sync.encode(doc))
                    manifest['files']['private/state.json'] = {'sha256': p.digest(path.read_bytes()), 'bytes': path.stat().st_size}
                else:
                    path = target / manifest['native_path']
                    raw = path.read_bytes().replace(b'plan-price', b'plan-wrong')
                    new = p.digest(raw)
                    manifest['files'].pop(manifest['native_path'])
                    path.unlink()
                    manifest['native_path'] = 'private/snapshots/' + new + '.json'
                    manifest['native_sha256'] = new
                    (target / manifest['native_path']).write_bytes(raw)
                    (target / manifest['native_path']).chmod(0o600)
                    state = target / 'private/state.json'
                    doc = json.loads(state.read_bytes()); doc['active'] = new
                    state.write_bytes(p.sync.encode(doc))
                    for name in ('private/state.json', manifest['native_path']):
                        raw2 = (target / name).read_bytes()
                        manifest['files'][name] = {'sha256': p.digest(raw2), 'bytes': len(raw2)}
                raw = p.sync.encode(manifest)
                (target / 'manifest.json').write_bytes(raw)
                with self.assertRaises((ValueError, OSError)):
                    self.pub.install(target, p.digest(raw), 'empty')
                self.assertIsNone(self.pub.current())
        # Benign unsupported tag: exercises the defensive allowlist without an exploit payload.
        with self.assertRaises(ValueError):
            p.media.svg(b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><metadata>fixture</metadata></svg>')

    def test_read_failure_rolls_back_and_manual_restore_is_cas(self):
        self.install(self.a)
        before = self.pub.current()
        check = self.pub.check_http
        def failed(item):
            if item and item['active'] == self.b['native']:
                raise ValueError('control_read_failure')
            return check(item)
        with patch.object(self.pub, 'check_http', side_effect=failed):
            with self.assertRaisesRegex(ValueError, 'control_read_failure'):
                self.install(self.b, self.a['native'])
        self.assertEqual(self.pub.current(), before)
        self.install(self.b, self.a['native'])
        with self.assertRaisesRegex(ValueError, 'restore_conflict'):
            self.pub.restore('0' * 64)
        self.pub.restore(self.b['native'])
        self.assertEqual(self.pub.current()['active'], self.a['native'])
        self.assertFalse(self.pub.current()['source_ok'])
        self.pub.restore(self.b['native'])
        with self.assertRaisesRegex(ValueError, 'stale_confirmation'):
            # Reinstalling the older observation after a newer confirmation is tested separately.
            self.install(self.c, self.a['native'])
            self.install(self.a, self.c['native'])

    def test_rollback_refuses_changed_pointer(self):
        self.install(self.a)
        before = self.pub.current()
        self.install(self.b, self.a['native'])
        candidate = self.pub.current()
        changed = dict(candidate, foreign_update=True)
        self.pub.store.save(changed)
        with self.assertRaisesRegex(ValueError, 'rollback_conflict'):
            self.pub.rollback(candidate, before)
        self.assertEqual(self.pub.current(), changed)

    def test_restore_checks_previous_media_and_installed_worker_handshake(self):
        self.install(self.a)
        runtime = self.pub.root / 'runtime'
        (runtime / 'scripts').mkdir(parents=True, mode=0o700)
        runtime.chmod(0o700)
        for name in ('catalog_sync.py', 'catalog-cron.sh'):
            p.sync.atomic(runtime / 'scripts' / name, (p.ROOT / 'scripts' / name).read_bytes())
        p.sync.atomic(runtime / 'scripts/catalog_sync.py', b'old local worker without owner guard')
        original = self.pub.state.read_bytes()
        with self.assertRaisesRegex(ValueError, 'installed_worker_requires_guarded_migration'):
            self.pub.owner(self.a['native'], 'publisher')
        with self.assertRaisesRegex(ValueError, 'installed_worker_requires_guarded_migration'):
            self.install(self.b, self.a['native'])
        self.assertEqual(self.pub.state.read_bytes(), original)
        p.sync.atomic(runtime / 'scripts/catalog_sync.py', (p.ROOT / 'scripts/catalog_sync.py').read_bytes())
        self.install(self.b, self.a['native'])
        record = self.pub.receipt(self.pub.current()['publisher_txn'])
        previous_only = next(n for n in record['before_files'] if n.endswith('.svg') and n not in record['files'])
        p.sync.atomic(self.pub.root / previous_only, b'damaged previous-only media')
        current = self.pub.state.read_bytes()
        with self.assertRaisesRegex(ValueError, 'installed_checksum'):
            self.pub.restore(self.b['native'])
        self.assertEqual(self.pub.state.read_bytes(), current)

    def test_real_legacy_bootstrap_new_preview_encoding_and_recovery(self):
        checked = p.document((Path(self.a['directory']) / 'private/state.json').read_bytes())['checked_at'] - 1
        old = legacy_bootstrap(self.pub, checked)
        guarded_runtime(self.pub)
        sha = '026ef1ab1116319eafed3c5a65c9f3c24034c4d4bb1d17138826dec2ee19cb1d'
        legacy_url = '/api/catalog-plan.php?file=' + sha + '.preview.webp'
        old_raw = self.pub.request(legacy_url, 'GET')[2]
        self.pub.owner(old, 'publisher')
        # Backward-compatible transport without the new preview query must fail safely on a legacy WebP collision.
        with tempfile.TemporaryDirectory(prefix='dom-publisher-legacy-input-') as temp:
            target = Path(temp).resolve() / 'package'
            shutil.copytree(self.a['directory'], target)
            manifest = p.document((target / 'manifest.json').read_bytes())
            snapshot = p.document((target / manifest['native_path']).read_bytes())
            for lot in snapshot['lots']:
                for plan in lot['plans']:
                    plan['local_path'] = p.sync.public_path(plan['sha256'])
            generated = subprocess.check_output(['node', str(p.ROOT / 'scripts/catalog-snapshot.mjs')],
                input=p.sync.encode({'date': snapshot['date'], 'lots': snapshot['lots']}))
            (target / manifest['native_path']).unlink()
            manifest['files'].pop(manifest['native_path'])
            native = p.digest(generated)
            manifest.update(native_sha256=native, native_path='private/snapshots/' + native + '.json')
            (target / manifest['native_path']).write_bytes(generated)
            (target / manifest['native_path']).chmod(0o600)
            projection = p.document((target / 'private/state.json').read_bytes())
            projection['active'] = native
            (target / 'private/state.json').write_bytes(p.sync.encode(projection))
            for name in (manifest['native_path'], 'private/state.json'):
                raw = (target / name).read_bytes()
                manifest['files'][name] = dict(sha256=p.digest(raw), bytes=len(raw))
            raw = p.sync.encode(manifest)
            (target / 'manifest.json').write_bytes(raw)
            baseline = self.pub.state.read_bytes()
            with self.assertRaisesRegex(ValueError, 'immutable_collision'):
                self.pub.install(target, p.digest(raw), old)
            self.assertEqual(self.pub.state.read_bytes(), baseline)
            self.assertEqual(self.pub.request(legacy_url, 'GET')[2], old_raw)
        self.install(self.a, old)
        row = next(r for r in self.pub.store.read_snapshot(self.a['native'])['lots'] if r['id'] == '900001')
        url = '/' + row['plans'][0]['local_path']
        new_raw = self.pub.request(url.replace('.svg', '.preview.webp'), 'GET')[2]
        self.assertNotEqual(p.digest(old_raw), p.digest(new_raw))
        expected_preview = p.digest((Path(self.a['directory']) / ('private/media/' + sha + '.preview.webp')).read_bytes())
        self.assertEqual(p.digest(new_raw), expected_preview)
        self.assertEqual(self.pub.request(legacy_url, 'GET')[2], old_raw)
        self.assertEqual(p.digest(self.pub.request(url, 'GET')[2]), sha)
        print('LEGACY_PREVIEW_BINDINGS ' + json.dumps(dict(svg_sha=sha, legacy_url=legacy_url,
            legacy_webp_sha=p.digest(old_raw), new_url=url.replace('.svg', '.preview.webp'),
            new_webp_sha=expected_preview, before_native=old, after_native=self.a['native']), sort_keys=True))
        self.pub.restore(self.a['native'])
        self.assertEqual(self.pub.current()['active'], old)
        self.pub.owner(old, 'legacy')
        # Offline legacy recovery after handing ownership back; no source or notification transport.
        with patch.object(self.pub.store, 'verify_live'), patch.object(self.pub.store, 'flush', return_value=False), \
             patch.object(self.pub.store, 'prepare', return_value=(self.pub.store.read_snapshot(old)['lots'], {}, [])):
            self.pub.store.run(at=checked+1)
        self.assertEqual(self.pub.current()['active'], old)
        self.assertEqual(self.pub.request(legacy_url, 'GET')[2], old_raw)

    def test_competing_processes_choose_one_base(self):
        self.install(self.a)
        children = []
        for bundle in (self.b, self.c):
            children.append(subprocess.Popen([sys.executable, '-B', str(p.ROOT / 'ops/catalog_publisher.py'), 'install',
              '--home', str(self.home), '--url', self.url, '--expect', self.a['native'],
              '--package', bundle['directory'], '--sha', bundle['package']], stdout=subprocess.PIPE, stderr=subprocess.PIPE))
        results = [child.communicate(timeout=30) for child in children]
        self.assertEqual(sum(child.returncode == 0 for child in children), 1, results)
        self.assertIn(self.pub.current()['publisher_package'], (self.b['package'], self.c['package']))

    def test_restore_empty_and_repeat(self):
        self.install(self.a)
        self.pub.restore(self.a['native'])
        self.assertIsNone(self.pub.current())
        self.pub.restore(self.a['native'])

    def test_process_death_and_lost_response(self):
        self.install(self.a)
        child = r'''
import os, signal, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1]+'/ops')
import catalog_publisher as p
pub=p.Publisher(Path(sys.argv[2]), sys.argv[3])
save=pub.store.save
def crash(item):
    switching=item.get('publisher_pending') and item['active']==sys.argv[7]
    if switching and sys.argv[4]=='before': os.kill(os.getpid(),signal.SIGKILL)
    save(item)
    if switching and sys.argv[4]=='after': os.kill(os.getpid(),signal.SIGKILL)
    if not item.get('publisher_pending') and item['active']==sys.argv[7] and sys.argv[4]=='response': os.kill(os.getpid(),signal.SIGKILL)
pub.store.save=crash
pub.install(Path(sys.argv[5]),sys.argv[6],sys.argv[8])
'''
        for stage in ('before', 'after', 'response'):
            proc = subprocess.run([sys.executable, '-B', '-c', child, str(p.ROOT), str(self.home), self.url,
                                   stage, self.b['directory'], self.b['package'], self.b['native'], self.a['native']])
            self.assertEqual(proc.returncode, -signal.SIGKILL)
            self.assertEqual(self.pub.current()['active'] == self.a['native'], stage == 'before')
            self.install(self.b, self.a['native'])
            self.assertNotIn('publisher_pending', self.pub.current())
            self.pub.restore(self.b['native'])
            self.assertEqual(self.pub.current()['active'], self.a['native'])

    def test_pending_retry_does_not_restore_damaged_previous_media(self):
        self.install(self.a)
        child = r'''
import os, signal, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1]+'/ops')
import catalog_publisher as p
pub = p.Publisher(Path(sys.argv[2]), sys.argv[3])
pub.finish = lambda candidate: os.kill(os.getpid(), signal.SIGKILL)
pub.install(Path(sys.argv[4]), sys.argv[5], sys.argv[6])
'''
        stopped = subprocess.run([sys.executable, '-B', '-c', child, str(p.ROOT), str(self.home), self.url,
                                  self.b['directory'], self.b['package'], self.a['native']])
        self.assertEqual(stopped.returncode, -signal.SIGKILL)
        candidate = self.pub.current()
        self.assertEqual(candidate['active'], self.b['native'])
        self.assertTrue(candidate['publisher_pending'])
        record = self.pub.receipt(candidate['publisher_pending'])
        previous_only = next(name for name in record['before_files']
                             if name.endswith('.svg') and name not in record['files'])
        p.sync.atomic(self.pub.root / previous_only, b'benign previous-only media damage')
        before_retry = self.pub.state.read_bytes()
        with patch.object(self.pub, 'check_http', side_effect=ValueError('benign_finish_control_read_failure')):
            with self.assertRaisesRegex(ValueError, 'installed_checksum'):
                self.install(self.b, self.a['native'])
        self.assertEqual(self.pub.state.read_bytes(), before_retry)
        self.assertEqual(self.pub.current(), candidate)

    def test_private_permissions_and_no_real_home(self):
        self.install(self.a)
        for parent, dirs, files in os.walk(self.pub.root):
            self.assertEqual(stat.S_IMODE(Path(parent).stat().st_mode), 0o700)
            for name in files:
                self.assertEqual(stat.S_IMODE((Path(parent) / name).stat().st_mode), 0o600)
        with self.assertRaisesRegex(ValueError, 'temporary_local_home_required'):
            p.Publisher(Path('/home/users/j/j84938826'), self.url)


if __name__ == '__main__':
    unittest.main(verbosity=2)
