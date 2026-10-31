"""New manager's accepted policy on disposable loopback Apache; no PHP/SMTP/Jino."""
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import release_core as core

ROOT=Path(__file__).resolve().parent.parent
HTTPD=os.environ.get('HTTPD_BIN','/usr/sbin/httpd')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        return None


def run():
    accepted=(ROOT/'.htaccess').read_bytes();core.approved_htaccess(accepted)
    with tempfile.TemporaryDirectory(prefix='dom-manager-guard-',dir='/private/tmp') as temporary:
        base=Path(temporary).resolve();doc=base/'public';doc.mkdir()
        fixture=b'synthetic protected fixture'
        files=['.envrc','.env','.git/config','assets/.env','.well-known/acme-challenge/.env']
        for name in files+['.well-known/acme-challenge/fixture-token']:
            p=doc/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(fixture)
        (doc/'index.html').write_bytes(b'isolated Apache fixture')
        (doc/'.htaccess').write_bytes(accepted)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        origin='http://127.0.0.1:'+str(port)
        modules=['mpm_event','unixd','authz_core','authz_host','dir','mime','log_config','rewrite','headers']
        conf='ServerRoot "'+str(base)+'"\n'
        conf+=''.join('LoadModule '+m+'_module /usr/libexec/apache2/mod_'+m+'.so\n' for m in modules)
        conf+='ServerName 127.0.0.1\nDefaultRuntimeDir "'+str(base)+'"\nMutex file:'+str(base)+' default\n'
        conf+='PidFile "'+str(base/'apache.pid')+'"\nErrorLog "'+str(base/'apache.log')+'"\nLogLevel warn\n'
        conf+='Listen 127.0.0.1:'+str(port)+'\nTypesConfig /private/etc/apache2/mime.types\nDirectoryIndex index.html\n'
        conf+='DocumentRoot "'+str(doc)+'"\n<Directory "'+str(doc)+'">\nAllowOverride All\nOptions FollowSymLinks\nRequire all granted\n</Directory>\n'
        conf+='RequestHeader set X-Forwarded-Protocol https early\n'
        (base/'httpd.conf').write_text(conf)
        subprocess.run([HTTPD,'-t','-f',str(base/'httpd.conf')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        apache=subprocess.Popen([HTTPD,'-f',str(base/'httpd.conf'),'-DFOREGROUND'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
        def get(path,method='GET'):
            request=urllib.request.Request(origin+path,method=method,headers={'Cache-Control':'no-cache'})
            try:
                with opener.open(request,timeout=2) as response:return response.status,response.read()
            except urllib.error.HTTPError as response:return response.code,response.read()
        try:
            for _ in range(100):
                try:
                    if get('/')[0]==200:break
                except OSError:pass
                if apache.poll() is not None:raise RuntimeError('Disposable Apache failed to start')
                time.sleep(.03)
            else:raise RuntimeError('Disposable Apache readiness timeout')
            rows=[]
            for path in files+['.htaccess','%2eenvrc','.git%2fconfig']:
                for method in ['GET','HEAD']:
                    code,_=get('/'+path,method);assert code in [403,404],(path,method,code)
                    rows.append(dict(path=path,method=method,status=code))
            assert get('/.well-known/acme-challenge/fixture-token')==(200,fixture)
            # Demonstrate a policy retaining both old substring checks yet exposing a service file.
            weak=accepted.replace(b'RewriteRule (^|/)\\. - [F,END]',b'RewriteRule ^\\.envrc$ - [END]\nRewriteRule (^|/)\\. - [F,END]')
            weak+=b'\n<Files ".envrc">\nRequire all granted\n</Files>\n'
            assert core.GUARD in weak and b'Require all denied' in weak
            try:core.approved_htaccess(weak)
            except RuntimeError:pass
            else:raise AssertionError('Permissive policy was accepted')
            (doc/'.htaccess').write_bytes(weak)
            assert get('/.envrc')==(200,fixture),'Harness must detect actual service-file exposure'
            (doc/'.htaccess').write_bytes(accepted)
            assert get('/.envrc')[0] in [403,404]
            assert get('/')[0]==200
        finally:
            apache.terminate()
            try:apache.wait(timeout=5)
            except subprocess.TimeoutExpired:apache.kill();apache.wait()
    out=ROOT/'.test-output/manager-guard-http';out.mkdir(parents=True,exist_ok=True)
    (out/'report.json').write_text(json.dumps(dict(status='PASS',checks=rows,acme=200,
        permissive_fixture_exposure_detected=True,permissive_policy_rejected=True,process_stopped=True,
        production_accessed=False),indent=2)+'\n')
    print('PASS new manager exact Apache policy: GET/HEAD 403/404, ACME 200; permissive marker fixture exposes 200 and is rejected; loopback process stopped')


if __name__=='__main__':run()
