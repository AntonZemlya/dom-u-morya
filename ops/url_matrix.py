"""Read-only URL contract. GET/HEAD only; never submits a lead or consent."""
import argparse
import json
from pathlib import Path
from release_http import ConnectionFailure, HTTPClient, NoRedirect, TransportFailure

DOMAIN = 'zhk-dom-umorya.ru'
ORIGIN = 'https://' + DOMAIN
QUERY = '?utm_source=seo001&utm_campaign=normalization%20check&yclid=1234567890'
PAGES = ['/', '/privacy.html', '/consent-personal-data.html', '/consent-analytics.html']
ALIASES = {'/index': '/', '/index/': '/', '/index.html': '/', '/index.html/': '/',
           '/privacy.html/': '/privacy.html',
           '/consent-personal-data.html/': '/consent-personal-data.html',
           '/consent-analytics.html/': '/consent-analytics.html'}


def check(fetcher=None, observe=False, *, client=None, compact=False, fail_fast=False, case_passed=None):
    if fetcher is None and client is None:
        client = HTTPClient()
        with client.deadline():
            return check(observe=observe, client=client, compact=compact, fail_fast=fail_fast)
    rows = []
    failures = []
    provider_hops = []

    def require(condition, message):
        if not condition:
            raise RuntimeError(message)

    def case(url, target, final_status, max_hops, method='GET'):
        current = url
        chain = []
        def check_redirect(code, headers):
            locations = [v for k, v in headers.items() if k.lower() == 'location']
            location = locations[0] if locations else None
            if not 300 <= code < 400:
                return location, False
            require(code == 301 and len(locations) == 1 and location, 'Expected permanent redirect with one Location')
            # Nginx may remove www first and leave the original path and query
            # for Apache to normalize. The only cleartext hop is http www to apex.
            www_apex = any(current.startswith(prefix) and location == ORIGIN + current[len(prefix) - 1:]
                           for prefix in ('https://www.' + DOMAIN + '/', 'http://www.' + DOMAIN + '/'))
            provider_hop = (current.startswith('http://www.' + DOMAIN + '/')
                            and location == current.replace('http://www.', 'http://', 1))
            require(current != target and (provider_hop or www_apex or location == target), 'Wrong redirect Location')
            return location, provider_hop

        try:
            for _ in range(5):
                if client is not None:
                    code, headers, body = client.fetch(current, method, expected=None, validate_headers=check_redirect)
                else:
                    code, headers, body = fetcher(current, method)
                location, provider_hop = check_redirect(code, headers)
                chain.append(dict(url=current, status=code, location=location))
                if not 300 <= code < 400:
                    break
                if current.startswith('http://') and method == 'GET':
                    require(len(body) <= 65536 and b'rel="canonical"' not in body.lower()
                            and b'hero-section-heading' not in body, 'HTTP redirect contains a site page')
                if provider_hop:
                    provider_hops.append(dict(url=current, location=location, method=method,
                                              status=code, no_site_page=True))
                require(location not in [hop['url'] for hop in chain], 'Redirect loop')
                current = location
            else:
                raise AssertionError('Too many redirects')
            require(code in final_status, 'Wrong final status')
            require(current == target, 'Wrong final URL or query parameters')
            require(len(chain) - 1 <= max_hops, 'Unnecessary redirect chain')
            if url != target:
                require(chain[0]['status'] == 301, 'Missing canonical redirect')
            else:
                require(len(chain) == 1, 'Canonical URL redirects')
            if case_passed is not None:
                case_passed()
            passed = True
            error = None
        except (ConnectionFailure, TransportFailure):
            raise
        except Exception as exc:
            if fail_fast:
                raise RuntimeError('URL redirect matrix failed for {} {}: {}'.format(
                    method, url.split('?', 1)[0], exc)) from None
            passed = False
            error = str(exc)
            failures.append(dict(url=url, method=method, error=error))
        rows.append(dict(method=method, url=url, target=target, chain=chain, passed=passed, error=error))

    if compact:
        case('http://www.' + DOMAIN + '/index.html' + QUERY, ORIGIN + '/' + QUERY, [200], 2)
        case(ORIGIN + '/seo-redirect-missing-001.html', ORIGIN + '/seo-redirect-missing-001.html', [404], 0)
        for path in ['/privacy/', '/assets/', '/api/', '/assets/fonts/']:
            case(ORIGIN + path, ORIGIN + path, [403, 404], 0)
    else:
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
    if not compact:
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
