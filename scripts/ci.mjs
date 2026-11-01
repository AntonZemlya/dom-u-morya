// One sequential CI contract; mandatory skips are failures, logs remain local.
import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const mode=process.argv[2];if(!['fast','full'].includes(mode))throw Error('Usage: node scripts/ci.mjs fast|full');
const out=path.join(root,'.test-output/ci',mode);fs.mkdirSync(out,{recursive:true});
const env={...process.env,BUILD_TARGET:'production',SITE_URL:'https://zhk-dom-umorya.ru'};
// Never inherit an external test origin or a user browser executable.
for(const key of ['QA_BASE_URL','LEAD_QA_URL','LEAD_CONFIG','CHROMIUM_EXECUTABLE_PATH','CI_PREVIEW_URL'])delete env[key];
const checks=[];const start=Date.now();let preview;
function run(id,cmd,args,requires=[],extraEnv={}){
 const missing=requires.filter(id=>checks.find(c=>c.id===id)?.status!=='PASS');
 const t=Date.now();let status,reason='',log='';
 if(missing.length){status='SKIP';reason='Required checks failed: '+missing.join(', ');}
 else {const p=spawnSync(cmd,args,{cwd:root,env:{...env,...extraEnv},encoding:'utf8',timeout:900000,maxBuffer:16*1024*1024});log=(p.stdout||'')+(p.stderr||'');status=p.status===0?'PASS':'FAIL';reason=p.error?.message|| (p.status===0?'':'Exit '+p.status);}
 fs.writeFileSync(path.join(out,id+'.log'),log);
 checks.push({id,status,required:true,reason,seconds:(Date.now()-t)/1000,command:[cmd,...args]});console.log(status+' '+id+(reason?' — '+reason:''));
 writeReport();
}
function writeReport(complete=false){
 const result={schema:1,mode,complete,node:process.version,platform:process.platform,started_at:new Date(start).toISOString(),status:!complete?'RUNNING':checks.every(c=>c.status==='PASS')?'PASS':'FAIL',seconds:(Date.now()-start)/1000,checks};
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(result,null,2)+'\n');
 fs.writeFileSync(path.join(out,'summary.md'),`# CI ${mode}: ${result.status}\n\nTotal: ${result.seconds.toFixed(1)}s\n\n`+checks.map(c=>`- ${c.status} ${c.id} (${c.seconds.toFixed(1)}s)${c.reason?' — '+c.reason:''}`).join('\n')+'\n');
}
writeReport();
const n=(id,file,requires=[],args=[])=>run(id,process.execPath,[file,...args],requires);
try{
 run('toolchain',process.execPath,['-e',"if(Number(process.versions.node.split('.')[0])!==22)throw Error('Node 22 required'); console.log(process.version)"]);
 run('source','npm',['run','check'],['toolchain']);
 n('syntax','scripts/ci-static.mjs',['toolchain']);
 n('analytics-unit','tests/analytics.test.mjs',['toolchain']);
 run('release-contract',process.execPath,['tests/release.cjs'],['source'],{BUILD_TARGET:'preview',SITE_URL:''});
 run('production-build','npm',['run','build:production'],['source']);
 n('offline-contract','tests/ci-contract.mjs',['production-build']);
 n('seo','tests/seo.mjs',['production-build']);
 run('legal',process.execPath,['-e',"require('./tests/legal-contract.cjs')(process.cwd())"],['production-build']);
 run('release-manager','python3',['-B','-m','unittest','discover','-s','ops','-p','test_release_manager.py']);
 if(mode==='full'){
  run('php84',env.PHP84_BIN||'php',['-n','-r',"if(PHP_MAJOR_VERSION!==8||PHP_MINOR_VERSION!==4||!extension_loaded('openssl')||!extension_loaded('ctype'))exit(1);echo PHP_VERSION;"]);
  run('analytics-sqlite',env.PHP84_BIN||'php',['-n','tests/analytics.test.php'],['php84']);
  run('analytics-browser',process.execPath,['tests/analytics-browser.cjs'],['analytics-sqlite','production-build'],{ANALYTICS_REQUIRE_VENDOR_FIXTURE:'1'});
  run('composer','composer',['validate','--strict','--no-check-all','--no-interaction']);
  run('composer-audit','composer',['audit','--locked','--no-interaction'],['composer']);
  n('smtp-runtime','scripts/smtp-runtime.mjs',['composer']);
  run('form-smtp','npm',['run','test:form'],['php84','smtp-runtime','production-build']);
  n('chromium','tests/ci-browser-dependency.cjs');
  // A loopback preview for the historical SEO/performance tests; closed in finally.
  preview=spawn(process.execPath,['tests/ci-preview.cjs'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  env.CI_PREVIEW_URL=await new Promise((resolve,reject)=>{
   preview.stdout.once('data',b=>resolve(b.toString().trim()));
   preview.once('error',reject);preview.once('exit',code=>reject(Error('Preview exited: '+code)));
  });
  n('ui','tests/ui.cjs',['chromium','production-build'],['--root','dist']);
  n('catalog-pdf','tests/catalog.cjs',['chromium','production-build'],['--root','dist']);
  n('catalog-transfer','tests/catalog-transfer.cjs',['chromium','production-build']);
  n('previews','tests/plan-previews.cjs',['chromium','production-build']);
  n('seo-browser','tests/seo-browser.cjs',['chromium','production-build']);
  n('performance','tests/performance.cjs',['chromium','production-build'],['ci']);
  run('legacy-fixtures','python3',['-B','scripts/ci-legacy-fixtures.py'],['smtp-runtime','production-build']);
  run('manager-guard-http','python3',['-B','ops/test_release_guard_http.py'],['production-build']);
  run('legacy-security','npm',['run','test:security']);
  run('legacy-form-release','npm',['run','test:form-release']);
  run('smtp-package','npm',['run','test:smtp-package']);
  run('smtp-e2e','npm',['run','test:smtp-e2e'],['php84','smtp-runtime','legacy-fixtures']);
 }
} catch(error) {run('ci-infrastructure',process.execPath,['-e','throw Error('+JSON.stringify(error.message)+')']);} finally {if(preview){preview.kill('SIGTERM');await new Promise(r=>preview.exitCode!==null?r():preview.once('exit',r));}}
writeReport(true);
process.exitCode=checks.every(c=>c.status==='PASS')?0:1;
