"""FORM-004 worker; Python 3.6; fixed domain in CLI, no SMTP client or mail probe."""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tarfile

HOME = '/home/users/j/j84938826'
PUBLIC = ['api/lead-catalog.php','api/smtp-manifest.php','api/lead-smtp.php',
          'privacy.html','consent-personal-data.html','script.js','api/lead-core.php']
RUNTIME = ['src/Exception.php','src/PHPMailer.php','src/SMTP.php','LICENSE','manifest.json']
CONTROL = ['ops/form_release.py','ops/form_release_remote.py','ops/form-config.php']
ORIGIN = 'https://zhk-dom-umorya.ru'
BASE = 'c1a32fa85c16d9e2c2b40588de8be5daa92d7801'

def ensure(ok):
    if not ok: raise RuntimeError('FORM-004 invariant failed; STOP, inspect private receipt')

def sha(data): return hashlib.sha256(data).hexdigest()

def real(p):
    ensure(p.is_absolute() and p.resolve()==p and not p.is_symlink())
    return p

def meta(p):
    real(p);ensure(p.is_file());s=p.stat()
    return dict(sha256=sha(p.read_bytes()),mode=stat.S_IMODE(s.st_mode),mtime_ns=s.st_mtime_ns,
                size=s.st_size,uid=s.st_uid,gid=s.st_gid)

def directory(p):
    if not p.exists():p.mkdir(mode=0o700)
    real(p);ensure(p.is_dir() and stat.S_IMODE(p.stat().st_mode)==0o700)

def atomic(p,data,mode=0o600):
    real(p);real(p.parent);ensure(not p.exists() or p.is_file())
    tmp=p.with_name('.'+p.name+'.form004')
    ensure(not tmp.exists() and not tmp.is_symlink())
    try:
        with tmp.open('xb') as f:
            os.chmod(str(tmp),mode);f.write(data);f.flush();os.fsync(f.fileno())
        os.replace(str(tmp),str(p))
    finally:
        if tmp.exists():tmp.unlink()

def unpack(raw,digest):
    ensure(re.fullmatch('[a-f0-9]{64}',digest) and sha(raw)==digest and len(raw)<2*1024*1024)
    with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as a:
        ms=a.getmembers();ensure(len(ms)==16 and all(m.isfile() and m.size<1024*1024 for m in ms))
        ensure(len(set(m.name for m in ms))==16)
        m=json.load(a.extractfile('manifest.json'));identity=m['runtime_identity']
        ensure(m['schema']=='FORM-004/v1' and m['site_url']==ORIGIN and m['base_commit']==BASE
               and re.fullmatch('[a-f0-9]{40}',m['commit']) and re.fullmatch('[a-f0-9]{64}',identity))
        names=set('public/'+n for n in PUBLIC)|set('private/smtp-runtime/'+identity+'/'+n for n in RUNTIME)|set(CONTROL)
        ensure(set(m['files'])==names and set(x.name for x in ms)==names|{'manifest.json'})
        files={n:a.extractfile(n).read() for n in names}
        ensure(all(sha(v)==m['files'][n] for n,v in files.items()))
        return m,files

def go_line(m,digest):
    return 'GO PROD FORM '+m['commit']+' '+digest+' TO info@anyara.ru BCC azm1982@yandex.ru LEGAL 2026-10-31 ACCEPT_UNTESTED_MAIN=YES AUTHORIZE_BCC=YES'

class Worker:
    def __init__(self,home=HOME,php='php'):
        self.home=real(Path(home));self.doc=self.home/'domains/zhk-dom-umorya.ru'
        self.private=self.home/'.dom-u-morya';self.php=php
    def inventory(self):
        real(self.doc);out={}
        for p in sorted(self.doc.rglob('*')):
            real(p);ensure(p.is_file() or p.is_dir())
            if p.is_file():out[str(p.relative_to(self.doc))]=meta(p)
        ensure(all(n in out for n in ['.envrc','.htaccess','index.html']))
        return out
    def snapshot(self):
        real(self.private);ensure(stat.S_IMODE(self.private.stat().st_mode)==0o700)
        cfg=meta(self.private/'config.php');ensure(cfg['mode']==0o600)
        return dict(base_commit=BASE,public=self.inventory(),config=cfg)
    def run_dir(self,digest):
        ensure(re.fullmatch('[a-f0-9]{64}',digest));return self.private/'form-004'/digest
    def receipt(self,run,r):atomic(run/'receipt.json',(json.dumps(r,sort_keys=True)+'\n').encode())
    def verified_manifest(self,run):
        m,_=unpack((run/'package.tar.gz').read_bytes(),run.name)
        ensure(json.loads((run/'manifest.json').read_text())==m)
        ensure(meta(run/'form-config.php')['sha256']==m['files']['ops/form-config.php'])
        return m
    def configure(self,run,phase,source=None):
        manifest=self.verified_manifest(run)
        cfg=source or self.private/'config.php';target=self.private/'config.form004-next.php'
        ensure(not target.exists() and not target.is_symlink())
        runtime=self.private/'smtp-runtime'/manifest['runtime_identity']
        proc=subprocess.run([self.php,'-n',str(run/'form-config.php'),str(cfg),str(target),phase,str(runtime)],
                            stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        ensure(proc.returncode==0 and proc.stdout==b'')
        ensure(meta(target)['mode']==0o600)
        with target.open('rb') as f:os.fsync(f.fileno())
        os.replace(str(target),str(self.private/'config.php'))
    def stage(self,raw,digest,go):
        m,files=unpack(raw,digest);ensure(go==go_line(m,digest))
        ensure(self.snapshot()==m['baseline']) # Includes config + every public file's full metadata.
        directory(self.private/'form-004');run=self.run_dir(digest);ensure(not run.exists());directory(run)
        atomic(run/'package.tar.gz',raw);atomic(run/'manifest.json',json.dumps(m).encode())
        atomic(run/'form-config.php',files['ops/form-config.php'])
        # Full public backup, kept private. Restore only the exact scoped file set.
        with (run/'public-backup.tar').open('xb') as f:
            os.chmod(str(run/'public-backup.tar'),0o600)
            with tarfile.open(fileobj=f,mode='w') as a:
                for name in sorted(m['baseline']['public']):a.add(str(self.doc/name),arcname=name,recursive=False)
            f.flush();os.fsync(f.fileno())
        atomic(run/'config-backup.php',(self.private/'config.php').read_bytes())
        ensure(self.snapshot()==m['baseline'])
        r=dict(phase='backed_up',backup_sha256=sha((run/'public-backup.tar').read_bytes()),
               package_sha256=digest,go_sha256=sha(go.encode()))
        self.receipt(run,r)
        try:
            directory(self.private/'smtp-runtime');runtime=self.private/'smtp-runtime'/m['runtime_identity']
            directory(runtime);directory(runtime/'src')
            for name in RUNTIME:
                p=runtime/name;data=files['private/smtp-runtime/'+runtime.name+'/'+name]
                if p.exists():ensure(meta(p)['sha256']==sha(data) and meta(p)['mode']==0o600)
                else:atomic(p,data)
            self.configure(run,'prepare') # Disabled before any public code changes.
            r['config_sha256']=meta(self.private/'config.php')['sha256'];r['phase']='publishing';self.receipt(run,r)
            for name in PUBLIC:
                atomic(self.doc/name,files['public/'+name],0o644)
            r['phase']='disabled';self.receipt(run,r)
            self.check_candidate(run,m,r)
            return dict(phase='disabled',form_enabled=False,backup_sha256=r['backup_sha256'])
        except BaseException:
            self.rollback(digest);raise
    def check_candidate(self,run,m,r):
        actual=self.inventory();before=m['baseline']['public']
        ensure(set(actual)==set(before)|set(PUBLIC))
        for name in actual:
            if name in PUBLIC:ensure(actual[name]['sha256']==m['files']['public/'+name] and actual[name]['mode']==0o644)
            else:ensure(actual[name]==before[name])
        ensure(meta(self.private/'config.php')['sha256']==r['config_sha256'])
    def enable(self,digest,go):
        run=self.run_dir(digest);m=self.verified_manifest(run);r=json.loads((run/'receipt.json').read_text())
        ensure(go==go_line(m,digest) and r['phase']=='disabled');self.check_candidate(run,m,r)
        self.configure(run,'enable');r['config_sha256']=meta(self.private/'config.php')['sha256'];r['phase']='enabled'
        self.receipt(run,r);self.check_candidate(run,m,r)
        return dict(phase='enabled',main_delivery_verified=False)
    def rollback(self,digest):
        run=self.run_dir(digest);m=self.verified_manifest(run)
        # Fail closed even when a backup/receipt is damaged; never restore unknown data.
        self.configure(run,'disable')
        r=json.loads((run/'receipt.json').read_text())
        ensure(sha((run/'public-backup.tar').read_bytes())==r['backup_sha256'])
        ensure(meta(run/'config-backup.php')['sha256']==m['baseline']['config']['sha256'])
        # Fail closed first. No state or one-shot marker is ever restored/deleted.
        r['phase']='rollback_started';self.receipt(run,r)
        with tarfile.open(str(run/'public-backup.tar')) as a:
            for name in reversed(PUBLIC):
                p=self.doc/name
                if p.exists():
                    ensure(meta(p)['sha256'] in [m['files']['public/'+name],m['baseline']['public'].get(name,{}).get('sha256')])
                if name in m['baseline']['public']:
                    old=m['baseline']['public'][name];atomic(p,a.extractfile(name).read(),old['mode'])
                    os.utime(str(p),ns=(old['mtime_ns'],old['mtime_ns']))
                elif p.exists():p.unlink()
        self.configure(run,'disable',run/'config-backup.php')
        ensure(self.inventory()==m['baseline']['public'])
        r['phase']='rolled_back';self.receipt(run,r)
        return dict(phase='rolled_back',form_enabled=False,public_restored=True,state_and_markers_preserved=True)

if __name__=='__main__':
    try:
        import base64
        request=json.load(sys.stdin);w=Worker();op=request['op']
        if op=='snapshot':result=w.snapshot()
        elif op=='stage':result=w.stage(base64.b64decode(request['archive']),request['sha'],request['go'])
        elif op=='enable':result=w.enable(request['sha'],request['go'])
        elif op=='rollback':result=w.rollback(request['sha'])
        else:raise RuntimeError()
        print(json.dumps(result,sort_keys=True))
    except BaseException:
        sys.stderr.write('FORM-004 STOP; inspect private receipt; never retry mail\n');sys.exit(1)
