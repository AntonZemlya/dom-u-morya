"""Jino Python 3.6-compatible worker. JSON stdin; never changes config/public handlers.

Only one temporary public pathname is writable. Candidate/runtime/receipts are private.
The CLI fixes HOME/ORIGIN; tests construct Worker against disposable loopback fixtures.
"""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import sys
import tarfile
import time

HOME = '/home/users/j/j84938826'
ORIGIN = 'https://zhk-dom-umorya.ru'
BASE = 'c1a32fa85c16d9e2c2b40588de8be5daa92d7801'
PUBLIC = ['api/lead-core.php','api/lead-smtp.php','api/lead-catalog.php','api/smtp-manifest.php']
RUNTIME = ['src/Exception.php','src/PHPMailer.php','src/SMTP.php','LICENSE','manifest.json']

def ensure(ok):
    if not ok: raise RuntimeError('E2E invariant failed; no secret diagnostics')

def digest(raw): return hashlib.sha256(raw).hexdigest()

def real(path):
    ensure(path.is_absolute() and path.resolve() == path and not path.is_symlink())
    return path

def metadata(path):
    real(path); ensure(path.is_file())
    s=path.stat()
    return {'sha256':digest(path.read_bytes()),'mode':stat.S_IMODE(s.st_mode),
            'mtime_ns':s.st_mtime_ns,'size':s.st_size,'uid':s.st_uid,'gid':s.st_gid}

def put(path, data, mode=0o600):
    real(path.parent)
    with path.open('xb') as f:
        os.chmod(str(path),mode); f.write(data); f.flush(); os.fsync(f.fileno())

def directory(path):
    if not path.exists(): path.mkdir(mode=0o700)
    real(path); ensure(path.is_dir() and stat.S_IMODE(path.stat().st_mode)==0o700)

def unpack(payload, expected_sha):
    ensure(re.fullmatch('[a-f0-9]{64}',expected_sha) and digest(payload)==expected_sha and len(payload)<2*1024*1024)
    with tarfile.open(fileobj=io.BytesIO(payload),mode='r:gz') as a:
        members=a.getmembers()
        ensure(len(members)==10 and len({m.name for m in members})==10 and all(m.isfile() and m.size<1024*1024 for m in members))
        manifest=json.load(a.extractfile('manifest.json'))
        identity=manifest['runtime_identity']
        ensure(re.fullmatch('[a-f0-9]{64}',identity) and manifest['base_commit']==BASE
               and re.fullmatch('[a-f0-9]{40}',manifest['commit']) and manifest['schema']=='SMTP-001/v1'
               and manifest['form_enabled'] is False and manifest['site_url']==ORIGIN)
        expected={'public/'+p for p in PUBLIC}|{'private/smtp-runtime/'+identity+'/'+p for p in RUNTIME}
        ensure(set(manifest['files'])==expected and {m.name for m in members}==expected|{'manifest.json'})
        files={name:a.extractfile(name).read() for name in expected}
        ensure(all(digest(data)==manifest['files'][name] for name,data in files.items()))
        return manifest,files

class Worker:
    def __init__(self,home=HOME,origin=ORIGIN,local_fixture=False):
        self.home=real(Path(home)); self.doc=self.home/'domains/zhk-dom-umorya.ru'
        self.private=self.home/'.dom-u-morya'; self.origin=origin; self.local=local_fixture

    def inventory(self,exclude=None):
        real(self.doc); result={}
        for p in sorted(self.doc.rglob('*')):
            real(p)
            relative=str(p.relative_to(self.doc))
            if p.is_file() and relative!=exclude: result[relative]=metadata(p)
            else: ensure(p.is_dir() or relative==exclude)
        ensure('.envrc' in result and '.htaccess' in result and 'index.html' in result)
        return result

    def snapshot(self,published):
        actual=self.inventory()
        ensure(published['base_commit']==BASE and set(actual)==set(published['files'])|{'.envrc'})
        ensure(all(actual[n]['sha256']==v and actual[n]['mode']==0o644 for n,v in published['files'].items()))
        real(self.private); ensure(stat.S_IMODE(self.private.stat().st_mode)==0o700)
        cfg=metadata(self.private/'config.php'); ensure(cfg['mode']==0o600)
        return {'base_commit':BASE,'public':actual,'config':cfg}

    def check_baseline(self,baseline,published,exclude=None):
        actual=self.inventory(exclude)
        ensure(actual==baseline['public'] and baseline['base_commit']==BASE)
        ensure(published['base_commit']==BASE and set(actual)==set(published['files'])|{'.envrc'}
               and all(actual[n]['sha256']==v and actual[n]['mode']==0o644 for n,v in published['files'].items()))
        cfg=metadata(self.private/'config.php')
        ensure(cfg==baseline['config'] and cfg['mode']==0o600 and stat.S_IMODE(real(self.private).stat().st_mode)==0o700)

    def install(self,payload,package_sha,baseline,published,template,run_id,token_hash,mode,commit,harness_sha,authorization):
        ensure(re.fullmatch('[a-f0-9]{24}',run_id) and re.fullmatch('[a-f0-9]{64}',token_hash) and mode in ['no-send','send-once'])
        ensure(re.fullmatch('[a-f0-9]{64}',harness_sha) and re.fullmatch('[a-f0-9]{32}',authorization))
        manifest,files=unpack(payload,package_sha); ensure(manifest['commit']==commit)
        self.check_baseline(baseline,published)
        directory(self.private)
        for name in ['candidates','smtp-runtime','e2e']: directory(self.private/name)
        directory(self.private/'e2e/approvals')
        approval=digest(('GO A '+commit+' '+package_sha+' '+harness_sha+' '+mode+' azm1982@yandex.ru AUTH '+authorization).encode())
        # A second controller invocation cannot reuse the same owner GO, even with a new URL/token.
        put(self.private/'e2e/approvals'/(approval+'.json'),json.dumps({'run_id':run_id,'mode':mode,'package_sha256':package_sha,'harness_sha256':harness_sha}).encode())
        run=self.private/'e2e'/run_id
        ensure(not run.exists()); run.mkdir(mode=0o700); (run/'state').mkdir(mode=0o700)
        candidate=self.private/'candidates'/package_sha
        directory(candidate); directory(candidate/'api')
        runtime=self.private/'smtp-runtime'/manifest['runtime_identity']
        directory(runtime); directory(runtime/'src')
        created=int(time.time())
        settings={'home':str(self.home),'origin':self.origin,'local_fixture':self.local,'run_id':run_id,
                  'token_hash':token_hash,'mode':mode,'created':created,'expires':created+120,
                  'commit':commit,'package_sha256':package_sha,'config_sha256':baseline['config']['sha256'],
                  'approval_id':approval,
                  'runtime_identity':manifest['runtime_identity'],
                  'candidate_files':{p:manifest['files']['public/'+p] for p in PUBLIC}}
        ensure(template.count(b'__E2E_SETTINGS_BASE64__')==1)
        rendered=template.replace(b'__E2E_SETTINGS_BASE64__',base64.b64encode(json.dumps(settings,separators=(',',':')).encode()))
        filename='smtp-e2e-'+run_id+'.php'
        receipt={'baseline':baseline,'published':published,'wrapper_sha256':digest(rendered),'filename':filename,
                 'commit':commit,'package_sha256':package_sha,'mode':mode,'expires':settings['expires'],'approval_id':approval}
        put(run/'receipt.json',json.dumps(receipt,sort_keys=True).encode())
        try:
            for name,data in files.items():
                if name.startswith('public/'): destination=candidate/name[len('public/'):]
                else: destination=self.private/name[len('private/'):]
                if destination.exists(): ensure(metadata(destination)['sha256']==digest(data) and metadata(destination)['mode']==0o600)
                else: put(destination,data)
            put(run/'wrapper.php',rendered,0o644) # Non-secret source, enclosed by 0700 run directory.
            # Final drift check immediately before the ONLY public write; no overwrite.
            self.check_baseline(baseline,published)
            os.link(str(run/'wrapper.php'),str(self.doc/filename)) # Atomic, exclusive; same filesystem required.
            self.check_baseline(baseline,published,filename)
        except BaseException:
            self.cleanup(run_id)
            raise
        return {'run_id':run_id,'expires':settings['expires'],'wrapper_sha256':digest(rendered)}

    def record(self,run_id):
        ensure(re.fullmatch('[a-f0-9]{24}',run_id))
        run=self.private/'e2e'/run_id; real(run)
        p=run/'receipt.json'; ensure(metadata(p)['mode']==0o600)
        r=json.loads(p.read_text()); ensure(r['filename']=='smtp-e2e-'+run_id+'.php')
        return run,r

    def verify(self,run_id,baseline=None,published=None):
        ensure(re.fullmatch('[a-f0-9]{24}',run_id))
        receipt=self.private/'e2e'/run_id/'receipt.json'
        if not receipt.exists() and not receipt.is_symlink():
            # Also covers an unknown/failed install before a receipt was written.
            ensure(baseline is not None and published is not None)
            path=self.doc/('smtp-e2e-'+run_id+'.php');ensure(not path.exists() and not path.is_symlink())
            self.check_baseline(baseline,published)
            return {'wrapper_removed':True,'public_unchanged':True,'config_unchanged':True,'status':'not_installed','invocations':0}
        run,r=self.record(run_id)
        ensure(not (self.doc/r['filename']).exists() and not (self.doc/r['filename']).is_symlink())
        self.check_baseline(r['baseline'],r['published'])
        status='not_attempted'
        if (run/'attempt.json').exists():
            try: status=json.loads((run/'attempt.json').read_text())['status']
            except (ValueError,KeyError): status='uncertain'
        ensure(status in ['not_attempted','pending','dry_run','smtp_accepted','uncertain'])
        return {'wrapper_removed':True,'public_unchanged':True,'config_unchanged':True,'status':status,
                'one_shot_retained':(run/'attempt.json').exists(),'invocations':int((run/'invocation.json').exists())}

    def cleanup(self,run_id,baseline=None,published=None):
        ensure(re.fullmatch('[a-f0-9]{24}',run_id))
        if not (self.private/'e2e'/run_id/'receipt.json').exists(): return self.verify(run_id,baseline,published)
        run,r=self.record(run_id); path=self.doc/r['filename']
        if path.exists() or path.is_symlink():
            ensure(metadata(path)['sha256']==r['wrapper_sha256']); path.unlink()
        # No deletion of marker/state/candidate/runtime, even on timeout or repeat.
        return self.verify(run_id)

def main():
    request=json.loads(sys.stdin.read(4*1024*1024+1)); w=Worker()
    op=request['operation']
    if op=='snapshot': result=w.snapshot(request['published'])
    elif op=='install':
        result=w.install(base64.b64decode(request['package'],validate=True),request['package_sha256'],request['baseline'],request['published'],
                         base64.b64decode(request['template'],validate=True),request['run_id'],request['token_hash'],request['mode'],request['commit'],request['harness_sha256'],request['authorization'])
    elif op=='cleanup': result=w.cleanup(request['run_id'],request.get('baseline'),request.get('published'))
    elif op=='verify': result=w.verify(request['run_id'],request.get('baseline'),request.get('published'))
    else: raise RuntimeError()
    print(json.dumps(result,separators=(',',':')))

if __name__=='__main__':
    try: main()
    except BaseException:
        print('E2E worker stopped; check invariants/cleanup using run ID, no automatic resend',file=sys.stderr)
        sys.exit(1)
