"""Read-only real Apache/PHP cache contract on disposable loopback fixtures."""
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
import urllib.request
import release_core as core

ROOT = Path(__file__).resolve().parent.parent
PHP = os.environ['PHP84_CGI_BIN']

def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def run():
    core.approved_htaccess((ROOT/'.htaccess').read_bytes())
    with tempfile.TemporaryDirectory(prefix='dom-cache-apache-', dir='/private/tmp') as temp:
        base=Path(temp).resolve();doc=base/'domains'/core.DOMAIN
        shutil.copytree(ROOT/'dist',doc)
        # A content-addressed test fixture is never part of the production package.
        raw=b'synthetic content-addressed HTTP fixture'
        hashed='font-1-'+hashlib.sha256(raw).hexdigest()[:16]+'.woff2'
        (doc/'assets/performance').mkdir(exist_ok=True)
        (doc/'assets/performance'/hashed).write_bytes(raw)
        (doc/'.envrc').write_bytes(b'protected synthetic fixture')
        port,php_port=free_port(),free_port();origin='http://127.0.0.1:'+str(port)
        modules=['mpm_event','unixd','authz_core','authz_host','dir','autoindex','mime','log_config','rewrite','headers','proxy','proxy_fcgi']
        conf='ServerRoot "'+str(base)+'"\n'+''.join('LoadModule '+m+'_module /usr/libexec/apache2/mod_'+m+'.so\n' for m in modules)
        conf+='ServerName '+core.DOMAIN+'\nDefaultRuntimeDir "'+str(base)+'"\nMutex file:'+str(base)+' default\n'
        conf+='PidFile "'+str(base/'httpd.pid')+'"\nErrorLog "'+str(base/'error.log')+'"\n'
        conf+='Listen 127.0.0.1:'+str(port)+'\nTypesConfig /private/etc/apache2/mime.types\nDirectoryIndex index.html\n'
        conf+='DocumentRoot "'+str(doc)+'"\n<Directory "'+str(doc)+'">\nAllowOverride All\nOptions Indexes FollowSymLinks\nRequire all granted\n</Directory>\n'
        conf+='ProxyFCGIBackendType GENERIC\n<FilesMatch "\\.php$">\nSetHandler "proxy:fcgi://127.0.0.1:'+str(php_port)+'"\n</FilesMatch>\n'
        cfg=base/'httpd.conf';cfg.write_text(conf)
        subprocess.run(['/usr/sbin/httpd','-t','-f',str(cfg)],check=True)
        php=subprocess.Popen([PHP,'-n','-d','disable_functions=mail','-d','cgi.force_redirect=0','-b','127.0.0.1:'+str(php_port)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        apache=subprocess.Popen(['/usr/sbin/httpd','-f',str(cfg),'-DFOREGROUND'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        def get(path,method='GET',headers=None):
            request=urllib.request.Request(origin+path,method=method,headers=dict({'Host':core.DOMAIN,'X-Forwarded-Protocol':'https'},**(headers or {})))
            try:response=opener.open(request,timeout=5)
            except urllib.error.HTTPError as error:response=error
            with response:return response.status,response.headers,response.read()
        try:
            for _ in range(100):
                try:
                    if get('/')[0]==200:break
                except OSError:pass
                assert apache.poll() is None,(base/'error.log').read_text()
                time.sleep(.03)
            else:raise AssertionError('Local Apache not ready')
            for path in ['/','/styles.css','/script.js','/assets/location.webp']:
                for method in ['GET','HEAD']:
                    status,h,_=get(path,method)
                    assert status==200 and h['Cache-Control']=='public, max-age=0, must-revalidate',(path,status,dict(h))
            status,h,body=get('/assets/performance/'+hashed)
            assert status==200 and body==raw and h['Cache-Control']=='public, max-age=31536000, immutable'
            assert get('/assets/performance/'+hashed,headers={'If-None-Match':h['ETag']})[0]==304
            _,h,_=get('/styles.css');(doc/'styles.css').write_text('/* synthetic replacement */')
            status,_,body=get('/styles.css',headers={'If-None-Match':h['ETag']})
            assert status==200 and body==b'/* synthetic replacement */'
            status,h,_=get('/api/form-status.php');assert status==200 and 'no-store' in h.get('Cache-Control','')
            for path in ['/.envrc','/.htaccess','/assets/missing.webp']:
                status,h,_=get(path);assert status in [403,404] and 'immutable' not in h.get('Cache-Control','')
        finally:
            for proc in [apache,php]:
                proc.terminate()
                try:proc.wait(timeout=5)
                except subprocess.TimeoutExpired:proc.kill();proc.wait()
    print('PASS Apache v3 cache: fixed-URL GET/HEAD/revalidation, immutable content hash/304, API no-store, protected paths; no production access')

if __name__=='__main__':run()
