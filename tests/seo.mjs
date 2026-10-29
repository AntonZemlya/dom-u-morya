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
 const built=seoHTML(source,file,origin);assert.ok(built.includes(`href="${pageURL(origin,file)}"`));assert.equal((built.match(/rel="canonical"/g)||[]).length,1);assert.doesNotMatch(seoHTML(source,file,''),/rel="canonical"/);}
 assert.equal(new Set(titles).size,3);assert.equal(new Set(descriptions).size,3);
 console.log('PASS SEO: HTTPS validation/fail-closed, three self canonicals, robots and parsed XML sitemap; local build has no invented origin');
}finally{fs.rmSync(tmp,{recursive:true,force:true})}
