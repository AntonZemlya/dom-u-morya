// Dev-only runner. Install Lighthouse 13.6.0 outside this repository, then set
// LIGHTHOUSE_PACKAGE=/absolute/path/to/node_modules/lighthouse. No app dependency.
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
const packageDir=process.env.LIGHTHOUSE_PACKAGE;
if(!packageDir)throw Error('Set LIGHTHOUSE_PACKAGE to an external Lighthouse 13.6.0 installation');
const resolve=createRequire(path.join(packageDir,'package.json'));
const {default:lighthouse}=await import(pathToFileURL(path.join(packageDir,'core/index.js')));
const {default:desktopConfig}=await import(pathToFileURL(path.join(packageDir,'core/config/desktop-config.js')));
const launcher=await import(pathToFileURL(resolve.resolve('chrome-launcher')));
assertVersion();
function assertVersion(){if(JSON.parse(fs.readFileSync(path.join(packageDir,'package.json'))).version!=='13.6.0')throw Error('Comparable runs require Lighthouse 13.6.0');}
const [url,out]=process.argv.slice(2);
if(!url||!out||!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(url))throw Error('Usage: node tests/performance/lighthouse.mjs http://127.0.0.1:PORT/ OUTPUT_DIRECTORY');
fs.mkdirSync(out,{recursive:true});
for(let run=1;run<=3;run++)for(const device of ['mobile','desktop']){
 const chrome=await launcher.launch({...(process.env.CHROME_PATH?{chromePath:process.env.CHROME_PATH}:{}),chromeFlags:['--headless','--no-sandbox','--disable-dev-shm-usage']});
 try{
  const r=await lighthouse(url,{port:chrome.port,output:'json',logLevel:'error',onlyCategories:['performance','accessibility','best-practices','seo']},device==='desktop'?desktopConfig:undefined);
  fs.writeFileSync(path.join(out,`${device}-${run}.json`),JSON.stringify(r.lhr));
  if(process.env.SAVE_ARTIFACTS==='1')for(const [name,key]of [['devtools','DevtoolsLog'],['trace','Trace']])fs.writeFileSync(path.join(out,`${device}-${run}-${name}.json`),JSON.stringify(r.artifacts[key]));
  console.log(device,run,r.lhr.categories.performance.score,r.lhr.audits['largest-contentful-paint'].numericValue,r.lhr.audits['total-byte-weight'].numericValue);
 }finally{await chrome.kill();}
}
