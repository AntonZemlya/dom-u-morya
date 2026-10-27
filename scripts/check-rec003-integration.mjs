// Disposable compatibility fixture. Does not merge, checkout, commit or alter either branch.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const ref='0ba0fbf46977d797239fd54b4a40352f8ab2242f';
const source=name=>execFileSync('git',['show',ref+':'+name],{cwd:root,encoding:'utf8',maxBuffer:5e6});
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'dom-u-morya-rec003-compat-'));
const read=name=>fs.readFileSync(path.join(fixture,name),'utf8'),write=(name,s)=>fs.writeFileSync(path.join(fixture,name),s);
const extract=(s,re)=>{const match=s.match(re);if(!match)throw Error('Missing integration boundary '+re);return match[0];};
try{
 fs.cpSync(root,fixture,{recursive:true,filter:src=>!['.git','node_modules','dist'].includes(path.basename(src))});
 fs.symlinkSync(path.join(root,'node_modules'),path.join(fixture,'node_modules'),'dir');
 // Check the actual V2.1 implementation. Never overwrite it with PR #8 in the fixture.
 for(const name of ['privacy.html','consent-personal-data.html']){
  if(read(name)!==source(name))throw Error('REC-003 document changed: '+name);
 }
 const html=read('index.html'),legal=source('index.html');
 for(const re of [/<label class="consent-label">[\s\S]*?(?=<div class="form-footnotes">)/,/<div class="cookie-banner"[\s\S]*?(?=<div class="lightbox")/,/<div class="submit-note">[\s\S]*?<\/div>/]){
  if(extract(html,re)!==extract(legal,re))throw Error('REC-003 integration differs: '+re);
 }
 const script=read('script.js'),prior=source('script.js');
 const foot=/<div class="foot">[\s\S]*?(?=\n<\/div>\n<\/body>)/;
 if(extract(script,foot)!==extract(prior,foot))throw Error('REC-003 PDF agency footer differs');
 for(const name of ['renderFormTitleSub','handleSubmit']){
  const re=new RegExp('function '+name+'\\(\\)\\{[\\s\\S]*?\\n\\}');
  if(extract(script,re)!==extract(prior,re))throw Error('REC-003 behavior differs: '+name);
 }
 // Adopt PR #8 assertions; only fixture counts/prices change for REC-004's real catalog.
 let test=source('tests/ui.cjs').replaceAll('[1440,768,390]','[1440,768,390,320]').replaceAll('width===390?844:1000','width<=390?844:1000').replace("[['studio',5],['1k',3],['2k',1],['3k',1]]","[['studio',4],['1k',6],['2k',6],['3k',2]]").replaceAll("locator('#plans-grid .card').count(),3","locator('#plans-grid .card').count(),6").replaceAll('/6 из 6/','/8 из 8/').replaceAll('/1 из 6/','/1 из 8/').replaceAll('7885023','7956744').replaceAll("locator('#plans-grid .card').count(),5","locator('#plans-grid .card').count(),28").replaceAll("locator('#gallery-grid .gallery-item').count(),6","locator('#gallery-grid .gallery-item').count(),8").replace('[...document.images].map(i=>i.src)',"[...document.images].filter(i=>i.getAttribute('src')).map(i=>i.src)");
 test=test.replace("assert.match(await page.locator('#lightbox-position').textContent(),/8 из 8/);","assert.match(await page.locator('#lightbox-position').textContent(),/8 из 8/);await page.locator('#lightbox-asset').evaluate(i=>i.decode());");
 write('tests/rec003.cjs',test);
 console.log('Compatibility fixture:',fixture,'REC-003:',ref);
 for(const args of [['scripts/build-release.mjs'],['tests/rec003.cjs','--root','dist'],['tests/catalog.cjs','--root','dist']]){
  const result=spawnSync(process.execPath,args,{cwd:fixture,stdio:'inherit',env:{...process.env,QA_OUTPUT_DIR:''}});if(result.status!==0)throw Error('Compatibility check failed: '+args.join(' '));
 }
 for(const name of ['privacy.html','consent-personal-data.html'])if(read(name)!==source(name))throw Error('REC-003 document changed: '+name);
 console.log('PASS actual V2.1: REC-003 documents/consent/banner/handlers byte-identical; contacts, form, PDF and REC-004 catalog/media pass together. No source substitution or merge performed.');
}finally{fs.rmSync(fixture,{recursive:true,force:true});}
