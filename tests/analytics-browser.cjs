// Standalone isolated Chromium matrix, adapted from Rehab Profi verify-metrica-consent.
// Every browser request is intercepted BEFORE network. PHP/SQLite runs on loopback only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const http=require('node:http');
const {spawn}=require('node:child_process'),{createHash}=require('node:crypto');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),php=process.env.PHP84_BIN||'php',origin='https://qa.invalid';
const output=path.join(root,'.test-output/metrica');fs.mkdirSync(output,{recursive:true});
const vendorPath=process.env.METRICA_VENDOR_FIXTURE||path.join(output,'vendor/tag.js');
const vendor=fs.existsSync(vendorPath)?fs.readFileSync(vendorPath,'utf8'):null;
const fake=`window.__capture(); window.ym=(...a)=>window.__calls.push(a);`;
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2','.ttf':'font/ttf'};
async function freePort(){return new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});}
(async()=>{
 if(!vendor&&process.env.ANALYTICS_REQUIRE_VENDOR_FIXTURE==='1')throw Error('Full CI requires a fresh local public tag.js: set METRICA_VENDOR_FIXTURE (no live counter requests)');
 const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'dom-analytics-http-')));fs.chmodSync(temp,0o700);
 const publicRoot=path.join(temp,'domains/zhk-dom-umorya.ru');fs.mkdirSync(publicRoot+'/api',{recursive:true});
 const privateRoot=path.join(temp,'.dom-u-morya');fs.mkdirSync(privateRoot,{mode:0o700});fs.mkdirSync(privateRoot+'/analytics',{mode:0o700});
 const state=privateRoot+'/analytics/state';fs.mkdirSync(state,{mode:0o700});
 for(const file of ['analytics-consent.php','analytics-core.php','analytics-document.php'])fs.copyFileSync(root+'/api/'+file,publicRoot+'/api/'+file);
 const port=await freePort(),server=spawn(php,['-n','-S','127.0.0.1:'+port,'-t',publicRoot],{stdio:'ignore'}),local='http://127.0.0.1:'+port+'/api/analytics-consent.php';
 let browser;const summaries=[];let leaked=0;
 try{
  for(let i=0;i<60;i++){try{if((await fetch(local)).status===405)break;}catch{}if(i===59)throw Error('Local PHP unavailable');await new Promise(r=>setTimeout(r,30));}
  for(const name of ['analytics-core.php','analytics-document.php'])assert.equal((await fetch(local.replace('analytics-consent.php',name))).status,404);
  assert.ok(!fs.existsSync(state+'/metrica-consent.sqlite3'),'GET never creates DB');
  const headers={'Host':'zhk-dom-umorya.ru','Origin':'https://zhk-dom-umorya.ru','X-Forwarded-Protocol':'https','Content-Type':'application/json','Sec-Fetch-Site':'same-origin'};
  const relay=(body,h=headers)=>new Promise((resolve,reject)=>{const req=http.request(local,{method:'POST',headers:{...h,'Content-Length':Buffer.byteLength(body)}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,text:async()=>text}));});req.on('error',reject);req.end(body);});
  for(const patch of [{'Origin':'https://other.invalid'},{'Host':'other.invalid'},{'X-Forwarded-Protocol':'http'},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await relay('{}',{...headers,...patch})).status,403);
  browser=await chromium.launch();
  async function fixture({width=390,real=false,enabled=true,race=null,noJS=false}={}){
   const context=await browser.newContext({viewport:{width,height:900},javaScriptEnabled:!noJS,serviceWorkers:'block'});
   const requests=[],operations=[],errors=[],controls={leadStatus:202,leadBody:{ok:true,id:'20261102-1234567890abcdef'},failWithdraw:false,apiStatus:[]};let releaseTag,tagStarted;
   const tagReady=new Promise(r=>tagStarted=r);
   await context.addInitScript(()=>{window.__calls=[];window.__snapshots=[];window.__capture=()=>{
    window.__snapshots.push({url:location.href,referrer:document.referrer});
    const original=window.ym;window.ym=(...a)=>{window.__calls.push(a);return original(...a);};
   };});
   await context.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url());
    if(u.origin===origin){
     if(u.pathname==='/api/analytics-consent.php'){
      const body=req.postDataJSON();operations.push(body.action);
      if(body.action==='withdraw'&&controls.failWithdraw)return route.fulfill({status:503,body:'{}',contentType:'application/json'});
      const response=await relay(req.postData());
      controls.apiStatus.push(response.status);return route.fulfill({status:response.status,body:await response.text(),contentType:'application/json'}).catch(()=>{});
     }
     if(u.pathname==='/api/form-status.php')return route.fulfill({contentType:'application/json',body:JSON.stringify({enabled:true,ready:true,consentVersion:'2026-10-31'})});
     if(u.pathname==='/api/lead.php')return route.fulfill({status:controls.leadStatus,contentType:'application/json',body:JSON.stringify(controls.leadBody)});
     const relative=u.pathname==='/'?'index.html':decodeURIComponent(u.pathname.slice(1));
     const file=path.resolve(root,relative);if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
     let body=fs.readFileSync(file);
     if(relative==='privacy/config.js')body=Buffer.from(body.toString().replace('analyticsEnabled:false','analyticsEnabled:'+enabled).replace('operatorPolicyApproved:false','operatorPolicyApproved:true').replace('vendorPayloadReviewApproved:false','vendorPayloadReviewApproved:true').replace("['zhk-dom-umorya.ru']","['qa.invalid']").replace('https://zhk-dom-umorya.ru',origin).replace('113992596','123456789'));
     return route.fulfill({contentType:types[path.extname(relative)]||'application/octet-stream',body});
    }
    if(u.hostname==='mc.yandex.ru'&&u.pathname==='/metrika/tag.js'){
     requests.push({kind:'tag'});tagStarted();if(race==='tag')await new Promise(r=>releaseTag=r);
     return route.fulfill({contentType:'application/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:real?'window.__capture();\n'+vendor:fake}).catch(()=>{});
    }
    if(/(?:^|\.)(?:yandex\.(?:ru|com)|yastatic\.net|webvisor\.com|yandexadexchange\.net)$/.test(u.hostname)){
     requests.push({kind:'vendor',url:req.url(),body:req.postData()||''});
     return route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true'},body:JSON.stringify({settings:{webvisor:{recp:'0'},form_goals:false}})}).catch(()=>{});
    }
    if(u.hostname==='www.openstreetmap.org')return route.fulfill({contentType:'text/html',body:'<html></html>'});
    leaked++;return route.abort();
   });
   const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
   return {p,context,requests,operations,controls,errors,tagReady,release:()=>releaseTag?.()};
  }
  for(const width of [320,390,768,1440]){
   const f=await fixture({width}),{p}=f;await p.goto(origin+'/?utm_campaign=dom_u_morya&utm_source=estatepartner#plans');
   await p.locator('#cookie-decline').waitFor();await p.screenshot({path:path.join(output,'banner-'+width+'.png')});assert.equal(f.requests.length,0);assert.equal(f.operations.length,0);
   await p.locator('#cookie-decline').click();assert.equal(f.operations.length,0);
   await p.locator('[data-privacy-settings]').first().click();await p.locator('#privacy-analytics').check();await p.screenshot({path:path.join(output,'settings-'+width+'.png')});await p.locator('[data-privacy-save]').click();
   await p.waitForFunction(()=>window.__calls.some(a=>a[1]==='hit')).catch(async e=>{console.error({width,operations:f.operations,status:f.controls.apiStatus,requests:f.requests.map(r=>r.kind),errors:f.errors,ui:await p.locator('[data-privacy-status]').textContent()});throw e;});
   assert.deepEqual(f.operations,['allow']);assert.equal((await p.evaluate(()=>window.__calls.filter(a=>a[1]==='init').length)),1);
   assert.equal((await p.evaluate(()=>window.__calls.filter(a=>a[1]==='hit').length)),1);
   await p.locator('#plans-grid .plan-thumb').first().click();await p.keyboard.press('Escape');
   assert.equal(await p.evaluate(()=>window.__calls.filter(a=>a[1]==='reachGoal'&&a[2]==='plan_open').length),1);
   await p.locator('#download-calc').scrollIntoViewIfNeeded();const download=p.waitForEvent('download');await p.locator('#download-calc').click();await download;
   await p.waitForFunction(()=>window.__calls.some(a=>a[2]==='pdf_download'));
   await p.evaluate(()=>document.addEventListener('click',e=>{if(e.target.closest('a[href^="tel:"],a[href^="mailto:"]'))e.preventDefault();}));
   await p.locator('a[href="tel:+79529568875"]').last().click();await p.locator('a[href="mailto:info@anyara.ru"]').last().click();
   for(const goal of ['phone_click','email_click'])assert.equal(await p.evaluate(goal=>window.__calls.filter(a=>a[1]==='reachGoal'&&a[2]===goal).length,goal),1);
   // Actual lead success predicate, without an SMTP connection.
   await p.locator('#name-input').fill('PRIVATE_NAME_SENTINEL');await p.locator('#phone-input').fill('70000000000');await p.locator('#consent-input').check();
   f.controls.leadStatus=503;await p.locator('#submit-btn').click();await p.waitForFunction(()=>!document.querySelector('#submit-btn').classList.contains('busy'));
   assert.ok(!(await p.evaluate(()=>window.__calls.some(a=>a[2]==='lead_accepted'))));
   f.controls.leadStatus=202;await p.locator('#submit-btn').click();await p.waitForFunction(()=>window.__calls.some(a=>a[2]==='lead_accepted'));
   const original=await p.evaluate(()=>JSON.parse(localStorage.getItem('domUMorya_analyticsConsent_v1')));
   await p.reload();await p.waitForFunction(()=>window.__calls.some(a=>a[1]==='hit'));assert.equal(f.operations.filter(a=>a==='allow').length,1);assert.ok(f.operations.includes('validate'));
   assert.equal((await p.evaluate(()=>JSON.parse(localStorage.getItem('domUMorya_analyticsConsent_v1')).time)),original.time);
   await p.locator('.footer-legal a[href="privacy.html"]').first().evaluate(a=>a.removeAttribute('target'));await p.locator('.footer-legal a[href="privacy.html"]').first().click();await p.waitForFunction(()=>window.__calls.some(a=>a[1]==='hit'));
   const second=await f.context.newPage();await second.goto(origin+'/consent-analytics.html');await second.waitForFunction(()=>window.__calls.some(a=>a[1]==='hit'));
   await p.locator('[data-privacy-settings]').first().click();f.controls.failWithdraw=true;await p.locator('[data-privacy-withdraw]').click();
   await second.waitForFunction(()=>window.disableYaCounter123456789===true);assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('domUMorya_analyticsConsent_v1')).choice),'withdrawn');
   f.controls.failWithdraw=false;await p.evaluate(()=>dispatchEvent(new Event('online')));await p.waitForFunction(()=>!JSON.parse(localStorage.getItem('domUMorya_analyticsConsent_v1')).token);
   assert.ok(!JSON.stringify(await p.evaluate(()=>window.__calls)).includes('PRIVATE_NAME_SENTINEL'));
   await p.locator('[data-privacy-settings]').first().click();await p.keyboard.press('Escape');assert.equal(await p.locator('#privacy-settings').isVisible(),false);
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await p.screenshot({path:path.join(output,'privacy-'+width+'.png')});console.log('PASS analytics viewport '+width);assert.deepEqual(f.errors,[]);
   summaries.push({scenario:'allow/deny/reload/legal/cross-tab/withdraw/retry/goals',width,status:'PASS'});await f.context.close();
  }
  for(const target of [origin+'/?phone=70000000000',origin+'/?utm_campaign=private_name',origin+'/#PRIVATE_TOKEN']){
   const f=await fixture();await f.p.goto(target);await f.p.locator('#cookie-accept').click();await f.p.waitForTimeout(70);assert.equal(f.requests.length,0);assert.equal(f.operations.length,0);await f.context.close();
  }
  const race=await fixture({race:'tag'});await race.p.goto(origin+'/');await race.p.locator('#cookie-accept').click();await race.tagReady;
  await race.p.locator('[data-privacy-settings]').first().click();await race.p.locator('[data-privacy-withdraw]').click();race.release();await race.p.waitForTimeout(100);assert.equal(await race.p.evaluate(()=>window.__calls.length),0);await race.context.close();
  for(const noJS of [false,true]){const f=await fixture({enabled:false,noJS});await f.p.goto(origin+'/');if(!noJS)await f.p.locator('#cookie-accept').click();await f.p.waitForTimeout(50);assert.equal(f.requests.length,0);assert.equal(f.operations.length,0);await f.context.close();}
  if(vendor){
   for(const [target,referrer] of [[origin+'/?utm_source=estatepartner&utm_campaign=dom_u_morya&yclid=1234567890123456789#plans','https://chatgpt.com/'],[origin+'/?token=PRIVATE_TOKEN',''],[origin+'/','https://chatgpt.com/c/PRIVATE_TOKEN']]){
    const f=await fixture({real:true});await f.p.goto(target,referrer?{referer:referrer}:{});await f.p.locator('#name-input').fill('PRIVATE_NAME_SENTINEL');await f.p.locator('#phone-input').fill('70000000000');await f.p.evaluate(()=>document.title='PRIVATE_TITLE_SENTINEL');await f.p.locator('#cookie-accept').click();
    if(target.includes('PRIVATE')||referrer.includes('PRIVATE')){await f.p.waitForTimeout(100);assert.equal(f.requests.length,0);}else{
     await f.p.waitForFunction(()=>window.__calls.some(a=>a[1]==='hit'));await f.p.waitForTimeout(500);
     const payload=JSON.stringify(f.requests);const token=await f.p.evaluate(()=>JSON.parse(localStorage.getItem('domUMorya_analyticsConsent_v1')).token);assert.ok(!payload.includes(token));assert.ok(!payload.includes('PRIVATE'));assert.ok(!payload.includes('70000000000'));const watch=f.requests.filter(r=>r.url?.includes('/watch/'));
     assert.equal(watch.filter(r=>new URL(r.url).searchParams.get('nohit')!=='1').length,1,'One actual counted pageview');
     for(const request of watch)for(const key of ['page-url','page-ref'])assert.ok(!(new URL(request.url).searchParams.get(key)||'').includes('#'),'No fragment in vendor URL/referrer');assert.ok(watch.some(r=>new URL(r.url).searchParams.get('page-url')?.includes('utm_campaign=dom_u_morya')),'Actual attribution preserved');
     await f.p.locator('#name-input').fill('PRIVATE_NAME_SENTINEL');await f.p.locator('#phone-input').fill('70000000000');await f.p.waitForTimeout(300);
     assert.ok(!JSON.stringify(f.requests).includes('PRIVATE_NAME_SENTINEL'));assert.ok(!JSON.stringify(f.requests).includes('70000000000'));
     summaries.push({scenario:'actual-vendor-intercepted',vendorSha256:createHash('sha256').update(vendor).digest('hex'),watchRequests:watch.length,status:'PASS'});
    }await f.context.close();
   }
  }
  assert.equal(leaked,0);fs.writeFileSync(path.join(output,'browser.json'),JSON.stringify({status:'PASS',realVendor:!!vendor,externalRequestsSent:0,summaries},null,2));
  console.log('PASS isolated Chromium: 4 widths, consent/SQLite/reload/legal/cross-tab/withdraw/retry/race, PDF/plan/lead goals; '+(vendor?'actual vendor PASS':'actual vendor NOT RUN (provide METRICA_VENDOR_FIXTURE)'));
 }finally{await browser?.close();server.kill();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
