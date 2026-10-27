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
 for(const name of ['privacy.html','consent-personal-data.html'])write(name,source(name));
 let html=read('index.html'),legal=source('index.html');
 for(const re of [/<section id="contact"[\s\S]*?<\/section>/,/<div class="cookie-banner"[\s\S]*?(?=<div class="lightbox")/])html=html.replace(re,extract(legal,re));
 html=html.replace('<span class="location-style-9">по телефону агентства</span>','<a href="#contact" class="location-style-9">По телефону и e-mail →</a>').replace('Скидку уточним в отделе продаж','Скидку уточним при консультации');write('index.html',html);
 let script=read('script.js'),prior=source('script.js');
 const foot=/<div class="foot">[\s\S]*?(?=\n<\/div>\n<\/body>)/;
 script=script.replace(foot,extract(prior,foot));
 for(const name of ['renderFormTitleSub','handleSubmit']){
  const re=new RegExp('function '+name+'\\(\\)\\{[\\s\\S]*?\\n\\}');script=script.replace(re,extract(prior,re));
 }
 write('script.js',script);
 // V2 already carries the exact legal documents and their layout; retain the designed footer.
 if(!read('styles.css').includes('.legal-main'))write('styles.css',read('styles.css')+'\n'+source('styles.css').split('/* Agency contacts and shared legal documents. */')[1]);
 if(!read('scripts/release-files.mjs').includes("'privacy.html'"))write('scripts/release-files.mjs',read('scripts/release-files.mjs').replace("'index.html',","'privacy.html', 'consent-personal-data.html', 'index.html',"));
 let test=source('tests/ui.cjs').replaceAll('[1440,768,390]','[1440,768,390,320]').replaceAll('width===390?844:1000','width<=390?844:1000').replace("[['studio',5],['1k',3],['2k',1],['3k',1]]","[['studio',4],['1k',6],['2k',6],['3k',2]]").replaceAll("locator('#plans-grid .card').count(),3","locator('#plans-grid .card').count(),6").replaceAll('/6 из 6/','/8 из 8/').replaceAll('/1 из 6/','/1 из 8/').replaceAll('7885023','7956744').replaceAll("locator('#plans-grid .card').count(),5","locator('#plans-grid .card').count(),28").replaceAll("locator('#gallery-grid .gallery-item').count(),6","locator('#gallery-grid .gallery-item').count(),8").replace('[...document.images].map(i=>i.src)',"[...document.images].filter(i=>i.getAttribute('src')).map(i=>i.src)");
 test=test.replace("assert.match(await page.locator('#lightbox-position').textContent(),/8 из 8/);","assert.match(await page.locator('#lightbox-position').textContent(),/8 из 8/);await page.locator('#lightbox-asset').evaluate(i=>i.decode());");
 write('tests/rec003.cjs',test);
 console.log('Compatibility fixture:',fixture,'REC-003:',ref);
 for(const args of [['scripts/generate-content.mjs'],['scripts/build-release.mjs'],['tests/rec003.cjs','--root','dist'],['tests/catalog.cjs','--root','dist']]){
  const result=spawnSync(process.execPath,args,{cwd:fixture,stdio:'inherit',env:{...process.env,QA_OUTPUT_DIR:''}});if(result.status!==0)throw Error('Compatibility check failed: '+args.join(' '));
 }
 for(const name of ['privacy.html','consent-personal-data.html'])if(read(name)!==source(name))throw Error('REC-003 document changed: '+name);
 console.log('PASS REC-003 legal pages byte-identical, contacts/consent/PDF preserved, REC-004 catalog and media verified together. No merge performed.');
}finally{fs.rmSync(fixture,{recursive:true,force:true});}
