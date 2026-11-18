#!/usr/bin/env python3
"""Build a reproducible private Cron runtime or install the exact approved bundle on Jino."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import sys
import tempfile

DOMAIN = 'zhk-dom-umorya.ru'
HOME = Path('/home/users/j/j84938826')
RUNTIME = 'catalog-sync-v1'
MAX_BUNDLE = 512 * 1024
FILES = (
    'content-model.js', 'data/apartments.json', 'scripts/catalog-cron.sh',
    'scripts/catalog-notify.php', 'scripts/catalog-presentation.mjs', 'scripts/catalog-snapshot.mjs',
    'scripts/catalog_source.py', 'scripts/catalog_sync.py', 'scripts/check_official_prices.py',
    'scripts/realty-schema.mjs',
)

def require(condition, message):
    if not condition:
        raise ValueError(message)

def sha(value):
    return hashlib.sha256(value).hexdigest()

def checksum(value):
    return bool(re.fullmatch(r'[a-f0-9]{64}', value or ''))

def identity(release_id):
    return bool(re.fullmatch(r'[a-z0-9][a-z0-9-]{2,63}', release_id or ''))

def go_line(release_id, website_sha, runtime_sha):
    return 'GO INSTALL AND ACTIVATE '+DOMAIN+' '+release_id+' WEBSITE '+website_sha+' RUNTIME '+runtime_sha

def build(commit, release_id, website_sha, output):
    require(identity(release_id) and checksum(website_sha), 'Expected exact reviewed website release')
    commit = subprocess.check_output(['git','rev-parse',commit+'^{commit}']).decode().strip()
    files = {}
    for name in FILES:
        files[name] = subprocess.check_output(['git','show',commit+':'+name]).decode('utf-8')
    value = dict(schema=1, commit=commit, release_id=release_id, website_sha=website_sha, files=files)
    raw = (json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'))+'\n').encode('utf-8')
    require(len(raw) <= MAX_BUNDLE, 'Runtime bundle exceeds byte limit')
    output.write_bytes(raw)
    output.chmod(0o600)
    return dict(commit=commit, runtime_sha=sha(raw), files=len(files), bytes=len(raw),
                go=go_line(release_id, website_sha, sha(raw)))

def install(raw, runtime_sha, go):
    require(checksum(runtime_sha) and len(raw) <= MAX_BUNDLE and sha(raw) == runtime_sha, 'Runtime SHA mismatch')
    data = json.loads(raw.decode('utf-8'))
    release_id, website_sha = data['release_id'], data['website_sha']
    require(data['schema'] == 1 and identity(release_id) and checksum(website_sha)
            and set(data['files']) == set(FILES), 'Wrong runtime bundle schema')
    require(go == go_line(release_id, website_sha, runtime_sha), 'Exact separate owner GO required')
    private = HOME/'.dom-u-morya'
    manager = private/'manager-v1'
    current = json.loads((manager/'current.json').read_text())
    receipt = json.loads((manager/release_id/'receipt.json').read_text())
    require(current['release_id'] == release_id and current['package_sha256'] == website_sha
            and receipt['phase'] == 'verified' and receipt['package_sha256'] == website_sha, 'Website release is not verified/current')
    require(private.resolve() == private and stat.S_IMODE(private.stat().st_mode) == 0o700
            and private.stat().st_uid == os.getuid(), 'Private account directory required')
    store = private/RUNTIME
    require(not store.exists() and not store.is_symlink(), 'Catalog runtime already exists; inspect it before retrying')
    with tempfile.TemporaryDirectory(prefix='.catalog-install-', dir=str(private)) as temp:
        ready = Path(temp)/RUNTIME
        ready.mkdir(mode=0o700)
        for folder in ('media','snapshots','runtime','runtime/data','runtime/scripts'):
            (ready/folder).mkdir(mode=0o700)
        for name, body in data['files'].items():
            target = ready/'runtime'/name
            target.write_text(body, encoding='utf-8')
            target.chmod(0o600)
        record = ready/'installed.json'
        record.write_text(json.dumps(dict(commit=data['commit'], runtime_sha=runtime_sha, website_sha=website_sha))+'\n')
        record.chmod(0o600)
        ready.rename(store)
    return dict(installed=str(store), runtime_sha=runtime_sha, release_id=release_id,
                cron_command='/bin/sh '+str(store/'runtime/scripts/catalog-cron.sh'), cron_schedule='30 8 * * *')

def install_remote(raw, runtime_sha, go):
    require(checksum(runtime_sha) and sha(raw) == runtime_sha, 'Runtime SHA mismatch')
    data = json.loads(raw.decode('utf-8'))
    require(go == go_line(data['release_id'], data['website_sha'], runtime_sha),
            'Exact separate owner GO required')
    worker = base64.b64encode(Path(__file__).read_bytes()).decode('ascii')
    code = 'import base64;exec(compile(base64.b64decode(%r),"catalog-runtime","exec"))' % worker
    command = ' '.join(shlex.quote(arg) for arg in
                       ('/usr/bin/python3','-B','-c',code,'install','--runtime-sha',runtime_sha,'--go',go))
    result = subprocess.run(['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',
                             '-o','ConnectTimeout=15','rehab-profi-jino',command],
                            input=raw, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
    require(result.returncode == 0, 'SSH installation failed or outcome unknown; inspect installed.json before any retry')
    return json.loads(result.stdout.decode('utf-8'))

def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['build','install','install-remote'])
    parser.add_argument('--commit')
    parser.add_argument('--release-id')
    parser.add_argument('--website-sha')
    parser.add_argument('--runtime-sha')
    parser.add_argument('--go')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--bundle', type=Path)
    args = parser.parse_args()
    if args.command == 'build':
        require(args.commit and args.output, 'Build requires commit and output')
        result = build(args.commit, args.release_id, args.website_sha, args.output)
    elif args.command == 'install-remote':
        require(args.bundle and args.bundle.stat().st_size <= MAX_BUNDLE, 'Expected private bundle')
        result = install_remote(args.bundle.read_bytes(), args.runtime_sha, args.go)
    else:
        result = install(sys.stdin.buffer.read(MAX_BUNDLE+1), args.runtime_sha, args.go)
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
