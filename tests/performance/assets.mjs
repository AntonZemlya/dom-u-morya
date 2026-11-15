import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import images from '../../data/performance-assets.json' with {type:'json'};
const root=new URL('../../',import.meta.url);
const all=Object.values(images).flat();
assert.deepEqual(fs.readdirSync(new URL('assets/performance/',root)).sort(),all.map(i=>i.src.split('/').at(-1)).sort(),'No untracked/stale cache variants');
for(const asset of all){const body=fs.readFileSync(new URL(asset.src,root));assert.ok(asset.src.includes(createHash('sha256').update(body).digest('hex').slice(0,16)),asset.src+': immutable URL must match actual bytes');assert.equal(body.length,asset.bytes);}
for(const [i,font] of images.fonts.entries())assert.deepEqual(fs.readFileSync(new URL(font.src,root)),fs.readFileSync(new URL(`assets/fonts/font-${i+1}.woff2`,root)),'Font glyphs/metrics must stay byte-identical');
const policy=fs.readFileSync(new URL('.htaccess',root),'utf8');
assert.match(policy,/max-age=0, must-revalidate/);assert.match(policy,/max-age=31536000, immutable/);
console.log('PASS content-addressed asset bytes, exact manifest, byte-identical fonts, fixed-URL revalidation');
