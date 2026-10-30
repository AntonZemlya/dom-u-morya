"""Domain-scoped release operations; invoked by release.py through SSH stdin."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import stat
import sys
import tarfile
from datetime import datetime, timezone

HOME = Path('/home/users/j/j84938826')
DOC = HOME / 'domains/zhk-dom-umorya.ru'
PRIVATE = HOME / '.dom-u-morya'

def ensure(condition, message):
    if not condition:
        raise RuntimeError(message)

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def unlink(path):
    # Jino's system Python is 3.6; do not rely on pathlib's newer missing_ok.
    try:
        path.unlink()
    except FileNotFoundError:
        pass

def inventory():
    ensure(DOC.is_dir() and not DOC.is_symlink() and DOC.resolve() == DOC, 'Unexpected document root')
    result = {}
    for path in sorted(DOC.rglob('*')):
        ensure(not path.is_symlink(), 'Unexpected symlink in document root')
        if path.is_file():
            s = path.stat()
            result[str(path.relative_to(DOC))] = {'sha256':digest(path),'mode':stat.S_IMODE(s.st_mode),'uid':s.st_uid,'gid':s.st_gid,'bytes':s.st_size}
        else:
            ensure(path.is_dir(), 'Unexpected special file')
    ensure('.envrc' in result and 'index.html' in result, 'Jino managed file or current index missing')
    return result

def private():
    ensure(not PRIVATE.is_symlink(), 'Unsafe private directory')
    PRIVATE.mkdir(mode=0o700, exist_ok=True)
    ensure(PRIVATE.resolve() == PRIVATE and stat.S_IMODE(PRIVATE.stat().st_mode) == 0o700, 'Private directory must be 0700')
    for name in ['releases','backups','state']:
        p = PRIVATE / name
        ensure(not p.is_symlink(), 'Unsafe private subdirectory')
        p.mkdir(mode=0o700, exist_ok=True)
        ensure(stat.S_IMODE(p.stat().st_mode) == 0o700, 'Private subdirectory must be 0700')

def release(sha):
    ensure(re.fullmatch('[a-f0-9]{64}', sha), 'Invalid package SHA')
    return PRIVATE / 'releases' / sha

def safe_name(name):
    p = Path(name)
    ensure(not p.is_absolute() and '..' not in p.parts and name == p.as_posix(), 'Unsafe release member')
    ensure(name=='.htaccess' or all(not part.startswith('.') for part in p.parts), 'Hidden files are forbidden')
    ensure(name in ['.htaccess','index.html','privacy.html','consent-personal-data.html','styles.css','script.js','content-model.js','favicon.png','robots.txt','sitemap.xml']
           or (len(p.parts) > 1 and p.parts[0] in ['api','assets','data']), 'Unapproved public path')
    if p.parts[0] == 'api':
        ensure(name in ['api/lead.php','api/lead-core.php','api/form-status.php'], 'Unapproved endpoint')

def unpack(folder):
    package = folder / 'package.tar.gz'
    ensure(digest(package) == folder.name, 'Package SHA mismatch on Jino')
    with tarfile.open(package, 'r:gz') as archive:
        members = archive.getmembers()
        ensure(len({m.name for m in members}) == len(members), 'Duplicate archive member')
        ensure(all(m.isfile() for m in members), 'Only regular archive files are permitted')
        manifest_member = archive.getmember('manifest.json')
        manifest = json.load(archive.extractfile(manifest_member))
        ensure(manifest['site_url'] == 'https://zhk-dom-umorya.ru', 'Wrong production origin')
        expected = {'public/'+name for name in manifest['files']} | {'manifest.json'}
        ensure({m.name for m in members} == expected, 'Manifest file set mismatch')
        files = {}
        for name, sha in manifest['files'].items():
            safe_name(name)
            content = archive.extractfile('public/'+name).read()
            ensure(hashlib.sha256(content).hexdigest() == sha, 'Public member SHA mismatch')
            files[name] = content
        return manifest, files

def atomic(path, data, mode=0o644):
    ensure(not path.is_symlink(), 'Refusing to replace symlink')
    parent = path.parent
    try:
        relative = parent.relative_to(DOC)
    except ValueError:
        relative = None
    if relative is not None:
        current = DOC
        for part in relative.parts:
            current = current / part
            ensure(not current.is_symlink(), 'Unsafe destination directory')
            current.mkdir(mode=0o755, exist_ok=True)
    tmp = path.with_name('.'+path.name+'.release-'+secrets.token_hex(6))
    try:
        with tmp.open('xb') as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        tmp.chmod(mode)
        os.replace(tmp, path)
    finally:
        unlink(tmp)

def prepare(sha):
    before = inventory()
    ensure(set(before) == {'.envrc','index.html'}, 'Initial rollout requires exactly the reviewed placeholder and .envrc')
    private()
    folder = release(sha)
    ensure(not folder.exists(), 'Package already prepared; inspect the existing prepare result')
    folder.mkdir(mode=0o700)
    payload = sys.stdin.buffer.read(100*1024*1024+1)
    ensure(len(payload) <= 100*1024*1024, 'Package too large')
    atomic(folder/'package.tar.gz', payload, 0o600)
    manifest, files = unpack(folder)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup = PRIVATE/'backups'/(stamp+'-'+sha[:12])
    backup.mkdir(mode=0o700)
    with tarfile.open(backup/'docroot.tar.gz','w:gz') as archive:
        # Full backup preserves Jino .envrc, owner IDs, modes and the previous index.
        archive.add(DOC,arcname='docroot',recursive=True)
    (backup/'docroot.tar.gz').chmod(0o600)
    atomic(backup/'manifest.json',json.dumps(before,sort_keys=True,indent=2).encode(),0o600)
    ensure(inventory() == before, 'Document root changed during backup')
    record = {'sha256':sha,'commit':manifest['commit'],'backup':str(backup),'backup_sha256':digest(backup/'docroot.tar.gz'),
              'before':before,'prepared_at':stamp,'deployed':False,'files':len(files)}
    atomic(folder/'record.json',json.dumps(record,sort_keys=True,indent=2).encode(),0o600)
    return {k:v for k,v in record.items() if k != 'before'}

def load_record(sha):
    folder=release(sha)
    ensure(folder.is_dir() and not folder.is_symlink(), 'Release is not prepared')
    record=json.loads((folder/'record.json').read_text())
    ensure(record['sha256']==sha, 'Release identity mismatch')
    return folder,record

def set_form(sha, active, probe_id='', legal_version='', auth=''):
    folder,record=load_record(sha)
    config=PRIVATE/'config.php'
    ensure(config.is_file() and not config.is_symlink(), 'Private config missing or unsafe')
    if active:
        ensure(record['deployed'] and 80400 <= record.get('http_php_version_id',0) < 80500 and not record.get('redirect_pending',True), 'Verify HTTP PHP 8.4 and activate the reviewed redirect before enabling')
        ensure(legal_version=='2026-10-30', 'Exact legal text must be approved by owner')
        ensure(auth=='SPF=pass;DKIM=pass;duplicates=0', 'Confirm received mail, SPF/DKIM and no duplicates')
        probe=json.loads((PRIVATE/('probe-'+sha+'.json')).read_text())
        ensure(probe['status']=='accepted' and probe['id']==probe_id, 'Owner confirmation must match the one synthetic probe')
    source=config.read_text()
    flags={'FORM_ENABLED':'true' if active else 'false'}
    if active:
        flags.update({'DELIVERY_VERIFIED':'true','LEGAL_APPROVED':"'2026-10-30'"})
    for key,value in flags.items():
        pattern=r"('"+key+r"'\s*=>\s*)(?:true|false|'[^']*')"
        source,count=re.subn(pattern,lambda m:m.group(1)+value,source)
        ensure(count==1, 'Unexpected private config shape')
    atomic(config,source.encode(),0o600)
    record['form_enabled']=active
    if active:
        record.update({'delivery_probe_id':probe_id,'mail_auth':auth,'legal_approved':legal_version})
    atomic(folder/'record.json',json.dumps(record,indent=2).encode(),0o600)
    return {'form_enabled':active,'sha256':sha}

def rollback(sha):
    folder,record=load_record(sha)
    manifest,files=unpack(folder)
    backup=Path(record['backup'])
    ensure(backup.parent == PRIVATE/'backups' and digest(backup/'docroot.tar.gz') == record['backup_sha256'], 'Backup SHA mismatch')
    ensure(digest(DOC/'.envrc') == record['before']['.envrc']['sha256'], 'Managed .envrc changed; preserve and inspect manually')
    if (PRIVATE/'config.php').is_file():
        set_form(sha,False)
    # Remove only paths in this exact reviewed release; no recursive root deletion.
    with tarfile.open(backup/'docroot.tar.gz','r:gz') as archive:
        for name,metadata in record['before'].items():
            if name == '.envrc':
                continue
            atomic(DOC/name,archive.extractfile('docroot/'+name).read(),metadata['mode'])
            os.chown(DOC/name,metadata['uid'],metadata['gid'])
            os.chmod(DOC/name,metadata['mode'])
    for name in sorted(files,reverse=True):
        if name not in record['before']:
            target=DOC/name
            ensure(not target.is_symlink(), 'Unsafe rollback path')
            unlink(target)
    for directory in sorted([p for p in DOC.rglob('*') if p.is_dir()],key=lambda p:len(p.parts),reverse=True):
        try:
            directory.rmdir()
        except OSError:
            pass
    ensure(inventory() == record['before'], 'Rollback inventory differs from backup')
    record['deployed']=False
    record['form_enabled']=False
    record['rolled_back_at']=datetime.now(timezone.utc).isoformat()
    atomic(folder/'record.json',json.dumps(record,indent=2).encode(),0o600)
    return {'rolled_back':True,'backup':str(backup),'envrc_preserved':True}

def deploy(sha):
    folder,record=load_record(sha)
    manifest,files=unpack(folder)
    ensure(not record['deployed'], 'This release is already deployed')
    ensure(inventory() == record['before'], 'Document root differs from reviewed backup; redo preflight')
    config=PRIVATE/'config.php'
    ensure(not config.exists(), 'Private config already exists; inspect before this initial rollout')
    atomic(config,("<?php return ['FORM_ENABLED'=>false,'DELIVERY_VERIFIED'=>false,'LEGAL_APPROVED'=>'','HMAC_SECRET'=>'"+secrets.token_hex(32)+"','STATE_DIR'=>__DIR__.'/state'];\n").encode(),0o600)
    try:
        # Assets/API/legal documents first; index is the final publication switch.
        for name in sorted((name for name in files if name!='.htaccess'),key=lambda name:(name=='index.html',name)):
            atomic(DOC/name,files[name])
        ensure(all(digest(DOC/name)==expected for name,expected in manifest['files'].items() if name!='.htaccess'), 'Deployed file hash mismatch')
        ensure(digest(DOC/'.envrc')==record['before']['.envrc']['sha256'], 'Managed .envrc changed')
        record['deployed']=True
        record['redirect_pending']='.htaccess' in files
        record['deployed_at']=datetime.now(timezone.utc).isoformat()
        atomic(folder/'record.json',json.dumps(record,indent=2).encode(),0o600)
    except BaseException:
        rollback(sha)
        raise
    return {'deployed':True,'sha256':sha,'commit':manifest['commit'],'files':len(files),'form_enabled':False,'redirect_pending':record['redirect_pending'],'backup':record['backup']}

def redirect(sha):
    folder,record=load_record(sha)
    ensure(record['deployed'] and record.get('proxy_protocol_verified'), 'Verify Jino proxy header over HTTP diagnostic before redirect activation')
    manifest,files=unpack(folder)
    ensure('.htaccess' in files,'No reviewed redirect in package')
    atomic(DOC/'.htaccess',files['.htaccess'])
    ensure(all(digest(DOC/name)==expected for name,expected in manifest['files'].items()),'Final deployed manifest mismatch')
    record['redirect_pending']=False
    atomic(folder/'record.json',json.dumps(record,indent=2).encode(),0o600)
    return {'redirect_rule_installed':True,'panel_https_toggle_still_unchanged':True,'sha256':sha}

def diagnostic(sha, action, filename, token_hash='', probe_id=''):
    folder,record=load_record(sha)
    ensure(record['deployed'], 'Diagnostics require a deployed GO-approved release')
    ensure(re.fullmatch(r'runtime-[a-f0-9]{24}\.php', filename), 'Invalid diagnostic filename')
    path=DOC/'api'/filename
    if action == 'remove':
        unlink(path)
        return {'removed':not path.exists()}
    ensure(re.fullmatch('[a-f0-9]{64}',token_hash), 'Invalid token digest')
    ensure(not path.exists(), 'Diagnostic already exists')
    expiry=int(datetime.now(timezone.utc).timestamp())+120
    source="""<?php
ini_set('display_errors','0'); ini_set('log_errors','0');
header('Cache-Control: no-store'); header('X-Robots-Tag: noindex');
if(time()>EXPIRY || !hash_equals('TOKENHASH',hash('sha256',$_SERVER['HTTP_X_LEAD_DIAGNOSTIC']??''))){http_response_code(404);exit;}
header('Content-Type: application/json');
""".replace('EXPIRY',str(expiry)).replace('TOKENHASH',token_hash)
    if action == 'runtime':
        source += "echo json_encode(['php_version'=>PHP_VERSION,'php_version_id'=>PHP_VERSION_ID,'mail_available'=>function_exists('mail'),'forwarded_protocol'=>in_array($_SERVER['HTTP_X_FORWARDED_PROTOCOL']??'',['http','https'],true)?$_SERVER['HTTP_X_FORWARDED_PROTOCOL']:'other']);"
    elif action == 'probe':
        ensure(re.fullmatch('[a-f0-9]{24}',probe_id), 'Invalid probe ID')
        source += """
if($_SERVER['REQUEST_METHOD']!=='POST' || PHP_VERSION_ID<80400 || PHP_VERSION_ID>=80500){http_response_code(409);exit;}
$marker=fopen('/home/users/j/j84938826/.dom-u-morya/probe-SHA.json','x');
if(!$marker){http_response_code(409);exit;}
chmod('/home/users/j/j84938826/.dom-u-morya/probe-SHA.json',0600);
fwrite($marker,json_encode(['id'=>'PROBEID','status'=>'pending','time'=>gmdate('c')]));fclose($marker);
require __DIR__.'/lead-core.php';
$ok=DomLead\\mailTransport(['subject'=>'=?UTF-8?B?'.base64_encode('Дом у моря — синтетический тест').'?=','body'=>'Synthetic delivery test. No visitor data. Release SHA. Probe PROBEID.','id'=>'PROBEID']);
file_put_contents('/home/users/j/j84938826/.dom-u-morya/probe-SHA.json',json_encode(['id'=>'PROBEID','status'=>$ok?'accepted':'failed','time'=>gmdate('c')]));
echo json_encode(['accepted'=>$ok,'probe_id'=>'PROBEID','delivery_confirmed'=>false]);
""".replace('SHA',sha).replace('PROBEID',probe_id)
    else:
        raise RuntimeError('Invalid diagnostic action')
    atomic(path,source.encode())
    return {'installed':filename,'expires_in_seconds':120}

def cleanup():
    path=PRIVATE/'state/state.json'
    if not path.exists():
        return {'cleaned':0}
    import fcntl
    ensure(not path.is_symlink(),'Unsafe state file')
    with path.open('r+') as f:
        fcntl.flock(f,fcntl.LOCK_EX)
        s=json.load(f)
        now=int(datetime.now(timezone.utc).timestamp())
        before=len(s['items'])+len(s['rates'])
        s['items']={k:v for k,v in s['items'].items() if v['expires']>now}
        s['rates']={k:v for k,v in s['rates'].items() if v['until']>now}
        f.seek(0);f.truncate();json.dump(s,f);f.flush();os.fsync(f.fileno())
        return {'cleaned':before-len(s['items'])-len(s['rates'])}

def main():
    operation=sys.argv[1]
    if operation=='preflight':
        result={'docroot':str(DOC),'inventory':inventory(),'private_exists':PRIVATE.exists(),'free_bytes':shutil.disk_usage(DOC).free}
    elif operation=='prepare':
        result=prepare(sys.argv[2])
    elif operation=='deploy':
        result=deploy(sys.argv[2])
    elif operation=='rollback':
        result=rollback(sys.argv[2])
    elif operation=='diagnostic':
        result=diagnostic(*sys.argv[2:])
    elif operation=='cleanup':
        result=cleanup()
    elif operation=='attest-runtime':
        folder,record=load_record(sys.argv[2])
        version=int(sys.argv[3])
        ensure(record['deployed'] and 80400<=version<80500 and sys.argv[4]=='https', 'Invalid HTTP runtime/proxy attestation')
        record['http_php_version_id']=version
        record['proxy_protocol_verified']=True
        atomic(folder/'record.json',json.dumps(record,indent=2).encode(),0o600)
        result={'http_php_84_verified':True}
    elif operation=='enable':
        result=set_form(sys.argv[2],True,*sys.argv[3:])
    elif operation=='disable':
        result=set_form(sys.argv[2],False)
    elif operation=='redirect':
        result=redirect(sys.argv[2])
    else:
        raise RuntimeError('Unknown domain operation')
    print(json.dumps(result,sort_keys=True))

if __name__=='__main__':
    try:
        main()
    except Exception as e:
        print('Domain release stopped: '+str(e),file=sys.stderr)
        sys.exit(1)
