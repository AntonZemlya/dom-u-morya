// Disposable compatibility fixture. Does not merge, checkout, commit or alter either branch.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import legalContract from '../tests/legal-contract.cjs';
import linkAttributes from '../tests/external-links.cjs';
const {withNofollow}=linkAttributes;
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const ref='0ba0fbf46977d797239fd54b4a40352f8ab2242f';
const source=name=>withNofollow(execFileSync('git',['show',ref+':'+name],{cwd:root,encoding:'utf8',maxBuffer:5e6}));
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'dom-u-morya-rec003-compat-'));
const read=name=>fs.readFileSync(path.join(fixture,name),'utf8'),write=(name,s)=>fs.writeFileSync(path.join(fixture,name),s);
const extract=(s,re)=>{const match=s.match(re);if(!match)throw Error('Missing integration boundary '+re);return match[0];};
try{
 fs.cpSync(root,fixture,{recursive:true,filter:src=>!['.git','node_modules','dist','.release-output'].includes(path.basename(src))});
 fs.symlinkSync(path.join(root,'node_modules'),path.join(fixture,'node_modules'),'dir');
 // Check the actual V2.2 implementation. Never overwrite it with PR #8 in the fixture.
 legalContract(root);
 const html=read('index.html'),legal=source('index.html');
 for(const re of [/<div class="cookie-banner"[\s\S]*?(?=<div class="lightbox")/]){
  if(extract(html,re)!==extract(legal,re))throw Error('REC-003 disclosure differs: '+re);
 }
 const consent=extract(html,/<label class="consent-label">[\s\S]*?<\/label>/);
 if(!consent.includes('href="consent-personal-data.html"')||!consent.includes('required=""')||/checked|принимаю/.test(consent))throw Error('Invalid consent semantics');
 if(/id="request-form"[\s\S]*?href="privacy.html"[\s\S]*?<\/form>/.test(html))throw Error('Duplicate policy link in form');
 if(!html.includes('id="consent-error"'))throw Error('Missing consent error');
 const script=read('script.js'),prior=source('script.js');
 const foot=/<div class="foot">[\s\S]*?(?=\n<\/div>\n<\/body>)/;
 if(extract(script,foot)!==extract(prior,foot))throw Error('REC-003 PDF agency footer differs');
 // V2.2 authorizes new form copy, compact context and removing duplicate policy.
 if(!script.includes('Данные не отправлены.'))throw Error('Missing honest no-send status');
 const test=fs.readFileSync(path.join(root,'tests/ui.cjs'),'utf8');
 write('tests/rec003.cjs',test);
 console.log('Compatibility fixture:',fixture,'REC-003:',ref);
 for(const args of [['scripts/build-release.mjs'],['tests/rec003.cjs','--root','dist'],['tests/catalog.cjs','--root','dist']]){
  const result=spawnSync(process.execPath,args,{cwd:fixture,stdio:'inherit',env:{...process.env,QA_OUTPUT_DIR:''}});if(result.status!==0)throw Error('Compatibility check failed: '+args.join(' '));
 }
 legalContract(root);
 console.log('PASS actual V2.2: REC-003 legal boundaries preserved; FORM-001 processing disclosure verified; banner/PDF footer byte-identical; separate required consent and default-disabled behavior verified; contacts, form, PDF and REC-004 catalog/media pass together. No source substitution or merge performed.');
}finally{fs.rmSync(fixture,{recursive:true,force:true});}
