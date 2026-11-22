"""Offline production-shaped receiver checks. Set RPM_REPO to the reviewed manager checkout."""

import base64
from io import BytesIO
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit

import catalog_publisher as p
import rpm_receiver as receiver

sys.path.insert(0, str(p.ROOT / 'tests'))
from r2b_support import ROUTER, guarded_runtime, legacy_bootstrap, site


SVG = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><rect width="2" height="2"/></svg>'
WEBP = base64.b64decode('UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoBAAEAAgA0JaACdLoB+AADsAD+8MQL/yC5YXXI1/8gP+QH/ID/+PIAAAA=')


class LostReceipt(BytesIO):
    def write(self, body):
        if json.loads(body)['op'] == 'published':
            raise BrokenPipeError
        return super().write(body)


class ReceiverTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(Path(os.environ['RPM_REPO']).resolve() / 'price_manager'))

    def setUp(self):
        self.home = Path(self.enterContext(tempfile.TemporaryDirectory(prefix='dom-publisher-'))).resolve()
        self.public = site(self.home)
        (self.public / 'fixture-router.php').write_text(ROUTER)
        local = p.Publisher(self.home, 'http://127.0.0.1:3333')
        self.legacy = legacy_bootstrap(local)
        guarded_runtime(local)
        with patch.object(p, 'JINO_HOME', self.home), patch.object(p.sync, 'NODE', shutil.which('node')), \
                patch.object(p.sync, 'PHP', shutil.which('php')):
            self.pub = p.Publisher.for_jino()
        self.pub.request = self.cgi
        self.staging = self.home / 'staging'
        self.staging.mkdir(mode=0o700)
        self.checked = int(time.time()) - 180
        if p.source.day(self.checked + 3) != p.source.day(self.checked):
            self.checked -= 10

    def cgi(self, path, method):
        uri = urlsplit(path)
        name = 'index.php' if uri.path == '/' else 'fixture-router.php' if uri.path == '/_validate' else uri.path[1:]
        env = dict(os.environ, REDIRECT_STATUS='1', GATEWAY_INTERFACE='CGI/1.1', SERVER_PROTOCOL='HTTP/1.1',
                   SCRIPT_FILENAME=str(self.public / name), SCRIPT_NAME='/' + name, REQUEST_METHOD=method,
                   REQUEST_URI=path, QUERY_STRING=uri.query, DOCUMENT_ROOT=str(self.public))
        process = subprocess.run(['php-cgi', '-d', 'display_errors=0'], input=b'', capture_output=True,
                                 cwd=self.public, env=env, check=True, timeout=10)
        headers, _, body = process.stdout.partition(b'\r\n\r\n')
        parsed = {k.lower(): v.strip() for k, v in (line.split(':', 1) for line in headers.decode().splitlines())}
        return int(parsed.get('status', '200').split()[0]), parsed, body

    def bundle(self, label, price, checked):
        package = self.home / label
        package.mkdir(mode=0o700)
        sha, preview = p.digest(SVG), p.digest(WEBP)
        lot = self.pub.store.read_snapshot(self.legacy)['lots'][0]
        lot.update(price_rub=price, snapshot_date=p.source.day(checked), plans=[dict(
            lot['plans'][0], sha256=sha, local_path='api/catalog-plan.php?preview=' + preview + '&file=' + sha + '.svg')])
        raw = subprocess.check_output(['node', str(p.ROOT / 'scripts/catalog-snapshot.mjs')],
                                      input=p.sync.encode(dict(date=lot['snapshot_date'], lots=[lot])), timeout=10)
        native = p.digest(raw)
        primary = 'private/snapshots/' + native + '.json'
        files = {primary: raw, 'private/media/' + sha + '.svg': SVG, 'private/media/' + sha + '.preview.webp': WEBP,
                 'private/state.json': p.sync.encode(dict(schema=1, active=native, source_ok=True,
                                                          checked_at=checked, published_checked_at=checked))}
        for name, body in files.items():
            target = package / name
            for folder in reversed(target.relative_to(package).parents):
                (package / folder).mkdir(mode=0o700, exist_ok=True)
            p.sync.atomic(target, body)
        inventory = {name: dict(sha256=p.digest(body), bytes=len(body)) for name, body in files.items()}
        manifest = p.sync.encode(dict(schema=1, format=p.FORMAT, namespace=p.NAMESPACE, source_sha256=sha,
                                     observation_sha256=preview, native_sha256=native, native_path=primary,
                                     checked_at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(checked)), files=inventory))
        p.sync.atomic(package / 'manifest.json', manifest)
        return manifest, native, files, lot['id']

    def deliver(self, bundle, base, sink=None):
        manifest, native, files, _ = bundle
        values = {p.digest(body): body for body in files.values()}
        missing = [sha for sha in sorted(values) if not (self.staging / 'blobs' / sha).exists()]
        message = dict(op='offer', schema=1, namespace=p.NAMESPACE, manifest_sha256=p.digest(manifest),
                       native_sha256=native, expected_active=base, manifest_bytes=len(manifest))
        raw = p.sync.encode(message) + manifest + b''.join(values[sha] for sha in missing) + b'{"op":"commit"}\n'
        sink = BytesIO() if sink is None else sink
        result = receiver.receive(self.pub, self.staging, source=BytesIO(raw), sink=sink)
        return result, [json.loads(line) for line in sink.getvalue().splitlines()]

    def test_receiver_cas_replay_and_previous_public_surfaces(self):
        a = self.bundle('a', 7_100_000, self.checked)
        b = self.bundle('b', 7_200_000, self.checked + 2)
        reconfirm = self.bundle('c', 7_200_000, self.checked + 3)
        legacy_row = self.pub.store.read_snapshot(self.legacy)['lots'][0]
        historical = '/' + legacy_row['plans'][0]['local_path'].replace('.svg', '.preview.webp')
        historical_body = self.cgi(historical, 'GET')[2]
        self.assertEqual(self.deliver(a, self.legacy)[1][-1]['code'], 'publication_refused')
        self.pub.owner(self.legacy, 'publisher')

        # Drop the receipt after the real publisher finalizes; retry sends no cached content.
        code, results = self.deliver(a, self.legacy, LostReceipt())
        self.assertEqual((code, results[-1]['code']), (1, 'staging_io'))
        saved = self.pub.state.read_bytes()
        code, results = self.deliver(a, self.legacy)
        self.assertEqual((code, results[0]['missing'], results[1]['op']), (0, [], 'published'))
        self.assertEqual(self.pub.state.read_bytes(), saved)

        for lock in (self.pub.store.running, self.pub.store.website_lock):
            with p.sync.lock(lock):
                self.assertEqual(self.deliver(b, a[1])[1][-1]['code'], 'publication_busy')
        self.assertEqual(self.deliver(b, self.legacy)[1][-1]['code'], 'publication_refused')
        self.assertEqual(self.pub.state.read_bytes(), saved)
        with patch.object(self.pub, 'request', return_value=(429, {}, b'')):
            self.assertEqual(self.deliver(b, a[1])[1][-1]['code'], 'publication_unavailable')
        def temporarily_unavailable(path, method):
            return (503, {}, b'') if self.pub.current()['active'] == b[1] else self.cgi(path, method)
        with patch.object(self.pub, 'request', side_effect=temporarily_unavailable):
            self.assertEqual(self.deliver(b, a[1])[1][-1]['code'], 'publication_unavailable')
        self.assertEqual(self.pub.state.read_bytes(), saved)
        self.assertEqual(self.deliver(b, a[1])[0], 0)
        self.assertEqual(self.deliver(reconfirm, b[1])[0], 0)

        b_sha, c_sha = p.digest(b[0]), p.digest(reconfirm[0])
        with self.assertRaisesRegex(ValueError, 'restore_conflict'):
            self.pub.restore(b[1], b_sha)
        with self.assertRaisesRegex(ValueError, 'restore_legacy_before_owner'):
            self.pub.owner(b[1], 'legacy')
        self.assertEqual(self.cgi(historical, 'GET')[2], historical_body)
        path = '/_validate?id=' + b[3] + '&price=7200000&version='
        self.assertEqual(self.cgi(path + a[1], 'GET')[0], 409)
        self.assertEqual(self.cgi(path + b[1], 'GET')[0], 200)
        self.assertEqual(self.pub.restore(b[1], c_sha)['package'], b_sha)
        self.assertEqual(self.pub.restore(b[1], c_sha)['package'], b_sha)
        restored = self.pub.state.read_bytes()
        self.assertEqual(self.deliver(reconfirm, b[1])[1][-1]['code'], 'publication_refused')
        self.assertEqual(self.pub.state.read_bytes(), restored)
        self.assertEqual(self.pub.restore(b[1], b_sha)['active'], a[1])
        self.assertEqual(self.deliver(b, a[1])[1][-1]['code'], 'publication_refused')
        self.assertEqual(self.pub.restore(a[1], p.digest(a[0]))['active'], self.legacy)
        self.assertEqual(self.pub.owner(self.legacy, 'legacy')['owner'], 'legacy')

    def test_migration_is_exact_and_recoverable(self):
        worker = self.pub.root / 'runtime/scripts/catalog_sync.py'
        old = subprocess.check_output(['git', '-C', str(p.ROOT), 'show', 'f75b518:scripts/catalog_sync.py'])
        self.assertEqual(p.digest(old), p.LEGACY_WORKER_SHA)
        p.sync.atomic(worker, b'unknown script')
        with self.assertRaisesRegex(ValueError, 'unknown_installed_worker'):
            self.pub.prepare_jino(self.legacy)
        p.sync.atomic(worker, old)
        before = self.pub.state.read_bytes()
        with self.assertRaisesRegex(ValueError, 'base_conflict'):
            self.pub.prepare_jino('f' * 64)
        self.assertEqual(worker.read_bytes(), old)
        self.assertEqual(self.pub.prepare_jino(self.legacy)['owner'], 'legacy')
        self.assertEqual(worker.read_bytes(), (p.ROOT / 'scripts/catalog_sync.py').read_bytes())
        self.assertEqual((self.pub.transactions / ('legacy-worker-' + p.LEGACY_WORKER_SHA + '.py')).read_bytes(), old)
        self.assertEqual(self.pub.state.read_bytes(), before)
        self.assertEqual(self.pub.prepare_jino(self.legacy)['active'], self.legacy)

    def test_forced_command_rejects_changed_command_before_account_access(self):
        for original, args in (('', ['receive']), ('id', ['receive']), ('rpm-receive-v1', ['owner'])):
            with patch.dict(os.environ, {'SSH_ORIGINAL_COMMAND': original}), patch.object(receiver.Publisher, 'for_jino') as factory:
                with self.assertRaisesRegex(ValueError, 'receiver_command_required'):
                    receiver.main(args)
                factory.assert_not_called()


if __name__ == '__main__':
    unittest.main()
