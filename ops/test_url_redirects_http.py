"""Real Apache/PHP on disposable loopback, emulating Jino's HTTP TLS backend."""
import hashlib
import json
import os
import re
import sys
from pathlib import Path
import shutil
import socket
import subprocess
import statistics
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import jino_remote
import release_core as core
import url_matrix
from release_manager import verify_catalog_page

ROOT = Path(__file__).resolve().parent.parent
HTTPD = os.environ.get('HTTPD_BIN', '/usr/sbin/httpd')
PHP = os.environ.get('PHP84_CGI_BIN', '/private/tmp/dom-smtp-harness-php84/sapi/cgi/php-cgi')


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def measure_root(get):
    get(core.ORIGIN+'/')
    samples = []
    for _ in range(20):
        started = time.perf_counter()
        code, _, _ = get(core.ORIGIN+'/')
        assert code == 200
        samples.append((time.perf_counter()-started)*1000)
    ordered = sorted(samples)
    return dict(median_ms=round(statistics.median(ordered), 2), p95_ms=round(ordered[18], 2))


def exercise_live_catalog(base, doc, get, loopback):
    sys.path.insert(0, str(ROOT/'scripts'))
    from catalog_sync import Store, atomic, public_path
    store = Store(base, node=shutil.which('node'))
    store.root.parent.mkdir(mode=0o700, exist_ok=True)
    for directory in (store.root, store.snapshots, store.media):
        directory.mkdir(mode=0o700)
    lots = json.loads((ROOT/'data'/'apartments.json').read_text())
    original_price = lots[0]['price_rub']
    lots[0]['price_rub'] += 23_000
    media = lots[0]['plans'][0]
    original = doc/media['local_path']
    store.put_media(media['sha256'], original.read_bytes(), original.with_suffix('.preview.webp').read_bytes())
    media['local_path'] = public_path(media['sha256'])
    lots.pop() # Exercise one confirmed withdrawal and dynamic category totals.
    now = int(time.time())-180
    version, raw = store.build_snapshot(lots, now)
    atomic(store.snapshots/(version+'.json'), raw)
    state = {'active':version, 'source_ok':True, 'checked_at':now, 'schema':1, 'unresolved_count':1, 'published_checked_at':now}
    first = base/'partial.json'
    first.write_text(json.dumps(state))
    lots[0]['price_rub'] += 11_000
    newer, raw = store.build_snapshot(lots, now)
    atomic(store.snapshots/(newer+'.json'), raw)
    second = base/'confirmed.json'
    second.write_text(json.dumps(dict(state, active=newer, unresolved_count=0)))
    lots[0]['price_rub'] -= 11_000
    subprocess.run(['node', str(ROOT/'tests/catalog-live-browser.cjs'), loopback, str(store.state), str(first), str(second),
                    lots[0]['id'], str(lots[0]['price_rub'])], check=True, timeout=120)
    store.save(state)
    sha = hashlib.sha256((doc/'index.html').read_bytes()).hexdigest()
    status, headers, body = get(core.ORIGIN+'/')
    assert status == 200 and headers['X-Dom-Catalog-Status'] == 'confirmed'
    assert headers['X-Dom-Catalog-Checked-At'] == time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now))
    verify_catalog_page(body, headers, sha)
    assert 'Ассортимент уточняется'.encode() not in body
    stamp = time.gmtime(now+10800)
    fresh_label = time.strftime('Цены и наличие проверены по данным застройщика %d.%m.%Y в %H:%M МСК', stamp)
    assert fresh_label.encode() in body
    state.update(checked_at=now+120, published_checked_at=now+120)
    store.save(state)
    code, headers, body_updated = get(core.ORIGIN+'/')
    assert code == 200 and headers['X-Dom-Catalog-Snapshot'] == version
    stamp = time.gmtime(now+120+10800)
    assert time.strftime('Цены и наличие проверены по данным застройщика %d.%m.%Y в %H:%M МСК', stamp).encode() in body_updated
    assert body_updated != body
    payload = json.loads(re.search(rb'<script id="site-data" type="application/json">(.*?)</script>', body, re.S)[1])
    assert len(payload['apartments']) == len(lots) and all(lot['developer_availability'] == 'InStock' for lot in payload['apartments'])
    timing = measure_root(get)
    assert timing['median_ms'] < 150, timing
    assert b'data-lot-id="'+lots[0]['id'].encode()+b'"' in body
    expected_price = '{:,}'.format(lots[0]['price_rub']).replace(',', '\u00a0')+' ₽'
    assert expected_price.encode() in body and expected_price.encode() in re.search(rb'id="price-label"[^>]*>(.*?)<', body)[1]
    response = get(core.ORIGIN+'/', 'HEAD')
    assert response[1]['X-Dom-Catalog-Snapshot'] == version and not response[2]
    assert get(core.ORIGIN+'/index.php')[0] == 301
    plan_url = core.ORIGIN+'/'+media['local_path']
    svg = get(plan_url)
    assert svg[0] == 200 and svg[1]['Content-Type'] == 'image/svg+xml'
    assert hashlib.sha256(svg[2]).hexdigest() == media['sha256']
    assert 'sandbox' in svg[1]['Content-Security-Policy']
    preview = get(plan_url[:-4]+'.preview.webp')
    assert preview[0] == 200 and preview[2][8:12] == b'WEBP'
    assert get(core.ORIGIN+'/api/catalog-plan.php?file=../state.json')[0] == 404
    # Validate selection against the real live snapshot without invoking SMTP or a form endpoint.
    php_cli = os.environ.get('PHP84_BIN', 'php')
    program = """
    require $argv[1].'/api/lead-core.php';
    $d = ['name'=>'Fixture','phone'=>'+79991234567','consent'=>true,
          'consentVersion'=>DomLead\\CONSENT_VERSION,'lotId'=>$argv[2]];
    foreach (array_slice($argv,3) as $expected) {
        if ($expected === 'legacy') unset($d['lotPrice']); else $d['lotPrice'] = (int)$expected;
        try { $v = DomLead\\validate(json_encode($d)); echo $v['lot']['price_rub']; }
        catch (DomLead\\Rejection $r) { echo $r->status.':'.$r->reason; }
        echo PHP_EOL;
    }
    """
    result = subprocess.check_output([php_cli,'-r',program,str(doc),lots[0]['id'],'legacy',str(original_price),str(lots[0]['price_rub'])])
    assert result.decode().splitlines() == ['409:catalog_reload_required', '409:catalog_price_changed', str(lots[0]['price_rub'])]
    state['source_ok'] = False
    store.save(state)
    code, headers, body = get(core.ORIGIN+'/')
    assert code == 200 and headers['X-Dom-Catalog-Status'] == 'unconfirmed'
    verify_catalog_page(body, headers, sha)
    assert time.strftime('Информация по состоянию на %d.%m.%Y', stamp).encode() in body
    assert headers['X-Dom-Catalog-Checked-At'] == time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now+120))
    assert 'Цены и наличие проверены'.encode() not in body
    result = subprocess.check_output([php_cli,'-r',program,str(doc),lots[0]['id'],str(lots[0]['price_rub'])])
    assert result.strip() == b'409:catalog_unconfirmed'
    store.save(dict(state, source_ok=True, checked_at=now-36*3600-1, published_checked_at=now-36*3600-1))
    expired = get(core.ORIGIN+'/', 'HEAD')
    assert expired[0] == 200 and expired[1]['X-Dom-Catalog-Status'] == 'unconfirmed'
    return timing


def run():
    accepted = (ROOT / '.htaccess').read_bytes()
    legacy = jino_remote.SECURITY_POLICY + jino_remote.HTTPS_REDIRECT
    assert accepted.startswith(jino_remote.SECURITY_POLICY), 'Permanent guard must be byte-identical'
    core.approved_htaccess(accepted)
    assert core.sha(legacy) == core.LEGACY_HTACCESS_SHA256
    php_version = subprocess.check_output([PHP, '-n', '-v'], text=True)
    assert 'PHP 8.4.' in php_version, 'PHP 8.4 CGI required'
    with tempfile.TemporaryDirectory(prefix='dom-url-apache-', dir='/private/tmp') as temporary:
        base = Path(temporary).resolve()
        doc = base / 'domains' / core.DOMAIN
        shutil.copytree(ROOT / 'dist', doc)
        fixtures = ['.envrc', '.git/config', 'assets/.env',
                    '.well-known/acme-challenge/.env', '.well-known/acme-challenge/fixture-token']
        for name in fixtures:
            p = doc / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(b'isolated-protected-fixture')
        http_port, php_port = port(), port()
        origin = 'http://127.0.0.1:' + str(http_port)
        modules = ['mpm_event', 'unixd', 'authz_core', 'authz_host', 'dir', 'autoindex',
                   'mime', 'log_config', 'rewrite', 'proxy', 'proxy_fcgi', 'headers']
        conf = 'ServerRoot "' + str(base) + '"\n'
        conf += ''.join('LoadModule ' + m + '_module /usr/libexec/apache2/mod_' + m + '.so\n' for m in modules)
        conf += 'ServerName ' + core.DOMAIN + '\nDefaultRuntimeDir "' + str(base) + '"\n'
        conf += 'Mutex file:' + str(base) + ' default\nPidFile "' + str(base / 'httpd.pid') + '"\n'
        conf += 'ErrorLog "' + str(base / 'error.log') + '"\nLogLevel warn\n'
        conf += 'Listen 127.0.0.1:' + str(http_port) + '\nTypesConfig /private/etc/apache2/mime.types\n'
        conf += 'DirectoryIndex index.html\nDocumentRoot "' + str(doc) + '"\n'
        # Deliberately enable Indexes in the parent: the exact policy must deny listing.
        conf += '<Directory "' + str(doc) + '">\nAllowOverride All\nOptions Indexes FollowSymLinks\nRequire all granted\n</Directory>\n'
        conf += 'ProxyFCGIBackendType GENERIC\n<FilesMatch "\\.php$">\nSetHandler "proxy:fcgi://127.0.0.1:' + str(php_port) + '"\n</FilesMatch>\n'
        (base / 'httpd.conf').write_text(conf)
        subprocess.run([HTTPD, '-t', '-f', str(base / 'httpd.conf')], check=True)
        php = subprocess.Popen([PHP, '-n', '-d', 'disable_functions=mail', '-d', 'cgi.force_redirect=0',
                                '-b', '127.0.0.1:' + str(php_port)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        apache = subprocess.Popen([HTTPD, '-f', str(base / 'httpd.conf'), '-DFOREGROUND'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), url_matrix.NoRedirect())

        def get(url, method='GET', headers=None):
            logical = urllib.parse.urlsplit(url)
            request = urllib.request.Request(origin + logical.path + ('?' + logical.query if logical.query else ''),
                method=method, headers=dict({'Host': logical.netloc, 'X-Forwarded-Protocol': logical.scheme}, **(headers or {})))
            try:
                response = opener.open(request, timeout=5)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                return response.status, dict(response.headers), response.read()

        try:
            for _ in range(100):
                try:
                    if get(core.ORIGIN + '/')[0] == 200:
                        break
                except OSError:
                    pass
                assert apache.poll() is None, (base / 'error.log').read_text()
                time.sleep(.03)
            else:
                raise AssertionError('Disposable Apache readiness timeout')
            # Reproduce the actual downgrade on a cleartext backend with the old policy.
            (doc / '.htaccess').write_bytes(legacy)
            old_code, old_headers, _ = get(core.ORIGIN + '/privacy')
            assert old_code == 301 and old_headers['Location'] == 'http://' + core.DOMAIN + '/privacy/'
            assert get(core.ORIGIN + '/index.html')[0] == 200
            assert get(core.ORIGIN + '/privacy.html/')[0] == 404
            (doc / '.htaccess').write_bytes(accepted)
            result = url_matrix.check(get)
            assert result['status'] == 'PASS', result['failures']
            # Exercise the exact provider exception without touching Jino settings.
            def provider_get(url, method='GET'):
                if url.startswith('http://www.' + core.DOMAIN + '/'):
                    return 301, {'Location': url.replace('http://www.', 'http://', 1)}, b'<html><title>301 Moved Permanently</title></html>'
                return get(url, method)
            provider = url_matrix.check(provider_get)
            assert provider['status'] == 'PASS' and len(provider['provider_http_www_hops']) == 44, provider['failures']
            # Independent negative fixtures prove the exception cannot hide a
            # downgrade, lost query parameters or a site page served over HTTP.
            for mutation in ['downgrade', 'query-loss', 'http-page']:
                def bad_get(url, method='GET'):
                    code, headers, body = provider_get(url, method)
                    if mutation == 'downgrade' and url == core.ORIGIN + '/':
                        return 301, {'Location': 'http://' + core.DOMAIN + '/'}, b''
                    if url.startswith('http://www.' + core.DOMAIN + '/'):
                        if mutation == 'query-loss' and '?' in url:
                            headers = {'Location': headers['Location'].split('?')[0]}
                        if mutation == 'http-page':
                            body = b'<link rel="canonical" href="https://zhk-dom-umorya.ru/">'
                    return code, headers, body
                rejected = url_matrix.check(bad_get)
                assert rejected['status'] == 'FAIL' and rejected['failures'], mutation
            # Every real static release file must keep both its URL and bytes.
            static = []
            for p in sorted((ROOT / 'dist').rglob('*')):
                if not p.is_file() or p.name.startswith('.') or p.suffix == '.php':
                    continue
                name = p.relative_to(ROOT / 'dist').as_posix()
                code, _, body = get(core.ORIGIN + '/' + ('' if name == 'index.html' else name))
                assert code == 200 and hashlib.sha256(body).digest() == hashlib.sha256(p.read_bytes()).digest(), name
                static.append(name)
            for scheme in ['http', 'https']:
                for host in [core.DOMAIN, 'www.' + core.DOMAIN]:
                    code, _, body = get(scheme + '://' + host + '/.well-known/acme-challenge/fixture-token')
                    assert code == 200 and body == b'isolated-protected-fixture'
            # Cache policy must work on real Apache, including HEAD, 304 and errors.
            for name in ['/', '/styles.css', '/script.js', '/assets/location.webp']:
                for method in ['GET','HEAD']:
                    code, headers, _ = get(core.ORIGIN + name,method)
                    assert code == 200 and headers.get('Cache-Control') == ('no-store, max-age=0' if name == '/' else 'public, max-age=0, must-revalidate'), (name,headers)
            for p in (doc/'assets/performance').iterdir():
                code, headers, body = get(core.ORIGIN + '/assets/performance/' + p.name)
                assert code == 200 and headers.get('Cache-Control') == 'public, max-age=31536000, immutable', headers
                assert hashlib.sha256(body).hexdigest()[:16] in p.name, p.name
                code, fresh, _ = get(core.ORIGIN + '/assets/performance/' + p.name,headers={'If-None-Match':headers['ETag']})
                assert code == 304 and fresh.get('Cache-Control') == headers['Cache-Control'], fresh
            code, headers, body = get(core.ORIGIN + '/api/form-status.php')
            assert code == 200 and 'no-store' in headers.get('Cache-Control',''), headers
            for name in ['/assets/missing.webp','/.envrc','/assets/.env']:
                code, headers, _ = get(core.ORIGIN + name)
                assert code in [403,404] and 'immutable' not in headers.get('Cache-Control',''), headers
            code, old_headers, _ = get(core.ORIGIN + '/styles.css')
            (doc/'styles.css').write_text('/* synthetic replacement */')
            code, new_headers, body = get(core.ORIGIN + '/styles.css',headers={'If-None-Match':old_headers['ETag']})
            assert code == 200 and body == b'/* synthetic replacement */', (code,new_headers)
            bundled_timing = measure_root(get)
            previous = subprocess.check_output(['git','show','1e3ecac8d72034d9ce4bc8a71b365796e5d07a59:.htaccess'], cwd=ROOT)
            assert core.sha(previous) == core.APPROVED_HTACCESS_SHA256
            (doc/'.htaccess').write_bytes(previous)
            static_timing = measure_root(get)
            (doc/'.htaccess').write_bytes(accepted)
            active_timing = exercise_live_catalog(base, doc, get, origin)
            result['catalog_response_timing_loopback'] = dict(static=static_timing, bundled_php=bundled_timing, active_php=active_timing)
            print('Catalog full-response localhost timing (ms):', result['catalog_response_timing_loopback'])
            result['cache_policy'] = 'PASS: fixed URL revalidation, content hashes, 304/HEAD, API no-store, errors, replacement'
            # POST is exercised only against disposable local PHP. The method
            # reaches PHP directly, rather than being redirected or changed to GET.
            code, headers, body = get(core.ORIGIN + '/api/lead.php', 'POST')
            assert code == 415 and json.loads(body)['error'] == 'json_required' and not headers.get('Location'), code
            result.update(static_files=len(static), acme_http_https=True, local_post_status=code,
                          old_mod_dir_downgrade_reproduced=True, php=php_version.splitlines()[0],
                          production_accessed=False, provider_exception_cases=44,
                          unsafe_provider_mutations_rejected=3)
        finally:
            for process in [apache, php]:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
    result['processes_stopped'] = True
    out = ROOT / '.test-output/url-redirects'
    out.mkdir(parents=True, exist_ok=True)
    (out / 'report.json').write_text(json.dumps(result, indent=2) + '\n')
    print('PASS real Apache/PHP URL matrix: %s cases, %s static files; old mod_dir downgrade reproduced; ACME and directory denial preserved' % (result['cases'], result['static_files']))


if __name__ == '__main__':
    run()
