"""Read-only URL contract. GET/HEAD only; never submits a lead or consent."""
import argparse
import json
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request

DOMAIN = 'zhk-dom-umorya.ru'
ORIGIN = 'https://' + DOMAIN
QUERY = '?utm_source=seo001&utm_campaign=normalization%20check&yclid=1234567890'
PAGES = ['/', '/privacy.html', '/consent-personal-data.html', '/consent-analytics.html']
ALIASES = {'/index': '/', '/index/': '/', '/index.html': '/', '/index.html/': '/',
           '/privacy.html/': '/privacy.html',
           '/consent-personal-data.html/': '/consent-personal-data.html',
           '/consent-analytics.html/': '/consent-analytics.html'}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def fetch(url, method='GET'):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request(url, method=method, headers={'Cache-Control': 'no-cache'})
    try:
        response = opener.open(request, timeout=25)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        # No protected response bodies are read, retained or printed.
        body = response.read(65537) if method == 'GET' and 300 <= response.status < 400 else b''
        return response.status, dict(response.headers), body


def check(fetcher=fetch, observe=False):
    rows = []
    failures = []
    provider_hops = []

    def case(url, target, final_status, max_hops, method='GET'):
        current = url
        chain = []
        try:
            for _ in range(5):
                code, headers, body = fetcher(current, method)
                location = next((v for k, v in headers.items() if k.lower() == 'location'), None)
                chain.append(dict(url=current, status=code, location=location))
                if not 300 <= code < 400:
                    break
                assert code == 301 and location, 'Expected permanent redirect with Location'
                # Owner-approved exception: Jino nginx strips www before Apache.
                # No other HTTP destination, path/query change or downgrade is allowed.
                provider_hop = (current.startswith('http://www.' + DOMAIN + '/')
                                and location == current.replace('http://www.', 'http://', 1))
                assert provider_hop or location.startswith(ORIGIN + '/'), 'Location must be absolute canonical HTTPS'
                if current.startswith('http://') and method == 'GET':
                    assert len(body) <= 65536 and b'rel="canonical"' not in body.lower() \
                        and b'hero-section-heading' not in body, 'HTTP redirect contains a site page'
                if provider_hop:
                    provider_hops.append(dict(url=current, location=location, method=method,
                                              status=code, no_site_page=True))
                assert location not in [hop['url'] for hop in chain], 'Redirect loop'
                current = location
            else:
                raise AssertionError('Too many redirects')
            assert code in final_status, 'Wrong final status'
            assert current == target, 'Wrong final URL or query parameters'
            assert len(chain) - 1 <= max_hops, 'Unnecessary redirect chain'
            if url != target:
                assert chain[0]['status'] == 301, 'Missing canonical redirect'
            else:
                assert len(chain) == 1, 'Canonical URL redirects'
            passed = True
            error = None
        except Exception as exc:
            passed = False
            error = str(exc)
            failures.append(dict(url=url, method=method, error=error))
        rows.append(dict(method=method, url=url, target=target, chain=chain, passed=passed, error=error))

    for scheme in ['https', 'http']:
        for host in [DOMAIN, 'www.' + DOMAIN]:
            origin = scheme + '://' + host
            for path, canonical in [(p, p) for p in PAGES] + list(ALIASES.items()):
                for query in ['', QUERY]:
                    # Jino's nginx www redirect precedes .htaccess, so two hops
                    # are permitted only for that provider-owned alias.
                    hops = 2 if host.startswith('www.') else 1
                    for method in ['GET', 'HEAD']:
                        case(origin + path + query, ORIGIN + canonical + query, [200], hops, method)
    for path in ['/seo-redirect-missing-001.html', '/seo-redirect-missing-001.html/',
                 '/missing/index.html', '/privacy.html/extra', '/index.html/extra']:
        case(ORIGIN + path, ORIGIN + path, [404], 0)
    for path in ['/privacy', '/assets', '/api', '/assets/fonts']:
        for query in ['', QUERY]:
            for method in ['GET', 'HEAD']:
                case(ORIGIN + path + query, ORIGIN + path + '/' + query, [403, 404], 1, method)
                case(ORIGIN + path + '/' + query, ORIGIN + path + '/' + query, [403, 404], 0, method)
    for path in ['/.envrc', '/.htaccess', '/.git', '/.git/config', '/%2eenvrc',
                 '/api/lead-core.php', '/api/lead-smtp.php', '/api/analytics-core.php',
                 '/.dom-u-morya/analytics/state/metrica-consent.sqlite3',
                 '/privacy/metrica-consent.sqlite3']:
        for method in ['GET', 'HEAD']:
            case(ORIGIN + path, ORIGIN + path, [403, 404], 0, method)
    for path in ['/api/lead.php', '/api/analytics-consent.php']:
        case(ORIGIN + path, ORIGIN + path, [405], 0)
    case(ORIGIN + '/api/form-status.php', ORIGIN + '/api/form-status.php', [200], 0)
    return dict(status='OBSERVED' if observe else 'PASS' if not failures else 'FAIL',
                cases=len(rows), failures=failures, checks=rows, no_post=True,
                provider_http_www_hops=provider_hops)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    parser.add_argument('--observe', action='store_true')
    args = parser.parse_args()
    result = check(observe=args.observe)
    Path(args.output).write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({k: v for k, v in result.items() if k != 'checks'}, indent=2))
    raise SystemExit(0 if args.observe or result['status'] == 'PASS' else 1)
