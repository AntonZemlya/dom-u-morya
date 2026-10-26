"""Audit the current static site; no historical archive or network is needed."""
from pathlib import Path
import re

root = Path(__file__).resolve().parent.parent
for name in ['index.html', 'privacy.html', 'consent-personal-data.html', 'styles.css', 'script.js']:
    text = (root / name).read_text()
    assert not re.search(r'<x-dc|<sc-(?:if|for)|support\.js|DCLogic|data-dc-|data-sc-|\{\{', text), name
    for pattern in [r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
                    r'gh[pousr]_[A-Za-z0-9]{30,}', r'sk-(?:proj-)?[A-Za-z0-9_-]{30,}',
                    r'AKIA[0-9A-Z]{16}']:
        assert not re.search(pattern, text), f'Potential credential in {name}'

html = (root / 'index.html').read_text()
assert len(re.findall(r'<h1\b', html)) == 1
assert '<html lang="ru">' in html
assert re.search(r'<title>[^<]+</title>', html)
assert re.search(r'<meta name="description" content="[^"]+"', html)
assert 'Заявка принята' not in (root / 'script.js').read_text()
for name in ['project', 'reference', 'docs/qa', 'design-qa.md', 'docs/REC-001.md']:
    assert not (root / name).exists(), f'Historical material returned: {name}'

resources = [root / 'favicon.png', *sorted((root / 'assets').rglob('*'))]
assert len(list((root / 'assets').glob('*.webp'))) == 7
assert len(list((root / 'assets/fonts').glob('*.ttf'))) == 9
for resource in resources:
    assert not resource.is_symlink(), resource
    if resource.is_file():
        assert resource.stat().st_size > 0, resource
for name in ['assets/fonts/fonts.css', 'assets/fonts/Newsreader.OFL.txt',
             'assets/fonts/Sora.OFL.txt', 'assets/vendor/html2canvas.min.js',
             'assets/vendor/jspdf.umd.min.js', 'assets/vendor/html2canvas.LICENSE',
             'assets/vendor/jspdf.LICENSE']:
    assert (root / name).is_file(), name

print('PASS: current sources, SEO structure, credential patterns, resources/licenses, no historical/runtime dependencies')

for name in ['privacy.html', 'consent-personal-data.html']:
    legal = (root / name).read_text()
    assert len(re.findall(r'<h1\b', legal)) == 1, name
    assert '<html lang="ru">' in legal, name
    assert re.search(r'<title>[^<]+</title>', legal), name
    assert re.search(r'<meta name="description" content="[^"]+"', legal), name
    assert '<script' not in legal, name
    assert not re.search(r'черновик|проект документа|подлежит согласованию|TODO', legal, re.I), name
    for value in ['366210396814', '318366800035941', 'tel:+79529568875', 'mailto:info@anyara.ru']:
        assert value in legal, (name, value)
for name in ['index.html', 'script.js', 'privacy.html', 'consent-personal-data.html']:
    assert not re.search(r'775.?28.?92|info@sk-gc\.ru|Артёма', (root / name).read_text()), name
print('PASS: complete static legal pages, operator identity and contact consistency')
