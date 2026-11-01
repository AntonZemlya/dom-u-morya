// Adapted from Rehab Profi privacy.test.mjs: same fail-closed and abort/epoch invariants.
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import {createHash} from 'node:crypto';
import {privacyConfig as prod} from '../privacy/config.js';
import {validRecord,createConsentController,createAnalyticsLifecycle,deploymentBlockers,safePage} from '../privacy/core.js';
import {createMetricaAdapter,createReceiptAdapter} from '../privacy/metrica.js';
const DAY=86400000,c={...prod,analyticsEnabled:true,operatorPolicyApproved:true,vendorPayloadReviewApproved:true,approvedProductionHosts:['test.invalid'],siteOrigin:'https://test.invalid',metricaCounterId:123456789};
const memory=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k),m};};
const setup=()=>{let now=Date.now();const storage=memory(),controller=createConsentController({config:c,storage,clock:()=>now});return {storage,controller,setTime:n=>now=n,now};};
const receipt=(p,now=Date.now())=>({schemaVersion:1,action:p.action,purpose:c.purpose,consentVersion:c.analyticsConsentVersion,receiptId:'1'.repeat(32),receivedAt:now,expiresAt:now+180*DAY,documentSha256:'a'.repeat(64)});
test('versioned independent choice, damaged/storage failure, expiry and unconfirmed withdrawal',()=>{
 const f=setup();f.storage.setItem('domUMorya_cookieChoice','accepted');f.controller.refresh();assert.equal(f.controller.state,'unknown');
 f.controller.choose('denied');assert.ok(!('token' in f.controller.record));f.controller.choose('granted');const token=f.controller.record.token;
 assert.equal(token.length,64);assert.equal(f.controller.record.operation,'allow');f.controller.choose('granted');assert.equal(f.controller.record.token,token);
 assert.equal(f.controller.record.receiptRequested,false);f.controller.requested(token);
 f.controller.choose('withdrawn');assert.equal(f.controller.state,'withdrawn');assert.equal(f.controller.choose('granted'),false);
 f.controller.withdrawn(token);assert.equal(f.controller.choose('granted'),true);
 assert.equal(validRecord(JSON.stringify(f.controller.record),{...c,analyticsConsentVersion:'new'}),null);
 f.setTime(f.now+181*DAY);assert.equal(f.controller.state,'unknown');
 const broken=createConsentController({config:c,storage:{getItem(){throw Error()},setItem(){throw Error()}}});assert.equal(broken.choose('granted'),false);assert.equal(broken.state,'unknown');
 assert.equal(validRecord('{broken',c),null);
});
test('unissued local choices can be withdrawn/re-granted; only legacy unapproved loopback withdrawal is repaired',async()=>{
 const f=setup();let requests=0;const adapter={start:async()=>assert.fail('preview start'),stop(){},event(){},pageview(){}};
 const lifecycle=(config,host,controller=f.controller)=>createAnalyticsLifecycle({config,host,controller,adapter,evidence:async()=>{requests++;throw Error('offline');},page:()=>({})});
 const local=lifecycle(prod,'127.0.0.1');
 for(let i=0;i<2;i++){f.controller.choose('granted');await local.sync();f.controller.choose('withdrawn');await local.sync();assert.equal(f.controller.record.operation,undefined);assert.equal(f.controller.record.token,undefined);}
 assert.equal(f.controller.choose('granted'),true);assert.equal(requests,0);
 const legacy={...f.controller.record,choice:'withdrawn',operation:'withdraw'};delete legacy.receiptRequested;
 f.storage.setItem(c.preferenceKey,JSON.stringify(legacy));f.controller.refresh();await local.sync();assert.equal(f.controller.choose('granted'),true);assert.equal(requests,0);
 for(const [host,marker] of [['test.invalid',undefined],['other.invalid',undefined],['127.0.0.1',true]]){
  const remote={...legacy};if(marker!==undefined)remote.receiptRequested=marker;
  f.storage.setItem(c.preferenceKey,JSON.stringify(remote));f.controller.refresh();await lifecycle(prod,host).sync();assert.equal(f.controller.record.operation,'withdraw');assert.equal(f.controller.choose('granted'),false);
 }
 assert.equal(requests,3);assert.equal(validRecord(JSON.stringify({...legacy,receiptRequested:'false'}),c),null);
 // If the pre-request marker cannot persist, no allow request may leave the page.
 const broken=memory(),b=createConsentController({config:c,storage:broken});b.choose('granted');broken.setItem=()=>{throw Error('full');};
 await lifecycle(c,'test.invalid',b).sync();assert.equal(requests,3);assert.equal(b.state,'unknown');
});
test('allow once then validate at 25h/48h without changing original time; expiry stops',async()=>{
 const f=setup(),calls=[],adapter={start:async()=>calls.push('start'),pageview:()=>calls.push('hit'),event:n=>calls.push(n),stop:()=>{}};
 const requests=[],evidence=async p=>{requests.push(p);return receipt(p,f.now);};
 const life=()=>createAnalyticsLifecycle({config:c,host:'test.invalid',controller:f.controller,adapter,evidence,page:()=>({})});
 f.controller.choose('granted');const l=life();assert.equal(l.emit('phone_click'),false);await l.sync();await l.sync();assert.deepEqual(calls,['start','hit']);
 for(const hours of [25,48]){f.setTime(f.now+hours*3600000);const next=life();await next.sync();assert.equal(requests.at(-1).action,'validate');assert.ok(!('clientTime' in requests.at(-1)));assert.equal(f.controller.record.time,f.now);}
 f.setTime(f.now+180*DAY);assert.equal(l.emit('phone_click'),false);await l.sync();assert.equal(l.active,false);
});
test('preview OFF and arbitrary local granted never start; no replay of denied goals',async()=>{
 assert.equal(prod.analyticsEnabled,false);assert.equal(prod.metricaCounterId,113992596);assert.ok(deploymentBlockers(prod,'zhk-dom-umorya.ru').length);
 for(const config of [prod,c]){const f=setup();let starts=0;f.controller.choose('granted');const l=createAnalyticsLifecycle({config,host:'test.invalid',controller:f.controller,
 adapter:{start:async()=>starts++,stop(){},event(){},pageview(){}},evidence:async()=>{throw Error('invalid token');},page:()=>({})});await l.sync();assert.equal(starts,0);assert.equal(l.emit('phone_click'),false);}
});
test('late receipt or vendor fetch, cross-tab withdrawal and retry never resurrect analytics',async()=>{
 for(const slow of ['receipt','tag']){const f=setup();let finish,starts=0,hits=0;const requests=[];
 const evidence=p=>{requests.push(p);if(p.action==='withdraw')throw Error('offline');return slow==='receipt'?new Promise(r=>finish=()=>r(receipt(p))):Promise.resolve(receipt(p));};
 const l=createAnalyticsLifecycle({config:c,host:'test.invalid',controller:f.controller,evidence,page:()=>({}),adapter:{start:()=>{starts++;return new Promise(r=>finish=r);},stop(){},pageview(){hits++;},event(){}}});
 f.controller.choose('granted');const pending=l.sync();await new Promise(r=>setImmediate(r));f.controller.choose('withdrawn');await l.sync();finish();await pending;
 assert.equal(hits,0);assert.equal(l.active,false);assert.equal(starts,slow==='tag'?1:0);assert.equal(f.controller.state,'withdrawn');assert.equal(f.controller.record.operation,'withdraw');
 const b=createConsentController({config:c,storage:f.storage});assert.equal(b.state,'withdrawn');assert.equal(b.choose('granted'),false);
 }
});
test('a forged granted flag cannot issue allow on reload; only explicit choice may issue',async()=>{
 const f=setup();f.controller.choose('granted');const fresh=createConsentController({config:c,storage:f.storage});const requests=[];
 const l=createAnalyticsLifecycle({config:c,host:'test.invalid',controller:fresh,adapter:{start:async()=>{throw Error('must not start');},stop(){},event(){},pageview(){}},
 evidence:async p=>{requests.push(p);throw Error('unknown token');},page:()=>({})});await l.sync();assert.equal(requests[0].action,'validate');assert.equal(l.active,false);
});
test('cancelled real adapter never evaluates late source; only known analytics storage is purged',async()=>{
 let finish;const storage=memory(),cookies=[],calls=[],scripts=[];
 const w={location:{hostname:'test.invalid'},localStorage:storage,ym:(...a)=>calls.push(a),fetch:()=>new Promise(r=>finish=()=>r({ok:true,text:async()=>"throw Error('late vendor executed')"}))};
 const d={head:{append:s=>scripts.push(s)},createElement:()=>({remove(){}}),set cookie(c){cookies.push(c);}};
 const a=createMetricaAdapter({window:w,document:d,config:c,page:()=>({url:c.siteOrigin,referer:''})}),abort=new AbortController();
 storage.setItem('unrelated','keep');storage.setItem('_ym_uid','delete');const start=a.start(abort.signal);abort.abort();a.stop();finish();await assert.rejects(start);
 assert.equal(scripts.length,0);assert.equal(calls.length,0);assert.equal(storage.getItem('unrelated'),'keep');assert.equal(storage.getItem('_ym_uid'),null);assert.ok(cookies.length);
});
test('estate campaign/unknown neutral source/AI roots/advertising IDs work; private markers block raw context',()=>{
 for(const pathname of ['/','/index.html','/privacy.html','/consent-analytics.html'])for(const search of ['?utm_source=yandex_business&utm_campaign=dom_u_morya','?utm_source=estatepartner&utm_medium=referral&utm_campaign=new_flats_2026','?utm_source=chatgpt','?yclid=1234567890123456789','?utm_referrer=perplexity.ai']){
 const loc={pathname,search,hash:'#plans'},before=JSON.stringify(loc);assert.ok(safePage(loc,c.siteOrigin,{anchors:['plans'],referrer:'https://estatepartner.example/'}));assert.equal(JSON.stringify(loc),before);}
 for(const query of ['?phone=79529568875','?utm_campaign=private_name','?utm_campaign=79529568875','?utm_campaign=test%40example.invalid','?utm_source=yandex&token=private','?utm_source=yandex&utm_source=google'])assert.equal(safePage({pathname:'/',search:query},c.siteOrigin,{}),null);
 for(const raw of ['https://chatgpt.com/c/PRIVATE_TOKEN','https://partner.example/?email=PRIVATE_EMAIL'])assert.equal(safePage({pathname:'/',search:''},c.siteOrigin,{referrer:raw}),null);
 assert.equal(safePage({pathname:'/',hash:'#PRIVATE_TOKEN'},c.siteOrigin,{anchors:['plans']}),null);
 const internal=c.siteOrigin+'/?utm_source=estatepartner&utm_campaign=dom_u_morya';assert.equal(safePage({pathname:'/privacy.html'},c.siteOrigin,{referrer:internal}).referer,internal);
 assert.equal(safePage({pathname:'/privacy.html'},c.siteOrigin,{referrer:c.siteOrigin+'/?token=PRIVATE_TOKEN'}),null);
});
test('receipt adapter checks operation/expiry and immutable server document matches public artifact',async()=>{
 const p={action:'validate',purpose:c.purpose,consentVersion:c.analyticsConsentVersion};
 const a=createReceiptAdapter(async()=>({ok:true,json:async()=>receipt(p)}),'/api/analytics-consent.php');assert.ok(await a(p));
 for(const patch of [{action:'allow'},{expiresAt:0},{mode:'mock-only'}])await assert.rejects(createReceiptAdapter(async()=>({ok:true,json:async()=>({...receipt(p),...patch})}),'x')(p));
 const text=fs.readFileSync('ops/analytics/consent-analytics-2026-11-02-v1.txt','utf8');const php=fs.readFileSync('api/analytics-document.php','utf8');assert.ok(php.includes(text));
 for(const paragraph of text.trim().split('\n\n'))assert.ok(fs.readFileSync('consent-analytics.html','utf8').includes('<p>'+paragraph.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('\n','<br>')+'</p>'));
 const digest=createHash('sha256').update(text).digest('hex');assert.equal(digest.length,64);
 for(const name of ['index.html','privacy.html','consent-personal-data.html','consent-analytics.html']){const html=fs.readFileSync(name,'utf8');assert.ok(html.includes('data-privacy-settings'));assert.ok(html.includes('privacy/privacy.js'));assert.ok(!html.includes('mc.yandex.ru'));
  const footer=html.match(/<footer[\s\S]*?<\/footer>/)[0];assert.equal((footer.match(/href="privacy.html"/g)||[]).length,1);assert.equal((footer.match(/data-privacy-settings/g)||[]).length,1);assert.doesNotMatch(footer,/href="consent-|Информация о проекте|footer-disclosure/);assert.ok(footer.includes('ИП Саврасова'));assert.ok(footer.includes('не является застройщиком'));assert.ok(footer.includes('оферт'));
 }
 assert.ok(!fs.readFileSync('script.js','utf8').includes('domUMorya_cookieChoice'));
});
