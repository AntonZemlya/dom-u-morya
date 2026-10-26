"""Source provenance and production independence checks (no network)."""
from pathlib import Path
from hashlib import sha256
import re, zipfile
root = Path(__file__).resolve().parent.parent
archive = root / 'reference/claude-design-2026-10-26.zip'
assert sha256(archive.read_bytes()).hexdigest() == '29a16825c9460eccc73820b8005681e461f57ea7086f58cd691ebaa3e2a2efba'
with zipfile.ZipFile(archive) as z:
    for entry in z.infolist():
        assert (entry.external_attr >> 16) & 0o170000 != 0o120000, entry.filename
    for path in z.namelist():
        assert not path.startswith('/') and '..' not in Path(path).parts
    for path in [p for p in z.namelist() if p.startswith('assets/')]+['favicon.png']:
        assert z.read(path) == (root/path).read_bytes(), path
    for path in z.namelist():
        if path.endswith(('.html','.js','.md','.json')):
            text = z.read(path).decode('utf-8',errors='replace')
            for pattern in [r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',r'gh[pousr]_[A-Za-z0-9]{30,}',r'sk-(?:proj-)?[A-Za-z0-9_-]{30,}',r'AKIA[0-9A-Z]{16}']:
                assert not re.search(pattern,text), f'Potential credential in {path}; review locally'
for name in ['index.html','styles.css','script.js']:
    text=(root/name).read_text()
    assert not re.search(r'<x-dc|<sc-(?:if|for)|support\.js|DCLogic|data-dc-|data-sc-|\{\{', text),name
html=(root/'index.html').read_text()
assert len(re.findall(r'<h1\b',html)) == 1
assert '<html lang="ru">' in html
assert 'Заявка принята' not in (root/'script.js').read_text()
print('PASS: archive SHA-256, safe paths, credential patterns, unchanged images, independent production sources, SEO structure')
