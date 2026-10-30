"""Exercise deployment and rollback against disposable local domain directories."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
import jino_remote as remote

class ReleaseTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='dom-release-ops-')
        self.root=Path(self.temp.name).resolve()
        remote.HOME=self.root
        remote.DOC=self.root/'domains/zhk-dom-umorya.ru'
        remote.PRIVATE=self.root/'.dom-u-morya'
        remote.DOC.mkdir(parents=True)
        (remote.DOC/'.envrc').write_text('managed php84\n')
        (remote.DOC/'index.html').write_text('previous Jino placeholder')
        self.original_guard_check=remote.guard_http_check
        self.guard_checks=0
        def check_guard():
            self.assertTrue((remote.DOC/'.htaccess').read_bytes().startswith(remote.SECURITY_POLICY))
            self.guard_checks+=1
            return {'.envrc':403,'.htaccess':403}
        remote.guard_http_check=check_guard
        remote.ensure_security()
        self.before=remote.inventory()

    def tearDown(self):
        remote.guard_http_check=self.original_guard_check
        self.temp.cleanup()

    def prepare(self, files=None):
        files=files or {'index.html':b'production index','.htaccess':remote.SECURITY_POLICY+remote.HTTPS_REDIRECT,'assets/test.css':b'body{}','api/lead.php':b'<?php /* fixture only */'}
        manifest={'site_url':'https://zhk-dom-umorya.ru','commit':'a'*40,'files':{name:hashlib.sha256(data).hexdigest() for name,data in files.items()}}
        buffer=io.BytesIO()
        with tarfile.open(fileobj=buffer,mode='w:gz') as tar:
            members={'manifest.json':json.dumps(manifest).encode(),**{'public/'+k:v for k,v in files.items()}}
            for name,data in members.items():
                item=tarfile.TarInfo(name);item.size=len(data);tar.addfile(item,io.BytesIO(data))
        payload=buffer.getvalue();sha=hashlib.sha256(payload).hexdigest()
        previous=sys.stdin
        try:
            sys.stdin=io.TextIOWrapper(io.BytesIO(payload))
            record=remote.prepare(sha)
        finally:
            sys.stdin=previous
        return sha,record

    def test_deploy_and_rollback(self):
        sha,record=self.prepare()
        self.assertEqual(remote.inventory(),self.before,'Preparation cannot alter docroot')
        self.assertTrue((Path(record['backup'])/'docroot.tar.gz').is_file())
        result=remote.deploy(sha)
        self.assertFalse(result['form_enabled'])
        self.assertIn("'FORM_ENABLED'=>false",(remote.PRIVATE/'config.php').read_text())
        self.assertEqual((remote.DOC/'index.html').read_text(),'production index')
        self.assertEqual((remote.DOC/'.envrc').read_text(),'managed php84\n')
        self.assertEqual((remote.DOC/'.htaccess').read_bytes(),remote.SECURITY_POLICY)
        with self.assertRaises(RuntimeError):remote.redirect(sha)
        with self.assertRaises(RuntimeError):remote.deploy(sha)
        remote.diagnostic(sha,'runtime','runtime-'+'b'*24+'.php','c'*64)
        remote.diagnostic(sha,'remove','runtime-'+'b'*24+'.php')
        with self.assertRaises(RuntimeError):remote.set_form(sha,True,'probe','2026-10-30','SPF=pass;DKIM=pass;duplicates=0')
        folder,record=remote.load_record(sha)
        record['http_php_version_id']=80427
        record['proxy_protocol_verified']=True
        (folder/'record.json').write_text(json.dumps(record))
        remote.redirect(sha)
        self.assertTrue((remote.DOC/'.htaccess').exists())
        (remote.PRIVATE/('probe-'+sha+'.json')).write_text(json.dumps({'id':'probe','status':'accepted'}))
        with self.assertRaises(RuntimeError):remote.set_form(sha,True,'wrong-id','2026-10-30','SPF=pass;DKIM=pass;duplicates=0')
        remote.set_form(sha,True,'probe','2026-10-30','SPF=pass;DKIM=pass;duplicates=0')
        self.assertIn("'FORM_ENABLED'=>true",(remote.PRIVATE/'config.php').read_text())
        remote.rollback(sha)
        self.assertEqual(remote.inventory(),self.before)
        self.assertIn("'FORM_ENABLED'=>false",(remote.PRIVATE/'config.php').read_text())

    def test_guard_is_verified_before_index(self):
        sha,_=self.prepare()
        original=remote.atomic
        previous_checks=self.guard_checks
        def verify_order(path,data,mode=0o644):
            if path==remote.DOC/'index.html' and data==b'production index':
                self.assertGreater(self.guard_checks,previous_checks)
                self.assertEqual((remote.DOC/'.htaccess').read_bytes(),remote.SECURITY_POLICY)
            return original(path,data,mode)
        remote.atomic=verify_order
        try:
            remote.deploy(sha)
        finally:
            remote.atomic=original

    def test_guard_http_failure_blocks_publication(self):
        sha,_=self.prepare()
        def failed_check():
            raise RuntimeError('Synthetic HTTP 200 dotfile regression')
        remote.guard_http_check=failed_check
        with self.assertRaises(RuntimeError):remote.deploy(sha)
        self.assertEqual(remote.inventory(),self.before)
        self.assertFalse((remote.PRIVATE/'config.php').exists())

    def test_legacy_rollback_cannot_remove_guard(self):
        sha,_=self.prepare()
        remote.deploy(sha)
        folder,record=remote.load_record(sha)
        del record['before']['.htaccess']
        (folder/'record.json').write_text(json.dumps(record))
        remote.rollback(sha)
        self.assertEqual(remote.inventory(),self.before)
        self.assertEqual((remote.DOC/'.htaccess').read_bytes(),remote.SECURITY_POLICY)

    def test_security_policy_and_old_hold(self):
        self.assertEqual((Path(__file__).parent.parent/'.htaccess').read_bytes(),remote.SECURITY_POLICY+remote.HTTPS_REDIRECT)
        with self.assertRaises(RuntimeError):remote.deploy(remote.REVOKED_SHA)
        with self.assertRaises(RuntimeError):self.prepare({'.htaccess':remote.HTTPS_REDIRECT,'index.html':b'unsafe'})

    def test_security_only_keeps_placeholder(self):
        result=remote.protect()
        self.assertTrue(result['security_only'])
        self.assertFalse(result['production_published'])
        self.assertEqual(remote.inventory(),self.before)

    def test_changed_docroot_blocks_deploy(self):
        sha,_=self.prepare()
        (remote.DOC/'unexpected.txt').write_text('new owner work')
        with self.assertRaises(RuntimeError):remote.deploy(sha)
        self.assertEqual((remote.DOC/'index.html').read_text(),'previous Jino placeholder')

    def test_hash_and_path_rejection(self):
        sha,_=self.prepare()
        (remote.release(sha)/'package.tar.gz').write_bytes(b'corrupt')
        with self.assertRaises(RuntimeError):remote.deploy(sha)
        for name in ['.envrc','../other-domain/index.html','/index.html','api/phpinfo.php','assets/.env']:
            with self.assertRaises(RuntimeError):remote.safe_name(name)

    def test_unexpected_and_symlink_rejection(self):
        (remote.DOC/'unexpected.txt').write_text('owner file')
        with self.assertRaises(RuntimeError):self.prepare()
        (remote.DOC/'unexpected.txt').unlink()
        (remote.DOC/'link').symlink_to(self.root/'private')
        with self.assertRaises(RuntimeError):remote.inventory()

    def test_failed_copy_rolls_back(self):
        sha,_=self.prepare()
        original=remote.atomic
        def fail_once(path,data,mode=0o644):
            if path==remote.DOC/'index.html' and data==b'production index':
                raise OSError('synthetic disk failure')
            return original(path,data,mode)
        remote.atomic=fail_once
        try:
            with self.assertRaises(OSError):remote.deploy(sha)
        finally:
            remote.atomic=original
        self.assertEqual(remote.inventory(),self.before)

if __name__=='__main__':unittest.main()
