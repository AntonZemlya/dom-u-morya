#!/usr/bin/env python3
"""Offline deterministic FORM-004 package; precise owner GO required for Jino writes."""
import argparse
import base64
import gzip
import io
import json
import os
from pathlib import Path
import shlex
import subprocess
import tarfile
import time
import urllib.error
import urllib.request
from form_release_remote import PUBLIC,RUNTIME,CONTROL,BASE,ORIGIN,sha,unpack,go_line
ROOT=Path(__file__).resolve().parent.parent
BASELINE=ROOT/'.release-output/form-002/config-prep/jino-baseline-after-config.json'
BASELINE_SHA='0083b86deb187949d5f9c20b39ace060fae66e82c9e92a37c736fcb737615b36'
OUT=ROOT/'.release-output/form-004'

def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()

def package(commit,baseline):
    from smtp_package import bundle
    _,old=bundle(ROOT,commit)
    identity=old['runtime_identity']
    runtime=ROOT/'.release-output/smtp-runtime'/identity
    files={'public/'+p:(ROOT/'dist'/p).read_bytes() for p in PUBLIC}
    files.update({'private/smtp-runtime/'+identity+'/'+p:(runtime/p).read_bytes() for p in RUNTIME})
    files.update({p:(ROOT/p).read_bytes() for p in CONTROL})
    manifest=dict(schema='FORM-004/v1',commit=commit,base_commit=BASE,accepted_base='52a71bd0c22f4899469d706df9038d8da665bdf9',
                  site_url=ORIGIN,runtime_identity=identity,baseline=baseline,consent_version='2026-10-31',
                  main_delivery_verified=False,files={n:sha(v) for n,v in sorted(files.items())})
    # Exact public delta relative to the accepted read-only production snapshot.
    actual={str(p.relative_to(ROOT/'dist')):sha(p.read_bytes()) for p in (ROOT/'dist').rglob('*') if p.is_file()}
    before={n:v['sha256'] for n,v in baseline['public'].items() if n!='.envrc'}
    if {n for n in set(actual)|set(before) if actual.get(n)!=before.get(n)}!=set(PUBLIC):
        raise RuntimeError('Unexpected public release delta; STOP')
    files['manifest.json']=(json.dumps(manifest,sort_keys=True,indent=2)+'\n').encode()
    out=io.BytesIO()
    with gzip.GzipFile(fileobj=out,mode='wb',filename='',mtime=0) as gz:
        with tarfile.open(fileobj=gz,mode='w') as a:
            for n,v in sorted(files.items()):
                m=tarfile.TarInfo(n);m.size=len(v);m.mode=0o644 if n.startswith('public/') else 0o600
                a.addfile(m,io.BytesIO(v))
    raw=out.getvalue();unpack(raw,sha(raw));return raw,manifest

def remote(request):
    code=(ROOT/'ops/form_release_remote.py').read_bytes()
    command='python3 -c '+shlex.quote("import base64;exec(compile(base64.b64decode('"+base64.b64encode(code).decode()+"'),'form004','exec'))")
    p=subprocess.run(['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','rehab-profi-jino',command],
                     input=json.dumps(request).encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if p.returncode:raise RuntimeError('Jino operation failed/uncertain: STOP; inspect receipt before recovery')
    return json.loads(p.stdout)

def smoke(enabled,origin=ORIGIN,context=None):
    def fetch(path,method='GET',data=None,headers=None):
        r=urllib.request.Request(origin+path,data=data,method=method,headers={'Cache-Control':'no-cache',**(headers or {})})
        try:
            with urllib.request.urlopen(r,timeout=15,context=context) as reply:return reply.status,reply.headers,reply.read()
        except urllib.error.HTTPError as e:
            return e.code,e.headers,e.read()
    # Read-only polling permits normal PHP opcode-cache timestamp revalidation.
    matched=False
    for attempt in range(10):
        code,headers,body=fetch('/api/form-status.php');status=json.loads(body)
        matched=code==200 and status=={'enabled':enabled,'ready':True,'consentVersion':'2026-10-31'} and 'no-store' in headers.get('Cache-Control','')
        if matched:break
        if attempt<9:time.sleep(.5)
    if not matched:
        raise RuntimeError('Runtime/config no-send readiness failed')
    for p in ['/','/privacy.html','/consent-personal-data.html']:
        if fetch(p)[0]!=200:raise RuntimeError('Public page unavailable')
    for p in ['/.envrc','/.htaccess','/.git/config']:
        if fetch(p)[0] not in [403,404]:raise RuntimeError('Protected path accessible')
    if fetch('/api/lead.php')[0]!=405:raise RuntimeError('Method guard failed')
    # Deliberately invalid requests: no name, phone, checkbox or valid idempotency payload.
    code=fetch('/api/lead.php','POST',b'{}',{'Content-Type':'application/json','Origin':ORIGIN,'X-Lead-Request':'1','Idempotency-Key':'f'*32})[0]
    if code!=(422 if enabled else 503):raise RuntimeError('Negative API guard failed')
    return dict(enabled=enabled,ready=True,negative_post=code,synthetic_mail_sent=False)

def main():
    p=argparse.ArgumentParser();p.add_argument('command',choices=['package','apply','rollback','snapshot'])
    p.add_argument('--go');args=p.parse_args()
    if args.command=='package':
        if git('status','--porcelain','--untracked-files=all'):raise RuntimeError('Commit sources before packaging')
        if sha(BASELINE.read_bytes())!=BASELINE_SHA:raise RuntimeError('Accepted baseline changed')
        subprocess.run(['node','scripts/smtp-runtime.mjs'],cwd=ROOT,check=True)
        subprocess.run(['npm','run','build:production'],cwd=ROOT,check=True,env={**os.environ,'SITE_URL':ORIGIN})
        raw,m=package(git('rev-parse','HEAD'),json.loads(BASELINE.read_text()))
        if raw!=package(m['commit'],m['baseline'])[0]:raise RuntimeError('Non-reproducible package')
        OUT.mkdir(parents=True,exist_ok=True);archive=OUT/'release.tar.gz';archive.write_bytes(raw);archive.chmod(0o600)
        result=dict(commit=m['commit'],sha256=sha(raw),archive=str(archive),public_files=PUBLIC,
                    private_runtime_files=5,control_files=3,form_enabled=False,go=go_line(m,sha(raw)))
        (OUT/'go-prod.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));return
    if args.command=='snapshot':print(json.dumps(remote(dict(op='snapshot')),sort_keys=True));return
    raw=(OUT/'release.tar.gz').read_bytes();digest=sha(raw);m,files=unpack(raw,digest)
    for n in CONTROL:
        if (ROOT/n).read_bytes()!=files[n]:raise RuntimeError('Release control source drift')
    if args.go!=go_line(m,digest):raise RuntimeError('Exact owner GO PROD FORM required; no network write performed')
    if args.command=='rollback':result=remote(dict(op='rollback',sha=digest))
    else:
        # Never retry this operation automatically, especially after an uncertain SSH outcome.
        result={'stage':remote(dict(op='stage',archive=base64.b64encode(raw).decode(),sha=digest,go=args.go))}
        try:
            result['disabled_smoke']=smoke(False)
            result['activation']=remote(dict(op='enable',sha=digest,go=args.go))
            result['enabled_smoke']=smoke(True)
            result.update(phase='enabled',form_enabled=True,main_delivery_verified=False)
        except BaseException:
            remote(dict(op='rollback',sha=digest));raise
    (OUT/'execution.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))

if __name__=='__main__':main()
