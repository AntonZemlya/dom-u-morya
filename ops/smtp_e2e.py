"""GO A controller: offline package/plan; separately gated Jino snapshot/run/cleanup.

Token stays in memory and HTTPS headers. No mailbox credential is accepted by this CLI.
No remote operation is performed by package or plan. No retry of an attempt, ever.
"""
import argparse
import base64
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import secrets
import shlex
import signal
import subprocess
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request
import smtp_e2e_remote as worker

ROOT=Path(__file__).resolve().parent.parent
HOST='rehab-profi-jino'
SOURCES=['ops/smtp_e2e.py','ops/smtp_e2e_remote.py','ops/smtp_e2e_wrapper.php']
DEFAULT=ROOT/'.release-output/form-002'

def sha(b): return hashlib.sha256(b).hexdigest()
def ensure(ok):
    if not ok: raise RuntimeError('GO A invariant failed; no remote retry')

def published_base():
    """Rebuild the exact deployed commit offline, without touching either checkout."""
    payload=subprocess.check_output(['git','archive',worker.BASE],cwd=ROOT)
    with tempfile.TemporaryDirectory(prefix='dom-e2e-base-',dir='/private/tmp') as tmp:
        root=Path(tmp)
        with tarfile.open(fileobj=io.BytesIO(payload)) as a:
            for m in a.getmembers():
                ensure(not m.name.startswith('/') and '..' not in Path(m.name).parts)
                p=root/m.name
                if m.isdir(): p.mkdir(parents=True,exist_ok=True)
                else:
                    ensure(m.isfile());p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(a.extractfile(m).read())
        (root/'node_modules').symlink_to(ROOT/'node_modules',target_is_directory=True)
        subprocess.run(['node','scripts/build-release.mjs'],cwd=root,check=True,stdout=subprocess.DEVNULL,
                       env={**os.environ,'SITE_URL':worker.ORIGIN,'BUILD_TARGET':'production'})
        return {'base_commit':worker.BASE,'files':{str(p.relative_to(root/'dist')):sha(p.read_bytes()) for p in sorted((root/'dist').rglob('*')) if p.is_file()}}

def package():
    ensure(not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=ROOT))
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    smtp=(DEFAULT/'smtp-update.tar.gz').read_bytes()
    smtp_manifest,_=worker.unpack(smtp,sha(smtp));ensure(smtp_manifest['commit']==commit)
    files={p:(ROOT/p).read_bytes() for p in SOURCES}
    files['published.json']=(json.dumps(published_base(),sort_keys=True,indent=2)+'\n').encode()
    manifest={'schema':'SMTP-E2E/v1','commit':commit,'smtp_sha256':sha(smtp),'files':{p:sha(b) for p,b in sorted(files.items())}}
    files['manifest.json']=(json.dumps(manifest,sort_keys=True,indent=2)+'\n').encode()
    def pack():
        out=io.BytesIO()
        with gzip.GzipFile(fileobj=out,mode='wb',filename='',mtime=0) as gz:
            with tarfile.open(fileobj=gz,mode='w') as a:
                for name,data in sorted(files.items()):
                    m=tarfile.TarInfo(name);m.size=len(data);m.mode=0o600;m.mtime=0;m.uid=0;m.gid=0;a.addfile(m,io.BytesIO(data))
        return out.getvalue()
    payload=pack();ensure(payload==pack())
    DEFAULT.mkdir(parents=True,exist_ok=True)
    target=DEFAULT/'smtp-e2e-harness.tar.gz';target.write_bytes(payload);target.chmod(0o600)
    result={'commit':commit,'smtp_sha256':sha(smtp),'harness_sha256':sha(payload),'harness_bytes':len(payload),
            'authorization':sha(payload)[:32],
            'go_no_send':permit(commit,sha(smtp),sha(payload),'no-send'),
            'go_send_once':permit(commit,sha(smtp),sha(payload),'send-once')}
    (DEFAULT/'go-a.json').write_text(json.dumps(result,indent=2)+'\n');(DEFAULT/'go-a.json').chmod(0o600)
    return result

def control(path,expected_sha):
    payload=path.read_bytes();ensure(sha(payload)==expected_sha and len(payload)<1024*1024)
    with tarfile.open(fileobj=io.BytesIO(payload),mode='r:gz') as a:
        members=a.getmembers();ensure(len(members)==5 and len({m.name for m in members})==5 and all(m.isfile() and m.size<1024*1024 for m in members))
        m=json.load(a.extractfile('manifest.json'))
        ensure(m['schema']=='SMTP-E2E/v1' and set(m['files'])==set(SOURCES)|{'published.json'} and {x.name for x in members}==set(m['files'])|{'manifest.json'})
        files={n:a.extractfile(n).read() for n in m['files']}
        ensure(all(sha(b)==m['files'][n] for n,b in files.items()))
        ensure(all((ROOT/n).read_bytes()==files[n] for n in SOURCES)) # Execute only reviewed controller/worker/template.
        m['published']=json.loads(files['published.json']);m['template']=files['ops/smtp_e2e_wrapper.php'];return m

def permit(commit,smtp_sha,harness_sha,mode,authorization=None):
    return 'GO A '+commit+' '+smtp_sha+' '+harness_sha+' '+mode+' azm1982@yandex.ru AUTH '+(authorization or harness_sha[:32])

def remote(request):
    code=base64.b64encode((ROOT/'ops/smtp_e2e_remote.py').read_bytes()).decode()
    command='python3 -c '+shlex.quote("import base64;exec(compile(base64.b64decode('"+code+"'),'smtp-e2e-reviewed','exec'))")
    p=subprocess.run(['ssh','-T','-o','BatchMode=yes','-o','ConnectTimeout=10',HOST,command],
                     input=json.dumps(request).encode(),stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=40)
    ensure(p.returncode==0);return json.loads(p.stdout)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): return None

class HTTP:
    def __init__(self,origin=worker.ORIGIN,context=None,timeout=15,api_origin=None):
        self.origin=origin;self.timeout=timeout;self.api_origin=api_origin or origin
        handlers=[NoRedirect()]
        if context: handlers.append(urllib.request.HTTPSHandler(context=context))
        self.opener=urllib.request.build_opener(*handlers)

    def request(self,path,token=None,action=None,body=b'',method='POST'):
        ensure(self.origin.startswith('https://') and path.startswith('/') and not path.startswith('//'))
        headers={'Origin':self.origin,'Cache-Control':'no-cache'}
        if token: headers['X-Lead-E2E-Token']=token
        if action: headers['X-Lead-E2E-Action']=action
        if path.startswith('/api/lead.php'):
            headers.update({'Content-Type':'application/json','X-Lead-Request':'1','Idempotency-Key':'0'*32,'Origin':self.api_origin})
        req=urllib.request.Request(self.origin+path,method=method,headers=headers,data=body if method=='POST' else None)
        try: response=self.opener.open(req,timeout=self.timeout)
        except urllib.error.HTTPError as e: response=e
        with response:
            raw=response.read(16385);ensure(len(raw)<=16384)
            return response.status,json.loads(raw) if response.headers.get_content_type()=='application/json' else None

    def disabled(self):
        code,data=self.request('/api/form-status.php',method='GET');ensure(code==200 and data['enabled'] is False)
        code,_=self.request('/api/lead.php',body=b'{}');ensure(code==503)

def execute(c,smtp,harness_sha,baseline,mode,go,call=remote,http=None,authorization=None):
    authorization=authorization or harness_sha[:32]
    ensure(go==permit(c['commit'],c['smtp_sha256'],harness_sha,mode,authorization)) # BEFORE any SSH or HTTP.
    ensure(sha(smtp)==c['smtp_sha256']);http=http or HTTP()
    run_id=secrets.token_hex(12);token=secrets.token_hex(32);out={'run_id':run_id,'mode':mode,'attempt_status':'not_attempted'}
    try:
        http.disabled()
        call({'operation':'install','package':base64.b64encode(smtp).decode(),'package_sha256':c['smtp_sha256'],
              'baseline':baseline,'published':c['published'],'template':base64.b64encode(c['template']).decode(),
              'run_id':run_id,'token_hash':sha(token.encode()),'mode':mode,'commit':c['commit'],
              'harness_sha256':harness_sha,'authorization':authorization})
        path='/smtp-e2e-'+run_id+'.php'
        code,preflight=http.request(path,token,'preflight');ensure(code==200 and preflight['smtp_invoked'] is False and preflight['form_enabled'] is False)
        # This is the ONLY attempt call. No automatic POST retry or alternative transport.
        out['attempt_status']='uncertain'
        code,result=http.request(path,token,'attempt');ensure(code==200 and result['form_enabled'] is False)
        ensure(result['status']==('dry_run' if mode=='no-send' else 'smtp_accepted'))
        out['attempt_status']=result['status'];out['id']=result['id']
    except Exception:
        out['operation_failed']=True
    finally:
        token=None
        try:
            out['cleanup_stage']='filesystem'
            out['cleanup']=call({'operation':'cleanup','run_id':run_id,'baseline':baseline,'published':c['published']})
            out['cleanup_stage']='filesystem_verify'
            out['verification']=call({'operation':'verify','run_id':run_id,'baseline':baseline,'published':c['published']})
            out['cleanup_stage']='http_404'
            code,_=http.request('/smtp-e2e-'+run_id+'.php?cleanup='+secrets.token_hex(8));out['cleanup_http_status']=code;ensure(code==404)
            out['cleanup_stage']='http_disabled'
            http.disabled();out['http_cleanup_verified']=True
            out['cleanup_stage']='complete'
        except Exception as error:
            out['cleanup_required']=True;out['cleanup_error_type']=type(error).__name__
    return out

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('command',choices=['package','plan','snapshot','run','cleanup'])
    p.add_argument('--harness',type=Path,default=DEFAULT/'smtp-e2e-harness.tar.gz');p.add_argument('--harness-sha')
    p.add_argument('--package',type=Path,default=DEFAULT/'smtp-update.tar.gz');p.add_argument('--baseline',type=Path)
    p.add_argument('--mode',choices=['no-send','send-once'],default='no-send');p.add_argument('--go');p.add_argument('--run-id')
    p.add_argument('--authorization',help='Non-secret owner-approved 128-bit grant identity; defaults to harness SHA prefix')
    args=p.parse_args()
    if args.command=='package': result=package()
    else:
        ensure(args.harness_sha);c=control(args.harness,args.harness_sha)
        if args.command=='plan':
            result={'remote_operations':0,'commit':c['commit'],'smtp_sha256':c['smtp_sha256'],'harness_sha256':args.harness_sha,
                    'go_required':permit(c['commit'],c['smtp_sha256'],args.harness_sha,args.mode,args.authorization),
                    'writes':['private candidate/runtime/receipt','one temporary smtp-e2e-<run-id>.php'],
                    'cleanup':['remove only owned wrapper','retain one-shot/state','verify public/config metadata + HTTP 404/false/503']}
        elif args.command=='snapshot':
            ensure(args.baseline is not None and not args.baseline.exists())
            data=remote({'operation':'snapshot','published':c['published']})
            with args.baseline.open('x') as f:
                os.chmod(str(args.baseline),0o600);json.dump(data,f,sort_keys=True,indent=2)
            result={'snapshot_written':True,'sha256':sha(args.baseline.read_bytes()),'public_write':False,'smtp_invoked':False}
        else:
            ensure(args.baseline is not None and worker.metadata(args.baseline.resolve())['mode']==0o600)
            baseline=json.loads(args.baseline.read_text())
            if args.command=='run':
                result=execute(c,args.package.read_bytes(),args.harness_sha,baseline,args.mode,args.go,authorization=args.authorization)
            else:
                ensure(args.run_id is not None)
                request={'run_id':args.run_id,'baseline':baseline,'published':c['published']}
                result={'cleanup':remote(dict(request,operation='cleanup')),'verification':remote(dict(request,operation='verify'))}
                http=HTTP();code,_=http.request('/smtp-e2e-'+args.run_id+'.php?cleanup='+secrets.token_hex(8));ensure(code==404);http.disabled();result['http_cleanup_verified']=True
    print(json.dumps(result,indent=2))
    if result.get('cleanup_required') or result.get('operation_failed'): sys.exit(1)

if __name__=='__main__':
    def stop(*args): raise RuntimeError('Interrupted; cleanup required')
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
    try: main()
    except Exception:
        print('GO A stopped; no resend. Inspect run receipt and use the documented cleanup command.',file=sys.stderr);sys.exit(1)
