"""Synthetic domain only. No SSH, real SMTP, real config or production restore."""
import base64
import copy
import errno
import http.client
import io
import json
import os
from pathlib import Path
import shutil
import stat
import ssl
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Event, Thread
from unittest.mock import patch
import release_core as c
import release_manager as cli
import release_http
import url_matrix


def deny_external(event,args):
    if event=='socket.connect' and isinstance(args[1],tuple) and args[1][0] not in ['127.0.0.1','::1']:
        raise RuntimeError('External network forbidden')
    if event=='subprocess.Popen' and Path(str(args[0])).name in ['ssh','scp']:
        raise RuntimeError('SSH forbidden in release fixture')
sys.addaudithook(deny_external)


class HTTPSResponse(io.BytesIO):
    def __init__(self,code,headers,body):
        super().__init__(body if isinstance(body,bytes) else b'')
        self.status=code;self.headers=headers;self.body=body

    def read(self,*args):
        if isinstance(self.body,Exception):raise self.body
        return super().read(*args)


class HTTPSFixture:
    """HTTPS origin, front proxy and Apache responses with no external connections."""
    def __init__(self, public=None):
        self.public = public or {'index.html': b'index new', 'script.js': b'script new'}
        self.failures = {}
        self.responses = {}
        self.requests = []
        self.opened = []

    def __call__(self, request, timeout):
        assert request.get_method() in ('GET', 'HEAD') and request.data is None
        assert 0 < timeout <= 15
        url = urllib.parse.urlsplit(request.full_url)
        path = url.path
        self.requests.append(path)
        if self.failures.get(path):
            raise self.failures[path].pop(0)
        if path in self.responses:
            code, headers, body = self.responses[path]
        else:
            code, headers, body = self.response(url)
        response = HTTPSResponse(code, headers, body)
        self.opened.append(response)
        if code >= 300:
            raise urllib.error.HTTPError(request.full_url, code, 'synthetic status', headers, response)
        return response

    def response(self, url):
        assert url.hostname in (c.DOMAIN, 'www.' + c.DOMAIN)
        path = url.path
        suffix = '?' + url.query if url.query else ''
        listings = ['/privacy', '/assets', '/api', '/assets/fonts']
        if url.scheme == 'http' and url.hostname.startswith('www.'):
            return 301, {'Location': 'http://' + c.DOMAIN + path + suffix}, b'Moved'
        if url.scheme == 'https' and url.hostname.startswith('www.'):
            return 301, {'Location': c.ORIGIN + path + suffix}, b'Moved'
        canonical = url_matrix.ALIASES.get(path, path)
        if path in listings:
            canonical += '/'
        if url.scheme != 'https' or url.hostname != c.DOMAIN or canonical != path:
            return 301, {'Location': c.ORIGIN + canonical + suffix}, b'Moved'
        if path in ['/api/lead.php', '/api/analytics-consent.php']:
            return 405, {}, b'GET denied'
        if path == '/api/form-status.php':
            return 200, {'Cache-Control': 'no-store'}, b'{"enabled":true,"ready":true}'
        name = 'index.html' if path == '/' else path[1:]
        if path in url_matrix.PAGES or (name in self.public and not name.startswith('.') and not name.endswith('.php')):
            body = self.public.get(name, b'legal fixture')
            headers = {}
            if name == 'index.html' and self.public.get('.htaccess') is not None and c.sha(self.public['.htaccess']) == c.CATALOG_HTACCESS_SHA256:
                headers = {'Cache-Control': 'no-store', 'X-Dom-Catalog-Template': c.sha(body),
                           'X-Dom-Catalog-Snapshot': 'bundled', 'X-Dom-Catalog-Status': 'confirmed'}
            return 200, headers, body
        return 404, {}, b'protected or missing'

    def client(self, profile='full', **kwargs):
        return release_http.HTTPClient(profile, opener=self, pace=0, **kwargs)

    def manifest(self):
        return dict(public_allowlist=list(self.public),files={'public/'+n:c.sha(b) for n,b in self.public.items()})


class HTTPRetry(unittest.TestCase):
    def setUp(self):
        self.network=HTTPSFixture()
        self.opener=patch.object(self.network,'__call__',side_effect=self.network).start()
        self.sleep=patch.object(release_http.time,'sleep').start()
        self.addCleanup(patch.stopall)

    def verify(self):
        client = release_http.HTTPClient(opener=self.opener, pace=0)
        return cli.http_verify(self.network.manifest(), 'synthetic-package-sha', client=client)

    def test_first_connection_reset_then_success(self):
        self.network.failures['/']=[urllib.error.URLError(ConnectionResetError(errno.ECONNRESET,'synthetic reset'))]
        result=self.verify()
        self.assertEqual(result['status'],'PASS');self.assertEqual(result['request_count'],10)
        self.assertEqual(result['retry_count'],1);self.assertEqual(result['transient_errors'],{'ECONNRESET':1})
        self.assertAlmostEqual(self.sleep.call_args.args[0], 0.25, delta=0.02)

    def test_three_transient_failures_then_success_and_statistics(self):
        self.network.failures['/']=[http.client.RemoteDisconnected('synthetic close'),
                                   urllib.error.URLError(TimeoutError('synthetic timeout')),
                                   ConnectionAbortedError(errno.ECONNABORTED,'synthetic abort')]
        result=self.verify()
        self.assertEqual(result['request_count'],12);self.assertEqual(result['retry_count'],3)
        self.assertEqual(result['transient_errors'],{'RemoteDisconnected':1,'ETIMEDOUT':1,'ECONNABORTED':1})
        self.assertEqual(self.sleep.call_count, 3)
        for call, delay in zip(self.sleep.call_args_list, (0.25, 0.5, 1.0)):
            self.assertAlmostEqual(call.args[0], delay, delta=0.02)

    def test_retry_budget_is_per_get(self):
        self.network.failures={p:[ConnectionResetError(errno.ECONNRESET,'synthetic reset') for _ in range(3)]
                               for p in ['/','/script.js']}
        result=self.verify()
        self.assertEqual(result['request_count'],15);self.assertEqual(result['retry_count'],6)
        self.assertEqual(result['transient_errors'],{'ECONNRESET':6})

    def test_exhausted_four_attempts_fail(self):
        self.network.failures['/.envrc']=[ConnectionResetError(errno.ECONNRESET,'synthetic reset') for _ in range(5)]
        with self.assertRaisesRegex(RuntimeError,'retries exhausted.*"request_count": 4.*"retry_count": 3.*"ECONNRESET": 4'):
            self.verify()
        self.assertEqual(self.opener.call_count,4);self.assertEqual(self.sleep.call_count,3)
        self.assertEqual(len(self.network.failures['/.envrc']),1)

    def test_certificate_and_other_unconfirmed_errors_never_retry(self):
        cert=ssl.SSLCertVerificationError(1,'synthetic certificate verification failed')
        errors=[cert,urllib.error.URLError(cert),ssl.SSLError(1,'synthetic TLS protocol error'),
                urllib.error.URLError('Connection reset by peer'),OSError(errno.EACCES,'synthetic access denied'),
                urllib.error.URLError(OSError(-2,'synthetic DNS failure')),ValueError('synthetic contract error')]
        for error in errors:
            with self.subTest(error=repr(error)):
                self.opener.reset_mock();self.sleep.reset_mock();self.network.failures['/.envrc']=[error]
                with self.assertRaises(cli.HTTPVerificationError):self.verify()
                self.assertEqual(self.opener.call_count,1);self.sleep.assert_not_called()

    def test_partial_200_body_is_discarded_and_retried(self):
        for error in [http.client.IncompleteRead(b'partial',100),ssl.SSLEOFError(8,'synthetic EOF'),
                      BrokenPipeError(errno.EPIPE,'synthetic pipe')]:
            with self.subTest(error=type(error).__name__):
                self.network.responses['/']=(200,{},error)
                # A fresh connection supplies the complete body on the next attempt.
                self.sleep.side_effect=lambda delay:self.network.responses.pop('/')
                result=self.verify();self.assertEqual(result['retry_count'],1)
                self.assertTrue(all(response.closed for response in self.network.opened))

    def test_sha_mismatch_never_retries(self):
        self.network.responses['/']=(200,{},b'wrong content')
        with self.assertRaisesRegex(RuntimeError,'HTTP public SHA mismatch'):self.verify()
        self.assertEqual(self.network.requests.count('/'),1);self.sleep.assert_not_called()

    def test_unexpected_http_status_never_retries(self):
        for path,codes in [('/.envrc',[200,500]),('/api/lead.php',[403,404,500]),
                           ('/api/form-status.php',[403,404,500]),('/',[201,204,304,403,404,500])]:
            for code in codes:
                with self.subTest(path=path,code=code):
                    self.network.responses={path:(code,{},b'{}')};self.network.requests=[]
                    with self.assertRaises(RuntimeError):self.verify()
                    self.assertEqual(self.network.requests.count(path),1);self.sleep.assert_not_called()
                    self.assertTrue(all(response.closed for response in self.network.opened))

    def test_http_error_body_network_failure_never_retries(self):
        for code in [201,500]:
            with self.subTest(code=code):
                self.network.responses['/']=(code,{},ConnectionResetError(errno.ECONNRESET,'synthetic reset'))
                self.network.requests=[]
                with self.assertRaisesRegex(RuntimeError,'Unexpected HTTP status'):self.verify()
                self.assertEqual(self.network.requests.count('/'),1);self.sleep.assert_not_called()

    def test_business_contract_and_invalid_json_never_retry(self):
        for headers,body in [({'Cache-Control':'no-store'},b'{"enabled":false,"ready":true}'),
                             ({},b'{"enabled":true,"ready":true}'),({},b'invalid json')]:
            with self.subTest(body=body,headers=headers):
                self.network.responses['/api/form-status.php']=(200,headers,body);self.network.requests=[]
                with self.assertRaises((RuntimeError,ValueError)):self.verify()
                self.assertEqual(self.network.requests.count('/api/form-status.php'),1);self.sleep.assert_not_called()

    def test_total_request_and_wall_clock_limits(self):
        for limits, message in [({'requests': 2}, 'request or time budget'), ({'seconds': .01}, 'deadline exceeded')]:
            with self.subTest(limits=limits):
                def opener(request, timeout):
                    if 'seconds' in limits:
                        Event().wait(1)
                    return self.network(request, timeout)
                client = release_http.HTTPClient(opener=opener, pace=0, **limits)
                with self.assertRaisesRegex(cli.HTTPVerificationError, message) as caught:
                    cli.http_verify(self.network.manifest(), 'fixture', client=client)
                self.assertEqual(caught.exception.report['failure_kind'], 'transport')
                self.assertLess(caught.exception.report['duration_seconds'], 0.5)
                self.assertLessEqual(caught.exception.report['request_count'], 2)


class HTTPFullBudget(unittest.TestCase):
    def setUp(self):
        self.now = 0.0
        monotonic = patch.object(release_http.time, 'monotonic', side_effect=lambda: self.now)
        sleep = patch.object(release_http.time, 'sleep', side_effect=self.advance)
        self.addCleanup(monotonic.stop)
        self.addCleanup(sleep.stop)
        monotonic.start()
        sleep.start()

    def advance(self, seconds):
        self.now += seconds

    def test_full_verification_completes_over_slow_transport_with_seven_resets(self):
        public = {name: b'page fixture' for name in c.HTTP_CRITICAL_FILES}
        public.update({'assets/img-{}.webp'.format(n): b'asset' for n in range(280)})
        fixture = HTTPSFixture(public)
        manifest = fixture.manifest()
        manifest['files']['public/.htaccess'] = c.APPROVED_HTACCESS_SHA256
        resets = {5, 50, 110, 240, 340, 495, 700}
        starts = []

        def open_slow(request, timeout):
            starts.append(self.now)
            self.advance(0.35)
            if len(starts) in resets:
                raise ConnectionResetError(errno.ECONNRESET, 'fixture reset')
            return fixture(request, timeout)

        client = release_http.HTTPClient('full', opener=open_slow)
        result = cli.http_verify(manifest, 'slow-release', client=client)
        self.assertEqual((result['status'], result['verified_files'], result['verified_route_cases']), ('PASS', 284, 236))
        self.assertEqual((result['request_count'], result['retry_count']), (776, 7))
        self.assertEqual(result['transient_errors'], {'ECONNRESET': 7})
        self.assertGreater(result['duration_seconds'], 208.74)
        self.assertLess(result['duration_seconds'], 360)
        self.assertTrue(all(after - before >= 0.09 for before, after in zip(starts, starts[1:])))

    def test_full_request_cap_includes_failed_attempt_and_prevents_retry(self):
        starts = []

        def opener(request, timeout):
            starts.append(self.now)
            if len(starts) == 850:
                raise ConnectionResetError()
            return HTTPSResponse(200, {}, b'')

        client = release_http.HTTPClient('full', opener=opener)
        with client.deadline():
            for _ in range(849):
                client.fetch(c.ORIGIN + '/')
            with self.assertRaisesRegex(release_http.TransportFailure, 'request or time budget'):
                client.fetch(c.ORIGIN + '/')
        self.assertEqual(client.statistics['request_count'], 850)
        self.assertEqual(client.statistics['retry_count'], 0)
        self.assertEqual(client.statistics['transient_errors'], {'ECONNRESET': 1})
        self.assertAlmostEqual(self.now, 849 * 0.09)

    def test_full_time_cap_prevents_retry_when_backoff_exceeds_remaining_time(self):
        calls = []

        def opener(request, timeout):
            calls.append(timeout)
            raise TimeoutError('fixture timeout')

        client = release_http.HTTPClient('full', opener=opener)
        self.advance(359.8)
        with client.deadline(), self.assertRaisesRegex(release_http.TransportFailure, 'request or time budget'):
            client.fetch(c.ORIGIN + '/')
        self.assertEqual(len(calls), 1)
        self.assertAlmostEqual(calls[0], 0.2)
        self.assertEqual(client.statistics['request_count'], 1)
        self.assertEqual(client.statistics['retry_count'], 0)
        self.assertEqual(client.statistics['transient_errors'], {'ETIMEDOUT': 1})


class Lifecycle(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='dom-manager-')
        self.home=Path(self.tmp.name).resolve();self.doc=self.home/'domains'/c.DOMAIN
        self.doc.mkdir(parents=True);self.private=self.home/'.dom-u-morya';self.private.mkdir(mode=0o700)
        self.policy=dict(keep_verified=2,protect_days=14,reserve_bytes=1024,quota_max_age_hours=24,
                         quota_evidence=dict(source='Jino panel',observed_unix=int(time.time()),limit_bytes=10**10))
        self.m=c.Manager(str(self.home),self.policy)
        self.runtime_data={n:('synthetic '+n).encode() for n in c.RUNTIME_FILES if n!='manifest.json'}
        hashes={n:c.sha(b) for n,b in self.runtime_data.items()};self.identity=c.sha(json.dumps(hashes,separators=(',',':')).encode())
        self.runtime_data['manifest.json']=c.canonical(dict(identity=self.identity,files=hashes))
        rt=self.private/'smtp-runtime'/self.identity;rt.mkdir(parents=True,mode=0o700);(rt/'src').mkdir(mode=0o700)
        for n,b in self.runtime_data.items():(rt/n).write_bytes(b);(rt/n).chmod(0o600)
        release_root = Path(__file__).resolve().parent.parent
        self.catalog_guard = (release_root/'.htaccess').read_bytes()
        self.guard = subprocess.check_output(['git', 'show', '1e3ecac8d72034d9ce4bc8a71b365796e5d07a59:.htaccess'], cwd=release_root)
        (self.doc/'api').mkdir();(self.doc/'.envrc').write_bytes(b'protected php84 fixture')
        (self.doc/'.htaccess').write_bytes(self.guard);(self.doc/'index.html').write_bytes(b'old index')
        (self.doc/'script.js').write_bytes(b'old script');(self.doc/'api/smtp-manifest.php').write_bytes(b'fixed runtime descriptor')
        (self.private/'config.php').write_bytes(b'fixture secret; no PHP execution');(self.private/'config.php').chmod(0o600)
        (self.private/'state').mkdir(mode=0o700);(self.private/'state/state.json').write_bytes(b'mutable-current')
        self.other=self.home/'domains/other.example';self.other.mkdir();(self.other/'index.html').write_bytes(b'untouched')
        self.baseline=self.m.snapshot(self.identity)

    def tearDown(self):self.tmp.cleanup()

    def package(self, version='new', extra=None, removed=None):
        data={'.htaccess':self.guard,'index.html':('index '+version).encode(),'script.js':('script '+version).encode(),
              'api/smtp-manifest.php':b'fixed runtime descriptor'}
        data.update(extra or {})
        for name in removed or []:data.pop(name)
        files={'public/'+n:b for n,b in data.items()}
        files.update({'private/smtp-runtime/'+self.identity+'/'+n:b for n,b in self.runtime_data.items()})
        manifest=dict(schema='dom-release/v1',origin=c.ORIGIN,commit='a'*40,public_allowlist=sorted(data),runtime_identity=self.identity,
                      files={n:c.sha(b) for n,b in files.items()})
        files['manifest.json']=c.canonical(manifest);return c.pack(files),manifest

    def plan(self, release_id='test-release', **kwargs):
        raw,manifest=self.package(**kwargs);result=self.m.plan(release_id,manifest,c.sha(raw),len(raw));return raw,manifest,result

    def apply(self, release_id='test-release', **kwargs):
        raw,manifest,result=self.plan(release_id,**kwargs)
        self.m.apply(raw,result['plan'],result['go']);return raw,manifest,result

    def verified(self, release_id='test-release', **kwargs):
        raw,manifest,result=self.apply(release_id,**kwargs)
        self.attest_fixture(result, manifest)
        return raw,manifest,result

    def attest_fixture(self, review, manifest):
        plan, go = review['plan'], review['go']
        state = self.m.http_state(plan, go)
        evidence = dict(status='PASS', package_sha256=plan['package_sha256'], profile='full',
                        plan_sha256=plan['sha256'], snapshot_sha256=state['snapshot_sha256'], baseline=None,
                        verified_files=len(c.http_files(manifest, plan, 'full')),
                        public_static_files_verified=True, no_post=True,
                        redirect_matrix=dict(status='PASS', cases=236))
        self.m.attest(plan, go, state, evidence)

    def assert_protected(self):
        self.assertEqual((self.private/'config.php').read_bytes(),b'fixture secret; no PHP execution')
        self.assertEqual((self.private/'state/state.json').read_bytes(),b'mutable-current')
        self.assertEqual((self.other/'index.html').read_bytes(),b'untouched')
        self.assertEqual(c.meta(self.doc/'.envrc'),self.baseline['public']['.envrc'])

    def test_roundtrip_bytes_permissions_and_scope(self):
        (self.doc/'script.js').chmod(0o640);self.baseline=self.m.snapshot(self.identity)
        # Analytics mutable state is outside public/runtime release snapshots.
        import sqlite3
        analytics=self.private/'analytics/state';analytics.mkdir(parents=True,mode=0o700)
        consent=sqlite3.connect(str(analytics/'metrica-consent.sqlite3'))
        consent.execute('CREATE TABLE receipts (withdrawn INTEGER)');consent.execute('INSERT INTO receipts VALUES (0)');consent.commit()
        raw,m,result=self.verified(extra={'assets/new/a.js':b'new asset'})
        consent.execute('UPDATE receipts SET withdrawn=1');consent.commit();consent.close()
        analytics_bytes=(analytics/'metrica-consent.sqlite3').read_bytes()
        run=self.m.run('test-release');self.m.verify_backup(run)
        (self.private/'state/state.json').write_bytes(b'new request remains')
        p=self.m.rollback_plan('test-release');self.m.rollback(p['plan'],p['go'])
        self.assertEqual(self.m.snapshot(self.identity),self.baseline)
        self.assertEqual((self.private/'state/state.json').read_bytes(),b'new request remains')
        self.assertEqual((analytics/'metrica-consent.sqlite3').read_bytes(),analytics_bytes)
        with tarfile.open(run/'backup.tar.gz') as archive:self.assertFalse(any('analytics' in n for n in archive.getnames()))
        self.assertFalse((self.doc/'assets').exists())
        self.assertEqual(stat.S_IMODE((run/'backup.tar.gz').stat().st_mode),0o600)
        self.assertEqual((self.other/'index.html').read_bytes(),b'untouched')

    def test_readonly_does_not_create_private_manager(self):
        raw,m,result=self.plan();self.m.preflight(m,len(raw));self.m.prune_plan();self.m.list_backups()
        self.assertFalse(self.m.root.exists());self.assertEqual(self.m.snapshot(self.identity),self.baseline)

    def test_go_no_write(self):
        raw,m,r=self.plan()
        for go in ['',r['go'].replace(c.DOMAIN,'another.example'),r['go'].replace('APPLY','ROLLBACK')]:
            with self.assertRaises(RuntimeError):self.m.apply(raw,r['plan'],go)
        self.assertFalse(self.m.root.exists())

    def test_replay_after_unknown_response_and_id_conflict(self):
        raw,m,r=self.apply()
        with self.assertRaises(RuntimeError):self.m.apply(raw,r['plan'],r['go'])
        raw2,m2=self.package('other')
        with self.assertRaises(RuntimeError):self.m.plan('test-release',m2,c.sha(raw2),len(raw2))
        self.assertEqual(len(list(self.m.root.glob('*/backup.tar.gz'))),1)

    def test_drift_before_apply(self):
        raw,m,r=self.plan();(self.doc/'script.js').write_bytes(b'new external work')
        with self.assertRaises(RuntimeError):self.m.apply(raw,r['plan'],r['go'])
        self.assertFalse(self.m.run('test-release').exists());self.assert_protected()

    def test_no_space_and_stale_quota(self):
        raw,m,r=self.plan()
        with patch.object(self.m,'capacity',return_value={'ready':False}):
            with self.assertRaises(RuntimeError):self.m.apply(raw,r['plan'],r['go'])
        self.policy['quota_evidence']['observed_unix']=1
        self.assertFalse(self.m.preflight(m,len(raw))['capacity']['ready'])
        self.assertFalse(self.m.run('test-release').exists())

    def test_partial_copy_auto_restore(self):
        raw,m,r=self.plan();publish=self.m.publish;calls=[]
        def broken(name,data):
            calls.append(name)
            if len(calls)==2:raise OSError('synthetic disk failure')
            publish(name,data)
        with patch.object(self.m,'publish',side_effect=broken):
            with self.assertRaises(RuntimeError):self.m.apply(raw,r['plan'],r['go'])
        self.assertEqual(self.m.receipt(self.m.run('test-release'))['phase'],'rolled_back')
        self.assertEqual(self.m.snapshot(self.identity),self.baseline);self.assert_protected()

    def test_recovery_after_hard_interrupt(self):
        raw,m,r=self.plan();publish=self.m.publish
        def broken(name,data):publish(name,data);raise KeyboardInterrupt()
        with patch.object(self.m,'publish',side_effect=broken):
            with self.assertRaises(KeyboardInterrupt):self.m.apply(raw,r['plan'],r['go'])
        self.assertEqual(self.m.receipt(self.m.run('test-release'))['phase'],'publishing')
        p=self.m.rollback_plan('test-release');self.m.rollback(p['plan'],p['go'])
        self.assertEqual(self.m.snapshot(self.identity),self.baseline)

    def test_corrupt_archive_and_missing_backup(self):
        raw,m,r=self.plan()
        with self.assertRaises(RuntimeError):c.verify_package(raw+b'bad',c.sha(raw))
        self.verified();run=self.m.run('test-release');(run/'backup.tar.gz').write_bytes(b'corrupt')
        with self.assertRaises(Exception):self.m.rollback_plan('test-release')
        (run/'backup.tar.gz').unlink()
        with self.assertRaises(Exception):self.m.verify_backup(run)
        self.assert_protected()

    def test_archive_duplicate_symlink_traversal_and_extra_files(self):
        for name,kind in [('../escape',tarfile.REGTYPE),('/escape',tarfile.REGTYPE),('a',tarfile.SYMTYPE),('a',tarfile.LNKTYPE)]:
            out=io.BytesIO()
            with tarfile.open(fileobj=out,mode='w:gz') as t:
                m=tarfile.TarInfo(name);m.type=kind;m.linkname='target';t.addfile(m)
            with self.assertRaises(RuntimeError):c.unpack(out.getvalue())
        raw,m=self.package();files=c.unpack(raw);files['public/extra.php']=b'unexpected'
        bad=c.pack(files)
        with self.assertRaises(RuntimeError):c.verify_package(bad,c.sha(bad))
        out=io.BytesIO()
        with tarfile.open(fileobj=out,mode='w:gz') as t:
            for _ in range(2):t.addfile(tarfile.TarInfo('duplicate'))
        with self.assertRaises(RuntimeError):c.unpack(out.getvalue())

    def test_symlink_production_and_private_roots(self):
        (self.doc/'script.js').unlink();(self.doc/'script.js').symlink_to(self.other/'index.html')
        with self.assertRaises(RuntimeError):self.plan()

    def test_concurrent_deploy(self):
        with self.m.lock():
            with self.assertRaises(RuntimeError):
                with self.m.lock():pass

    def test_protected_config_guard_runtime_drift(self):
        raw,m,r=self.plan();(self.private/'config.php').chmod(0o644)
        with self.assertRaises(RuntimeError):self.m.apply(raw,r['plan'],r['go'])
        (self.private/'config.php').chmod(0o600);(self.doc/'.htaccess').write_bytes(b'unguarded')
        with self.assertRaises(RuntimeError):self.plan()

    def test_rollback_external_drift_and_failure(self):
        self.verified();(self.doc/'script.js').write_bytes(b'external work')
        p=self.m.rollback_plan('test-release')
        with self.assertRaises(RuntimeError):self.m.rollback(p['plan'],p['go'])
        self.assertEqual((self.doc/'script.js').read_bytes(),b'external work')
        self.assert_protected()

    def test_roll_back_failure_retains_evidence(self):
        self.verified();p=self.m.rollback_plan('test-release')
        with patch('release_core.atomic',side_effect=OSError('write failure')):
            with self.assertRaises(OSError):self.m.rollback(p['plan'],p['go'])
        self.assertTrue((self.m.run('test-release')/'backup.tar.gz').exists())

    def test_prune_minimum_pin_period_drift_and_tombstone(self):
        for index in range(5):self.verified('release-'+str(index),version=str(index))
        self.assertEqual(self.m.prune_plan()['plan']['candidates'],[])
        for run in self.m.root.iterdir():
            if run.is_dir():
                r=self.m.receipt(run);r['created_unix']-=30*86400;self.m.save(run,r)
        p=self.m.prune_plan();self.assertEqual([r['release_id'] for r in p['plan']['candidates']],['release-1'])
        with self.assertRaises(RuntimeError):self.m.prune(p['plan'],'wrong GO')
        path=self.m.run('release-1')/'receipt.json';previous=path.read_bytes();path.write_bytes(previous+b' ')
        with self.assertRaises(RuntimeError):self.m.prune(p['plan'],p['go'])
        c.atomic(path,previous);p=self.m.prune_plan();self.m.prune(p['plan'],p['go'])
        self.assertEqual(len(self.m.list_backups()),4)
        self.assertEqual(self.m.status('release-1')['phase'],'pruned')
        with self.assertRaises(RuntimeError):self.plan('release-1')
        self.assert_protected()

    def test_prune_unknown_inventory_stops(self):
        self.verified();(self.m.run('test-release')/'unknown').write_bytes(b'x')
        with self.assertRaises(RuntimeError):self.m.prune_plan()

    def test_pending_release_keeps_all_backups(self):
        for index in range(4):self.verified('release-'+str(index),version=str(index))
        self.apply('pending-release',version='pending')
        plan=self.m.prune_plan(now=int(time.time())+40*86400)['plan']
        self.assertEqual(plan['candidates'],[])
        with self.assertRaises(RuntimeError):self.plan('next-release',version='next')

    def test_htaccess_rejects_marker_plus_permissive_directive(self):
        for policy in [self.guard+b'\nRequire all granted\n',
                       self.guard.replace(b'RewriteRule (^|/)\\. - [F,END]',b'RewriteRule ^\\.envrc$ - [END]\nRewriteRule (^|/)\\. - [F,END]')+b'\n<Files ".envrc">\nRequire all granted\n</Files>\n']:
            with self.subTest(policy=c.sha(policy)):
                raw,manifest=self.package(extra={'.htaccess':policy})
                self.assertIn(c.GUARD,policy);self.assertIn(b'Require all denied',policy)
                with self.assertRaisesRegex(RuntimeError,'Apache policy'):c.verify_package(raw,c.sha(raw))
                with self.assertRaisesRegex(RuntimeError,'Apache policy'):self.m.preflight(manifest,len(raw))
        self.assertFalse(self.m.root.exists());self.assert_protected()

    def test_ordinary_release_preserves_exact_apache_policy(self):
        raw,m,review=self.verified()
        self.assertEqual(c.sha(self.guard),c.APPROVED_HTACCESS_SHA256)
        self.assertNotIn('.htaccess',[change['path'] for change in review['plan']['changes']])
        self.assertEqual(c.meta(self.doc/'.htaccess'),self.baseline['public']['.htaccess'])
        (self.doc/'.htaccess').write_bytes(self.guard+b'\nRequire all granted\n')
        with self.assertRaisesRegex(RuntimeError,'Apache policy'):self.m.snapshot(self.identity)

    def migration_plan(self, release_id='apache-migration'):
        import jino_remote
        legacy=jino_remote.SECURITY_POLICY+jino_remote.HTTPS_REDIRECT
        (self.doc/'.htaccess').write_bytes(legacy)
        self.baseline=self.m.snapshot(self.identity)
        # Migration changes exactly .htaccess, including modes and all other bytes.
        return self.plan(release_id,extra={'index.html':b'old index','script.js':b'old script'})

    def test_catalog_migration_future_release_and_rollback_preserve_private_state(self):
        public = {name:b'catalog-compatible fixture' for name in c.CATALOG_PUBLIC_FILES - {'index.html'}}
        public['.htaccess'] = self.catalog_guard
        with self.assertRaisesRegex(RuntimeError, 'compatible'):
            self.plan('incomplete-catalog', extra={'.htaccess':self.catalog_guard})
        first, _, setup = self.verified('catalog-route', extra=public)
        self.assertEqual(setup['plan']['apache_policy_migration']['scope'], 'PRICE-SYNC-002')
        private = self.private/'catalog-sync-v1'
        private.mkdir(mode=0o700)
        state = private/'state.json'
        state.write_bytes(b'catalog state owned by Cron')
        state.chmod(0o600)
        with self.assertRaisesRegex(RuntimeError, 'catalog-compatible rollback'):
            self.m.rollback_plan('catalog-route')
        _, _, next_review = self.verified('compatible-release', version='next', extra=public)
        self.assertIsNone(next_review['plan']['apache_policy_migration'])
        rollback = self.m.rollback_plan('compatible-release')
        self.m.rollback(rollback['plan'], rollback['go'])
        self.assertEqual(state.read_bytes(), b'catalog state owned by Cron')
        self.assertEqual(self.m.status('catalog-route')['phase'], 'verified')

    def test_exact_apache_migration_backup_rollback_and_target_only_packages(self):
        raw,manifest,review=self.migration_plan()
        p=review['plan']
        self.assertEqual(p['apache_policy_migration'],dict(scope='SEO-REDIRECT-001',
            from_sha256=c.LEGACY_HTACCESS_SHA256,to_sha256=c.APPROVED_HTACCESS_SHA256))
        self.assertEqual([row['path'] for row in p['changes']],['.htaccess'])
        self.m.apply(raw,p,review['go']);self.assert_protected()
        self.assertEqual((self.doc/'.htaccess').read_bytes(),self.guard)
        backup,files=self.m.verify_backup(self.m.run('apache-migration'))
        self.assertEqual(c.sha(files['public/.htaccess']),c.LEGACY_HTACCESS_SHA256)
        self.attest_fixture(review, manifest)
        self.assertEqual(self.m.list_backups()[0]['phase'],'verified')
        # The next ordinary release has no policy change.
        self.assertIsNone(self.plan('ordinary')[2]['plan']['apache_policy_migration'])
        rollback=self.m.rollback_plan('apache-migration')
        self.m.rollback(rollback['plan'],rollback['go'])
        self.assertEqual(self.m.snapshot(self.identity),self.baseline)
        old_raw,old_manifest=self.package(extra={'.htaccess':files['public/.htaccess']})
        with self.assertRaisesRegex(RuntimeError,'Apache policy'):c.verify_package(old_raw,c.sha(old_raw))
        with self.assertRaisesRegex(RuntimeError,'Apache policy'):self.m.preflight(old_manifest,len(old_raw))

    def test_exact_cache_migration_from_v2_preserves_guard_and_rollback(self):
        previous=self.guard.split(b'\n# PAGESPEED-MOBILE-001:')[0]
        self.assertEqual(c.sha(previous),c.PREVIOUS_HTACCESS_SHA256)
        self.assertTrue(self.guard.startswith(previous))
        (self.doc/'.htaccess').write_bytes(previous)
        self.baseline=self.m.snapshot(self.identity)
        with self.assertRaisesRegex(RuntimeError,'only the exact .htaccess'):
            self.plan('too-broad-cache')
        raw,manifest,review=self.plan('cache-only',extra={'index.html':b'old index','script.js':b'old script'})
        self.assertEqual(review['plan']['apache_policy_migration'],dict(scope='PAGESPEED-MOBILE-001',
            from_sha256=c.PREVIOUS_HTACCESS_SHA256,to_sha256=c.APPROVED_HTACCESS_SHA256))
        self.assertEqual([row['path'] for row in review['plan']['changes']],['.htaccess'])
        self.m.apply(raw,review['plan'],review['go'])
        self.attest_fixture(review, manifest)
        rollback=self.m.rollback_plan('cache-only')
        self.m.rollback(rollback['plan'],rollback['go'])
        self.assertEqual(self.m.snapshot(self.identity),self.baseline)
        old_raw,old_manifest=self.package(extra={'.htaccess':previous})
        with self.assertRaisesRegex(RuntimeError,'Apache policy'):c.verify_package(old_raw,c.sha(old_raw))

    def test_apache_migration_rejects_other_changes_and_forged_scope(self):
        raw,manifest,review=self.migration_plan()
        with self.assertRaisesRegex(RuntimeError,'only the exact .htaccess'):
            self.plan('too-broad')
        plan=dict(review['plan']);plan['apache_policy_migration']=None
        plan.pop('sha256');plan['sha256']=c.digest(plan)
        with self.assertRaisesRegex(RuntimeError,'Drift'):
            self.m.apply(raw,plan,self.m.go(plan))
        self.assertFalse(self.m.run('apache-migration').exists());self.assert_protected()

    def test_apache_migration_failure_restores_old_exact_policy(self):
        raw,manifest,review=self.migration_plan()
        original=self.m.publish
        def fail_after_policy(name,data):
            original(name,data)
            raise OSError('synthetic failure after exact policy replacement')
        with patch.object(self.m,'publish',side_effect=fail_after_policy):
            with self.assertRaisesRegex(RuntimeError,'Publication failed'):
                self.m.apply(raw,review['plan'],review['go'])
        self.assertEqual(self.m.status('apache-migration')['phase'],'rolled_back')
        self.assertEqual(self.m.snapshot(self.identity),self.baseline);self.assert_protected()

    def test_historical_v1_records_remain_verifiable_but_not_publishable(self):
        import jino_remote
        legacy=jino_remote.SECURITY_POLICY+jino_remote.HTTPS_REDIRECT
        # Generate a historical receipt using the old exact policy and unchanged engine.
        with patch.object(c,'APPROVED_HTACCESS_SHA256',c.LEGACY_HTACCESS_SHA256):
            self.guard=legacy;(self.doc/'.htaccess').write_bytes(legacy)
            raw,manifest,review=self.verified('historical-v1')
        self.assertEqual(self.m.list_backups()[0]['phase'],'verified')
        with self.assertRaisesRegex(RuntimeError,'Apache policy'):c.verify_package(raw,c.sha(raw))

    def test_verified_inventory_missing_each_required_file_stops_every_prune(self):
        self.verified();run=self.m.run('test-release');review=self.m.prune_plan()
        for name in sorted(c.RUN_FILES):
            with self.subTest(missing=name):
                data=(run/name).read_bytes();(run/name).unlink()
                try:
                    for operation in [self.m.list_backups,self.m.prune_plan,lambda:self.m.prune(review['plan'],review['go'])]:
                        with self.assertRaises(Exception):operation()
                    self.assertFalse((run/'pruned.json').exists())
                finally:c.atomic(run/name,data)
        self.assertEqual(self.m.list_backups()[0]['phase'],'verified');self.assert_protected()

    def test_verified_inventory_rejects_disagreement_and_corrupt_archive(self):
        self.verified();run=self.m.run('test-release')
        mutations=[('receipt.json',lambda v:dict(v,backup_sha256='0'*64)),
                   ('receipt.json',lambda v:dict(v,package_sha256='0'*64)),
                   ('receipt.json',lambda v:dict(v,http=dict(status='FAIL',package_sha256=v['package_sha256']))),
                   ('manifest.json',lambda v:dict(v,commit='b'*40)),
                   ('plan.json',lambda v:dict(v,package_bytes=v['package_bytes']+1)),
                   ('backup.json',lambda v:dict(v,sha256='0'*64))]
        for name,mutate in mutations:
            with self.subTest(inconsistent=name):
                original=(run/name).read_bytes();c.atomic(run/name,c.canonical(mutate(json.loads(original))))
                try:
                    with self.assertRaises(Exception):self.m.list_backups()
                    with self.assertRaises(Exception):self.m.prune_plan()
                finally:c.atomic(run/name,original)
        for name in ['backup.tar.gz','package.tar.gz']:
            with self.subTest(corrupt=name):
                original=(run/name).read_bytes();c.atomic(run/name,original+b'corrupt')
                try:
                    with self.assertRaises(Exception):self.m.list_backups()
                    with self.assertRaises(Exception):self.m.prune_plan()
                finally:c.atomic(run/name,original)
        self.assertEqual(self.m.list_backups()[0]['phase'],'verified');self.assert_protected()

    def export_fixture(self):
        self.verified();run=self.m.run('test-release')
        key=self.home/'recipient.key';cert=self.home/'recipient.crt'
        subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(cert),'-days','1','-subj','/CN=synthetic backup recipient'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        backup_sha=self.m.receipt(run)['backup_sha256'];destination=str(self.home/'approved.cms')
        review=self.m.export_plan(run.name,backup_sha,cert.read_bytes(),destination)
        return run,backup_sha,cert,key,destination,review

    def test_export_rejects_missing_wrong_or_substituted_go_before_archive_read(self):
        run,backup_sha,cert,key,destination,review=self.export_fixture()
        other=self.home/'other.crt'
        subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(self.home/'other.key'),'-out',str(other),'-days','1','-subj','/CN=other synthetic recipient'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        base=(run.name,backup_sha,cert.read_bytes(),destination,review['plan'],review['go'])
        invalid=[base[:-1]+('',),base[:-1]+('GO APPLY '+c.DOMAIN,),
                 ('other-release',)+base[1:],(base[0],'0'*64)+base[2:],
                 base[:2]+(other.read_bytes(),)+base[3:],base[:3]+(str(self.home/'elsewhere.cms'),)+base[4:]]
        for args in invalid:
            with self.subTest(change=args[-1][:12]):
                with patch('release_core.regular',side_effect=AssertionError('Unauthorized backup read')), patch.object(self.m,'verify_record') as verify:
                    with self.assertRaises(RuntimeError):self.m.encrypted_backup(*args)
                    verify.assert_not_called()
                import release_manager as cli
                supplied=self.home/'supplied.crt';supplied.write_bytes(args[2])
                with patch.object(cli,'remote') as remote:
                    with self.assertRaises(RuntimeError):cli.export_command(self.policy,args[0],args[1],str(supplied),args[3],args[4],args[5])
                    remote.assert_not_called()
        self.assert_protected()

    def test_export_plan_reads_metadata_without_archive_extraction(self):
        run,backup_sha,cert,key,destination,review=self.export_fixture();actual=c.regular
        def read(path):
            self.assertIn(path.name,['receipt.json','backup.json'],'No archive/payload access while planning')
            return actual(path)
        with patch('release_core.regular',side_effect=read):
            self.assertEqual(self.m.export_plan(run.name,backup_sha,cert.read_bytes(),destination),review)
        # The fingerprint identifies DER, so harmless PEM surrounding whitespace is canonical.
        self.assertEqual(c.certificate_sha256(cert.read_bytes()),c.certificate_sha256(b'\n'+cert.read_bytes()+b'\n'))
        with self.assertRaises(RuntimeError):c.certificate_sha256(cert.read_bytes()+key.read_bytes())
        self.assert_protected()

    def test_export_cli_requires_go_before_ssh_and_writes_only_approved_ciphertext(self):
        import release_manager as cli
        run,backup_sha,cert,key,destination,review=self.export_fixture()
        with patch.object(cli,'remote') as remote:
            for go in ['',review['go'].replace('EXPORT','APPLY')]:
                with self.assertRaises(RuntimeError):cli.export_command(self.policy,run.name,backup_sha,str(cert),destination,review['plan'],go)
            remote.assert_not_called()
        plan_path=self.home/'export-plan.json';plan_path.write_bytes(c.canonical(review))
        policy=self.home/'policy.json';policy.write_bytes(c.canonical(self.policy))
        argv=['release_manager.py','backup','export','--release-id',run.name,'--sha',backup_sha,'--certificate',str(cert),'--output',destination,'--plan',str(plan_path),'--policy',str(policy)]
        with patch.object(sys,'argv',argv),patch.object(cli,'remote') as remote:
            with self.assertRaisesRegex(RuntimeError,'separate exact --go'):cli.main()
            remote.assert_not_called()
        def local(op,policy,**request):
            self.assertEqual(op,'export')
            return self.m.encrypted_backup(request['release_id'],request['backup_sha256'],base64.b64decode(request['certificate']),request['destination'],request['plan'],request['go'])
        with patch.object(cli,'remote',side_effect=local) as remote:
            receipt=cli.export_command(self.policy,run.name,backup_sha,str(cert),destination,review['plan'],review['go'])
            self.assertEqual(remote.call_count,1)
        self.assertEqual(receipt['export_plan_sha256'],review['plan']['sha256'])
        cipher=Path(destination).read_bytes();self.assertEqual(c.sha(cipher),receipt['sha256'])
        self.assertEqual(stat.S_IMODE(Path(destination).stat().st_mode),0o600)
        decoded=subprocess.run(['openssl','cms','-decrypt','-binary','-inform','DER','-recip',str(cert),'-inkey',str(key)],input=cipher,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout
        self.assertEqual(c.sha(decoded),backup_sha);self.assert_protected()

    def test_export_plan_cli_never_uploads_a_private_key_bundle(self):
        import release_manager as cli
        run,backup_sha,cert,key,destination,review=self.export_fixture()
        cert.write_bytes(cert.read_bytes()+key.read_bytes())
        policy=self.home/'policy.json';policy.write_bytes(c.canonical(self.policy))
        argv=['release_manager.py','backup','export-plan','--release-id',run.name,'--sha',backup_sha,'--certificate',str(cert),'--destination',destination,'--policy',str(policy)]
        with patch.object(sys,'argv',argv),patch.object(cli,'remote') as remote:
            with self.assertRaisesRegex(RuntimeError,'public X.509'):cli.main()
            remote.assert_not_called()
        self.assert_protected()

    def test_encrypted_export_roundtrip(self):
        self.verified();run=self.m.run('test-release')
        key=self.home/'export.key';cert=self.home/'export.crt'
        subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(cert),'-days','1','-subj','/CN=synthetic backup recipient'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        backup_sha=self.m.receipt(run)['backup_sha256'];destination=str(self.home/'approved.cms')
        approval=self.m.export_plan(run.name,backup_sha,cert.read_bytes(),destination)
        encrypted=self.m.encrypted_backup(run.name,backup_sha,cert.read_bytes(),destination,approval['plan'],approval['go']);cipher=base64.b64decode(encrypted['ciphertext'])
        self.assertNotIn(b'fixture secret',cipher)
        decoded=subprocess.run(['openssl','cms','-decrypt','-binary','-inform','DER','-recip',str(cert),'-inkey',str(key)],input=cipher,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout
        self.assertEqual(c.sha(decoded),encrypted['backup_sha256'])
        self.assertEqual(decoded,(run/'backup.tar.gz').read_bytes());self.assert_protected()

    def test_noop_plan_has_no_authorization(self):
        raw,m,_=self.verified()
        result=self.m.plan('new-noop',m,c.sha(raw),len(raw))
        self.assertEqual(result['plan']['changes'],[]);self.assertIsNone(result['go'])
        with self.assertRaises(RuntimeError):self.m.apply(raw,result['plan'],'')
        self.assertFalse(self.m.run('new-noop').exists())

    def test_atomic_parent_swap_cannot_follow_symlink(self):
        folder=self.doc/'race';folder.mkdir();target=folder/'file'
        target.write_bytes(b'original');moved=self.doc/'race-moved'
        real=c.real
        def swap(path):
            if path==target and not moved.exists():
                folder.rename(moved);folder.symlink_to(self.other,target_is_directory=True)
            return path
        with patch('release_core.real',side_effect=swap):
            with self.assertRaises(OSError):c.atomic(target,b'forbidden')
        self.assertEqual((moved/'file').read_bytes(),b'original')
        self.assertFalse((self.other/'file').exists())

    def test_http_tls_failure_stops_before_remote_apply(self):
        import release_manager as cli
        raw,m,result=self.plan();archive=self.home/'package.tar.gz';archive.write_bytes(raw)
        plan=self.home/'plan.json';plan.write_bytes(c.canonical(result));policy=self.home/'policy.json';policy.write_bytes(c.canonical(self.policy))
        argv=['release_manager.py','release','apply','--archive',str(archive),'--sha',c.sha(raw),'--plan',str(plan),'--policy',str(policy),'--go',result['go']]
        with patch.object(sys,'argv',argv),patch.object(cli,'http_preflight',side_effect=RuntimeError('TLS or DNS unavailable')),patch.object(cli,'remote') as remote:
            with self.assertRaisesRegex(RuntimeError,'TLS or DNS'):cli.main()
            remote.assert_not_called()
        self.assertFalse(self.m.root.exists());self.assert_protected()

    def test_incident_and_presentation_only_scopes_over_local_http(self):
        ordinary = {'assets/img-{}.webp'.format(n): b'unchanged fixture' for n in range(275)}
        ui = {'index.html': b'index old', 'privacy.html': b'privacy old',
              'consent-personal-data.html': b'personal old', 'consent-analytics.html': b'analytics old',
              'privacy/privacy.css': b'css old', 'privacy/privacy.js': b'js old', 'styles.css': b'style old'}
        public = dict(ordinary, **ui)
        public.update({'.htaccess': self.catalog_guard, 'index.php': b'catalog route',
                       **{name: b'catalog helper' for name in c.CATALOG_PUBLIC_FILES if name.startswith('api/')}})
        _, baseline_manifest, baseline = self.verified('catalog-baseline', extra=public)
        changed = {name: body + b' revised' for name, body in ui.items()}
        changed['assets/analytics-icon.svg'] = b'new icon fixture'
        incident = {**public, **changed}
        full_raw, full_manifest, full_review = self.plan('incident-eight', extra=incident)
        full_plan = full_review['plan']
        self.assertEqual(len(full_plan['changes']), 8)
        self.assertEqual(full_plan['http_verification'], dict(profile='full', reason='publication_scope'))
        presentation = {**incident, 'privacy/privacy.js': ui['privacy/privacy.js']}
        raw, manifest, review = self.apply('ui-update', extra=presentation)
        plan, go = review['plan'], review['go']
        self.assertEqual(len(plan['changes']), 7)
        self.assertEqual(plan['http_verification']['baseline']['package_sha256'], baseline['plan']['package_sha256'])
        self.assertEqual(c.http_profile(plan), 'compact')
        self.assertEqual(c.http_profile(baseline['plan']), 'full')
        self.assertIn('public/index.php', baseline_manifest['files'])
        presentation['script.js'] = incident['script.js'] = b'script new'
        network = HTTPSFixture(presentation)
        state = self.m.http_state(plan, go)

        class ServerResponse(BaseHTTPRequestHandler):
            def serve(self):
                url = urllib.parse.urlsplit(self.headers['X-Logical-URL'])
                code, headers, body = network.response(url)
                self.send_response(code)
                for name, value in headers.items():
                    self.send_header(name, value)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                if self.command == 'GET':
                    self.wfile.write(body)

            do_GET = do_HEAD = serve

            def log_message(self, *args):
                pass

        with HTTPServer(('127.0.0.1', 0), ServerResponse) as server:
            thread = Thread(target=server.serve_forever, daemon=True)
            thread.start()
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), release_http.NoRedirect())

            def loopback(request, timeout):
                local = urllib.request.Request('http://127.0.0.1:{}/'.format(server.server_port),
                                               headers={'X-Logical-URL': request.full_url}, method=request.get_method())
                return opener.open(local, timeout=timeout)

            try:
                with patch.object(cli.subprocess, 'run'), patch.object(cli.subprocess, 'check_output', return_value=b'styles.css\0'):
                    compact = cli.http_verify(manifest, c.sha(raw), plan=plan, state=state,
                                              client=release_http.HTTPClient('compact', opener=loopback, pace=0))
                network.public = incident
                full = cli.http_verify(full_manifest, c.sha(full_raw), plan=full_plan,
                                       client=release_http.HTTPClient('full', opener=loopback, pace=0))
            finally:
                server.shutdown()
                thread.join()
        self.assertEqual((compact['profile'], compact['verified_files'], compact['verified_route_cases']), ('compact', 7, 28))
        self.assertEqual((full['profile'], full['verified_files'], full['verified_route_cases']), ('full', 284, 236))
        self.assertEqual(compact['files_covered_by_baseline'], 277)
        self.assertEqual(compact['request_count'], 40)
        self.assertEqual(full['request_count'], 771)
        print('HTTP comparison fixture:', json.dumps({r['profile']: {
              k: r[k] for k in ('request_count', 'duration_seconds', 'verified_files', 'verified_route_cases')}
              for r in (compact, full)}, sort_keys=True))
        self.m.attest(plan, go, state, compact)
        self.assertEqual(self.m.status('ui-update')['phase'], 'verified')
        next_raw, next_manifest, next_review = self.plan('next-ui', extra={**presentation, 'styles.css': b'next css'})
        self.assertEqual(c.http_profile(next_review['plan']), 'compact')
        with patch.object(time, 'time', return_value=time.time() + c.HTTP_BASELINE_SECONDS + 1):
            self.assertEqual(c.http_profile(self.m.plan('stale-ui', next_manifest, c.sha(next_raw), len(next_raw))['plan']), 'full')
        (_, _, php_review) = self.plan('route-change', extra={**presentation, 'index.php': b'changed handler'})
        self.assertEqual(c.http_profile(php_review['plan']), 'full')
        (self.doc/'assets/img-0.webp').write_bytes(b'outside drift')
        with self.assertRaisesRegex(RuntimeError, 'Current verified baseline has drifted'):
            self.plan('drifted-ui', extra=presentation)

    def test_consent_and_metrica_changes_require_full_with_a_verified_baseline(self):
        public = {name: b'page fixture' for name in c.HTTP_CRITICAL_FILES}
        consent = b'function consent(choice) { return choice === "granted"; }'
        metrica = b'function metrica(active) { if (active) return startAnalytics(); }'
        public['privacy/privacy.js'] = consent + metrica
        _, _, baseline = self.verified('privacy-baseline', extra=public)
        self.assertEqual(c.http_profile(baseline['plan']), 'full')
        for feature, rewrite in [
            ('consent gate', consent.replace(b'"granted"', b'"denied"') + metrica),
            ('analytics loading', consent + metrica.replace(b'if (active)', b'if (!active)')),
        ]:
            with self.subTest(feature=feature):
                _, manifest, review = self.plan('privacy-candidate', extra={**public, 'privacy/privacy.js': rewrite})
                plan = review['plan']
                self.assertEqual([row['path'] for row in plan['changes']], ['privacy/privacy.js'])
                self.assertEqual(cli.verification_profile(plan, manifest), ('full', 'publication_scope'))

        _, manifest, review = self.plan('css-candidate', extra={**public, 'index.html': b'new HTML'})
        self.assertEqual(c.http_profile(review['plan']), 'compact')
        with patch.object(cli.subprocess, 'run'), \
             patch.object(cli.subprocess, 'check_output', return_value=b'index.html\0privacy/privacy.js\0'):
            self.assertEqual(cli.verification_profile(review['plan'], manifest), ('full', 'source_scope'))

    def test_finalize_rejects_compact_attestation_for_an_older_privacy_plan(self):
        public = {name: b'page fixture' for name in c.HTTP_CRITICAL_FILES}
        public['privacy/privacy.js'] = b'old privacy fixture'
        self.verified('privacy-baseline', extra=public)
        public['privacy/privacy.js'] = b'changed privacy fixture'
        ui_path = c.ui_path
        with patch.object(c, 'ui_path', side_effect=lambda name: name == 'privacy/privacy.js' or ui_path(name)):
            raw, manifest, review = self.apply('previous-compact', extra=public)
        plan, go = review['plan'], review['go']
        self.assertEqual(plan['http_verification']['profile'], 'compact')
        self.assertEqual(cli.verification_profile(plan, manifest), ('full', 'publication_scope'))
        state = self.m.http_state(plan, go)
        network = HTTPSFixture({**public, 'script.js': b'script new'})
        evidence = cli.http_verify(manifest, c.sha(raw), plan=plan, state=state, client=network.client())
        compact_evidence = dict(evidence, profile='compact', baseline=plan['http_verification']['baseline'],
                                redirect_matrix=dict(status='PASS', cases=28),
                                verified_files=len(c.http_files(manifest, plan, 'compact')))
        with self.assertRaisesRegex(RuntimeError, 'HTTP verification profile mismatch'):
            self.m.attest(plan, go, state, compact_evidence)
        self.assertEqual(self.m.status('previous-compact')['phase'], 'awaiting_http_verify')
        self.assertEqual(self.m.attest(plan, go, state, evidence)['phase'], 'verified')
        self.assertEqual(self.m.receipt(self.m.run('previous-compact'))['http']['profile'], 'full')

    def test_catalog_snapshot_mismatch_fails_before_attestation(self):
        public = {'.htaccess': self.catalog_guard, 'index.php': b'catalog route',
                  **{name: b'catalog helper' for name in c.CATALOG_PUBLIC_FILES if name.startswith('api/')}}
        raw, manifest, review = self.apply('catalog-test', extra=public)
        network = HTTPSFixture({**public, 'index.html': b'index new', 'script.js': b'script new'})
        network.responses['/'] = (200, {'Cache-Control': 'no-store', 'X-Dom-Catalog-Template': c.sha(b'index new'),
                                        'X-Dom-Catalog-Snapshot': '0' * 64, 'X-Dom-Catalog-Status': 'confirmed'},
                                  b'<script id="site-data" type="application/json">{"catalog_version":"other","catalog_status":"confirmed","apartments":[{"id":"1"}]}</script>'
                                  b'<article data-lot-id="1"></article><script type="application/ld+json">{"@graph":[]}</script>')
        with self.assertRaisesRegex(cli.HTTPVerificationError, 'does not match its active snapshot'):
            cli.http_verify(manifest, c.sha(raw), plan=review['plan'], client=network.client())
        self.assertEqual(self.m.status('catalog-test')['phase'], 'awaiting_http_verify')

    def test_ssh_uncertain_response_has_no_retry(self):
        import release_manager as cli
        from types import SimpleNamespace
        with patch.object(cli.subprocess,'run',return_value=SimpleNamespace(returncode=255,stdout=b'',stderr=b'connection lost')) as run:
            for operation in ['apply','rollback','prune','export','verify-backup','status']:
                with self.subTest(operation=operation):
                    run.reset_mock()
                    with self.assertRaisesRegex(RuntimeError,'outcome unknown'):cli.remote(operation,self.policy,release_id='test-release')
                    self.assertEqual(run.call_count,1)

    def http_cli_args(self,command,raw,review):
        archive=self.home/'package.tar.gz';archive.write_bytes(raw)
        plan=self.home/'plan.json';plan.write_bytes(c.canonical(review))
        policy=self.home/'policy.json';policy.write_bytes(c.canonical(self.policy))
        quota = self.home/'quota.json'
        quota.write_bytes(c.canonical(self.policy['quota_evidence']))
        return ['release_manager.py','release',command,'--archive',str(archive),'--sha',c.sha(raw),
                '--plan',str(plan),'--policy',str(policy),'--go',review['go'],'--quota-evidence',str(quota)]

    def local_remote(self, operation, policy, **request):
        with patch.object(c, 'Manager', return_value=self.m):
            return c.dispatch(dict(operation=operation, policy=policy, **request))

    def test_http_exhaustion_after_publication_never_reapplies(self):
        raw, _, review = self.plan()
        network = HTTPSFixture({'index.html': b'old index', 'script.js': b'old script'})

        def local(operation, policy, **request):
            result = self.local_remote(operation, policy, **request)
            if operation == 'apply':
                network.public = {'index.html': b'index new', 'script.js': b'script new'}
                network.failures['/'] = [ConnectionResetError() for _ in range(4)]
            return result

        with patch.object(sys, 'argv', self.http_cli_args('apply', raw, review)), \
             patch.object(cli, 'remote', side_effect=local) as remote, \
             patch.object(cli, 'HTTPClient', side_effect=network.client), patch.object(release_http.time, 'sleep'):
            with self.assertRaisesRegex(RuntimeError, 'retries exhausted'):
                cli.main()
        self.assertEqual([call.args[0] for call in remote.call_args_list], ['apply', 'http-state'])
        self.assertEqual(self.m.status('test-release')['phase'], 'awaiting_http_verify')
        self.assertEqual(len(list(self.m.root.glob('*/backup.tar.gz'))), 1)
        self.assertEqual((self.doc/'index.html').read_bytes(), b'index new')
        self.assert_protected()

    def test_finalize_resumes_only_proven_static_files_and_never_republishes(self):
        raw, _, review = self.apply()
        network = HTTPSFixture()
        network.failures['/index'] = [ConnectionResetError() for _ in range(4)]
        run = self.m.run('test-release')
        snapshot, backups = self.m.snapshot(self.identity), (run/'backup.tar.gz').read_bytes()
        with patch.object(sys, 'argv', self.http_cli_args('finalize', raw, review)), \
             patch.object(cli, 'remote', side_effect=self.local_remote) as remote, \
             patch.object(cli, 'HTTPClient', side_effect=network.client), patch.object(release_http.time, 'sleep'), \
             patch('sys.stdout', new_callable=io.StringIO) as stdout:
            with self.assertRaisesRegex(RuntimeError, 'retries exhausted'):
                cli.main()
            self.assertEqual(self.m.receipt(run)['http_progress']['files'], ['script.js'])
            self.assertEqual(self.m.status('test-release')['phase'], 'awaiting_http_verify')
            self.assertEqual(network.requests.count('/script.js'), 1)
            network.requests.clear()
            cli.main()
        self.assertEqual([call.args[0] for call in remote.call_args_list],
                         ['http-state', 'http-checkpoint', 'http-state', 'attest'])
        self.assertEqual(json.loads(stdout.getvalue())['phase'], 'verified')
        self.assertEqual(json.loads(stdout.getvalue())['http']['resumed_files'], 1)
        self.assertNotIn('/script.js', network.requests)
        self.assertIn('/api/form-status.php', network.requests)
        self.assertIn('/.envrc', network.requests)
        self.assertEqual(self.m.snapshot(self.identity), snapshot)
        self.assertEqual((run/'backup.tar.gz').read_bytes(), backups)
        self.assertNotIn('http_progress', self.m.receipt(run))

    def test_approved_v1_plan_can_apply_and_finalize_with_full_profile(self):
        raw, _, review = self.plan()
        plan = review['plan']
        for field in ('http_verification', 'quota_evidence_sha256', 'sha256'):
            plan.pop(field)
        plan['sha256'] = c.digest(plan)
        review['go'] = c.plan_go(plan)
        self.m.apply(raw, plan, review['go'])
        network = HTTPSFixture()
        with patch.object(sys, 'argv', self.http_cli_args('finalize', raw, review)), \
             patch.object(cli, 'remote', side_effect=self.local_remote), \
             patch.object(cli, 'HTTPClient', side_effect=network.client), \
             patch('sys.stdout', new_callable=io.StringIO) as stdout:
            cli.main()
        self.assertEqual(json.loads(stdout.getvalue())['http']['profile'], 'full')
        self.assertEqual(self.m.status('test-release')['phase'], 'verified')

    def test_finalize_blocks_missing_or_wrong_quota_evidence_before_http_or_ssh(self):
        raw, _, review = self.apply()
        argv = self.http_cli_args('finalize', raw, review)
        for arguments, error in [(argv[:-2], 'original --quota-evidence'), (argv, 'Policy SHA mismatch')]:
            with self.subTest(error=error), patch.object(sys, 'argv', arguments), \
                 patch.object(cli, 'remote') as remote, patch.object(cli, 'HTTPClient') as http:
                (self.home/'quota.json').write_text('{}')
                with self.assertRaisesRegex(RuntimeError, error):
                    cli.main()
                remote.assert_not_called()
                http.assert_not_called()
        self.assertEqual(self.m.status('test-release')['phase'], 'awaiting_http_verify')

    def test_finalize_blocks_matrix_semantic_failures_without_retry_or_attestation(self):
        raw, _, review = self.apply()
        for path, response, error in [
            ('/index', (301, {'Location': 'http://outside.invalid/private?not-for-logs'}, b''), 'Wrong redirect Location'),
            ('/.envrc', (200, {}, b'sensitive fixture'), 'Wrong final status'),
        ]:
            with self.subTest(path=path):
                network = HTTPSFixture()
                network.responses[path] = response
                with patch.object(sys, 'argv', self.http_cli_args('finalize', raw, review)), \
                     patch.object(cli, 'remote', side_effect=self.local_remote) as remote, \
                     patch.object(cli, 'HTTPClient', side_effect=network.client), patch.object(release_http.time, 'sleep') as sleep:
                    with self.assertRaisesRegex(RuntimeError, error) as caught:
                        cli.main()
                self.assertNotIn('not-for-logs', str(caught.exception))
                self.assertEqual(network.requests.count(path), 1)
                self.assertEqual([call.args[0] for call in remote.call_args_list], ['http-state'])
                sleep.assert_not_called()
        self.assertEqual(self.m.status('test-release')['phase'], 'awaiting_http_verify')

    def test_finalize_rechecks_production_before_attestation(self):
        raw, manifest, review = self.apply()
        plan, go = review['plan'], review['go']
        state = self.m.http_state(plan, go)
        evidence = cli.http_verify(manifest, c.sha(raw), plan=plan, state=state, client=HTTPSFixture().client())
        (self.doc/'script.js').write_bytes(b'third-party change')
        with self.assertRaisesRegex(RuntimeError, 'Published snapshot drift'):
            self.m.attest(plan, go, state, evidence)
        with self.assertRaisesRegex(RuntimeError, 'Published snapshot drift'):
            self.m.http_state(plan, go)
        self.assertEqual(self.m.receipt(self.m.run('test-release'))['phase'], 'awaiting_http_verify')

    def test_expired_or_replaced_checkpoint_is_unusable(self):
        _, _, review = self.apply()
        plan, go = review['plan'], review['go']
        state = self.m.http_state(plan, go)
        self.m.checkpoint_http(plan, go, state, ['script.js'])
        recent = self.m.http_state(plan, go)
        self.assertEqual(recent['checked_files'], ['script.js'])
        with self.assertRaisesRegex(RuntimeError, 'state changed'):
            self.m.checkpoint_http(plan, go, state, ['script.js'])
        with patch.object(time, 'time', return_value=time.time() + c.HTTP_PROGRESS_SECONDS + 1):
            self.assertEqual(self.m.http_state(plan, go)['checked_files'], [])

    def test_archived_entrypoints_cannot_contact_production(self):
        for name in ['release.py','form_release.py','smtp_e2e.py','smtp_package.py']:
            result=subprocess.run([sys.executable,'-B',str(Path(__file__).parent/name),'apply'],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            self.assertNotEqual(result.returncode,0);self.assertIn(b'Archived rollout CLI',result.stderr)

    def test_legacy_inventory_is_readonly_and_outside_prune(self):
        legacy=self.private/'backups/legacy';legacy.mkdir(parents=True,mode=0o700)
        archive=legacy/'public.tar.gz';archive.write_bytes(c.pack({'index.html':b'old'}));archive.chmod(0o600)
        rows=self.m.historical_backups();self.assertEqual(rows[0]['sha256'],c.sha(archive.read_bytes()))
        self.assertFalse(rows[0]['verified_for_manager']);self.assertFalse(self.m.root.exists())
        self.assertEqual(self.m.prune_plan()['plan']['candidates'],[])

    def test_status_detects_current_production_drift(self):
        self.verified();self.assertTrue(self.m.status('test-release')['current_files_match_receipt'])
        (self.doc/'script.js').write_bytes(b'external change')
        status=self.m.status('test-release');self.assertEqual(status['phase'],'drifted');self.assertEqual(status['receipt_phase'],'verified')
        self.assertFalse(status['current_files_match_receipt']);self.assert_protected()

    def test_package_determinism(self):
        self.assertEqual(self.package()[0],self.package()[0])
        raw,m=self.package();self.assertEqual(c.verify_package(raw,c.sha(raw))[0],m)

    def test_runtime_migration_and_unexpected_files_block(self):
        raw,m=self.package();m['files']['public/api/smtp-manifest.php']='0'*64
        with self.assertRaises(RuntimeError):self.m.preflight(m,len(raw))
        (self.doc/'unknown.txt').write_bytes(b'outside scope')
        with self.assertRaises(RuntimeError):self.plan()


if __name__=='__main__':unittest.main()
