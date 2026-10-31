const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {browser,stable,maskMap,root}=require('./helpers.cjs');
const base=process.env.LEAD_QA_URL,temp=process.env.LEAD_QA_DIR;
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)||!temp)throw Error('Only temporary local PHP QA is allowed');
const mails=()=>fs.existsSync(path.join(temp,'fake-mail.json'))?JSON.parse(fs.readFileSync(path.join(temp,'fake-mail.json'))):[];
const reset=()=>{fs.writeFileSync(path.join(temp,'state/state.json'),JSON.stringify({items:{},rates:{}}),{mode:0o600});fs.rmSync(path.join(temp,'fake-mail.json'),{force:true});};
const out=path.join(root,'.test-output/form-002');fs.mkdirSync(out,{recursive:true});
async function fill(p){await p.locator('#name-input').fill('Синтетический тест');await p.locator('#phone-input').fill('70000000000');await p.locator('#consent-input').check();}
(async()=>{const b=await browser();try{
 for(const width of [1440,768,390,320]){
  reset();const p=await b.newPage({viewport:{width,height:width<500?844:1000}});const errors=[];p.on('pageerror',e=>errors.push(e.message));await maskMap(p);
  await p.goto(base+'/?form-qa');await stable(p);await p.locator('#cookie-decline').click();
  await p.locator('#plans-grid [data-action="ask-plan"]').first().click();
  assert.match(await p.locator('#snapshot-slot').innerText(),/22825/);
  assert.equal(await p.locator('#consent-input').isChecked(),false);
  await p.locator('#request-form').screenshot({path:path.join(out,`form-${width}.png`)});
  await fill(p);await p.waitForFunction(()=>!document.getElementById('submit-btn').disabled);
  // Live-enabled UI must hide the disabled-service notice without removing the fallback.
  assert.equal(await p.locator('#form-availability').isVisible(),false);
  let posted; p.on('request',r=>{if(r.method()==='POST')posted=r;});
  await p.locator('#submit-btn').click();await p.waitForFunction(()=>document.getElementById('form-status').textContent.includes('Запрос принят на обработку'));
  assert.equal(mails().length,1);assert.match(mails()[0].body,/Квартира № 6 \(лот 22825\)/);
  assert.equal(posted.postDataJSON().lotId,'22825');assert.equal(posted.postDataJSON().phone,'+70000000000');
  assert.equal(posted.postDataJSON().consent,true);assert.equal(await p.locator('#consent-input').isChecked(),false);
  // A 202 is a completed request, not another request for consent.
  assert.equal(await p.locator('#consent-error').isVisible(),false);
  assert.equal(await p.locator('#consent-input').getAttribute('aria-invalid'),'false');
  assert.equal(await p.locator('#submit-btn').isEnabled(),false);
  assert.equal(await p.locator('#form-status').isVisible(),true);
  const reply=await fetch(base+'/api/lead.php',{method:'POST',headers:{'Content-Type':'application/json','Origin':base,'X-Lead-Request':'1','Idempotency-Key':posted.headers()['idempotency-key']},body:posted.postData()});
  assert.equal(reply.status,202);assert.match(reply.headers.get('cache-control'),/no-store/);assert.equal(mails().length,1);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  await p.locator('#form-status').focus();assert.equal(await p.locator('#form-status').evaluate(e=>e===document.activeElement),true);
  await p.close();console.log('PASS PHP HTTP/browser selected lot, consent, UTF-8 mail, replay and accessibility '+width);
 }
 reset();const p=await b.newPage({viewport:{width:1440,height:1000}});await maskMap(p);await p.goto(base+'/?form-qa');await stable(p);await p.locator('#cookie-decline').click();
 await p.locator('#plans-grid [data-action="calc-here"]').first().click();
 await p.evaluate(()=>{state.downPct=20;state.term=20;state.rate=6;state.mortgageProgram='family';renderCalculator();});
 await p.locator('#send-to-form').click();await fill(p);
 for(const field of ['email','channel','time'])await p.locator(`.more-field-btn[data-field="${field}"]`).click();
 await p.locator('#email-input').fill('synthetic@example.invalid');
 await p.locator('#channel-chips [data-chip-value="Telegram"]').click();
 await p.locator('#time-chips [data-chip-value="12-15"]').click();
 // Lose the first response after the server accepted it, then retry with the same key.
 await p.route('**/api/lead.php',async route=>{await route.fetch();await route.abort('failed');});
 await p.locator('#submit-btn').click();await p.waitForFunction(()=>document.getElementById('form-status').textContent.includes('Не удалось подтвердить'));
 assert.equal(mails().length,1);await p.unroute('**/api/lead.php');await p.locator('#submit-btn').click();
 await p.waitForFunction(()=>document.getElementById('form-status').textContent.includes('Запрос принят на обработку'));assert.equal(mails().length,1);
 assert.match(mails()[0].body,/ИПОТЕЧНЫЙ РАСЧЁТ/);
 for(const text of ['Квартира № 6 (лот 22825)','6 978 183 ₽','Первоначальный взнос: 20%','Срок: 20 лет','Ставка: 6%','Программа: Семейная ипотека','synthetic@example.invalid','Способ связи: Telegram','Удобное время: 12:00–15:00'])assert.ok(mails()[0].body.includes(text),text);
 for(const [code,copy] of [[422,'Проверьте'],[429,'Слишком много'],[409,'Повторная отправка'],[500,'Запрос не принят'],[503,'временно недоступен']]){
  await p.route('**/api/lead.php',r=>r.fulfill({status:code,contentType:'application/json',body:'{"ok":false}'}));
  await p.locator('#consent-input').check();await p.locator('#submit-btn').click();await p.waitForFunction(copy=>document.getElementById('form-status').textContent.includes(copy),copy);
  assert.doesNotMatch(await p.locator('#form-status').innerText(),/Запрос принят/);await p.unroute('**/api/lead.php');
 }
 assert.equal(mails().length,1);
 await p.route('**/api/lead.php',r=>r.fulfill({status:200,contentType:'text/html',body:'<b>untrusted server diagnostic</b>'}));
 await p.locator('#consent-input').check();await p.locator('#submit-btn').click();
 await p.waitForFunction(()=>document.getElementById('form-status').textContent.includes('Ответ сервера не подтвердил'));
 assert.doesNotMatch(await p.locator('#form-status').innerText(),/untrusted server diagnostic|Запрос принят/);await p.unroute('**/api/lead.php');
 // HTTP envelope/security rejection paths against PHP, without a real mail transport.
 const post=(body,headers={},method='POST')=>fetch(base+'/api/lead.php',{method,headers:{'Content-Type':'application/json','Origin':base,'X-Lead-Request':'1','Idempotency-Key':'a'.repeat(32),...headers},...(method==='GET'?{}:{body})});
 for(const [response,code] of [[await post('{}',{},'GET'),405],[await post('{broken'),400],[await post('x'.repeat(8193)),413],[await post('{}',{'Origin':'https://forged.invalid'}),403],[await post('{}',{'Content-Type':'text/plain'}),415]]){
  assert.equal(response.status,code);assert.match(response.headers.get('cache-control'),/no-store/);assert.equal(response.headers.get('access-control-allow-origin'),null);
 }
 await p.locator('#calc-plan-clear').click();
 await p.locator('#rate-range').evaluate(e=>{e.value='7.5';e.dispatchEvent(new Event('input',{bubbles:true}));});
 await p.locator('#send-to-form').click();await p.locator('#consent-input').check();await p.locator('#submit-btn').click();
 await p.waitForFunction(()=>document.getElementById('form-status').textContent.includes('Запрос принят на обработку'));
 assert.equal(mails().length,2);assert.match(mails()[1].body,/Ставка: 7,5%/);assert.match(mails()[1].body,/Программа: Индивидуальный расчёт/);assert.doesNotMatch(mails()[1].body,/КВАРТИРА/);
 fs.unlinkSync(path.join(temp,'config.php'));
 assert.equal((await (await fetch(base+'/api/form-status.php')).json()).enabled,false);assert.equal((await post('{}',{'Origin':'https://zhk-dom-umorya.ru'})).status,503);
 await p.reload();await fill(p);assert.equal(await p.locator('#submit-btn').isEnabled(),false);assert.match(await p.locator('#form-availability').innerText(),/временно выключен/);
 await p.close();const nojs=await b.newContext({javaScriptEnabled:false,viewport:{width:320,height:844}});const n=await nojs.newPage();await n.goto(base);
 assert.equal(await n.locator('#plans-grid .card').count(),28);assert.equal(await n.locator('#submit-btn').isEnabled(),false);assert.equal(await n.locator('#request-form').getAttribute('method'),'post');
 assert.equal(await n.locator('a[href="tel:+79529568875"]').first().isVisible(),true);await nojs.close();
 console.log('PASS lost response retry, full family/manual calc MIME, 4xx/5xx honesty, missing config, no-JS and no real email');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1});
