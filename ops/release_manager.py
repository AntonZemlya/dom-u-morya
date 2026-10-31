#!/usr/bin/env python3
"""Universal domain-scoped release CLI. No SMTP client, no valid POST, no implicit GO."""
import argparse
import base64
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
from release_core import (DOMAIN, ORIGIN, RUNTIME_FILES, Manager, canonical, digest,
                          ensure, pack, regular, sha, verify_package, check_export_go, export_destination, certificate_sha256, validate_id)

ROOT=Path(__file__).resolve().parent.parent
CORE=ROOT/'ops/release_core.py'
HOST='rehab-profi-jino'


def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()


def build(commit, output):
    commit=git('rev-parse',commit+'^{commit}')
    ensure(not git('status','--porcelain','--untracked-files=all'), 'Commit reviewed changes before release build')
    # Build a fresh Git snapshot; no source file or ignored dist can contaminate the package.
    with tempfile.TemporaryDirectory(prefix='dom-release-build-') as temporary:
        source=Path(temporary).resolve()
        data=subprocess.check_output(['git','archive','--format=tar',commit],cwd=ROOT)
        import io
        with tarfile.open(fileobj=io.BytesIO(data)) as archive:
            for m in archive.getmembers():
                ensure(not m.issym() and not m.islnk() and not m.name.startswith('/') and '..' not in Path(m.name).parts, 'Unsafe Git snapshot')
            archive.extractall(source,filter='data')
        (source/'node_modules').symlink_to(ROOT/'node_modules',target_is_directory=True)
        (source/'vendor').symlink_to(ROOT/'vendor',target_is_directory=True)
        env={**os.environ,'BUILD_TARGET':'production','SITE_URL':ORIGIN}
        for args in [['node','scripts/generate-content.mjs','--check'],['node','scripts/build-release.mjs'],['node','scripts/smtp-runtime.mjs']]:
            subprocess.run(args,cwd=source,env=env,check=True,stdout=subprocess.DEVNULL)
        identity=json.loads((source/'api/smtp-manifest.php').read_text().split('return json_decode(',1)[1].split(', true,',1)[0])
        identity=json.loads(identity)['identity']
        allowlist=json.loads(subprocess.check_output(['node','--input-type=module','-e',
            "import {RELEASE_FILES} from './scripts/release-files.mjs';console.log(JSON.stringify([...RELEASE_FILES,'robots.txt','sitemap.xml'].sort()))"],cwd=source))
        files={'public/'+n:regular(source/'dist'/n) for n in allowlist}
        files.update({'private/smtp-runtime/'+identity+'/'+n:regular(source/'.release-output/smtp-runtime'/identity/n) for n in RUNTIME_FILES})
        manifest=dict(schema='dom-release/v1',commit=commit,origin=ORIGIN,public_allowlist=allowlist,runtime_identity=identity,
                      composer_lock_sha256=sha(regular(source/'composer.lock')),files={n:sha(b) for n,b in sorted(files.items())})
        files['manifest.json']=canonical(manifest);raw=pack(files,{n:0o644 if n.startswith('public/') else 0o600 for n in files})
        ensure(raw==pack(files,{n:0o644 if n.startswith('public/') else 0o600 for n in files}), 'Non-deterministic archive')
        verify_package(raw,sha(raw))
        output=output.resolve();output.mkdir(parents=True,exist_ok=True,mode=0o700)
        target=output/(commit+'.tar.gz');target.write_bytes(raw);target.chmod(0o600)
        (output/'package.json').write_bytes(canonical(dict(commit=commit,sha256=sha(raw),bytes=len(raw),archive=str(target))))
        return dict(commit=commit,sha256=sha(raw),bytes=len(raw),archive=str(target),public_files=len(allowlist))


def remote(operation, policy, **kwargs):
    request=dict(operation=operation,policy=policy,**kwargs)
    code=base64.b64encode(CORE.read_bytes()).decode()
    source="import base64,json,sys;exec(compile(base64.b64decode('"+code+"'),'dom-release-core','exec'));print(json.dumps(dispatch(json.load(sys.stdin))))"
    command='python3 -B -c '+shlex.quote(source)
    result=subprocess.run(['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=15',HOST,command],
                          input=canonical(request),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=600)
    ensure(result.returncode==0, 'SSH operation failed or outcome unknown: STOP; inspect status, never automatically replay')
    return json.loads(result.stdout)


def http_verify(manifest, package_sha):
    # GET only. TLS and DNS failures remain failures; no insecure fallback.
    def get(path):
        request=urllib.request.Request(ORIGIN+path,headers={'Cache-Control':'no-cache'})
        try:
            with urllib.request.urlopen(request,timeout=25) as response:return response.status,response.headers,response.read()
        except urllib.error.HTTPError as e:return e.code,e.headers,e.read()
    for path in ['/.envrc','/.htaccess','/.git/config','/api/lead-core.php','/api/lead-smtp.php']:
        ensure(get(path)[0] in [403,404], 'HTTP protected path failure')
    ensure(get('/api/lead.php')[0]==405, 'API GET guard failed')
    code,headers,body=get('/api/form-status.php');status=json.loads(body)
    ensure(code==200 and status.get('enabled') is True and status.get('ready') is True and 'no-store' in headers.get('Cache-Control',''), 'Form readiness failed; inspect status, do not retry deploy')
    for name in manifest['public_allowlist']:
        if name.startswith('.') or name.endswith('.php'):continue
        code,_,body=get('/'+('' if name=='index.html' else name))
        ensure(code==200 and sha(body)==manifest['files']['public/'+name], 'HTTP public SHA mismatch: '+name)
    return dict(status='PASS',package_sha256=package_sha,public_static_files_verified=True,form_status=status,no_post=True)


def http_preflight(snapshot):
    manifest={'public_allowlist':['index.html','script.js'],'files':{'public/'+n:snapshot['public'][n]['sha256'] for n in ['index.html','script.js']}}
    return http_verify(manifest,'baseline')


def load(path):
    return json.loads(Path(path).read_text())


def export_command(policy, release_id, backup_sha, certificate, output, plan, go):
    target=Path(output).resolve();destination=str(target)
    ensure(target.suffix=='.cms' and not target.exists(), 'New .cms destination required')
    cert=Path(certificate).read_bytes()
    check_export_go(plan,go,release_id,backup_sha,cert,destination) # No SSH without a matching separate GO.
    encrypted=remote('export',policy,release_id=release_id,backup_sha256=backup_sha,
                     certificate=base64.b64encode(cert).decode(),destination=destination,plan=plan,go=go)
    raw=base64.b64decode(encrypted.pop('ciphertext'))
    ensure(sha(raw)==encrypted['sha256'] and encrypted['backup_sha256']==backup_sha
           and encrypted['certificate_sha256']==plan['certificate_sha256']
           and encrypted['destination']==destination and encrypted['export_plan_sha256']==plan['sha256'],
           'Encrypted export receipt differs from approved plan')
    fd=os.open(str(target),os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as f:
        f.write(raw);f.flush();os.fsync(f.fileno())
    return dict(encrypted,path=str(target))


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('group',choices=['release','backup'])
    p.add_argument('command')
    p.add_argument('--commit',default='HEAD');p.add_argument('--archive');p.add_argument('--sha')
    p.add_argument('--release-id');p.add_argument('--plan');p.add_argument('--output');p.add_argument('--go')
    p.add_argument('--policy',default=str(ROOT/'ops/release-policy.json'));p.add_argument('--quota-evidence')
    p.add_argument('--dry-run',action='store_true');p.add_argument('--certificate');p.add_argument('--destination')
    a=p.parse_args();policy=load(a.policy)
    ensure(policy['keep_verified']>=2 and policy['protect_days']>=0 and policy['reserve_bytes']>=0,'Unsafe retention policy')
    if a.quota_evidence:policy['quota_evidence']=load(a.quota_evidence)
    if a.group=='release' and a.command=='build':result=build(a.commit,Path(a.output or ROOT/'.release-output/universal'))
    elif a.group=='release' and a.command in ['verify','preflight','plan','apply']:
        ensure(a.archive and a.sha,'--archive and exact --sha required')
        raw=Path(a.archive).read_bytes();manifest,_=verify_package(raw,a.sha)
        # Independently compare package scope to its Git commit's explicit allowlist.
        # Full authority is the clean deterministic rebuild for this exact commit.
        if a.command=='verify':
            with tempfile.TemporaryDirectory() as tmp:
                rebuilt=build(manifest['commit'],Path(tmp));ensure(rebuilt['sha256']==a.sha,'Archive does not match reproducible commit build')
            result=dict(status='PASS',sha256=a.sha,commit=manifest['commit'])
        elif a.command=='preflight':
            result=remote('preflight',policy,manifest=manifest,package_bytes=len(raw));result['http']=http_preflight(result['snapshot'])
        elif a.command=='plan':
            ensure(a.release_id,'--release-id required');result=remote('plan',policy,release_id=a.release_id,manifest=manifest,package_sha256=a.sha,package_bytes=len(raw));http_preflight(result['plan']['snapshot'])
        else:
            ensure(a.plan and a.go,'Review plan and obtain exact owner GO first');plan=load(a.plan)['plan']
            http_preflight(plan['snapshot'])
            result=remote('apply',policy,payload=base64.b64encode(raw).decode(),plan=plan,go=a.go)
            evidence=http_verify(manifest,a.sha)
            result=remote('attest',policy,release_id=plan['release_id'],plan=plan,go=a.go,evidence=evidence)
    elif a.group=='release' and a.command=='finalize':
        ensure(a.plan and a.archive and a.sha and a.go,'--plan --archive --sha --go required')
        plan=load(a.plan)['plan'];manifest,_=verify_package(Path(a.archive).read_bytes(),a.sha)
        ensure(plan['package_sha256']==a.sha,'Wrong package for finalization')
        evidence=http_verify(manifest,a.sha)
        result=remote('attest',policy,release_id=plan['release_id'],plan=plan,go=a.go,evidence=evidence)
    elif a.group=='release' and a.command=='status':result=remote('status',policy,release_id=a.release_id)
    elif a.group=='release' and a.command=='rollback':
        if a.dry_run or not a.go:result=remote('rollback-plan',policy,release_id=a.release_id)
        else:
            ensure(a.plan,'--plan required');result=remote('rollback',policy,plan=load(a.plan)['plan'],go=a.go)
            http_verify({'public_allowlist':sorted(result['restored_public']),'files':{'public/'+n:h for n,h in result['restored_public'].items()}},load(a.plan)['plan']['package_sha256'])
    elif a.group=='backup' and a.command=='list':result=remote('list',policy)
    elif a.group=='backup' and a.command=='verify':result=remote('verify-backup',policy,release_id=a.release_id)
    elif a.group=='backup' and a.command=='prune':
        if a.dry_run or not a.go:result=remote('prune-plan',policy)
        else:
            ensure(a.plan,'--plan required');result=remote('prune',policy,plan=load(a.plan)['plan'],go=a.go)
    elif a.group=='backup' and a.command=='export-plan':
        ensure(a.destination and a.certificate and a.release_id and a.sha,'--destination --certificate --release-id --sha required')
        destination=export_destination(str(Path(a.destination).resolve()));validate_id(a.release_id)
        cert=Path(a.certificate).read_bytes();certificate_sha256(cert) # Never upload a key/bundle as a public certificate.
        result=remote('export-plan',policy,release_id=a.release_id,backup_sha256=a.sha,
                      certificate=base64.b64encode(cert).decode(),destination=destination)
    elif a.group=='backup' and a.command=='export':
        ensure(a.output and a.certificate and a.release_id and a.sha and a.plan and a.go,
               'Export requires --output --certificate --release-id --sha --plan and separate exact --go')
        result=export_command(policy,a.release_id,a.sha,a.certificate,a.output,load(a.plan)['plan'],a.go)
    else:raise RuntimeError('Unknown command')
    if a.output and not (a.group=='release' and a.command=='build') and not a.command=='export':
        Path(a.output).write_bytes(canonical(result))
    print(json.dumps(result,indent=2,sort_keys=True))


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(str(error),file=sys.stderr);sys.exit(1)
