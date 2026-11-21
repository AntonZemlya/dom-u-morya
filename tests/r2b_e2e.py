#!/usr/bin/env python3
"""Reproduce local PHP + actual Chromium PDF with independently recorded package SHAs."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'ops'))
import catalog_publisher as p
from r2b_fixtures import packages
from r2b_support import site, server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument('--r2a-repo', type=Path)
    choice.add_argument('--fixtures', type=Path, help='Trusted fixtures.json recording directory and expected SHA independently')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--checked-at', help='Explicit UTC confirmation; default is current UTC minus 60 seconds')
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    if args.r2a_repo:
        fixture_root = Path(tempfile.mkdtemp(prefix='dom-publisher-packages-')).resolve()
        fixture = dict(root=str(fixture_root), r2a=p.R2A, packages=packages(args.r2a_repo, fixture_root, args.checked_at))
    else:
        fixture = json.loads(args.fixtures.read_bytes())
    for bundle in fixture['packages']:
        p.verify_package(Path(bundle['directory']), bundle['package'])
    fixture_file = out / 'fixtures.json'
    fixture_file.write_text(json.dumps(fixture, indent=2)+'\n')
    home = Path(tempfile.mkdtemp(prefix='dom-publisher-e2e-')).resolve()
    public = site(home)
    with server(public) as url:
        bundle = fixture['packages'][0]
        command = [sys.executable, '-B', str(ROOT / 'ops/catalog_publisher.py'), 'install', '--home', str(home),
                   '--url', url, '--expect', 'empty', '--package', bundle['directory'], '--sha', bundle['package']]
        first = subprocess.run(command, check=True, capture_output=True, text=True)
        report = out / 'browser.json'
        subprocess.run(['node', str(ROOT / 'tests/r2b_browser.cjs'), str(ROOT), url, str(home),
                        str(fixture_file), str(report)], check=True, timeout=120)
        summary = dict(status='PASS', home=str(home), public=str(public), root=str(ROOT), r2a=p.R2A,
                       php=subprocess.check_output(['php', '-r', 'echo PHP_VERSION;'], text=True),
                       initial_command=command, first_install=json.loads(first.stdout),
                       browser_report=str(report), fixtures=str(fixture_file), final=p.Publisher(home, url).status())
        (out / 'e2e.json').write_text(json.dumps(summary, indent=2)+'\n')
        print(json.dumps(summary, indent=2))
    # Packages and home intentionally remain in /tmp for coordinator inspection/replay; no server remains running.


if __name__ == '__main__':
    main()
