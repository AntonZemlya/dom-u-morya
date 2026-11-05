"""Real Apache/PHP on disposable loopback, emulating Jino's HTTP TLS backend."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import jino_remote
import release_core as core
import url_matrix

ROOT = Path(__file__).resolve().parent.parent
HTTPD = os.environ.get('HTTPD_BIN', '/usr/sbin/httpd')
PHP = os.environ.get('PHP84_CGI_BIN', '/private/tmp/dom-smtp-harness-php84/sapi/cgi/php-cgi')


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


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
                   'mime', 'log_config', 'rewrite', 'proxy', 'proxy_fcgi']
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

        def get(url, method='GET'):
            logical = urllib.parse.urlsplit(url)
            request = urllib.request.Request(origin + logical.path + ('?' + logical.query if logical.query else ''),
                method=method, headers={'Host': logical.netloc, 'X-Forwarded-Protocol': logical.scheme})
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
