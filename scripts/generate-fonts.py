"""Full-glyph WOFF2 derivatives; pip install fonttools brotli. TTF and OFL remain unchanged."""
from pathlib import Path
from fontTools.ttLib import TTFont
root = Path(__file__).resolve().parent.parent
for source in sorted((root / 'assets/fonts').glob('font-*.ttf')):
    font = TTFont(source)
    font.flavor = 'woff2'
    font.save(source.with_suffix('.woff2'))
    original = TTFont(source)
    result = TTFont(source.with_suffix('.woff2'))
    assert original.getBestCmap() == result.getBestCmap()
    assert original['hmtx'].metrics == result['hmtx'].metrics
    assert original.getGlyphOrder() == result.getGlyphOrder()
print('PASS all 9 WOFF2: identical glyph mapping, glyph order and horizontal metrics; no subset')
