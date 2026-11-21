import http.client
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
from contextlib import contextmanager

ROOT = Path(__file__).resolve().parent.parent

ROUTER = r'''<?php
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($path === '/') { require getcwd().'/index.php'; return; }
if ($path !== '/_validate') return false;
// Isolated field validation only: no config, accept, delivery, rate state or SMTP.
require getcwd().'/api/lead-core.php';
$d = ['name'=>'Fixture','phone'=>'+7'.str_repeat('0',10), 'consent'=>true,
  'consentVersion'=>\DomLead\CONSENT_VERSION, 'lotId'=>$_GET['id'], 'lotPrice'=>(int)$_GET['price']];
if (isset($_GET['version'])) $d['catalogVersion'] = $_GET['version'];
try { $v = \DomLead\validate(json_encode($d)); echo $v['lot']['price_rub']; }
catch (\DomLead\Rejection $e) { http_response_code($e->status); echo $e->reason; }
'''


def site(home):
    public = home / 'domains' / 'zhk-dom-umorya.ru'
    public.mkdir(parents=True)
    names = ['index.html', 'index.php', 'api/catalog-view.php', 'api/catalog-plan.php', 'api/lead-core.php',
             'api/lead-catalog.php', 'script.js', 'content-model.js', 'styles.css', 'privacy/privacy.js',
             'privacy/privacy.css', 'scripts/seo.mjs', 'scripts/realty-schema.mjs', 'data/apartments.json',
             'assets/logo-cropped.webp', 'assets/vendor/html2canvas.min.js', 'assets/vendor/jspdf.umd.min.js',
             'assets/fonts/fonts.css']
    names += [str(path.relative_to(ROOT)) for path in (ROOT / 'assets/performance').glob('font-*.woff2')]
    for name in names:
        path = public / name
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, path)
    subprocess.run(['node', '--input-type=module', '-e', """
import fs from 'node:fs'; import {seoHTML} from './scripts/seo.mjs';
fs.writeFileSync('index.html', seoHTML(fs.readFileSync('index.html','utf8'),'index.html','https://zhk-dom-umorya.ru'));
"""], cwd=public, check=True)
    return public


def legacy_bootstrap(pub, checked=1795152599):
    """Materialize the previously tracked worker catalog and exact old SVG/WebP in a temp home."""
    import catalog_sync as sync
    bundled = __import__('json').loads((ROOT / 'data/apartments.json').read_bytes())
    lots = []
    for lot in bundled:
        plans = []
        for plan in lot['plans']:
            key = plan['sha256']
            svg = (ROOT / plan['local_path']).read_bytes()
            webp = (ROOT / plan['local_path']).with_suffix('.preview.webp').read_bytes()
            pub.immutable(pub.store.media / (key + '.svg'), svg)
            pub.immutable(pub.store.media / (key + '.preview.webp'), webp)
            plans.append(sync.normalize_plan(plan['type'], plan['source_url'], key))
        lots.append(sync.normalize_lot(lot, plans))
    native, raw = pub.store.build_snapshot(lots, checked)
    pub.immutable(pub.store.snapshots / (native + '.json'), raw)
    pub.store.save(dict(schema=1, active=native, history=[native], checked_at=checked, published_checked_at=checked,
                        source_ok=True, started_at=None, etags={'legacy-cache': {}}, outbox=[], history_events=[]))
    return native


def guarded_runtime(pub):
    import catalog_sync as sync
    runtime = pub.root / 'runtime'
    runtime.mkdir(mode=0o700, exist_ok=True)
    (runtime / 'scripts').mkdir(mode=0o700, exist_ok=True)
    for name in ('catalog_sync.py', 'catalog-cron.sh'):
        sync.atomic(runtime / 'scripts' / name, (ROOT / 'scripts' / name).read_bytes())


@contextmanager
def server(public):
    path = public.parent / 'fixture-router.php'
    path.write_text(ROUTER)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    with (public.parent / 'php.log').open('w') as log:
        process = subprocess.Popen(['php', '-d', 'display_errors=0', '-S', f'127.0.0.1:{port}', '-t', str(public), str(path)],
                                   cwd=public, stdout=subprocess.DEVNULL, stderr=log,
                                   env={k: v for k, v in os.environ.items() if k != 'LEAD_CONFIG'})
        try:
            for _ in range(100):
                try:
                    with socket.create_connection(('127.0.0.1', port), timeout=.1):
                        break
                except OSError:
                    if process.poll() is not None:
                        raise RuntimeError('PHP fixture stopped')
                    time.sleep(.02)
            yield f'http://127.0.0.1:{port}'
        finally:
            process.terminate()
            process.wait(timeout=5)
