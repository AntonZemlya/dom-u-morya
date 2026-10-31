"""Real loopback Apache/TLS + PHP 8.4 FastCGI lifecycle; no staging or real email."""
import hashlib
import io
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import ssl
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
import jino_remote as remote
from security_http import check_denials, fetch, SERVICE_PATHS

ROOT=Path(__file__).resolve().parent.parent
HTTPD=os.environ.get('HTTPD_BIN','/usr/sbin/httpd')
PHP=os.environ.get('PHP84_CGI_BIN','/private/tmp/dom-u-morya-php84/php-8.4.14/sapi/cgi/php-cgi')

def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0))
        return sock.getsockname()[1]

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        return None

def run():
    assert Path(PHP).is_file(),'Set PHP84_CGI_BIN to PHP 8.4 CGI'
    version=subprocess.check_output([PHP,'-n','-v'],text=True)
    assert 'PHP 8.4.' in version
    report={'server':'Apache 2.4 loopback HTTP/HTTPS + PHP 8.4 FastCGI','real_mail':'disabled','stages':[]}
    with tempfile.TemporaryDirectory(prefix='dom-dotfile-http-',dir='/private/tmp') as directory:
        base=Path(directory).resolve()
        doc=base/'domains/zhk-dom-umorya.ru';doc.mkdir(parents=True)
        placeholder=b'Original placeholder, no production publication'
        (doc/'index.html').write_bytes(placeholder)
        (doc/'.envrc').write_bytes(b'fixture-managed-php84')
        env_hash=hashlib.sha256((doc/'.envrc').read_bytes()).hexdigest()
        remote.HOME=base;remote.DOC=doc;remote.PRIVATE=base/'.dom-u-morya'
        http_port,https_port,php_port=port(),port(),port()
        http='http://127.0.0.1:'+str(http_port)
        https='https://127.0.0.1:'+str(https_port)
        subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=127.0.0.1',
            '-addext','subjectAltName=IP:127.0.0.1','-addext','basicConstraints=CA:FALSE','-keyout',str(base/'key.pem'),'-out',str(base/'cert.pem')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        (base/'key.pem').chmod(0o600)
        context=ssl.create_default_context(cafile=str(base/'cert.pem'))
        remote.ORIGIN=https;remote.HTTP_TLS_CONTEXT=context
        modules=['mpm_event','unixd','authz_core','authz_host','dir','mime','log_config','rewrite','headers','proxy','proxy_fcgi','ssl','socache_shmcb']
        conf='ServerRoot "'+str(base)+'"\n'
        conf+='\n'.join('LoadModule '+name+'_module /usr/libexec/apache2/mod_'+name+'.so' for name in modules)+'\n'
        conf+='ServerName 127.0.0.1\nDefaultRuntimeDir "'+str(base)+'"\nMutex file:'+str(base)+' default\nPidFile "'+str(base/'httpd.pid')+'"\nErrorLog "'+str(base/'httpd-error.log')+'"\nLogLevel warn\n'
        conf+='Listen 127.0.0.1:'+str(http_port)+'\nListen 127.0.0.1:'+str(https_port)+'\n'
        conf+='TypesConfig /private/etc/apache2/mime.types\nDirectoryIndex index.html\nDocumentRoot "'+str(doc)+'"\n'
        conf+='<Directory "'+str(doc)+'">\nAllowOverride All\nOptions FollowSymLinks\nRequire all granted\n</Directory>\n'
        conf+='ProxyFCGIBackendType GENERIC\n<FilesMatch "\\.php$">\nSetHandler "proxy:fcgi://127.0.0.1:'+str(php_port)+'"\n</FilesMatch>\n'
        conf+='<VirtualHost 127.0.0.1:'+str(http_port)+'>\nRequestHeader set X-Forwarded-Protocol http early\n</VirtualHost>\n'
        conf+='<VirtualHost 127.0.0.1:'+str(https_port)+'>\nServerName 127.0.0.1\nSSLEngine on\nSSLCertificateFile "'+str(base/'cert.pem')+'"\nSSLCertificateKeyFile "'+str(base/'key.pem')+'"\nRequestHeader set X-Forwarded-Protocol https early\n</VirtualHost>\n'
        (base/'httpd.conf').write_text(conf)
        subprocess.run([HTTPD,'-t','-f',str(base/'httpd.conf')],check=True)
        php=subprocess.Popen([PHP,'-n','-d','disable_functions=mail','-d','cgi.force_redirect=0','-b','127.0.0.1:'+str(php_port)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        apache=subprocess.Popen([HTTPD,'-f',str(base/'httpd.conf'),'-DFOREGROUND'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            ready=False
            for _ in range(100):
                try:
                    with urllib.request.urlopen(https,context=context,timeout=1) as response:
                        ready=response.status==200
                    if ready:break
                except Exception:
                    pass
                if apache.poll() is not None:
                    raise RuntimeError((base/'httpd-error.log').read_text())
                time.sleep(.05)
            assert ready,'Temporary Apache did not start'
            # Establish that this test detects the original bug, without printing the body.
            assert fetch(https+'/.envrc',context=context)[0]==200
            remote.protect()

            def check(stage,expected_index,apis=False):
                fixtures=['.env','.env.local','.env.css','.env.php','.envrc.bak','.htaccess~','.git/config','.git/HEAD','.svn/entries','assets/.env','assets/.git/config','.well-known/acme-challenge/.env']
                created_dirs=[]
                for name in fixtures:
                    p=doc/name
                    for parent in reversed(list(p.parents)):
                        if parent!=doc and doc in parent.parents and not parent.exists():
                            parent.mkdir();created_dirs.append(parent)
                    assert not p.exists()
                    p.write_bytes(b'private fixture; must never be served')
                identity=secrets.token_hex(12);token=secrets.token_hex(32)
                remote.security_probe('install',identity,hashlib.sha256(token.encode()).hexdigest())
                try:
                    rows=check_denials(https,context)
                    assert all(row['status'] in [403,404] for row in rows)
                    with urllib.request.urlopen(https,context=context) as response:
                        assert response.status==200 and response.read()==expected_index
                    php_url=https+'/security-probe-'+identity+'.php'
                    assert fetch(php_url,context=context)[0]==404
                    code,_,body=fetch(php_url,headers={'X-Lead-Diagnostic':token},context=context)
                    assert code==200,('temporary PHP status',code,'body bytes',len(body))
                    runtime=json.loads(body)
                    assert code==200 and 80400<=runtime['php_version_id']<80500 and runtime['no_mail_sent']
                    assert fetch(https+'/.well-known/acme-challenge/'+identity,context=context)[2]==('security-acme-'+identity).encode()
                    assert fetch(http+'/.well-known/acme-challenge/'+identity)[0]==200
                    if apis:
                        with urllib.request.urlopen(https+'/api/form-status.php',context=context) as response:
                            assert json.load(response)['enabled'] is False
                        assert fetch(https+'/api/lead.php',context=context)[0]==405
                        assert fetch(https+'/styles.css',context=context)[0]==200
                    report['stages'].append({'stage':stage,'service_checks':rows,'index':200,'php':runtime['php_version'],'https':200,'acme_http':200,'acme_https':200,'envrc_unchanged':True})
                    assert hashlib.sha256((doc/'.envrc').read_bytes()).hexdigest()==env_hash
                finally:
                    remote.security_probe('remove',identity)
                    for name in fixtures:(doc/name).unlink()
                    for p in sorted(set(created_dirs),key=lambda p:len(p.parts),reverse=True):
                        try:p.rmdir()
                        except OSError:pass

            check('before-index-publication',placeholder)
            files={str(p.relative_to(ROOT/'dist')):p.read_bytes() for p in (ROOT/'dist').rglob('*') if p.is_file()}
            assert files['.htaccess']==remote.SECURITY_POLICY+remote.HTTPS_REDIRECT
            manifest={'site_url':'https://zhk-dom-umorya.ru','commit':'fixture-only','files':{name:hashlib.sha256(content).hexdigest() for name,content in files.items()}}
            buffer=io.BytesIO()
            with tarfile.open(fileobj=buffer,mode='w:gz') as tar:
                for name,content in {'manifest.json':json.dumps(manifest).encode(),**{'public/'+n:v for n,v in files.items()}}.items():
                    member=tarfile.TarInfo(name);member.size=len(content);tar.addfile(member,io.BytesIO(content))
            payload=buffer.getvalue();sha=hashlib.sha256(payload).hexdigest();previous=sys.stdin
            try:
                sys.stdin=io.TextIOWrapper(io.BytesIO(payload));remote.prepare(sha)
            finally:sys.stdin=previous
            original_atomic=remote.atomic
            def before_index(path,data,mode=0o644):
                if path==doc/'index.html' and data==files['index.html']:
                    assert (doc/'index.html').read_bytes()==placeholder
                    check_denials(https,context)
                return original_atomic(path,data,mode)
            remote.atomic=before_index
            try:remote.deploy(sha)
            finally:remote.atomic=original_atomic
            check('after-publication-before-301',files['index.html'],True)
            folder,record=remote.load_record(sha);record.update({'proxy_protocol_verified':True,'http_php_version_id':80414});(folder/'record.json').write_text(json.dumps(record))
            remote.redirect(sha)
            opener=urllib.request.build_opener(NoRedirect())
            try:opener.open(http+'/privacy.html?check=1')
            except urllib.error.HTTPError as response:
                assert response.code==301 and response.headers['Location']=='https://zhk-dom-umorya.ru/privacy.html?check=1'
            else:raise AssertionError('HTTP must redirect after 301 activation')
            check('after-publication-with-301',files['index.html'],True)
            remote.rollback(sha)
            check('after-rollback',placeholder)
            folder,record=remote.load_record(sha);record['before'].pop('.htaccess');(folder/'record.json').write_text(json.dumps(record))
            remote.rollback(sha)
            check('after-legacy-rollback',placeholder)
            assert (doc/'.htaccess').read_bytes()==remote.SECURITY_POLICY
        finally:
            apache.terminate();php.terminate()
            for process in [apache,php]:
                try:process.wait(timeout=5)
                except subprocess.TimeoutExpired:process.kill();process.wait()
    report['all_processes_stopped']=True
    output=ROOT/'review/form-001/security-http.json'
    output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print('PASS real Apache/PHP 8.4 HTTP/TLS dotfile denial, ACME, publication order, 301 and both rollback paths; processes stopped')

if __name__=='__main__':run()
