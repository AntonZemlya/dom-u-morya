"""Synthetic domain only. No SSH, real SMTP, real config or production restore."""
import base64
import copy
import io
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
from unittest.mock import patch
import release_core as c


def deny_external(event,args):
    if event=='socket.connect' and isinstance(args[1],tuple) and args[1][0] not in ['127.0.0.1','::1']:
        raise RuntimeError('External network forbidden')
    if event=='subprocess.Popen' and Path(str(args[0])).name in ['ssh','scp']:
        raise RuntimeError('SSH forbidden in release fixture')
sys.addaudithook(deny_external)


class Lifecycle(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='dom-manager-')
        self.home=Path(self.tmp.name).resolve();self.doc=self.home/'domains'/c.DOMAIN
        self.doc.mkdir(parents=True);self.private=self.home/'.dom-u-morya';self.private.mkdir(mode=0o700)
        self.policy=dict(keep_verified=2,protect_days=14,reserve_bytes=1024,quota_max_age_hours=24,
                         quota_evidence=dict(source='Jino panel',observed_unix=int(time.time()),limit_bytes=10**10))
        self.m=c.Manager(str(self.home),self.policy)
        self.runtime_data={n:('synthetic '+n).encode() for n in c.RUNTIME_FILES if n!='manifest.json'}
        hashes={n:c.sha(b) for n,b in self.runtime_data.items()};self.identity=c.sha(json.dumps(hashes,separators=(',',':')).encode())
        self.runtime_data['manifest.json']=c.canonical(dict(identity=self.identity,files=hashes))
        rt=self.private/'smtp-runtime'/self.identity;rt.mkdir(parents=True,mode=0o700);(rt/'src').mkdir(mode=0o700)
        for n,b in self.runtime_data.items():(rt/n).write_bytes(b);(rt/n).chmod(0o600)
        self.guard=b'Require all denied\n'+c.GUARD+b'\n'
        (self.doc/'api').mkdir();(self.doc/'.envrc').write_bytes(b'protected php84 fixture')
        (self.doc/'.htaccess').write_bytes(self.guard);(self.doc/'index.html').write_bytes(b'old index')
        (self.doc/'script.js').write_bytes(b'old script');(self.doc/'api/smtp-manifest.php').write_bytes(b'fixed runtime descriptor')
        (self.private/'config.php').write_bytes(b'fixture secret; no PHP execution');(self.private/'config.php').chmod(0o600)
        (self.private/'state').mkdir(mode=0o700);(self.private/'state/state.json').write_bytes(b'mutable-current')
        self.other=self.home/'domains/other.example';self.other.mkdir();(self.other/'index.html').write_bytes(b'untouched')
        self.baseline=self.m.snapshot(self.identity)

    def tearDown(self):self.tmp.cleanup()

    def package(self, version='new', extra=None, removed=None):
        data={'.htaccess':self.guard,'index.html':('index '+version).encode(),'script.js':('script '+version).encode(),
              'api/smtp-manifest.php':b'fixed runtime descriptor'}
        data.update(extra or {})
        for name in removed or []:data.pop(name)
        files={'public/'+n:b for n,b in data.items()}
        files.update({'private/smtp-runtime/'+self.identity+'/'+n:b for n,b in self.runtime_data.items()})
        manifest=dict(schema='dom-release/v1',origin=c.ORIGIN,commit='a'*40,public_allowlist=sorted(data),runtime_identity=self.identity,
                      files={n:c.sha(b) for n,b in files.items()})
        files['manifest.json']=c.canonical(manifest);return c.pack(files),manifest

    def plan(self, release_id='test-release', **kwargs):
        raw,manifest=self.package(**kwargs);result=self.m.plan(release_id,manifest,c.sha(raw),len(raw));return raw,manifest,result

    def apply(self, release_id='test-release', **kwargs):
        raw,manifest,result=self.plan(release_id,**kwargs)
        self.m.apply(raw,result['plan'],result['go']);return raw,manifest,result

    def verified(self, release_id='test-release', **kwargs):
        raw,manifest,result=self.apply(release_id,**kwargs)
        self.m.attest(release_id,result['plan'],result['go'],dict(status='PASS',package_sha256=c.sha(raw)))
        return raw,manifest,result

    def assert_protected(self):
        self.assertEqual((self.private/'config.php').read_bytes(),b'fixture secret; no PHP execution')
        self.assertEqual((self.private/'state/state.json').read_bytes(),b'mutable-current')
        self.assertEqual((self.other/'index.html').read_bytes(),b'untouched')
        self.assertEqual(c.meta(self.doc/'.envrc'),self.baseline['public']['.envrc'])

    def test_roundtrip_bytes_permissions_and_scope(self):
        (self.doc/'script.js').chmod(0o640);self.baseline=self.m.snapshot(self.identity)
        raw,m,result=self.verified(extra={'assets/new/a.js':b'new asset'})
        run=self.m.run('test-release');self.m.verify_backup(run)
        (self.private/'state/state.json').write_bytes(b'new request remains')
        p=self.m.rollback_plan('test-release');self.m.rollback(p['plan'],p['go'])
        self.assertEqual(self.m.snapshot(self.identity),self.baseline)
        self.assertEqual((self.private/'state/state.json').read_bytes(),b'new request remains')
        self.assertFalse((self.doc/'assets').exists())
        self.assertEqual(stat.S_IMODE((run/'backup.tar.gz').stat().st_mode),0o600)
        self.assertEqual((self.other/'index.html').read_bytes(),b'untouched')

    def test_readonly_does_not_create_private_manager(self):
        raw,m,result=self.plan();self.m.preflight(m,len(raw));self.m.prune_plan();self.m.list_backups()
        self.assertFalse(self.m.root.exists());self.assertEqual(self.m.snapshot(self.identity),self.baseline)

    def test_go_no_write(self):
        raw,m,r=self.plan()
        for go in ['',r['go'].replace(c.DOMAIN,'another.example'),r['go'].replace('APPLY','ROLLBACK')]:
            with self.assertRaises(RuntimeError):self.m.apply(raw,r['plan'],go)
        self.assertFalse(self.m.root.exists())

    def test_replay_after_unknown_response_and_id_conflict(self):
        raw,m,r=self.apply()
        with self.assertRaises(RuntimeError):self.m.apply(raw,r['plan'],r['go'])
        raw2,m2=self.package('other')
        with self.assertRaises(RuntimeError):self.m.plan('test-release',m2,c.sha(raw2),len(raw2))
        self.assertEqual(len(list(self.m.root.glob('*/backup.tar.gz'))),1)

    def test_drift_before_apply(self):
        raw,m,r=self.plan();(self.doc/'script.js').write_bytes(b'new external work')
        with self.assertRaises(RuntimeError):self.m.apply(raw,r['plan'],r['go'])
        self.assertFalse(self.m.run('test-release').exists());self.assert_protected()

    def test_no_space_and_stale_quota(self):
        raw,m,r=self.plan()
        with patch.object(self.m,'capacity',return_value={'ready':False}):
            with self.assertRaises(RuntimeError):self.m.apply(raw,r['plan'],r['go'])
        self.policy['quota_evidence']['observed_unix']=1
        self.assertFalse(self.m.preflight(m,len(raw))['capacity']['ready'])
        self.assertFalse(self.m.run('test-release').exists())

    def test_partial_copy_auto_restore(self):
        raw,m,r=self.plan();publish=self.m.publish;calls=[]
        def broken(name,data):
            calls.append(name)
            if len(calls)==2:raise OSError('synthetic disk failure')
            publish(name,data)
        with patch.object(self.m,'publish',side_effect=broken):
            with self.assertRaises(RuntimeError):self.m.apply(raw,r['plan'],r['go'])
        self.assertEqual(self.m.receipt(self.m.run('test-release'))['phase'],'rolled_back')
        self.assertEqual(self.m.snapshot(self.identity),self.baseline);self.assert_protected()

    def test_recovery_after_hard_interrupt(self):
        raw,m,r=self.plan();publish=self.m.publish
        def broken(name,data):publish(name,data);raise KeyboardInterrupt()
        with patch.object(self.m,'publish',side_effect=broken):
            with self.assertRaises(KeyboardInterrupt):self.m.apply(raw,r['plan'],r['go'])
        self.assertEqual(self.m.receipt(self.m.run('test-release'))['phase'],'publishing')
        p=self.m.rollback_plan('test-release');self.m.rollback(p['plan'],p['go'])
        self.assertEqual(self.m.snapshot(self.identity),self.baseline)

    def test_corrupt_archive_and_missing_backup(self):
        raw,m,r=self.plan()
        with self.assertRaises(RuntimeError):c.verify_package(raw+b'bad',c.sha(raw))
        self.verified();run=self.m.run('test-release');(run/'backup.tar.gz').write_bytes(b'corrupt')
        with self.assertRaises(Exception):self.m.rollback_plan('test-release')
        (run/'backup.tar.gz').unlink()
        with self.assertRaises(Exception):self.m.verify_backup(run)
        self.assert_protected()

    def test_archive_duplicate_symlink_traversal_and_extra_files(self):
        for name,kind in [('../escape',tarfile.REGTYPE),('/escape',tarfile.REGTYPE),('a',tarfile.SYMTYPE),('a',tarfile.LNKTYPE)]:
            out=io.BytesIO()
            with tarfile.open(fileobj=out,mode='w:gz') as t:
                m=tarfile.TarInfo(name);m.type=kind;m.linkname='target';t.addfile(m)
            with self.assertRaises(RuntimeError):c.unpack(out.getvalue())
        raw,m=self.package();files=c.unpack(raw);files['public/extra.php']=b'unexpected'
        bad=c.pack(files)
        with self.assertRaises(RuntimeError):c.verify_package(bad,c.sha(bad))
        out=io.BytesIO()
        with tarfile.open(fileobj=out,mode='w:gz') as t:
            for _ in range(2):t.addfile(tarfile.TarInfo('duplicate'))
        with self.assertRaises(RuntimeError):c.unpack(out.getvalue())

    def test_symlink_production_and_private_roots(self):
        (self.doc/'script.js').unlink();(self.doc/'script.js').symlink_to(self.other/'index.html')
        with self.assertRaises(RuntimeError):self.plan()

    def test_concurrent_deploy(self):
        with self.m.lock():
            with self.assertRaises(RuntimeError):
                with self.m.lock():pass

    def test_protected_config_guard_runtime_drift(self):
        raw,m,r=self.plan();(self.private/'config.php').chmod(0o644)
        with self.assertRaises(RuntimeError):self.m.apply(raw,r['plan'],r['go'])
        (self.private/'config.php').chmod(0o600);(self.doc/'.htaccess').write_bytes(b'unguarded')
        with self.assertRaises(RuntimeError):self.plan()

    def test_rollback_external_drift_and_failure(self):
        self.verified();(self.doc/'script.js').write_bytes(b'external work')
        p=self.m.rollback_plan('test-release')
        with self.assertRaises(RuntimeError):self.m.rollback(p['plan'],p['go'])
        self.assertEqual((self.doc/'script.js').read_bytes(),b'external work')
        self.assert_protected()

    def test_roll_back_failure_retains_evidence(self):
        self.verified();p=self.m.rollback_plan('test-release')
        with patch('release_core.atomic',side_effect=OSError('write failure')):
            with self.assertRaises(OSError):self.m.rollback(p['plan'],p['go'])
        self.assertTrue((self.m.run('test-release')/'backup.tar.gz').exists())

    def test_prune_minimum_pin_period_drift_and_tombstone(self):
        for index in range(5):self.verified('release-'+str(index),version=str(index))
        self.assertEqual(self.m.prune_plan()['plan']['candidates'],[])
        for run in self.m.root.iterdir():
            if run.is_dir():
                r=self.m.receipt(run);r['created_unix']-=30*86400;self.m.save(run,r)
        p=self.m.prune_plan();self.assertEqual([r['release_id'] for r in p['plan']['candidates']],['release-1'])
        with self.assertRaises(RuntimeError):self.m.prune(p['plan'],'wrong GO')
        path=self.m.run('release-1')/'receipt.json';previous=path.read_bytes();path.write_bytes(previous+b' ')
        with self.assertRaises(RuntimeError):self.m.prune(p['plan'],p['go'])
        c.atomic(path,previous);p=self.m.prune_plan();self.m.prune(p['plan'],p['go'])
        self.assertEqual(len(self.m.list_backups()),4)
        self.assertEqual(self.m.status('release-1')['phase'],'pruned')
        with self.assertRaises(RuntimeError):self.plan('release-1')
        self.assert_protected()

    def test_prune_unknown_inventory_stops(self):
        self.verified();(self.m.run('test-release')/'unknown').write_bytes(b'x')
        with self.assertRaises(RuntimeError):self.m.prune_plan()

    def test_pending_release_keeps_all_backups(self):
        for index in range(4):self.verified('release-'+str(index),version=str(index))
        self.apply('pending-release',version='pending')
        plan=self.m.prune_plan(now=int(time.time())+40*86400)['plan']
        self.assertEqual(plan['candidates'],[])
        with self.assertRaises(RuntimeError):self.plan('next-release',version='next')

    def test_encrypted_export_roundtrip(self):
        self.verified();run=self.m.run('test-release')
        key=self.home/'export.key';cert=self.home/'export.crt'
        subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(cert),'-days','1','-subj','/CN=synthetic backup recipient'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        encrypted=self.m.encrypted_backup(run,cert.read_bytes());cipher=base64.b64decode(encrypted['ciphertext'])
        self.assertNotIn(b'fixture secret',cipher)
        decoded=subprocess.run(['openssl','cms','-decrypt','-binary','-inform','DER','-recip',str(cert),'-inkey',str(key)],input=cipher,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout
        self.assertEqual(c.sha(decoded),encrypted['backup_sha256'])
        self.assertEqual(decoded,(run/'backup.tar.gz').read_bytes());self.assert_protected()

    def test_noop_plan_has_no_authorization(self):
        raw,m,_=self.verified()
        result=self.m.plan('new-noop',m,c.sha(raw),len(raw))
        self.assertEqual(result['plan']['changes'],[]);self.assertIsNone(result['go'])
        with self.assertRaises(RuntimeError):self.m.apply(raw,result['plan'],'')
        self.assertFalse(self.m.run('new-noop').exists())

    def test_atomic_parent_swap_cannot_follow_symlink(self):
        folder=self.doc/'race';folder.mkdir();target=folder/'file'
        target.write_bytes(b'original');moved=self.doc/'race-moved'
        real=c.real
        def swap(path):
            if path==target and not moved.exists():
                folder.rename(moved);folder.symlink_to(self.other,target_is_directory=True)
            return path
        with patch('release_core.real',side_effect=swap):
            with self.assertRaises(OSError):c.atomic(target,b'forbidden')
        self.assertEqual((moved/'file').read_bytes(),b'original')
        self.assertFalse((self.other/'file').exists())

    def test_http_tls_failure_stops_before_remote_apply(self):
        import release_manager as cli
        raw,m,result=self.plan();archive=self.home/'package.tar.gz';archive.write_bytes(raw)
        plan=self.home/'plan.json';plan.write_bytes(c.canonical(result));policy=self.home/'policy.json';policy.write_bytes(c.canonical(self.policy))
        argv=['release_manager.py','release','apply','--archive',str(archive),'--sha',c.sha(raw),'--plan',str(plan),'--policy',str(policy),'--go',result['go']]
        with patch.object(sys,'argv',argv),patch.object(cli,'http_preflight',side_effect=RuntimeError('TLS or DNS unavailable')),patch.object(cli,'remote') as remote:
            with self.assertRaisesRegex(RuntimeError,'TLS or DNS'):cli.main()
            remote.assert_not_called()
        self.assertFalse(self.m.root.exists());self.assert_protected()

    def test_ssh_uncertain_response_has_no_retry(self):
        import release_manager as cli
        from types import SimpleNamespace
        with patch.object(cli.subprocess,'run',return_value=SimpleNamespace(returncode=255,stdout=b'',stderr=b'connection lost')) as run:
            with self.assertRaisesRegex(RuntimeError,'outcome unknown'):cli.remote('status',self.policy,release_id='test-release')
            self.assertEqual(run.call_count,1)

    def test_archived_entrypoints_cannot_contact_production(self):
        for name in ['release.py','form_release.py','smtp_e2e.py','smtp_package.py']:
            result=subprocess.run([sys.executable,'-B',str(Path(__file__).parent/name),'apply'],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            self.assertNotEqual(result.returncode,0);self.assertIn(b'Archived rollout CLI',result.stderr)

    def test_legacy_inventory_is_readonly_and_outside_prune(self):
        legacy=self.private/'backups/legacy';legacy.mkdir(parents=True,mode=0o700)
        archive=legacy/'public.tar.gz';archive.write_bytes(c.pack({'index.html':b'old'}));archive.chmod(0o600)
        rows=self.m.historical_backups();self.assertEqual(rows[0]['sha256'],c.sha(archive.read_bytes()))
        self.assertFalse(rows[0]['verified_for_manager']);self.assertFalse(self.m.root.exists())
        self.assertEqual(self.m.prune_plan()['plan']['candidates'],[])

    def test_status_detects_current_production_drift(self):
        self.verified();self.assertTrue(self.m.status('test-release')['current_files_match_receipt'])
        (self.doc/'script.js').write_bytes(b'external change')
        status=self.m.status('test-release');self.assertEqual(status['phase'],'drifted');self.assertEqual(status['receipt_phase'],'verified')
        self.assertFalse(status['current_files_match_receipt']);self.assert_protected()

    def test_package_determinism(self):
        self.assertEqual(self.package()[0],self.package()[0])
        raw,m=self.package();self.assertEqual(c.verify_package(raw,c.sha(raw))[0],m)

    def test_runtime_migration_and_unexpected_files_block(self):
        raw,m=self.package();m['files']['public/api/smtp-manifest.php']='0'*64
        with self.assertRaises(RuntimeError):self.m.preflight(m,len(raw))
        (self.doc/'unknown.txt').write_bytes(b'outside scope')
        with self.assertRaises(RuntimeError):self.plan()


if __name__=='__main__':unittest.main()
