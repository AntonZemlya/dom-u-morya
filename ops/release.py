#!/usr/bin/env python3
"""Deterministic package, private backup, SHA-gated Jino deploy and rollback."""
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
import subprocess
import sys
import tarfile
import urllib.request
from security_http import check_denials, fetch

ROOT=Path(__file__).resolve().parent.parent
REMOTE=Path(__file__).with_name('jino_remote.py')
HOST='rehab-profi-jino'

def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()

def remote(*args, payload=None):
    code=base64.b64encode(REMOTE.read_bytes()).decode()
    command='python3 -c '+shlex.quote("import base64;exec(compile(base64.b64decode('"+code+"'),'jino-domain-release','exec'))")
    command+=' '+' '.join(shlex.quote(a) for a in args)
    result=subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=10',HOST,command],input=payload,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError(result.stderr.decode(errors='replace'))
    return json.loads(result.stdout)

def package():
    if git('status','--porcelain','--untracked-files=all'):
        raise RuntimeError('Commit the reviewed sources before packaging')
    subprocess.run(['npm','run','build'],cwd=ROOT,check=True,env={**os.environ,'SITE_URL':'https://zhk-dom-umorya.ru','BUILD_TARGET':'production'})
    output=subprocess.check_output(['node','--input-type=module','-e',
        "import {validateRelease} from './scripts/build-release.mjs';console.log(JSON.stringify(await validateRelease('dist')));"],cwd=ROOT,text=True)
    validated=json.loads(output)
    files={str(p.relative_to(ROOT/'dist')):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((ROOT/'dist').rglob('*')) if p.is_file()}
    for name in ['index.html','privacy.html','consent-personal-data.html']:
        html=(ROOT/'dist'/name).read_text()
        expected='https://zhk-dom-umorya.ru/'+('' if name=='index.html' else name)
        if 'rel="canonical" href="'+expected+'"' not in html:
            raise RuntimeError('Build with SITE_URL=https://zhk-dom-umorya.ru BUILD_TARGET=production')
    manifest={'schema':1,'commit':git('rev-parse','HEAD'),'site_url':'https://zhk-dom-umorya.ru','release_content_sha256':validated['sha256'],'files':files}
    output=ROOT/'.release-output';output.mkdir(exist_ok=True)
    archive=output/'release.tar.gz'
    with archive.open('wb') as target:
        with gzip.GzipFile(fileobj=target,mode='wb',filename='',mtime=0) as gz:
            with tarfile.open(fileobj=gz,mode='w') as tar:
                members={'manifest.json':json.dumps(manifest,sort_keys=True,indent=2).encode()}
                members.update({'public/'+n:(ROOT/'dist'/n).read_bytes() for n in files})
                for name,data in sorted(members.items()):
                    member=tarfile.TarInfo(name);member.size=len(data);member.mode=0o644;member.mtime=0;member.uid=0;member.gid=0
                    tar.addfile(member,io.BytesIO(data))
    sha=hashlib.sha256(archive.read_bytes()).hexdigest()
    metadata={'archive':str(archive),'sha256':sha,'commit':manifest['commit'],'content_sha256':validated['sha256'],'files':len(files),'bytes':archive.stat().st_size}
    (output/'package.json').write_text(json.dumps(metadata,indent=2)+'\n')
    return metadata

def security_check(with_runtime=False):
    origin='https://zhk-dom-umorya.ru'
    result={'service_files':check_denials(origin),'no_mail_sent':True}
    code,_,_=fetch(origin+'/')
    if code!=200:
        raise RuntimeError('Current site does not return HTTPS 200')
    result['https_status']=code
    if with_runtime:
        identity=secrets.token_hex(12)
        token=secrets.token_hex(32)
        installed=False
        try:
            installed=True # Cleanup also covers an unknown outcome of the SSH install.
            probe=remote('security-probe','install',identity,hashlib.sha256(token.encode()).hexdigest())
            url=origin+'/'+probe['php_path']
            code,_,_=fetch(url)
            if code!=404:
                raise RuntimeError('Unauthenticated temporary PHP probe must return 404')
            code,_,body=fetch(url,headers={'X-Lead-Diagnostic':token})
            runtime=json.loads(body)
            if code!=200 or not 80400<=runtime.get('php_version_id',0)<80500 or not runtime.get('no_mail_sent'):
                raise RuntimeError('Security check did not confirm HTTP PHP 8.4')
            result['runtime']=runtime
            code,_,body=fetch(origin+'/'+probe['acme_path'])
            if code!=200 or body!=('security-acme-'+identity).encode():
                raise RuntimeError('Root ACME challenge exception failed HTTP check: '+str(code))
            result['acme_status']=code
            result['existing_dotfile_probes']=[]
            for path in probe['dotfile_paths']:
                for method in ['GET','HEAD']:
                    code,_,_=fetch(origin+'/'+path,method)
                    if code not in [403,404]:
                        raise RuntimeError('Existing hidden static/PHP probe is accessible: '+str(code))
                    result['existing_dotfile_probes'].append({'extension':Path(path).suffix,'method':method,'status':code})
        finally:
            if installed:
                removed=remote('security-probe','remove',identity)
                if not all(removed.values()):
                    raise RuntimeError('Temporary security probes must be removed immediately')
                result['probes_removed']=True
        result['removed_probe_http']=[]
        for path in [probe['php_path'],probe['acme_path']]:
            code,_,body=fetch(origin+'/'+path+'?removed-check='+secrets.token_hex(8),headers={'Cache-Control':'no-cache'})
            kind='php' if path==probe['php_path'] else 'acme'
            row={'kind':kind,'fresh_status':code,'filesystem_removed':True}
            if code not in [403,404]:
                raise RuntimeError('Removed '+kind+' security probe returned HTTP '+str(code))
            result['removed_probe_http'].append(row)
    return result

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['package','preflight','prepare','deploy','rollback','runtime','probe','cleanup','enable','disable','redirect','protect','security-check'])
    parser.add_argument('--sha')
    parser.add_argument('--go',help='Exact owner-approved package SHA; required to modify the public docroot')
    parser.add_argument('--permit',help='Separate permission: SEND ONE SYNTHETIC <SHA>')
    parser.add_argument('--delivery-confirmed',help='Received synthetic probe ID, confirmed by mailbox owner')
    parser.add_argument('--legal-approved',help='Exact owner-approved legal revision')
    parser.add_argument('--mail-auth',help='Owner-confirmed header results: SPF=pass;DKIM=pass;duplicates=0')
    parser.add_argument('--with-runtime',action='store_true',help='Temporary protected PHP/ACME security probes; never sends mail')
    args=parser.parse_args()
    if (ROOT/'api/lead-smtp.php').exists() and args.command in ['prepare','deploy','probe','enable','package']:
        raise RuntimeError('Legacy FORM-001 rollout does not package the private SMTP runtime or recipient-bound evidence. Use ops/smtp_package.py and ops/SMTP-GO.md; no remote change was made.')
    if args.command=='package':
        result=package()
    elif args.command=='security-check':
        result=security_check(args.with_runtime)
    elif args.command in ['preflight','cleanup','protect']:
        result=remote(args.command)
    else:
        if not args.sha or len(args.sha)!=64 or any(c not in '0123456789abcdef' for c in args.sha):
            raise RuntimeError('--sha must be the complete package SHA-256')
        if args.command=='prepare':
            payload=(ROOT/'.release-output/release.tar.gz').read_bytes()
            if hashlib.sha256(payload).hexdigest()!=args.sha:
                raise RuntimeError('Local package SHA mismatch')
            result=remote('prepare',args.sha,payload=payload)
        elif args.command in ['deploy','runtime','probe','enable','redirect']:
            if args.go!=args.sha:
                raise RuntimeError('Required owner gate: GO PROD '+args.sha)
            if args.command=='deploy':
                result=remote('deploy',args.sha)
            elif args.command=='enable':
                if not args.delivery_confirmed or not args.legal_approved or not args.mail_auth:
                    raise RuntimeError('Enabling needs explicit receipt, mail header and legal approval evidence')
                result=remote('enable',args.sha,args.delivery_confirmed,args.legal_approved,args.mail_auth)
            elif args.command=='redirect':
                result=remote('redirect',args.sha)
            else:
                if args.command=='probe' and args.permit!='SEND ONE SYNTHETIC '+args.sha:
                    raise RuntimeError('Synthetic mail needs a separate explicit owner permission')
                token=secrets.token_hex(32)
                filename='runtime-'+secrets.token_hex(12)+'.php'
                probe_id=secrets.token_hex(12) if args.command=='probe' else ''
                try:
                    remote('diagnostic',args.sha,args.command,filename,hashlib.sha256(token.encode()).hexdigest(),probe_id)
                    request=urllib.request.Request('https://zhk-dom-umorya.ru/api/'+filename,
                        headers={'X-Lead-Diagnostic':token},method='POST' if args.command=='probe' else 'GET',
                        data=b'' if args.command=='probe' else None)
                    with urllib.request.urlopen(request,timeout=20) as response:
                        result=json.load(response)
                    if args.command=='runtime' and not 80400<=result.get('php_version_id',0)<80500:
                        raise RuntimeError('HTTP runtime is not PHP 8.4; keep form disabled')
                    if args.command=='runtime':
                        if result.get('forwarded_protocol')!='https':
                            raise RuntimeError('Jino HTTPS proxy header differs from documented mechanism')
                        spoof=urllib.request.Request(request.full_url,headers={'X-Lead-Diagnostic':token,'X-Forwarded-Protocol':'http'})
                        with urllib.request.urlopen(spoof,timeout=20) as response:
                            verified=json.load(response)
                        if verified.get('forwarded_protocol')!='https':
                            raise RuntimeError('Proxy protocol header can be spoofed; do not activate rewrite')
                        remote('attest-runtime',args.sha,str(result['php_version_id']),'https')
                finally:
                    removed=remote('diagnostic',args.sha,'remove',filename)
                    if not removed.get('removed'):
                        raise RuntimeError('Diagnostic cleanup must be completed immediately')
        elif args.command=='rollback':
            result=remote('rollback',args.sha)
        elif args.command=='disable':
            result=remote('disable',args.sha)
    print(json.dumps(result,indent=2,ensure_ascii=False))

if __name__=='__main__':
    raise SystemExit('Archived rollout CLI; use ops/release_manager.py and ops/RELEASE-RUNBOOK.md. No remote operation performed.')
    try:
        main()
    except Exception as error:
        print(str(error),file=sys.stderr)
        sys.exit(1)
