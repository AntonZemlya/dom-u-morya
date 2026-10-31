"""Offline SMTP-001 update bundle. Never connects to Jino or reads private config."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parent.parent
BASE = 'c1a32fa85c16d9e2c2b40588de8be5daa92d7801'
PUBLIC = ['api/lead-core.php','api/lead-smtp.php','api/lead-catalog.php','api/smtp-manifest.php']
PRIVATE = ['src/Exception.php','src/PHPMailer.php','src/SMTP.php','LICENSE','manifest.json']

def sha(data):
    return hashlib.sha256(data).hexdigest()

def regular(root, name):
    path = root/name
    if not path.is_file() or any(p.is_symlink() for p in [path]+list(path.parents)):
        raise RuntimeError('Only regular files in real directories are permitted')
    return path.read_bytes()

def bundle(root, commit):
    manifest_paths = list((root/'.release-output/smtp-runtime').glob('*/manifest.json'))
    if len(manifest_paths) != 1:
        raise RuntimeError('Exactly one reviewed private runtime is required')
    runtime = manifest_paths[0].parent
    upstream = json.loads(regular(runtime,'manifest.json'))
    if runtime.name != upstream['identity'] or set(upstream['files']) != set(PRIVATE)-{'manifest.json'}:
        raise RuntimeError('Invalid runtime allowlist')
    files = {'public/'+p:regular(root/'dist',p) for p in PUBLIC}
    for p in PRIVATE:
        content = regular(runtime,p)
        if p != 'manifest.json' and sha(content) != upstream['files'][p]:
            raise RuntimeError('Private runtime hash mismatch')
        files['private/smtp-runtime/'+runtime.name+'/'+p] = content
    # Check the upstream identity, not just hashes supplied by the bundle itself.
    locked = json.loads(regular(root,'composer.lock'))
    if (upstream['reference'] != locked['packages'][0]['source']['reference']
            or upstream['identity'] != sha(json.dumps(upstream['files'],separators=(',',':')).encode())):
        raise RuntimeError('Runtime identity differs from Composer lock')
    manifest = {'schema':'SMTP-001/v1','base_commit':BASE,'commit':commit,
                'site_url':'https://zhk-dom-umorya.ru','form_enabled':False,
                'runtime_identity':runtime.name,'composer_lock_sha256':sha(regular(root,'composer.lock')),
                'files':{name:sha(data) for name,data in sorted(files.items())}}
    files['manifest.json'] = (json.dumps(manifest,sort_keys=True,indent=2)+'\n').encode()
    out = io.BytesIO()
    with gzip.GzipFile(fileobj=out,mode='wb',filename='',mtime=0) as gz:
        with tarfile.open(fileobj=gz,mode='w') as tar:
            for name,data in sorted(files.items()):
                member=tarfile.TarInfo(name)
                member.size=len(data);member.mode=0o600 if name.startswith('private/') else 0o644
                member.mtime=0;member.uid=0;member.gid=0
                tar.addfile(member,io.BytesIO(data))
    return out.getvalue(),manifest

def main():
    if subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=ROOT):
        raise RuntimeError('Commit all reviewed sources before packaging')
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    subprocess.run(['git','merge-base','--is-ancestor',BASE,commit],cwd=ROOT,check=True)
    subprocess.run(['node','scripts/smtp-runtime.mjs'],cwd=ROOT,check=True)
    subprocess.run(['npm','run','build'],cwd=ROOT,check=True)
    payload,manifest=bundle(ROOT,commit)
    again,_=bundle(ROOT,commit)
    if payload!=again:
        raise RuntimeError('Non-reproducible bundle')
    output=ROOT/'.release-output/form-002';output.mkdir(parents=True,exist_ok=True)
    target=output/'smtp-update.tar.gz';target.write_bytes(payload);target.chmod(0o600)
    result={'archive':str(target),'sha256':sha(payload),'bytes':len(payload),'commit':commit,
            'base_commit':BASE,'public_files':len(PUBLIC),'private_files':len(PRIVATE),
            'runtime_identity':manifest['runtime_identity'],'form_enabled':False}
    (output/'package.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))

if __name__=='__main__':main()
