"""Domain-scoped release engine, stdlib only, compatible with Jino Python 3.6.
Read methods never mkdir/open for write/lock. Write methods require exact plan GO.
"""
import base64
import contextlib
import datetime
import fcntl
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import tarfile
import time

DOMAIN = 'zhk-dom-umorya.ru'
ORIGIN = 'https://' + DOMAIN
HOME = '/home/users/j/j84938826'
RUNTIME_FILES = ['LICENSE', 'manifest.json', 'src/Exception.php', 'src/PHPMailer.php', 'src/SMTP.php']
TERMINAL = ['verified', 'rolled_back']
MAX_ARCHIVE = 128 * 1024 * 1024
MAX_EXPANDED = 256 * 1024 * 1024
GUARD = b'# END DOM-U-MORYA PERMANENT DOTFILE GUARD v1'
# Exact accepted public policy. Ordinary releases cannot change Apache access rules.
APPROVED_HTACCESS_SHA256 = '652ea884d02b2a73b7fa026823c4732fd1ccccba1ba11e1c43ee8c19be0e3ee5'
RUN_FILES = {'receipt.json','package.tar.gz','manifest.json','plan.json','backup.tar.gz','backup.json'}
BACKED_UP_PHASES = {'backed_up','publishing','awaiting_http_verify','verified',
                    'needs_rollback','rolling_back','rolled_back','recovery_required'}


def ensure(ok, message):
    if not ok:
        raise RuntimeError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True) + '\n').encode()


def digest(value):
    return sha(canonical(value))


def real(path):
    path = Path(path)
    ensure(path.is_absolute() and path.resolve() == path and not path.is_symlink(), 'Symlink or non-canonical path: STOP')
    return path


def safe_name(name):
    ensure(isinstance(name, str) and name and '\\' not in name and '\x00' not in name
           and not name.startswith('/') and str(PurePosixPath(name)) == name
           and all(p not in ['', '.', '..'] for p in name.split('/')), 'Unsafe archive path')
    return name


def regular(path):
    real(path)
    s = path.lstat()
    ensure(stat.S_ISREG(s.st_mode) and s.st_nlink == 1, 'Expected regular single-link file')
    return path.read_bytes()


def meta(path):
    data = regular(path)
    s = path.stat()
    return dict(sha256=sha(data), size=len(data), mode=stat.S_IMODE(s.st_mode),
                uid=s.st_uid, gid=s.st_gid, mtime_ns=s.st_mtime_ns)


def stable_meta(path):
    return {k: v for k, v in meta(path).items() if k != 'mtime_ns'}


def sync_dir(path):
    fd = os.open(str(path), os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


@contextlib.contextmanager
def parent_fd(path):
    # Walk every ancestor with openat/O_NOFOLLOW; a concurrent symlink swap cannot
    # redirect a write into another domain between path validation and replacement.
    path=Path(path)
    ensure(path.is_absolute(), 'Absolute target required')
    fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY)
    try:
        for part in path.parent.parts[1:]:
            child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
            os.close(fd);fd=child
        yield fd
    finally:
        os.close(fd)


def safe_unlink(path):
    with parent_fd(path) as fd:
        s=os.stat(path.name,dir_fd=fd,follow_symlinks=False)
        ensure(stat.S_ISREG(s.st_mode) and s.st_nlink==1,'Unsafe unlink target')
        os.unlink(path.name,dir_fd=fd);os.fsync(fd)


def atomic(path, data, mode=0o600, original=None):
    real(path)
    temporary='.'+path.name+'.manager-'+os.urandom(8).hex()
    with parent_fd(path) as directory_fd:
        try:
            target=os.stat(path.name,dir_fd=directory_fd,follow_symlinks=False)
            ensure(stat.S_ISREG(target.st_mode) and target.st_nlink==1,'Unsafe replacement target')
        except FileNotFoundError:
            pass
        fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode,dir_fd=directory_fd)
        try:
            with os.fdopen(fd,'wb') as target:
                os.fchmod(target.fileno(),mode)
                target.write(data);target.flush();os.fsync(target.fileno())
                if original:
                    os.fchown(target.fileno(),original['uid'],original['gid'])
                    os.utime(target.fileno(),ns=(original['mtime_ns'],original['mtime_ns']))
            os.replace(temporary,path.name,src_dir_fd=directory_fd,dst_dir_fd=directory_fd)
            os.fsync(directory_fd)
        finally:
            try:os.unlink(temporary,dir_fd=directory_fd)
            except FileNotFoundError:pass


def mkdir(path):
    real(path)
    if not path.exists():
        with parent_fd(path) as fd:
            os.mkdir(path.name,mode=0o700,dir_fd=fd);os.fsync(fd)
    ensure(path.is_dir() and stat.S_IMODE(path.stat().st_mode) == 0o700, 'Private directory permissions must be 0700')


def pack(files, modes=None):
    out = io.BytesIO()
    with gzip.GzipFile(fileobj=out, mode='wb', filename='', mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w', format=tarfile.USTAR_FORMAT) as archive:
            for name, data in sorted(files.items()):
                safe_name(name)
                member = tarfile.TarInfo(name); member.size = len(data)
                member.mode = (modes or {}).get(name, 0o600); member.mtime = 0
                archive.addfile(member, io.BytesIO(data))
    return out.getvalue()


def unpack(raw):
    ensure(len(raw) <= MAX_ARCHIVE, 'Archive exceeds size budget')
    files = {}
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
        total = 0
        for member in archive:
            safe_name(member.name)
            ensure(member.isfile() and not member.pax_headers and member.name not in files, 'Unsafe/duplicate archive member')
            total += member.size
            ensure(len(files) < 2000 and 0 <= member.size <= 64*1024*1024 and total <= MAX_EXPANDED, 'Expanded archive exceeds budget')
            files[member.name] = archive.extractfile(member).read()
    return files


def verify_package(raw, expected_sha):
    ensure(re.fullmatch('[a-f0-9]{64}', expected_sha or '') and sha(raw) == expected_sha, 'Package SHA mismatch')
    files = unpack(raw)
    m = json.loads(files.pop('manifest.json'))
    ensure(m['schema'] == 'dom-release/v1' and m['origin'] == ORIGIN, 'Wrong package schema/domain')
    ensure(re.fullmatch('[a-f0-9]{40}', m['commit']) is not None, 'Exact Git commit required')
    names = m['public_allowlist']
    ensure(len(names) == len(set(names)) and names == sorted(names), 'Invalid public allowlist')
    for name in names:
        safe_name(name)
        ensure(not any(p.startswith('.') for p in name.split('/')) or name == '.htaccess', 'Dotfile in package')
        ensure(name != 'manifest.json', 'Reserved name')
    identity = m['runtime_identity']
    ensure(re.fullmatch('[a-f0-9]{64}', identity) is not None, 'Invalid runtime identity')
    expected = set('public/' + n for n in names) | set('private/smtp-runtime/' + identity + '/' + n for n in RUNTIME_FILES)
    ensure(set(files) == set(m['files']) == expected, 'Package allowlist mismatch')
    ensure(all(sha(b) == m['files'][n] for n, b in files.items()), 'Package member SHA mismatch')
    approved_htaccess(files.get('public/.htaccess', b''))
    upstream = json.loads(files['private/smtp-runtime/' + identity + '/manifest.json'])
    ensure(upstream['identity'] == identity and set(upstream['files']) == set(RUNTIME_FILES)-{'manifest.json'}, 'Runtime manifest mismatch')
    ensure(sha(json.dumps(upstream['files'], separators=(',', ':')).encode()) == identity, 'Runtime identity mismatch')
    ensure(all(sha(files['private/smtp-runtime/' + identity + '/' + n]) == h for n, h in upstream['files'].items()), 'Runtime source mismatch')
    return m, files


def approved_htaccess(data):
    ensure(sha(data) == APPROVED_HTACCESS_SHA256,
           'Apache policy differs from the accepted exact revision; separate security scope required')


def certificate_sha256(certificate):
    ensure(isinstance(certificate,bytes) and len(certificate) <= 4096
           and re.fullmatch(rb'\s*-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\s*',certificate),
           'Exactly one public X.509 certificate required')
    result = subprocess.run(['openssl','x509','-inform','PEM','-outform','DER'],
                            input=certificate,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
    ensure(result.returncode == 0 and result.stdout, 'Invalid recipient certificate')
    return sha(result.stdout)


def export_destination(destination):
    ensure(isinstance(destination,str) and destination.startswith('/')
           and not any(c in destination for c in ['\\','\x00','\n','\r'])
           and str(PurePosixPath(destination)) == destination
           and '..' not in PurePosixPath(destination).parts
           and destination.endswith('.cms'), 'Canonical absolute .cms destination required')
    return destination


def export_go(plan):
    return ('GO EXPORT '+DOMAIN+' '+plan['release_id']+' BACKUP '+plan['backup_sha256']
            +' CERT '+plan['certificate_sha256']+' DEST '+sha(plan['destination'].encode())
            +' PLAN '+plan['sha256'])


def check_export_go(plan, go, release_id, backup_sha, certificate, destination):
    # This gate is shared by CLI and worker and runs before opening the backup.
    ensure(isinstance(plan,dict), 'Reviewed export plan required')
    expected_keys={'schema','action','domain','release_id','backup_sha256',
                   'certificate_sha256','destination','sha256'}
    ensure(set(plan)==expected_keys, 'Export plan schema mismatch')
    unsigned=dict(plan); supplied=unsigned.pop('sha256')
    ensure(supplied==digest(unsigned) and plan['schema']=='dom-export/v1'
           and plan['action']=='export' and plan['domain']==DOMAIN, 'Export plan identity mismatch')
    ensure(validate_id(release_id)==plan['release_id']
           and re.fullmatch('[a-f0-9]{64}',backup_sha or '')
           and backup_sha==plan['backup_sha256'], 'Export backup identity mismatch')
    ensure(export_destination(destination)==plan['destination'], 'Export destination differs from approved plan')
    ensure(go==export_go(plan), 'Separate exact owner EXPORT GO required')
    ensure(certificate_sha256(certificate)==plan['certificate_sha256'], 'Export recipient differs from approved plan')


def validate_id(value):
    ensure(re.fullmatch('[a-z0-9][a-z0-9-]{2,63}', value or '') is not None, 'Invalid release ID')
    return value


class Manager:
    def __init__(self, home=HOME, policy=None):
        self.home = real(Path(home))
        self.doc = real(self.home / 'domains' / DOMAIN)
        self.private = real(self.home / '.dom-u-morya')
        self.root = real(self.private / 'manager-v1')
        self.policy = policy
        ensure(isinstance(policy,dict) and policy.get('keep_verified',0)>=2 and policy.get('protect_days',-1)>=0 and policy.get('reserve_bytes',-1)>=0, 'Unsafe policy')

    def runtime(self, identity):
        return real(self.private / 'smtp-runtime' / identity)

    def snapshot(self, identity):
        ensure(self.doc.is_dir() and self.private.is_dir(), 'Existing protected site required')
        ensure(stat.S_IMODE(self.private.stat().st_mode) == 0o700, 'Private root must be 0700')
        public = {}; directories = {}
        for path in sorted(self.doc.rglob('*')):
            real(path)
            name = str(path.relative_to(self.doc))
            if path.is_dir():
                s=path.stat();directories[name] = dict(mode=stat.S_IMODE(s.st_mode), uid=s.st_uid, gid=s.st_gid)
            else:
                public[name] = meta(path)
        ensure(all(n in public for n in ['.envrc', '.htaccess', 'index.html']), 'Protected baseline required')
        approved_htaccess(regular(self.doc / '.htaccess'))
        config = meta(self.private / 'config.php')
        ensure(config['mode'] == 0o600, 'Config must be 0600')
        runtime = {n: meta(self.runtime(identity) / n) for n in RUNTIME_FILES}
        ensure(all(v['mode'] == 0o600 for v in runtime.values()), 'Runtime must be private')
        ensure(all(v['uid'] == os.getuid() for v in list(public.values()) + [config] + list(runtime.values())), 'Foreign file owner: STOP')
        return dict(public=public, directories=directories, config=config, runtime=runtime, runtime_identity=identity)

    def capacity(self, required):
        # Account limit comes from a fresh panel observation, never df's filesystem size.
        p = self.policy
        quota = p.get('quota_evidence', {})
        age = time.time() - quota.get('observed_unix', 0)
        confirmed = 0 <= age <= p['quota_max_age_hours']*3600 and quota.get('source') == 'Jino panel' and quota.get('limit_bytes', 0) > 0
        allocated = 0
        for directory, dirs, files in os.walk(str(self.home), followlinks=False):
            for name in files:
                s = (Path(directory)/name).lstat(); allocated += max(s.st_blocks*512, s.st_size)
        fsfree = shutil.disk_usage(str(self.private)).free
        free = max(0, quota.get('limit_bytes', 0) - max(allocated, quota.get('used_bytes', 0)))
        return dict(quota_confirmed=confirmed, account_used_bytes=allocated, quota_free_bytes=free,
                    filesystem_free_bytes=fsfree, required_bytes=required,
                    ready=confirmed and min(free, fsfree) >= required)

    def run(self, release_id):
        return real(self.root / validate_id(release_id))

    def receipt(self, run):
        return json.loads(regular(run / 'receipt.json'))

    def save(self, run, receipt):
        atomic(run / 'receipt.json', canonical(receipt))

    @contextlib.contextmanager
    def lock(self):
        mkdir(self.root)
        lock = real(self.root / 'lock')
        with parent_fd(lock) as directory_fd:
            fd = os.open(lock.name, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600,dir_fd=directory_fd)
        try:
            ensure(stat.S_IMODE(os.fstat(fd).st_mode) == 0o600 and os.fstat(fd).st_nlink == 1, 'Unsafe lock')
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError('Concurrent manager operation: STOP')
            yield
        finally:
            os.close(fd)

    def preflight(self, manifest, package_bytes=0):
        ensure(manifest['files'].get('public/.htaccess')==APPROVED_HTACCESS_SHA256, 'Package Apache policy changed: STOP')
        identity=manifest['runtime_identity']; snapshot=self.snapshot(identity)
        # SMTP upgrades require a separate config migration; ordinary releases preserve config.
        ensure(snapshot['public']['api/smtp-manifest.php']['sha256'] == manifest['files']['public/api/smtp-manifest.php'], 'SMTP runtime migration requires separate reviewed scope')
        ensure(all(snapshot['runtime'][n]['sha256'] == manifest['files']['private/smtp-runtime/'+identity+'/'+n] for n in RUNTIME_FILES), 'Installed runtime differs from package')
        inventory = self.list_backups()
        ensure(all(r['phase'] in TERMINAL for r in inventory), 'Unfinished release: inspect status; no new deployment')
        needed = sum(v['size'] for v in snapshot['public'].values())*3 + package_bytes*2 + self.policy['reserve_bytes']
        return dict(schema=1, domain=DOMAIN, snapshot=snapshot, snapshot_sha256=digest(snapshot),
                    inventory=inventory, capacity=self.capacity(needed))

    def plan(self, release_id, manifest, package_sha, package_bytes):
        validate_id(release_id)
        ensure(not self.run(release_id).exists(), 'Release ID already reserved; use status, never replay')
        before = self.preflight(manifest, package_bytes)
        current = before['snapshot']['public']; wanted = {n:manifest['files']['public/'+n] for n in manifest['public_allowlist']}
        known = set(wanted)
        if self.root.exists() and (self.root/'current.json').exists():
            pointer=json.loads(regular(self.root/'current.json'))
            previous=json.loads(regular(self.run(pointer['release_id'])/'manifest.json'))
            known.update(previous['public_allowlist'])
        ensure(set(current)-known <= {'.envrc'}, 'Unexpected production paths; explicit adoption required')
        changes=[]
        for name in sorted((set(current)|set(wanted))-{'.envrc'}):
            old=current.get(name); new=wanted.get(name)
            if (old or {}).get('sha256') != new or (new and old and old['mode'] != 0o644):
                changes.append(dict(path=name, action='delete' if new is None else 'add' if old is None else 'replace',
                                    before_sha256=(old or {}).get('sha256'), after_sha256=new))
        plan=dict(schema='dom-plan/v1', action='apply' if changes else 'noop', domain=DOMAIN, release_id=release_id,
                  commit=manifest['commit'], package_sha256=package_sha, package_bytes=package_bytes,
                  snapshot=before['snapshot'], snapshot_sha256=before['snapshot_sha256'], changes=changes,
                  policy_sha256=digest(self.policy), inventory_sha256=digest(before['inventory']))
        plan['sha256']=digest(plan)
        return dict(plan=plan, capacity=before['capacity'], go=self.go(plan) if changes else None)

    def go(self, plan, action=None):
        return 'GO '+(action or plan['action']).upper()+' '+DOMAIN+' '+plan['release_id']+' '+plan['package_sha256']+' PLAN '+plan['sha256']

    def check_plan(self, plan, action, go):
        clone=dict(plan); supplied=clone.pop('sha256')
        ensure(supplied == digest(clone) and plan['domain'] == DOMAIN and plan['action'] == action, 'Plan identity mismatch')
        ensure(plan['policy_sha256'] == digest(self.policy), 'Policy changed: regenerate plan')
        ensure(go == self.go(plan), 'Exact owner GO required')

    def backup(self, run, plan, manifest):
        baseline=plan['snapshot']; files={}; modes={}
        for name, v in baseline['public'].items():
            files['public/'+name]=regular(self.doc/name); modes['public/'+name]=v['mode']
        files['private/config.php']=regular(self.private/'config.php')
        for name in RUNTIME_FILES:
            files['private/smtp-runtime/'+manifest['runtime_identity']+'/'+name]=regular(self.runtime(manifest['runtime_identity'])/name)
        metadata=dict(schema='dom-backup/v1', release_id=plan['release_id'], package_sha256=plan['package_sha256'],
                      baseline=baseline, files={n:sha(b) for n,b in files.items()})
        files['backup-manifest.json']=canonical(metadata)
        raw=pack(files,modes); atomic(run/'backup.tar.gz',raw)
        atomic(run/'backup.json',canonical(dict(sha256=sha(raw), bytes=len(raw))))
        self.verify_backup(run)
        self.rehearse_backup(run)
        ensure(self.snapshot(manifest['runtime_identity']) == baseline, 'Baseline changed while backing up: STOP')
        return sha(raw)

    def verify_backup(self, run):
        metadata=json.loads(regular(run/'backup.json'));raw=regular(run/'backup.tar.gz')
        ensure(sha(raw) == metadata['sha256'] and len(raw) == metadata['bytes'], 'Backup SHA mismatch')
        files=unpack(raw);m=json.loads(files.pop('backup-manifest.json'))
        ensure(m['schema']=='dom-backup/v1' and m['release_id']==run.name, 'Backup identity mismatch')
        plan=json.loads(regular(run/'plan.json'))
        ensure(m['baseline']==plan['snapshot'] and m['package_sha256']==plan['package_sha256'], 'Backup baseline mismatch')
        ensure(set(files)==set(m['files']) and all(sha(b)==m['files'][n] for n,b in files.items()), 'Backup contents mismatch')
        expected={'public/'+n:v['sha256'] for n,v in m['baseline']['public'].items()}
        expected['private/config.php']=m['baseline']['config']['sha256']
        expected.update({'private/smtp-runtime/'+m['baseline']['runtime_identity']+'/'+n:v['sha256'] for n,v in m['baseline']['runtime'].items()})
        ensure(m['files']==expected, 'Backup scope mismatch')
        approved_htaccess(files.get('public/.htaccess',b''))
        with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as archive:
            for member in archive.getmembers():
                old=m['baseline']['public'].get(member.name[7:]) if member.name.startswith('public/') else None
                ensure(member.mode == (old['mode'] if old else 0o600), 'Backup permission mismatch')
        # A real independent unpack/byte/mode rehearsal in the authorized private run directory
        # is not needed here: pure archive verification is read-only; restore tests do it locally.
        return m, files

    def rehearse_backup(self, run):
        # Authorized preparation only. verify/preflight/list remain strictly read-only.
        m, files = self.verify_backup(run)
        rehearsal = run / 'restore-rehearsal'
        ensure(not rehearsal.exists(), 'Restore rehearsal path already exists')
        mkdir(rehearsal)
        try:
            for name, data in files.items():
                path = rehearsal / name
                path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                expected = m['baseline']['public'].get(name[7:]) if name.startswith('public/') else None
                mode = expected['mode'] if expected else 0o600
                atomic(path, data, mode)
                ensure(regular(path) == data and stat.S_IMODE(path.stat().st_mode) == mode, 'Restore rehearsal failed')
        finally:
            shutil.rmtree(str(rehearsal))
        return dict(files=len(files), isolated_rehearsal=True, production_restore=False)

    def export_plan(self, release_id, backup_sha, certificate, destination):
        # Read metadata only. No archive reads or ciphertext without a separate GO.
        validate_id(release_id); export_destination(destination)
        ensure(re.fullmatch('[a-f0-9]{64}',backup_sha or ''), 'Exact backup SHA required')
        fingerprint=certificate_sha256(certificate)
        run=self.run(release_id);metadata=json.loads(regular(run/'backup.json'));receipt=self.receipt(run)
        ensure(metadata['sha256']==backup_sha==receipt.get('backup_sha256')
               and receipt['release_id']==release_id, 'Export backup metadata mismatch')
        plan=dict(schema='dom-export/v1',action='export',domain=DOMAIN,release_id=release_id,
                  backup_sha256=backup_sha,certificate_sha256=fingerprint,destination=destination)
        plan['sha256']=digest(plan)
        return dict(plan=plan,go=export_go(plan))

    def encrypted_backup(self, release_id, backup_sha, certificate, destination, plan, go):
        check_export_go(plan,go,release_id,backup_sha,certificate,destination)
        run=self.run(release_id)
        self.verify_record(run) # Complete inventory + archive checks only AFTER the authorization gate.
        ensure(self.receipt(run)['backup_sha256']==backup_sha, 'Approved export backup changed')
        raw=regular(run/'backup.tar.gz')
        ensure(sha(raw)==backup_sha, 'Approved export backup SHA mismatch')
        read_fd, write_fd = os.pipe()
        try:
            os.write(write_fd, certificate); os.close(write_fd); write_fd = None
            result = subprocess.run(['openssl','cms','-encrypt','-binary','-aes-256-cbc','-outform','DER','/dev/fd/'+str(read_fd)],
                                    input=raw,stdout=subprocess.PIPE,stderr=subprocess.PIPE,pass_fds=(read_fd,),timeout=120)
            ensure(result.returncode == 0 and result.stdout, 'CMS encryption failed; no plaintext fallback')
        finally:
            os.close(read_fd)
            if write_fd is not None: os.close(write_fd)
        ensure(regular(run/'backup.tar.gz') == raw, 'Backup changed during encrypted export')
        return dict(status='EXPORTED_ENCRYPTED',ciphertext=base64.b64encode(result.stdout).decode(),
                    sha256=sha(result.stdout),backup_sha256=backup_sha,restore_verified=False,
                    certificate_sha256=plan['certificate_sha256'],destination=destination,
                    export_plan_sha256=plan['sha256'],go_sha256=sha(go.encode()))

    def protect_unchanged(self, baseline, current):
        ensure(current['config']==baseline['config'] and current['runtime']==baseline['runtime']
               and current['public']['.envrc']==baseline['public']['.envrc'], 'Protected config/runtime/.envrc drift: STOP')

    def publish(self, name, data):
        path=real(self.doc/name)
        parent=path.parent; missing=[]
        while not parent.exists():
            missing.append(parent);parent=parent.parent
        for folder in reversed(missing):
            real(folder)
            with parent_fd(folder) as fd:
                os.mkdir(folder.name,mode=0o755,dir_fd=fd);os.fsync(fd)
        if data is None:
            regular(path);safe_unlink(path)
        else:
            atomic(path,data,0o644)

    def restore(self, run, receipt):
        m,files=self.verify_backup(run);plan=json.loads(regular(run/'plan.json'));baseline=m['baseline']
        current=self.snapshot(baseline['runtime_identity']);self.protect_unchanged(baseline,current)
        expected={n:v['sha256'] for n,v in baseline['public'].items()}
        candidate=json.loads(regular(run/'manifest.json'))
        changed={c['path'] for c in plan['changes']}
        ensure(set(current['public']) <= set(expected)|changed, 'Unexpected public drift blocks rollback')
        for name in set(expected)|set(current['public']):
            if name=='.envrc':continue
            actual=current['public'].get(name);old=baseline['public'].get(name)
            if name in changed:
                ensure((actual or {}).get('sha256') in [(old or {}).get('sha256'),candidate['files'].get('public/'+name)], 'Third-party drift blocks rollback')
            else:
                ensure(actual==old, 'Unscoped drift blocks rollback')
        receipt['phase']='rolling_back';self.save(run,receipt)
        for name in sorted(changed,key=lambda n:(n=='index.html',n)):
            if name in baseline['public']:
                approved_htaccess(files['public/.htaccess'])
                path=real(self.doc/name)
                if not path.parent.exists():path.parent.mkdir(parents=True,mode=0o755)
                atomic(path,files['public/'+name],baseline['public'][name]['mode'],baseline['public'][name])
            elif (self.doc/name).exists():
                real(self.doc/name);regular(self.doc/name);safe_unlink(self.doc/name)
        for name in sorted(current['directories'],key=lambda n:(-n.count('/'),n),reverse=False):
            if name not in baseline['directories']:
                folder=real(self.doc/name);folder.rmdir();sync_dir(folder.parent)
        ensure(self.snapshot(baseline['runtime_identity'])==baseline, 'Rollback verification failed: STOP')
        receipt['phase']='rolled_back';self.save(run,receipt)
        previous=receipt.get('previous_current')
        if previous and not (self.run(previous['release_id'])/'pruned.json').exists():atomic(self.root/'current.json',canonical(previous))
        elif (self.root/'current.json').exists():safe_unlink(self.root/'current.json')
        return dict(phase='rolled_back',release_id=run.name,mutable_state_restored=False,restored_public={n:v['sha256'] for n,v in baseline['public'].items() if n!='.envrc'})

    def apply(self, raw, plan, go):
        self.check_plan(plan,'apply',go)
        manifest,files=verify_package(raw,plan['package_sha256'])
        ensure(manifest['commit']==plan['commit'] and len(raw)==plan['package_bytes'], 'Package changed')
        with self.lock():
            fresh=self.plan(plan['release_id'],manifest,sha(raw),len(raw))
            ensure(fresh['plan']==plan and fresh['capacity']['ready'], 'Drift or insufficient/unconfirmed quota: STOP')
            run=self.run(plan['release_id']);mkdir(run) # ID reservation is durable and never reused.
            atomic(run/'plan.json',canonical(plan));atomic(run/'manifest.json',canonical(manifest));atomic(run/'package.tar.gz',raw)
            r=dict(schema=1, release_id=run.name, package_sha256=sha(raw), phase='reserved',created_unix=int(time.time()),
                   pinned=not (self.root/'current.json').exists(), go_sha256=sha(go.encode()))
            if (self.root/'current.json').exists():r['previous_current']=json.loads(regular(self.root/'current.json'))
            self.save(run,r)
            r['backup_sha256']=self.backup(run,plan,manifest);r['phase']='backed_up';self.save(run,r)
            ensure(self.snapshot(manifest['runtime_identity'])==plan['snapshot'],'Production drift before publication')
            r['phase']='publishing';self.save(run,r)
            try:
                for change in sorted(plan['changes'],key=lambda c:(c['path']!='.htaccess',c['path']=='index.html',c['path'])):
                    path=real(self.doc/change['path'])
                    ensure((meta(path) if path.exists() else None)==plan['snapshot']['public'].get(change['path']), 'Scoped target drift during publication')
                    self.publish(change['path'],files.get('public/'+change['path']))
                after=self.snapshot(manifest['runtime_identity']);self.protect_unchanged(plan['snapshot'],after)
                wanted={n:manifest['files']['public/'+n] for n in manifest['public_allowlist']}
                ensure({n:v['sha256'] for n,v in after['public'].items() if n!='.envrc'}==wanted,'Publication byte verification failed')
                r['after']=after;r['phase']='awaiting_http_verify';self.save(run,r)
                atomic(self.root/'current.json',canonical(dict(release_id=run.name,package_sha256=sha(raw))))
            except Exception:
                r['phase']='needs_rollback';self.save(run,r)
                try:self.restore(run,r)
                except Exception:
                    r['phase']='recovery_required';self.save(run,r)
                raise RuntimeError('Publication failed; inspect status/receipt before any further action')
            return dict(phase=r['phase'],release_id=run.name,backup_sha256=r['backup_sha256'])

    def attest(self, release_id, plan, go, evidence):
        self.check_plan(plan,'apply',go)
        ensure(evidence.get('status')=='PASS' and evidence.get('package_sha256')==plan['package_sha256'], 'Read-only HTTP verification required')
        with self.lock():
            run=self.run(release_id);r=self.receipt(run)
            ensure(r['phase']=='awaiting_http_verify' and self.snapshot(plan['snapshot']['runtime_identity'])==r['after'], 'Attestation drift/phase mismatch')
            r['phase']='verified';r['http']=evidence;self.save(run,r)
        return dict(phase='verified',release_id=release_id)

    def rollback_plan(self, release_id):
        run=self.run(release_id);r=self.receipt(run)
        self.verify_backup(run)
        ensure(r['phase'] in ['verified','awaiting_http_verify','publishing','needs_rollback','recovery_required','rolling_back','backed_up'], 'Rollback phase invalid')
        if (self.root/'current.json').exists():
            current=json.loads(regular(self.root/'current.json'))
            ensure(current['release_id']==release_id or r['phase'] in ['publishing','needs_rollback','recovery_required','rolling_back','backed_up'], 'A later release exists: rollback latest first')
        base=json.loads(regular(run/'plan.json'))
        plan=dict(schema='dom-plan/v1',action='rollback',domain=DOMAIN,release_id=release_id,package_sha256=r['package_sha256'],
                  receipt_sha256=digest(r),snapshot=self.snapshot(base['snapshot']['runtime_identity']),policy_sha256=digest(self.policy))
        plan['sha256']=digest(plan)
        return dict(plan=plan,go=self.go(plan))

    def rollback(self, plan, go):
        self.check_plan(plan,'rollback',go)
        with self.lock():
            ensure(self.rollback_plan(plan['release_id'])['plan']==plan, 'Rollback plan drift')
            run=self.run(plan['release_id']);return self.restore(run,self.receipt(run))

    def status(self, release_id):
        run=self.run(release_id);r=self.receipt(run)
        result={k:r[k] for k in ['schema','release_id','package_sha256','phase','created_unix','backup_sha256'] if k in r}
        if (run/'pruned.json').exists():
            result['phase']='pruned';result['receipt_phase']=r['phase'];return result
        if r['phase']=='verified':self.verify_record(run)
        current=json.loads(regular(self.root/'current.json')) if (self.root/'current.json').exists() else None
        result['is_current']=bool(current and current['release_id']==release_id)
        if result['is_current'] and r['phase'] in ['verified','awaiting_http_verify']:
            try:matches=self.snapshot(r['after']['runtime_identity'])==r['after']
            except Exception:matches=False
            result['current_files_match_receipt']=matches
            if not matches:result['receipt_phase']=r['phase'];result['phase']='drifted'
        return result

    def verify_record(self, run):
        # A terminal/verified label is never sufficient evidence of a restore point.
        real(run);ensure(run.is_dir() and stat.S_IMODE(run.stat().st_mode)==0o700, 'Unsafe run directory')
        present={path.name for path in run.iterdir()}
        ensure(present<=RUN_FILES, 'Unknown run member: STOP')
        for path in run.iterdir():
            ensure(meta(path)['mode']==0o600, 'Run files must be regular private 0600 files')
        ensure({'receipt.json','package.tar.gz','manifest.json','plan.json'}<=present, 'Incomplete release record: STOP')
        receipt=self.receipt(run)
        phase=receipt['phase']
        ensure(receipt['schema']==1 and receipt['release_id']==run.name
               and phase in BACKED_UP_PHASES|{'reserved'}, 'Receipt identity/phase mismatch')
        raw=regular(run/'package.tar.gz');manifest,_=verify_package(raw,receipt['package_sha256'])
        ensure(json.loads(regular(run/'manifest.json'))==manifest, 'Stored manifest differs from package')
        plan=json.loads(regular(run/'plan.json'));unsigned=dict(plan);supplied=unsigned.pop('sha256')
        ensure(supplied==digest(unsigned) and plan['schema']=='dom-plan/v1'
               and plan['action']=='apply' and plan['domain']==DOMAIN
               and plan['release_id']==run.name and plan['package_sha256']==receipt['package_sha256']
               and plan['commit']==manifest['commit'] and plan['package_bytes']==len(raw)
               and plan['snapshot_sha256']==digest(plan['snapshot'])
               and plan['snapshot']['runtime_identity']==manifest['runtime_identity']
               and receipt['go_sha256']==sha(self.go(plan).encode()), 'Receipt/plan/package mismatch')
        if phase in BACKED_UP_PHASES or {'backup.json','backup.tar.gz'} & present:
            ensure(RUN_FILES<=present, 'Incomplete backup record: STOP')
            backup,files=self.verify_backup(run)
            ensure(json.loads(regular(run/'backup.json'))['sha256']==receipt.get('backup_sha256'), 'Receipt backup SHA mismatch')
        else:backup=files=None
        if phase in ['verified','awaiting_http_verify']:
            after=receipt['after'];wanted={n:manifest['files']['public/'+n] for n in manifest['public_allowlist']}
            ensure({n:v['sha256'] for n,v in after['public'].items() if n!='.envrc'}==wanted, 'Receipt after-state differs from manifest')
            ensure(after['runtime_identity']==manifest['runtime_identity'], 'Receipt runtime identity mismatch')
            self.protect_unchanged(plan['snapshot'],after)
        if phase=='verified':
            ensure(receipt['http']['status']=='PASS' and receipt['http']['package_sha256']==receipt['package_sha256'], 'Verified HTTP evidence mismatch')
        return backup,files

    def list_backups(self):
        if not self.root.exists():return []
        real(self.root);rows=[]
        for run in sorted(self.root.iterdir()):
            real(run)
            if run.name in ['lock','current.json']:continue
            ensure(run.is_dir(),'Unknown manager entry: STOP');validate_id(run.name)
            r=self.receipt(run)
            ensure(r['release_id']==run.name,'Receipt identity mismatch')
            if (run/'pruned.json').exists():
                ensure({p.name for p in run.iterdir()}=={'receipt.json','pruned.json'}, 'Pruned tombstone mismatch')
                tombstone=json.loads(regular(run/'pruned.json'))
                ensure(tombstone['package_sha256']==r['package_sha256']
                       and re.fullmatch('[a-f0-9]{64}',tombstone['plan_sha256']), 'Pruned receipt mismatch')
                continue
            backup,_=self.verify_record(run)
            config_fingerprint=None if backup is None else digest(dict(config=backup['baseline']['config']['sha256'],runtime={n:v['sha256'] for n,v in backup['baseline']['runtime'].items()}))
            rows.append(dict(release_id=run.name,path=str(run),bytes=sum(p.stat().st_size for p in run.iterdir()),phase=r['phase'],pinned=r['pinned'],
                             created_unix=r['created_unix'],config_fingerprint=config_fingerprint,inventory_sha256=digest({p.name:meta(p) for p in sorted(run.iterdir())})))
        return rows

    def historical_backups(self):
        # Inventory only. These paths are never accepted by prune/apply/rollback.
        rows=[]
        for folder in ['backups','releases','form-004','security']:
            root=real(self.private/folder)
            if not root.exists():continue
            for path in sorted(root.rglob('*')):
                real(path)
                if path.is_file() and path.name.endswith(('.tar','.tar.gz','.tgz','.zip')):
                    data=regular(path);s=path.stat()
                    rows.append(dict(path=str(path),bytes=len(data),sha256=sha(data),mode=stat.S_IMODE(s.st_mode),
                                     modified_unix=int(s.st_mtime),classification='legacy-preserved',verified_for_manager=False))
        return rows

    def prune_plan(self, now=None):
        now=int(time.time()) if now is None else now;rows=self.list_backups()
        verified=sorted([r for r in rows if r['phase']=='verified'],key=lambda r:(r['created_unix'],r['release_id']),reverse=True)
        keep=set(r['release_id'] for r in verified[:self.policy['keep_verified']])
        if (self.root/'current.json').exists():keep.add(json.loads(regular(self.root/'current.json'))['release_id'])
        config_seen=set()
        for row in verified:
            if row['config_fingerprint'] not in config_seen:
                keep.add(row['release_id']);config_seen.add(row['config_fingerprint'])
        # Pending releases may rely on an earlier point; protect the whole chain conservatively.
        pending=any(r['phase'] not in TERMINAL for r in rows)
        for release_id in list(keep):
            previous=self.receipt(self.run(release_id)).get('previous_current')
            if previous:keep.add(previous['release_id'])
        candidates=[];retained=[]
        for row in rows:
            age=max(0,now-row['created_unix']);reason=[]
            if row['release_id'] in keep:reason.append('latest verified/current')
            if row['pinned']:reason.append('pinned known-good baseline')
            if age<self.policy['protect_days']*86400:reason.append('protective period')
            if pending:reason.append('unfinished release dependency')
            if row['phase']!='verified':reason.append('not a verified alternative')
            if len(verified)<self.policy['keep_verified']+1:reason.append('insufficient verified alternatives')
            row=dict(row,age_days=age//86400,rollback_dependency=bool(reason),verified_alternatives=sorted(keep))
            if reason:retained.append(dict(row,reasons=reason))
            else:candidates.append(dict(row,reason='superseded verified point; protected alternatives available'))
        plan=dict(schema='dom-prune/v1',domain=DOMAIN,policy_sha256=digest(self.policy),inventory_sha256=digest(rows),
                  candidates=candidates,retained=retained,reclaim_bytes=sum(r['bytes'] for r in candidates))
        plan['sha256']=digest(plan)
        return dict(plan=plan,go='GO PRUNE '+DOMAIN+' PLAN '+plan['sha256'])

    def prune(self, plan, go):
        clone=dict(plan);s=clone.pop('sha256')
        ensure(digest(clone)==s and go=='GO PRUNE '+DOMAIN+' PLAN '+s,'Exact prune GO required')
        with self.lock():
            ensure(self.prune_plan()['plan']==plan,'Inventory/policy changed: STOP')
            # Revalidate the entire inventory before the first deletion, then keep replay tombstones.
            for row in plan['candidates']:
                run=self.run(row['release_id']);r=self.receipt(run)
                atomic(run/'pruned.json',canonical(dict(plan_sha256=s,package_sha256=r['package_sha256'])))
                for path in sorted(run.iterdir()):
                    if path.name not in ['receipt.json','pruned.json']:
                        regular(path);safe_unlink(path)
                sync_dir(run)
        return dict(phase='pruned',release_ids=[r['release_id'] for r in plan['candidates']])


def dispatch(request):
    manager=Manager(policy=request['policy']);op=request['operation'];p=request.get('plan')
    if op=='preflight':return manager.preflight(request['manifest'],request['package_bytes'])
    if op=='plan':return manager.plan(request['release_id'],request['manifest'],request['package_sha256'],request['package_bytes'])
    if op=='status':return manager.status(request['release_id'])
    if op=='apply':return manager.apply(base64.b64decode(request['payload']),p,request['go'])
    if op=='attest':return manager.attest(request['release_id'],p,request['go'],request['evidence'])
    if op=='rollback-plan':return manager.rollback_plan(request['release_id'])
    if op=='rollback':return manager.rollback(p,request['go'])
    if op=='list':return dict(managed=manager.list_backups(),legacy=manager.historical_backups())
    if op=='verify-backup':
        run=manager.run(request['release_id']);m,_=manager.verify_record(run)
        ensure(m is not None,'No verified backup available')
        return dict(status='PASS',release_id=run.name,backup_sha256=manager.receipt(run)['backup_sha256'],files=len(m['files']),production_restore_performed=False)
    if op=='export-plan':return manager.export_plan(request['release_id'],request['backup_sha256'],base64.b64decode(request['certificate']),request['destination'])
    if op=='export':return manager.encrypted_backup(request['release_id'],request['backup_sha256'],base64.b64decode(request['certificate']),request['destination'],p,request.get('go'))
    if op=='prune-plan':return manager.prune_plan()
    if op=='prune':return manager.prune(p,request['go'])
    raise RuntimeError('Unknown operation')
