import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {siteOrigin,seoHTML,indexingFiles,SEO_PAGES,pageURL} from '../scripts/seo.mjs';
assert.equal(siteOrigin(''),'');assert.throws(()=>siteOrigin('','production'));
for(const value of ['http://anyara.ru','https://localhost','https://127.0.0.1','https://example.com','https://example.test','https://test.ru','https://anyara.ru/path','https://anyara.ru/?a','https://anyara.ru/#a','https://user@anyara.ru','https://anyara.ru:8443',' https://anyara.ru'])assert.throws(()=>siteOrigin(value),value);
// Only the rendering layer sees this isolated fixture origin; production validation rejects it.
const origin='https://example.test',tmp=fs.mkdtempSync(path.join(os.tmpdir(),'seo-fixture-'));
try{
 const files=indexingFiles(origin);for(const [name,text] of Object.entries(files))fs.writeFileSync(path.join(tmp,name),text);
 execFileSync('python3',['-c',`import xml.etree.ElementTree as E,sys; r=E.parse(sys.argv[1]).getroot(); assert len(r)==3; assert len({x[0].text for x in r})==3`,path.join(tmp,'sitemap.xml')]);
 assert.ok(files['robots.txt'].includes(origin+'/sitemap.xml'));assert.deepEqual(Object.keys(indexingFiles('')),['robots.txt']);
 const titles=[],descriptions=[];
 for(const file of SEO_PAGES){const source=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');titles.push(source.match(/<title>(.*?)<\/title>/s)[1]);descriptions.push(source.match(/<meta name="description" content="(.*?)"/)[1]);
 const built=seoHTML(source,file,origin);assert.ok(built.includes(`href="${pageURL(origin,file)}"`));assert.equal((built.match(/rel="canonical"/g)||[]).length,1);assert.doesNotMatch(seoHTML(source,file,''),/rel="canonical"|property="og:url"|property="og:image"/);
 const ld=JSON.parse(built.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);assert.equal(ld['@graph'].length,5);assert.equal(ld['@graph'][0].taxID,'366210396814');assert.equal(ld['@graph'][4].about['@id'],origin+'/#complex');assert.doesNotMatch(JSON.stringify(ld),/InStock|AggregateRating|Review|Offer|RealEstateAgent/);assert.ok(built.includes('content="image/jpeg"'));}
 assert.equal(new Set(titles).size,3);assert.equal(new Set(descriptions).size,3);
 console.log('PASS SEO: HTTPS validation/fail-closed, three self canonicals, robots and parsed XML sitemap; local build has no invented origin');
}finally{fs.rmSync(tmp,{recursive:true,force:true})}

const originals=JSON.parse(fs.readFileSync(new URL('./seo-originals.json',import.meta.url)));
const {createHash}=await import('node:crypto');
const M=(await import('../content-model.js')).default;
const apartments=JSON.parse(fs.readFileSync(new URL('../data/apartments.json',import.meta.url)));
assert.equal(Object.keys(originals).length,57);assert.equal(apartments.length,28);assert.equal(apartments.flatMap(a=>a.plans).length,84);
for(const [src,sha] of Object.entries(originals)){const buffer=fs.readFileSync(new URL('../'+src,import.meta.url));assert.equal(createHash('sha256').update(buffer).digest('hex'),sha);const derivative=src.replace(/\.svg$/,'.preview.webp');const bytes=fs.readFileSync(new URL('../'+derivative,import.meta.url));assert.equal(bytes.toString('ascii',8,12),'WEBP');assert.ok(bytes.length<buffer.length);}
for(const p of M.plans(apartments))for(const v of Object.keys(M.views)){const asset=p.plans.find(a=>a.type===v),html=M.card(p,v);assert.ok(html.includes('src="'+M.previewPath(asset)+'"'));assert.ok(html.includes('href="'+asset.local_path+'"'));assert.ok(html.includes(M.rub(p.price)));}
console.log('PASS 57 immutable SHA originals, lighter lossless previews, all 28×3 modes and real original fallback links');
