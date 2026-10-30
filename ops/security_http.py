"""Read-only HTTP regression checks for hidden service files. Never prints bodies."""
import secrets
import urllib.error
import urllib.request

SERVICE_PATHS = [
    '.envrc','.htaccess','.env','.env.local','.env.css','.env.php','.envrc.bak','.htaccess~','.git/config','.git/HEAD',
    '.svn/entries','assets/.env','assets/.git/config',
    '%2eenvrc','%2ehtaccess','%2egit/config','.well-known/acme-challenge/.env',
]

def fetch(url, method='GET', headers=None, context=None):
    request=urllib.request.Request(url,method=method,headers=headers or {})
    try:
        response=urllib.request.urlopen(request,timeout=15,context=context)
    except urllib.error.HTTPError as error:
        response=error
    with response:
        # No service file bodies are retained or printed, even on a regression.
        return response.getcode(),dict(response.headers),response.read(16384) if '/security-probe-' in url or '/.well-known/acme-challenge/' in url and '/.env' not in url else b''

def check_denials(origin, context=None):
    rows=[]
    nonce=secrets.token_hex(8)
    targets=[(name,'') for name in SERVICE_PATHS]+[(name,'?security-check='+nonce) for name in ['.envrc','.htaccess']]
    for name,suffix in targets:
        for method in ['GET','HEAD']:
            code,headers,_=fetch(origin+'/'+name+suffix,method,{'Cache-Control':'no-cache'},context)
            if code not in [403,404]:
                raise RuntimeError('Hidden service path accessible or broken: '+method+' /'+name+' HTTP '+str(code))
            rows.append({'path':'/'+name,'method':method,'status':code,'cache_busted':bool(suffix)})
    return rows
