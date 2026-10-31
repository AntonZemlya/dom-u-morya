"""No Jino access. Real loopback Apache/TLS + PHP 8.4; zero-send and SMTP sink lifecycle."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import ssl
import subprocess
import tarfile
import tempfile
import time
import unittest
from unittest.mock import patch
import smtp_e2e as cli
import smtp_e2e_remote as remote

ROOT=Path(__file__).resolve().parent.parent
PHP=os.environ.get('PHP84_BIN','/private/tmp/rehab-ci-php84/runtime/bin/php')
CGI=os.environ.get('PHP84_CGI_BIN','/private/tmp/dom-smtp-harness-php84/sapi/cgi/php-cgi')
HTTPD=os.environ.get('HTTPD_BIN','/usr/sbin/httpd')

def port():
    with socket.socket() as s: s.bind(('127.0.0.1',0));return s.getsockname()[1]

def command(args,cwd=None):
    subprocess.run(args,cwd=cwd,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

class E2E(unittest.TestCase):
    evidence=[]
    @classmethod
    def setUpClass(cls):
        for binary in [PHP,CGI]:
            version=subprocess.check_output([binary,'-n','-v'],text=True);assert 'PHP 8.4.' in version
            modules=subprocess.check_output([binary,'-n','-m'],text=True);assert 'openssl' in modules and 'ctype' in modules

    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='dom-smtp-e2e-test-',dir='/private/tmp')
        self.home=Path(self.tmp.name).resolve();self.doc=self.home/'domains/zhk-dom-umorya.ru';self.doc.mkdir(parents=True)
        self.private=self.home/'.dom-u-morya';self.private.mkdir(mode=0o700);(self.private/'state').mkdir(mode=0o700)
        (self.private/'state/state.json').write_text('{"items":{},"rates":{}}');(self.private/'state/state.json').chmod(0o600)
        self.production_state=remote.metadata(self.private/'state/state.json')
        (self.doc/'api').mkdir();(self.doc/'index.html').write_text('Local baseline only');(self.doc/'.envrc').write_text('managed fixture')
        for name in ['.htaccess','api/lead-core.php','api/lead.php','api/form-status.php']:
            (self.doc/name).write_bytes(subprocess.check_output(['git','show',remote.BASE+':'+name],cwd=ROOT))
        self.published={'base_commit':remote.BASE,'files':{str(p.relative_to(self.doc)):remote.metadata(p)['sha256'] for p in self.doc.rglob('*') if p.is_file() and p.name!='.envrc'}}
        self.payload=(ROOT/'.release-output/form-002/smtp-update.tar.gz').read_bytes();self.package_sha=cli.sha(self.payload)
        self.manifest,_=remote.unpack(self.payload,self.package_sha);self.template=(ROOT/'ops/smtp_e2e_wrapper.php').read_bytes()
        self.processes=[]
        self.smtpdir=self.home/'sink';self.smtpdir.mkdir(mode=0o700);(self.smtpdir/'mode').write_text('success')
        command(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=127.0.0.1',
                 '-addext','subjectAltName=IP:127.0.0.1','-keyout',str(self.smtpdir/'server.key'),'-out',str(self.smtpdir/'server.crt')])
        self.context=ssl.create_default_context(cafile=str(self.smtpdir/'server.crt'))
        self.log=self.home/'process.log';self.logfile=self.log.open('wb')
        self.stopped=False
        self.addCleanup(self.tmp.cleanup)
        self.addCleanup(self.stop_processes)
        self.spawn(['python3','-B',str(ROOT/'tests/smtp-fixture.py'),str(self.smtpdir),str(self.private/'e2e')])
        for _ in range(100):
            if (self.smtpdir/'smtps-port').exists(): break
            time.sleep(.02)
        self.smtp_port=int((self.smtpdir/'smtp-port').read_text())
        self.web_port,self.cgi_port,self.fcgi_port,self.php_port=port(),port(),port(),port()
        self.origin='https://127.0.0.1:'+str(self.web_port);self.cgi_origin='https://127.0.0.1:'+str(self.cgi_port)
        self.configure()
        self.spawn([PHP,'-n','-d','disable_functions=mail','-d','openssl.cafile='+str(self.smtpdir/'server.crt'),'-S','127.0.0.1:'+str(self.php_port),'-t',str(self.doc)],
                   env={**os.environ,'LEAD_CONFIG':str(self.private/'config.php'),'LEAD_SMTP_TEST':'1'})
        self.spawn([CGI,'-n','-d','disable_functions=mail','-d','openssl.cafile='+str(self.smtpdir/'server.crt'),'-d','cgi.force_redirect=0','-b','127.0.0.1:'+str(self.fcgi_port)])
        mods=['mpm_event','unixd','authz_core','authz_host','dir','mime','log_config','rewrite','headers','proxy','proxy_http','proxy_fcgi','ssl','socache_shmcb']
        conf='ServerRoot "'+str(self.home)+'"\n'+''.join('LoadModule '+m+'_module /usr/libexec/apache2/mod_'+m+'.so\n' for m in mods)
        conf+='ServerName 127.0.0.1\nDefaultRuntimeDir "'+str(self.home)+'"\nMutex file:'+str(self.home)+' default\nPidFile "'+str(self.home/'apache.pid')+'"\n'
        conf+='ErrorLog "'+str(self.home/'apache.log')+'"\nLogLevel warn\nTypesConfig /private/etc/apache2/mime.types\nDirectoryIndex index.html\n'
        conf+='DocumentRoot "'+str(self.doc)+'"\n<Directory "'+str(self.doc)+'">\nAllowOverride All\nOptions FollowSymLinks\nRequire all granted\n</Directory>\n'
        for p in [self.web_port,self.cgi_port]:
            conf+='Listen 127.0.0.1:'+str(p)+'\n<VirtualHost 127.0.0.1:'+str(p)+'>\nServerName 127.0.0.1\nSSLEngine on\n'
            conf+='SSLCertificateFile "'+str(self.smtpdir/'server.crt')+'"\nSSLCertificateKeyFile "'+str(self.smtpdir/'server.key')+'"\nRequestHeader set X-Forwarded-Protocol https early\n'
            if p==self.web_port:
                # Let Apache own static/missing-file 404s; PHP's dev server otherwise falls back to index.html.
                conf+='ProxyPreserveHost On\nProxyPass /api/ http://127.0.0.1:'+str(self.php_port)+'/api/\nRewriteEngine On\n'
                conf+='RewriteCond %{DOCUMENT_ROOT}%{REQUEST_URI} -f\nRewriteRule ^/(smtp-e2e-[a-f0-9]{24}\\.php)$ http://127.0.0.1:'+str(self.php_port)+'/$1 [P,L]\n'
            else: conf+='ProxyFCGIBackendType GENERIC\n<FilesMatch "\\.php$">\nSetHandler "proxy:fcgi://127.0.0.1:'+str(self.fcgi_port)+'"\n</FilesMatch>\n'
            conf+='</VirtualHost>\n'
        (self.home/'apache.conf').write_text(conf);command([HTTPD,'-t','-f',str(self.home/'apache.conf')]);self.spawn([HTTPD,'-f',str(self.home/'apache.conf'),'-DFOREGROUND'])
        self.http=cli.HTTP(self.origin,self.context);self.cgi_http=cli.HTTP(self.cgi_origin,self.context,api_origin=remote.ORIGIN)
        for _ in range(100):
            try:
                if self.http.request('/',method='GET')[0]==200 and self.cgi_http.request('/',method='GET')[0]==200: break
            except Exception: pass
            time.sleep(.03)
        else: self.fail('Local Apache/TLS did not start')
        self.worker=remote.Worker(str(self.home),self.origin,True)

    def spawn(self,args,env=None):
        p=subprocess.Popen(args,stdout=self.logfile,stderr=self.logfile,env=env,start_new_session=True);self.processes.append(p);return p

    def configure(self,cgi=False):
        cfg={'FORM_ENABLED':False,'DELIVERY_VERIFIED':False,'LEGAL_APPROVED':'','DELIVERY_VERIFIED_TO':'','LEGAL_MAIL_TO':'',
             'MAIL_FROM':'sales@zhk-dom-umorya.ru','MAIL_TO':'azm1982@yandex.ru','HMAC_SECRET':'fixture-only-'*4,
             'STATE_DIR':str(self.private/'state'),'ORIGIN':self.cgi_origin if cgi else self.origin,
             'SMTP_RUNTIME':str(self.private/'smtp-runtime'/self.manifest['runtime_identity']),
             'SMTP_HOST':'smtp.jino.ru' if cgi else '127.0.0.1','SMTP_PORT':587 if cgi else self.smtp_port,'SMTP_SECURITY':'starttls',
             'SMTP_USERNAME':'sales@zhk-dom-umorya.ru' if cgi else 'fixture-user','SMTP_PASSWORD':'fixture-password','SMTP_TEST_CA':str(self.smtpdir/'server.crt')}
        p=self.private/'config.php';p.write_text('<?php return json_decode('+json.dumps(json.dumps(cfg))+',true);');p.chmod(0o600)

    def stop_processes(self):
        if self.stopped: return
        self.stopped=True
        for p in reversed(self.processes):
            try: os.killpg(p.pid,signal.SIGTERM);p.wait(timeout=5)
            except ProcessLookupError: pass
            except subprocess.TimeoutExpired: os.killpg(p.pid,signal.SIGKILL);p.wait()
        self.logfile.close()

    def tearDown(self):
        self.stop_processes()
        for name in ['process.log','apache.log']:
            p=self.home/name
            if p.exists():
                for secret in ['fixture-user','fixture-password',base64.b64encode(b'fixture-password').decode(),'Синтетический SMTP E2E','+70000000000','synthetic@example.invalid']:
                    self.assertNotIn(secret,p.read_text(errors='replace'))
        self.assertEqual(remote.metadata(self.private/'state/state.json'),self.production_state)
        self.evidence.append({'test':self._testMethodName,'smtp_data_count':sum(x.get('command')=='DATA' for x in self.audit()),
            'private_invocations':len(list((self.private/'e2e').glob('*/invocation.json'))),
            'approval_markers_retained':len(list((self.private/'e2e/approvals').glob('*.json'))),
            'public_wrappers_remaining':len(list(self.doc.glob('smtp-e2e-*.php'))),'processes_stopped':all(p.poll() is not None for p in self.processes),
            'production_state_unchanged':True,'secret_free_logs':True})
        self.tmp.cleanup()

    def install(self,mode='no-send',worker=None):
        w=worker or self.worker;baseline=w.snapshot(self.published);rid=secrets.token_hex(12);token=secrets.token_hex(32)
        w.install(self.payload,self.package_sha,baseline,self.published,self.template,rid,cli.sha(token.encode()),mode,self.manifest['commit'],'b'*64,rid+'0'*8)
        return w,baseline,rid,token,'/smtp-e2e-'+rid+'.php'

    def audit(self):
        p=self.smtpdir/'smtp-audit.jsonl';return [json.loads(s) for s in p.read_text().splitlines()] if p.exists() else []

    def call(self,q):
        op=q['operation']
        if op=='install': return self.worker.install(base64.b64decode(q['package']),q['package_sha256'],q['baseline'],q['published'],base64.b64decode(q['template']),q['run_id'],q['token_hash'],q['mode'],q['commit'],q['harness_sha256'],q['authorization'])
        if op=='cleanup': return self.worker.cleanup(q['run_id'],q.get('baseline'),q.get('published'))
        if op=='verify': return self.worker.verify(q['run_id'],q.get('baseline'),q.get('published'))
        raise AssertionError('Unexpected operation')

    def control(self): return {'commit':self.manifest['commit'],'smtp_sha256':self.package_sha,'published':self.published,'template':self.template}

    def test_01_real_cgi_no_send_auth_replay_and_cleanup(self):
        self.configure(cgi=True);w=remote.Worker(str(self.home),self.cgi_origin,True)
        w,b,rid,token,path=self.install(worker=w)
        try:
            for method,auth,action,body in [('GET',token,'preflight',b''),('POST','0'*64,'attempt',b''),('POST',token,'bad',b''),('POST',token,'attempt',b'{"mode":"send-once"}')]:
                self.assertEqual(self.cgi_http.request(path,auth,action,body,method)[0],404)
            self.assertFalse((self.private/'e2e'/rid/'attempt.json').exists())
            code,data=self.cgi_http.request(path,token,'preflight');self.assertEqual(code,200);self.assertEqual(data['sapi'],'cgi-fcgi');self.assertFalse(data['smtp_invoked'])
            code,data=self.cgi_http.request(path,token,'attempt');self.assertEqual(code,200);self.assertEqual(data['status'],'dry_run');self.assertFalse(data['smtp_invoked'])
            self.assertEqual(self.cgi_http.request(path,token,'attempt')[0],409)
            self.assertEqual(self.audit(),[])
            out=ROOT/'.test-output/e2e';out.mkdir(parents=True,exist_ok=True);shutil.copy(self.private/'e2e'/rid/'wrapper.php',out/'wrapper.no-send.rendered.php')
        finally: result=w.cleanup(rid)
        self.assertEqual(result['invocations'],1);self.assertTrue(result['one_shot_retained']);self.assertEqual(result['status'],'dry_run')
        self.assertEqual(self.cgi_http.request(path)[0],404);self.cgi_http.disabled();self.assertEqual(w.snapshot(self.published),b)

    def test_02_exactly_one_smtp_and_marker_before_transport(self):
        w,b,rid,token,path=self.install('send-once')
        try:
            self.assertEqual(self.http.request(path,token,'preflight')[0],200);self.assertEqual(self.audit(),[])
            code,data=self.http.request(path,token,'attempt');self.assertEqual(code,200);self.assertEqual(data['status'],'smtp_accepted')
            self.assertEqual(self.http.request(path,token,'attempt')[0],409)
            rows=self.audit();self.assertEqual(sum(x.get('command')=='DATA' for x in rows),1)
            self.assertTrue(all(x['one_shot_before_smtp'] and x['tls'] for x in rows if x.get('command') in ['AUTH','MAIL','RCPT','DATA']))
            messages=json.loads((self.smtpdir/'fake-mail.json').read_text());self.assertEqual(len(messages),1)
            self.assertEqual(messages[0]['to'],'azm1982@yandex.ru')
            for part in ['Лот 22825','6978183','взнос 20%; срок 20 лет; ставка 6%; программа family','Telegram','12-15','2026-10-30']:
                self.assertIn(part,messages[0]['body'])
        finally: result=w.cleanup(rid)
        self.assertEqual(result['invocations'],1);self.assertTrue(w.verify(rid)['public_unchanged']);self.http.disabled()

    def test_03_expired_ttl_and_invalid_origin_never_invoke(self):
        with patch.object(remote.time,'time',return_value=time.time()-121): w,b,rid,token,path=self.install()
        try: self.assertEqual(self.http.request(path,token,'attempt')[0],404);self.assertEqual(self.audit(),[])
        finally: self.assertEqual(w.cleanup(rid)['invocations'],0)
        w,b,rid,token,path=self.install()
        wrong=cli.HTTP(self.origin,self.context);wrong.origin=self.origin+'/wrong'
        # Missing Origin is rejected before marker creation.
        import urllib.request
        req=urllib.request.Request(self.origin+path,data=b'',headers={'X-Lead-E2E-Token':token,'X-Lead-E2E-Action':'attempt'})
        try: wrong.opener.open(req)
        except urllib.error.HTTPError as e: self.assertEqual(e.code,404)
        finally: w.cleanup(rid)
        self.assertEqual(self.audit(),[])

    def test_04_controller_timeout_finally_retains_uncertain(self):
        (self.smtpdir/'mode').write_text('accept_timeout')
        class ShortAttempt(cli.HTTP):
            def request(self,path,token=None,action=None,body=b'',method='POST'):
                self.timeout=.15 if action=='attempt' else 15
                return super().request(path,token,action,body,method)
        c=self.control();h='b'*64;go=cli.permit(c['commit'],self.package_sha,h,'send-once')
        result=cli.execute(c,self.payload,h,self.worker.snapshot(self.published),'send-once',go,self.call,ShortAttempt(self.origin,self.context))
        self.assertTrue(result['operation_failed']);self.assertEqual(result['attempt_status'],'uncertain')
        self.assertTrue(result.get('http_cleanup_verified'),result);self.assertNotIn('cleanup_required',result)
        self.assertTrue(result['cleanup']['one_shot_retained']);self.assertEqual(result['verification']['invocations'],1)
        self.assertEqual(sum(x.get('command')=='DATA' for x in self.audit()),1)
        run=self.private/'e2e'/result['run_id'];self.assertEqual(json.loads((run/'attempt.json').read_text())['status'],'pending')

    def test_05_drift_and_failed_install_cleanup(self):
        b=self.worker.snapshot(self.published);index=self.doc/'index.html';s=index.stat();os.utime(index,ns=(s.st_atime_ns,s.st_mtime_ns+1000000))
        with self.assertRaises(RuntimeError): self.worker.check_baseline(b,self.published)
        os.utime(index,ns=(s.st_atime_ns,s.st_mtime_ns));index.chmod(0o600)
        with self.assertRaises(RuntimeError): self.worker.check_baseline(b,self.published)
        index.chmod(0o644);original=index.read_bytes();index.write_bytes(b'changed')
        with self.assertRaises(RuntimeError): self.worker.check_baseline(b,self.published)
        index.write_bytes(original);os.utime(index,ns=(s.st_atime_ns,s.st_mtime_ns))
        rid=secrets.token_hex(12)
        with patch.object(remote.os,'link',side_effect=OSError('forced install failure')):
            with self.assertRaises(OSError): self.worker.install(self.payload,self.package_sha,b,self.published,self.template,rid,'a'*64,'no-send',self.manifest['commit'],'b'*64,rid+'0'*8)
        self.assertTrue(self.worker.verify(rid)['wrapper_removed']);self.assertEqual(self.audit(),[])
        # Unknown install outcome before receipt: still prove absence + unchanged metadata.
        self.assertTrue(self.worker.cleanup(secrets.token_hex(12),b,self.published)['wrapper_removed'])

    def test_06_go_gate_and_package_rejection_before_network(self):
        c=self.control();h='b'*64;calls=[]
        for go in [None,'old approval',cli.permit('0'*40,self.package_sha,h,'send-once'),cli.permit(c['commit'],self.package_sha,h,'no-send')]:
            with self.assertRaises(RuntimeError): cli.execute(c,self.payload,h,{},'send-once',go,lambda q:calls.append(q))
        self.assertEqual(calls,[])
        with self.assertRaises(RuntimeError): remote.unpack(self.payload,'0'*64)
        broken=io.BytesIO()
        with tarfile.open(fileobj=broken,mode='w:gz') as a:
            m=tarfile.TarInfo('../config.php');m.size=1;a.addfile(m,io.BytesIO(b'x'))
        with self.assertRaises(RuntimeError): remote.unpack(broken.getvalue(),cli.sha(broken.getvalue()))
        self.assertEqual(self.audit(),[])

    def test_07_whole_command_cannot_reuse_owner_grant(self):
        c=self.control();h='b'*64;go=cli.permit(c['commit'],self.package_sha,h,'send-once');b=self.worker.snapshot(self.published)
        first=cli.execute(c,self.payload,h,b,'send-once',go,self.call,self.http)
        self.assertEqual(first['attempt_status'],'smtp_accepted',first);self.assertTrue(first['http_cleanup_verified'])
        second=cli.execute(c,self.payload,h,b,'send-once',go,self.call,self.http)
        self.assertTrue(second['operation_failed']);self.assertEqual(second['attempt_status'],'not_attempted');self.assertTrue(second['http_cleanup_verified'])
        self.assertEqual(sum(x.get('command')=='DATA' for x in self.audit()),1)
        self.assertEqual(len(list((self.private/'e2e/approvals').glob('*.json'))),1)

    def test_08_cleanup_refuses_changed_wrapper(self):
        w,b,rid,token,path=self.install();p=self.doc/path.lstrip('/');source=p.read_bytes();p.write_bytes(b'changed owner file')
        with self.assertRaises(RuntimeError):w.cleanup(rid)
        self.assertEqual(p.read_bytes(),b'changed owner file')
        p.write_bytes(source);self.assertTrue(w.cleanup(rid)['wrapper_removed']);self.assertEqual(self.audit(),[])

    def test_09_unknown_install_and_cleanup_recovery(self):
        c=self.control();h='b'*64;b=self.worker.snapshot(self.published);go=cli.permit(c['commit'],self.package_sha,h,'no-send')
        def lost_install(q):
            result=self.call(q)
            if q['operation']=='install':raise TimeoutError('lost install acknowledgement')
            return result
        result=cli.execute(c,self.payload,h,b,'no-send',go,lost_install,self.http)
        self.assertTrue(result['operation_failed']);self.assertEqual(result['attempt_status'],'not_attempted');self.assertTrue(result['http_cleanup_verified'])
        def failed_cleanup(q):
            if q['operation']=='cleanup':raise OSError('lost cleanup connection')
            return self.call(q)
        auth='c'*32;go=cli.permit(c['commit'],self.package_sha,h,'no-send',auth)
        result=cli.execute(c,self.payload,h,b,'no-send',go,failed_cleanup,self.http,authorization=auth)
        self.assertEqual(result['attempt_status'],'dry_run');self.assertTrue(result['cleanup_required']);self.assertNotIn('http_cleanup_verified',result)
        rid=result['run_id'];self.assertTrue((self.doc/('smtp-e2e-'+rid+'.php')).exists())
        self.assertTrue(self.worker.cleanup(rid)['one_shot_retained']);self.assertTrue(self.worker.verify(rid)['wrapper_removed'])
        self.assertEqual(self.http.request('/smtp-e2e-'+rid+'.php')[0],404);self.http.disabled();self.assertEqual(self.audit(),[])

if __name__=='__main__':
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(E2E)
    if len(__import__('sys').argv)>1: suite=unittest.defaultTestLoader.loadTestsFromName(__import__('sys').argv[1],module=__import__('sys').modules[__name__])
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    report={'success':result.wasSuccessful(),'tests_run':result.testsRun,'errors':len(result.errors),'failures':len(result.failures),
            'scope':'loopback only; no Jino SSH/HTTP, no real mail','evidence':E2E.evidence,
            'php_cli':subprocess.check_output([PHP,'-n','-v'],text=True).splitlines()[0],
            'php_cgi':subprocess.check_output([CGI,'-n','-v'],text=True).splitlines()[0],
            'source_sha256':{name:cli.sha((ROOT/name).read_bytes()) for name in cli.SOURCES+['ops/test_smtp_e2e.py','tests/smtp-fixture.py']}}
    out=ROOT/'.test-output/e2e';out.mkdir(parents=True,exist_ok=True);(out/'results.json').write_text(json.dumps(report,indent=2)+'\n')
    raise SystemExit(0 if result.wasSuccessful() else 1)
