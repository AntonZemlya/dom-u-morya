#!/usr/bin/env python3
"""Universal domain-scoped release CLI. No SMTP client, no valid POST, no implicit GO."""
import argparse
import base64
import json
import os
import re
from pathlib import Path
import shlex
import subprocess
import sys
import tarfile
import tempfile
import time
from urllib.parse import quote
from release_core import (DOMAIN, ORIGIN, RUNTIME_FILES, check_plan, canonical, digest,
                          ensure, pack, regular, sha, verify_package, check_export_go, export_destination, certificate_sha256, validate_id,
                          APPROVED_HTACCESS_SHA256, CATALOG_HTACCESS_SHA256, HTTP_CRITICAL_FILES,
                          http_files, http_profile, ui_path)
from release_http import ConnectionFailure, HTTPClient, TransportFailure
import url_matrix

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
    source = ("import base64,json,sys\nexec(compile(base64.b64decode('" + code +
              "'),'dom-release-core','exec'))\nrequest=json.load(sys.stdin)\n"
              "try: result=dispatch(request)\n"
              "except RuntimeError as error:\n"
              " if request['operation'] not in ('http-state','http-checkpoint','attest'): raise\n"
              " result={'http_operation_error':str(error)}\nprint(json.dumps(result))")
    command='python3 -B -c '+shlex.quote(source)
    result=subprocess.run(['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=15',HOST,command],
                          input=canonical(request),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=600)
    ensure(result.returncode==0, 'SSH operation failed or outcome unknown: STOP; inspect status, never automatically replay')
    response = json.loads(result.stdout)
    if isinstance(response, dict) and 'http_operation_error' in response:
        raise RuntimeError(response['http_operation_error'])
    return response


def verify_catalog_page(body, headers, template_sha):
    ensure(headers.get('X-Dom-Catalog-Template') == template_sha and 'no-store' in headers.get('Cache-Control', ''),
           'Catalog route does not match the verified release template or cache policy')
    version = headers.get('X-Dom-Catalog-Snapshot', '')
    status = headers.get('X-Dom-Catalog-Status', '')
    if version == 'bundled':
        ensure(sha(body) == template_sha and status == 'confirmed', 'Bundled catalog differs from package')
        return
    ensure(re.fullmatch('[a-f0-9]{64}', version) and status in ('confirmed', 'unconfirmed'),
           'Catalog snapshot identity missing')
    payload = re.search(rb'<script id="site-data" type="application/json">(.*?)</script>', body, re.S)
    structured = re.search(rb'<script type="application/ld\+json">(.*?)</script>', body, re.S)
    ensure(payload and structured, 'Catalog response did not include the HTML payload and structured data')
    page_data = json.loads(payload[1])
    lots = page_data['apartments']
    cards = re.findall(rb'<article\b[^>]*data-lot-id="([0-9]+)"', body)
    ids = {lot['id'] for lot in lots}
    ensure(page_data['catalog_version'] == version and page_data['catalog_status'] == status and 0 < len(ids) == len(lots) == len(cards)
           and ids == {card.decode() for card in cards}, 'Catalog page does not match its active snapshot')
    graph = json.loads(structured[1])['@graph']
    offers = next(node['offers'] for node in graph if 'offers' in node)
    expected = {lot['id']: lot['price_rub'] for lot in lots if lot['developer_availability'] == 'InStock'}
    actual = {offer['@id'].rsplit('-', 1)[-1]: offer['price'] for offer in offers}
    ensure(len(actual) == len(offers) and actual == expected and (status != 'unconfirmed' or not actual),
           'Catalog availability or prices differ between HTML and SEO')


def verification_profile(plan, manifest):
    scope = plan.get('http_verification', {})
    if http_profile(plan) != 'compact':
        reason = 'publication_scope' if scope.get('profile') == 'compact' else scope.get('reason', 'legacy_plan')
        return 'full', reason
    base = scope['baseline']['commit']
    try:
        subprocess.run(['git', 'merge-base', '--is-ancestor', base, manifest['commit']],
                       cwd=ROOT, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
        changed = subprocess.check_output(['git', 'diff', '--name-only', '--no-renames', '-z', base,
                                           manifest['commit'], '--'], cwd=ROOT, stderr=subprocess.DEVNULL,
                                          timeout=10).decode().split('\0')
    except (OSError, UnicodeError, subprocess.SubprocessError):
        return 'full', 'source_history_unavailable'
    # The publication allowlist is already checked against the exact deployed diff.
    ui_sources = {'data/news.json', 'data/media.json', 'data/media-provenance.json', 'data/performance-assets.json',
                  'scripts/content-files.mjs', 'scripts/release-files.mjs', 'templates/footer.html'}
    if any(not ui_path(name) and name not in ui_sources and not name.startswith('tests/')
           for name in changed if name):
        return 'full', 'source_scope'
    return 'compact', 'verified_ui_scope'


class HTTPVerificationError(RuntimeError):
    def __init__(self, cause, report, checked_files):
        self.report = report
        self.checked_files = checked_files
        self.transport_failure = isinstance(cause, TransportFailure)
        kind = 'transport' if self.transport_failure else getattr(cause, 'kind', 'contract')
        report.update(status='STOP', failure_kind=kind, error=str(cause))
        super().__init__('HTTP verification STOP: ' + json.dumps(report, sort_keys=True))


def http_verify(manifest, package_sha, *, plan=None, state=None, client=None):
    plan, state = plan or {}, state or {}
    preflight = package_sha == 'baseline'
    profile, reason = ('preflight', 'current_site') if preflight else verification_profile(plan, manifest)
    client = client or HTTPClient(profile)
    expected_files = http_files(manifest, plan, profile)
    resumed = set(expected_files) & set(state.get('checked_files', []))
    verified = set(resumed)
    fresh = set()
    redirects = None
    matrix_cases = 0
    policy = manifest['files'].get('public/.htaccess')
    approved_policy = policy in (APPROVED_HTACCESS_SHA256, CATALOG_HTACCESS_SHA256)
    baseline = plan['http_verification']['baseline'] if profile == 'compact' else None

    def report():
        return dict(profile=profile, profile_reason=reason, baseline=baseline, package_sha256=package_sha,
                    plan_sha256=plan.get('sha256'), snapshot_sha256=state.get('snapshot_sha256'),
                    verified_files=len(verified), freshly_verified_files=len(fresh), resumed_files=len(resumed),
                    files_covered_by_baseline=len(http_files(manifest, plan, 'full')) - len(expected_files),
                    verified_route_cases=matrix_cases, redirect_matrix=redirects,
                    duration_seconds=round(time.monotonic() - client.started, 3), no_post=True,
                    release_phase=state.get('phase'), **client.statistics)

    def record_case():
        nonlocal matrix_cases
        matrix_cases += 1

    def get(path, expected=(200,), body_limit=None):
        return client.fetch(ORIGIN + path, expected=expected, body_limit=body_limit)

    try:
        with client.deadline():
            if preflight or not approved_policy:
                for path in ['/.envrc', '/.htaccess', '/.git/config', '/api/lead-core.php', '/api/lead-smtp.php']:
                    get(path, (403, 404))
                get('/api/lead.php', (405,))
            if policy == CATALOG_HTACCESS_SHA256:
                for path in ['/api/catalog-view.php', '/api/catalog-plan.php']:
                    get(path, (403, 404))
            _, headers, body = get('/api/form-status.php', body_limit=16385)
            ensure(len(body) <= 16384, 'Unexpected form readiness response size')
            status = json.loads(body)
            ensure(status.get('enabled') is True and status.get('ready') is True
                   and 'no-store' in headers.get('Cache-Control', ''), 'Form readiness failed')

            paths = [n for n in HTTP_CRITICAL_FILES if n in expected_files]
            paths += sorted(set(expected_files) - set(paths) - resumed)
            for name in paths:
                _, headers, body = get('/' + ('' if name == 'index.html' else quote(name)), body_limit=-1)
                target_sha = manifest['files']['public/' + name]
                if name == 'index.html' and policy == CATALOG_HTACCESS_SHA256:
                    verify_catalog_page(body, headers, target_sha)
                else:
                    ensure(sha(body) == target_sha, 'HTTP public SHA mismatch: ' + name)
                fresh.add(name)
                verified.add(name)
            if approved_policy and not preflight:
                matrix = url_matrix.check(client=client, compact=profile == 'compact', fail_fast=True,
                                          case_passed=record_case)
                ensure(matrix['status'] == 'PASS', 'URL redirect matrix failed')
                redirects = dict(status='PASS', cases=matrix_cases, evidence_sha256=digest(matrix))
    except (RuntimeError, ValueError, KeyError, StopIteration, AttributeError) as error:
        raise HTTPVerificationError(error, report(), sorted(fresh - set(HTTP_CRITICAL_FILES))) from None
    return dict(status='PASS', public_static_files_verified=True, form_status={'enabled': True, 'ready': True},
                **report())


def http_preflight(snapshot):
    manifest = {'public_allowlist': ['index.html', 'script.js'],
                'files': {'public/' + n: snapshot['public'][n]['sha256'] for n in ['index.html', 'script.js', '.htaccess']
                          if n in snapshot['public']}}
    return http_verify(manifest, 'baseline')


def finish_release_http(policy, manifest, plan, go, output=None):
    state = remote('http-state', policy, plan=plan, go=go)
    try:
        evidence = http_verify(manifest, plan['package_sha256'], plan=plan, state=state)
    except HTTPVerificationError as error:
        if error.transport_failure and error.checked_files:
            try:
                remote('http-checkpoint', policy, plan=plan, go=go, state=state, files=error.checked_files)
                error.report['checkpoint_files_saved'] = len(error.checked_files)
            except RuntimeError as checkpoint_error:
                error.report['checkpoint_error'] = str(checkpoint_error)
        if output:
            Path(output).write_bytes(canonical(error.report))
        raise RuntimeError('HTTP verification STOP: ' + json.dumps(error.report, sort_keys=True)) from None

    try:
        result = remote('attest', policy, plan=plan, go=go, state=state, evidence=evidence)
    except RuntimeError as error:
        evidence.update(status='STOP', failure_kind='attestation', release_phase='unknown', error=str(error))
        if output:
            Path(output).write_bytes(canonical(evidence))
        raise RuntimeError('HTTP attestation STOP: ' + json.dumps(evidence, sort_keys=True)) from None
    return dict(result, http=dict(evidence, release_phase=result['phase']))


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
    ensure(policy['keep_verified']>=2 and policy['protect_days']>=0 and policy['reserve_bytes']>=0
           and policy.get('quota_mode','required') in ('required','operator_managed'),'Unsafe retention policy')
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
            ensure(a.release_id, '--release-id required')
            result = remote('plan', policy, release_id=a.release_id, manifest=manifest, package_sha256=a.sha, package_bytes=len(raw))
            profile, reason = verification_profile(result['plan'], manifest)
            result.update(http_profile=profile, http_profile_reason=reason, http=http_preflight(result['plan']['snapshot']))
        else:
            ensure(a.plan and a.go, 'Review plan and obtain exact owner GO first')
            plan = load(a.plan)['plan']
            check_plan(plan, 'apply', a.go, policy)
            ensure(plan['package_sha256'] == a.sha, 'Wrong package for approved plan')
            http_preflight(plan['snapshot'])
            remote('apply', policy, payload=base64.b64encode(raw).decode(), plan=plan, go=a.go)
            result = finish_release_http(policy, manifest, plan, a.go, a.output)
    elif a.group=='release' and a.command=='finalize':
        ensure(a.plan and a.archive and a.sha and a.go, '--plan --archive --sha --go required')
        plan = load(a.plan)['plan']
        if policy.get('quota_mode','required') == 'required' or plan.get('quota_evidence_sha256') not in (None,digest({})):
            ensure(a.quota_evidence, 'Finalize requires the original --quota-evidence file '
                   '(quota evidence SHA-256 {}, policy SHA-256 {}): STOP'.format(
                       plan.get('quota_evidence_sha256', 'not recorded in this plan'), plan['policy_sha256']))
        check_plan(plan, 'apply', a.go, policy)
        manifest, _ = verify_package(Path(a.archive).read_bytes(), a.sha)
        ensure(plan['package_sha256'] == a.sha, 'Wrong package for finalization')
        result = finish_release_http(policy, manifest, plan, a.go, a.output)
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
