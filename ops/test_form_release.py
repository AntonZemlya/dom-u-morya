"""FORM-004 real Apache/TLS/CGI release lifecycle; external DNS/SSH blocked by fixture."""
import gzip
import base64
import contextlib
import io
import json
from pathlib import Path
import tarfile
import sys
from unittest.mock import patch
import unittest
from test_smtp_e2e import E2E,PHP,ROOT # Reuse disposable servers and enforced loopback audit hook.
import form_release as cli
import form_release_remote as remote

class Release(E2E):
    # Inherit only fixture setup/cleanup, not the historical GO A test cases.
    def setUp(self):
        super().setUp();self.configure(cgi=True)
        self.worker=remote.Worker(str(self.home),PHP)
        self.baseline=self.worker.snapshot()
        baseline=json.loads(cli.BASELINE.read_text())
        raw,m=cli.package('a'*40,baseline)
        _,self.files=remote.unpack(raw,remote.sha(raw));m['baseline']=self.baseline
        self.payload=self.pack(m,self.files);self.digest=remote.sha(self.payload)
        self.manifest=m;self.go=remote.go_line(m,self.digest)
    @staticmethod
    def pack(m,files):
        out=io.BytesIO()
        with tarfile.open(fileobj=out,mode='w:gz') as a:
            for n,v in {**files,'manifest.json':json.dumps(m).encode()}.items():
                t=tarfile.TarInfo(n);t.size=len(v);a.addfile(t,io.BytesIO(v))
        return out.getvalue()
    def test_final_release_and_rollback(self):
        before_state=(self.private/'state/state.json').read_bytes()
        marker=self.private/'accepted-go-a-marker';marker.write_bytes(b'preserve');marker.chmod(0o600)
        original=(self.private/'config.php').read_bytes()
        with self.assertRaises(RuntimeError):self.worker.stage(self.payload,self.digest,'old GO A')
        self.assertEqual(self.worker.snapshot(),self.baseline)
        staged=self.worker.stage(self.payload,self.digest,self.go)
        self.assertEqual(staged['phase'],'disabled')
        self.assertFalse(cli.smoke(False,self.cgi_origin,self.context)['enabled'])
        with self.assertRaises(RuntimeError):self.worker.enable(self.digest,'wrong GO')
        self.worker.enable(self.digest,self.go)
        self.assertTrue(cli.smoke(True,self.cgi_origin,self.context)['enabled'])
        # Preserve every unowned working setting, including secrets, without printing any value.
        def cfg(p):
            import subprocess
            return json.loads(subprocess.check_output([PHP,'-n','-r','echo json_encode(require $argv[1]);',str(p)]))
        run=self.worker.run_dir(self.digest);old=cfg(run/'config-backup.php');new=cfg(self.private/'config.php')
        for key in ['HMAC_SECRET','STATE_DIR','SMTP_PASSWORD','SMTP_USERNAME','ORIGIN','SMTP_TEST_CA']:
            self.assertEqual(new[key],old[key])
        self.assertFalse(new['MAIN_DELIVERY_VERIFIED']);self.assertFalse(new['DELIVERY_VERIFIED'])
        self.assertEqual(new['MAIL_TO'],'info@anyara.ru');self.assertEqual(new['MAIL_BCC'],'azm1982@yandex.ru')
        self.assertEqual((run/'config-backup.php').read_bytes(),original)
        with self.assertRaises(RuntimeError):self.worker.stage(self.payload,self.digest,self.go)
        result=self.worker.rollback(self.digest);self.assertTrue(result['public_restored'])
        self.assertEqual(self.worker.inventory(),self.baseline['public'])
        self.assertFalse(cfg(self.private/'config.php')['FORM_ENABLED'])
        self.assertEqual(cfg(self.private/'config.php'),{**old,'FORM_ENABLED':False})
        self.assertEqual((self.private/'state/state.json').read_bytes(),before_state)
        self.assertEqual(marker.read_bytes(),b'preserve')
        self.assertFalse((self.smtpdir/'fake-mail.json').exists())
        self.assertFalse((self.smtpdir/'smtp-audit.jsonl').exists(),'No SMTP connection during release/smoke')
        self.assertFalse(any(self.doc.glob('*e2e*')))
        self.evidence.append({'scenario':'FORM-004 stage/enable/rollback real CGI','result':'PASS','mail':0})
    def test_config_or_public_drift_stops_before_write(self):
        for p in [self.private/'config.php',self.doc/'index.html']:
            original=p.read_bytes();p.write_bytes(original+b' ')
            before=self.worker.snapshot()
            with self.assertRaises(RuntimeError):self.worker.stage(self.payload,self.digest,self.go)
            self.assertEqual(before,self.worker.snapshot())
            p.write_bytes(original)
        self.assertFalse((self.private/'form-004').exists())
    def test_partial_public_failure_restores_backup(self):
        real=remote.atomic
        failed=[False]
        def fail(p,data,mode=0o600):
            if p==self.doc/'script.js' and not failed[0]:failed[0]=True;raise OSError('injected local publication failure')
            return real(p,data,mode)
        with patch.object(remote,'atomic',fail):
            with self.assertRaises(OSError):self.worker.stage(self.payload,self.digest,self.go)
        self.assertEqual(self.worker.inventory(),self.baseline['public'])
        self.assertFalse((self.smtpdir/'smtp-audit.jsonl').exists())
        self.assertEqual(json.loads((self.worker.run_dir(self.digest)/'receipt.json').read_text())['phase'],'rolled_back')
    def test_tampered_bundle_and_symlink_rejected(self):
        with self.assertRaises(RuntimeError):self.worker.stage(self.payload+b'x',self.digest,self.go)
        p=self.doc/'unsafe';p.symlink_to(self.doc/'index.html')
        with self.assertRaises(RuntimeError):self.worker.stage(self.payload,self.digest,self.go)
        p.unlink();self.assertFalse((self.private/'form-004').exists())
    def controller(self,go,fail_smoke=False):
        out=self.home/'local-package';out.mkdir();(out/'release.tar.gz').write_bytes(self.payload)
        actual_smoke=cli.smoke
        calls=[]
        def local(q):
            calls.append(q['op'])
            if q['op']=='stage':return self.worker.stage(base64.b64decode(q['archive']),q['sha'],q['go'])
            if q['op']=='enable':return self.worker.enable(q['sha'],q['go'])
            if q['op']=='rollback':return self.worker.rollback(q['sha'])
            raise AssertionError('Unexpected operation')
        def smoke(enabled):
            if enabled and fail_smoke:raise RuntimeError('injected smoke failure')
            return actual_smoke(enabled,self.cgi_origin,self.context)
        with patch.object(cli,'OUT',out),patch.object(cli,'remote',local),patch.object(cli,'smoke',smoke),\
             patch.object(sys,'argv',['form_release.py','apply','--go',go]),contextlib.redirect_stdout(io.StringIO()):
            cli.main()
        return json.loads((out/'execution.json').read_text()),calls
    def test_controller_correct_go_and_final_report(self):
        result,calls=self.controller(self.go)
        self.assertEqual(calls,['stage','enable']);self.assertTrue(result['form_enabled'])
        self.assertEqual(result['phase'],'enabled');self.assertFalse(result['main_delivery_verified'])
        self.assertFalse((self.smtpdir/'smtp-audit.jsonl').exists())
        self.worker.rollback(self.digest)
    def test_controller_invalid_go_before_any_network(self):
        with self.assertRaisesRegex(RuntimeError,'Exact owner GO'):
            self.controller('INVALID OWNER GO')
        self.assertEqual(self.worker.snapshot(),self.baseline)
        self.assertFalse((self.private/'form-004').exists())
    def test_controller_smoke_failure_automatically_rolls_back(self):
        with self.assertRaisesRegex(RuntimeError,'injected smoke failure'):
            self.controller(self.go,True)
        self.assertEqual(self.worker.inventory(),self.baseline['public'])
        self.assertEqual(json.loads((self.worker.run_dir(self.digest)/'receipt.json').read_text())['phase'],'rolled_back')
        self.assertFalse((self.smtpdir/'smtp-audit.jsonl').exists())

# unittest does not need the inherited historical send-once scenarios in this suite.
for name in list(dir(E2E)):
    if name.startswith('test_') and name not in Release.__dict__:setattr(Release,name,None)

if __name__=='__main__':
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(Release)
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(not result.wasSuccessful())
