const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {PDFDocument}=require('pdf-lib');
const {root,server,browser,stable,maskMap}=require('./helpers.cjs');
const apartments=require('../data/apartments.json');
const {withNofollow}=require('./external-links.cjs');
const out=process.env.QA_OUTPUT_DIR;
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const base=execFileSync('git',['show','1d79ebc:index.html'],{cwd:root,encoding:'utf8',maxBuffer:1e6});
for(const id of ['hero-section','about','location','gallery','progress','developer']){
 const re=new RegExp(`<section id="${id}"[\\s\\S]*?<\\/section>`);
 assert.equal(require('./seo-contract.cjs').semantic(html.match(re)[0]),withNofollow(base.match(re)[0]),`${id} source unchanged from V2.2`);
}
for(const file of ['data/apartments.json','data/plan-groups.json','data/media.json']){
 assert.deepEqual(fs.readFileSync(path.join(root,file)),Buffer.from(withNofollow(execFileSync('git',['show','1d79ebc:'+file],{cwd:root,maxBuffer:5e6}))),file+' unchanged except external nofollow');
}
require('./legal-contract.cjs')(root);
const money=s=>Number(s.replace(/\D/g,''));
const payment=(p,d,t,r)=>Math.round(p*(1-d/100)*(r/1200)/(1-(1+r/1200)**(-12*t)));
(async()=>{const site=await server(path.join(root,'dist')),b=await browser();try{
 for(const width of [1440,768,390,320]){
  const context=await b.newContext({viewport:{width,height:width<500?844:1000},reducedMotion:'reduce',acceptDownloads:true});
  const p=await context.newPage(),errors=[],writes=[];
  p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.method()!=='GET')writes.push(r.url());});
  await maskMap(p);await p.goto(site.url);await stable(p);await p.locator('#cookie-decline').click();
  const toggle=p.locator('#toggle-filters'),panel=p.locator('#catalog-controls');
  assert.equal(await toggle.getAttribute('aria-controls'),'catalog-controls');
  assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await panel.isVisible(),false);
  // Opening and closing never replaces any card, losing its focus or selected view.
  await p.locator('#plans-grid .card').first().evaluate(e=>window.__firstCard=e);
  await toggle.focus();await p.keyboard.press('Enter');assert.equal(await panel.isVisible(),true);
  assert.equal(await toggle.getAttribute('aria-expanded'),'true');
  await p.keyboard.press('Space');assert.equal(await panel.isVisible(),false);
  assert.equal(await p.locator('#plans-grid .card').first().evaluate(e=>e===window.__firstCard),true);
  await toggle.click();await p.locator('[data-tab="1k"]').click();
  await p.locator('#budget-filter').selectOption('10000000');await p.locator('#floor-filter').selectOption('3');
  await p.locator('#sort-filter').selectOption('area');assert.equal(await p.locator('#filter-count').innerText(),'3');
  const ids=await p.locator('#plans-grid [data-lot-id]').evaluateAll(es=>es.map(e=>e.dataset.lotId));
  const expected=apartments.filter(a=>a.bedrooms===1&&a.price_rub<=10000000&&a.floor===3).sort((a,b)=>a.area_m2-b.area_m2||a.number-b.number).map(a=>a.id);
  assert.deepEqual(ids,expected);
  await toggle.click();assert.equal(await panel.isVisible(),false);assert.equal(await p.locator('#reset-filters-compact').isVisible(),true);
  await p.locator('[data-view="cats"]').click();assert.equal(await toggle.isVisible(),false);assert.equal(await p.locator('#category-grid .category-card').count(),4);
  await p.locator('[data-view="lots"]').click();assert.equal(await panel.isVisible(),false);await toggle.click();
  for(const [id,value] of [['budget','10000000'],['floor','3'],['sort','area']])assert.equal(await p.locator(`#${id}-filter`).inputValue(),value);
  assert.deepEqual(await p.locator('#plans-grid [data-lot-id]').evaluateAll(es=>es.map(e=>e.dataset.lotId)),ids);
  await p.locator('#floor-filter').focus();await p.keyboard.press('Escape');assert.equal(await panel.isVisible(),false);assert.equal(await toggle.evaluate(e=>e===document.activeElement),true);
  await p.locator('#reset-filters-compact').click();assert.equal(await toggle.evaluate(e=>e===document.activeElement),true);assert.equal(await p.locator('#filter-count').isVisible(),false);
  await toggle.click();await p.locator('#layout-filter').selectOption('layout-12c10e0ed8f5');await p.locator('#sea-filter').check();
  await toggle.click();await toggle.click();assert.equal(await p.locator('#layout-filter').inputValue(),'layout-12c10e0ed8f5');assert.equal(await p.locator('#sea-filter').isChecked(),true);
  await p.locator('#reset-filters').click();assert.equal(await p.locator('#sea-filter').isChecked(),false);assert.equal(await p.locator('#layout-filter').inputValue(),'');
  if(out)await p.locator('#plans').screenshot({path:path.join(out,`filters-open-${width}.png`)});
  await toggle.click();if(out)await p.locator('#plans').screenshot({path:path.join(out,`filters-closed-${width}.png`)});
  const setRange=(id,value)=>p.locator(`#${id}-range`).evaluate((el,v)=>{el.value=String(v);el.dispatchEvent(new Event('input',{bubbles:true}));},value);
  // Preserve a concrete apartment, floor-plan variant, price and term across both presets.
  await p.locator('[data-tab="3k"]').click();const lot=apartments.find(a=>a.id==='23037'),card=p.locator('[data-lot-id="23037"]');
  await card.locator('[data-plan-view="floor"]').click();await card.locator('[data-action="calc-here"]').click();await setRange('term',17);await setRange('down',10);
  for(const [key,rate,down,limit] of [['family',6,20,12000000],['regional',2,20,6000000]]){
   await p.locator(`[data-mortgage-program="${key}"]`).click();
   assert.equal(await p.evaluate(()=>document.activeElement.id),'mortgage-program');
   assert.equal(await p.locator('#rate-range').inputValue(),String(rate));assert.equal(await p.locator('#rate-label').innerText(),rate.toFixed(1)+'%');
   assert.equal(await p.locator('#down-range').inputValue(),String(down));assert.equal(await p.locator('#down-range').getAttribute('min'),key==='family'?'20':'10');
   assert.equal(await p.locator('#term-range').inputValue(),'17');assert.equal(money(await p.locator('#price-label').innerText()),lot.price_rub);
   assert.match(await p.locator('#calc-plan-meta').innerText(),/ID 23037.*На этаже/);
   assert.equal(money(await p.locator('#payment-label').innerText()),payment(lot.price_rub,down,17,rate));
   assert.equal(await p.locator('#mortgage-warning').isVisible(),true);const warning=await p.locator('#mortgage-warning').innerText();assert.ok(warning.includes(limit.toLocaleString('ru-RU')));assert.match(warning,/не означает её доступность на всю сумму/);
   await p.locator('#send-to-form').click();const snapshot=await p.locator('#snapshot-slot').innerText();assert.match(snapshot,/23037/);assert.ok(snapshot.includes(warning));assert.equal(await p.evaluate(()=>state.snapshot.lotId),'23037');assert.match(snapshot,new RegExp(rate.toFixed(1).replace('.','\\.')+'%'));
   if(width===1440){
    await p.evaluate(()=>{window.__pdfOriginal=makeCalcPdf;makeCalcPdf=(html,name)=>{window.__pdfHtml=html;return window.__pdfOriginal(html,name);};});
    const pending=p.waitForEvent('download');await p.locator('#download-calc').click();const dl=await pending;
    const target=out?path.join(out,`mortgage-${key}.pdf`):path.join(require('os').tmpdir(),`eng001-${key}.pdf`);await dl.saveAs(target);
    assert.equal((await PDFDocument.load(fs.readFileSync(target))).getPageCount(),1);
    const doc=await p.evaluate(()=>window.__pdfHtml);for(const value of ['ID 23037','На этаже',lot.price_rub.toLocaleString('ru-RU'),warning,`${rate.toFixed(1)}%`])assert.ok(doc.includes(value),value);
    await p.waitForFunction(()=>!state.pdfBusy);assert.equal(await p.locator('#pdf-status').isVisible(),false);await p.evaluate(()=>makeCalcPdf=window.__pdfOriginal);
    if(!out)fs.unlinkSync(target);
   }
  }
  await setRange('down',45);await p.locator('[data-mortgage-program="family"]').click();assert.equal(await p.locator('#down-range').inputValue(),'45');
  await p.locator('[data-mortgage-program="regional"]').click();assert.equal(await p.locator('#down-range').inputValue(),'45');
  await setRange('rate',7.5);assert.match(await p.locator('#mortgage-program').innerText(),/Индивидуальная ставка/);assert.equal(await p.locator('#mortgage-warning').isVisible(),false);
  await setRange('down',10);await p.locator('[data-mortgage-program="regional"]').click();assert.equal(await p.locator('#down-range').inputValue(),'10');
  await setRange('price',10000000);await setRange('down',40);assert.equal(await p.locator('#mortgage-warning').isVisible(),false,'Exactly 6m is within limit');await setRange('down',39);assert.equal(await p.locator('#mortgage-warning').isVisible(),true);
  await p.locator('[data-mortgage-program="family"]').click();assert.equal(await p.locator('#mortgage-warning').isVisible(),false);await setRange('price',20000000);await setRange('down',40);assert.equal(await p.locator('#mortgage-warning').isVisible(),false,'Exactly 12m is within limit');await setRange('down',39);assert.equal(await p.locator('#mortgage-warning').isVisible(),true);
  if(out)await p.locator('#calculator').screenshot({path:path.join(out,`mortgage-${width}.png`)});
  const before=await p.evaluate(()=>({id:state.selectedPlanId,rate:state.rate,term:state.term,price:state.price}));await p.locator('[data-action="ask-fullpay"]').click();assert.match(await p.locator('#snapshot-slot').innerText(),/100% оплата/);assert.deepEqual(await p.evaluate(()=>({id:state.selectedPlanId,rate:state.rate,term:state.term,price:state.price})),before);
  await p.locator('#send-to-form').click();await p.locator('#name-input').fill('Локальная проверка');await p.locator('#phone-input').fill('70000000000');await p.locator('#consent-input').check();assert.equal(await p.locator('#submit-btn').isEnabled(),false);assert.match(await p.locator('#form-availability').innerText(),/Данные не отправлены/);assert.deepEqual(writes,[]);
  for(const doc of ['privacy.html','consent-personal-data.html'])assert.equal((await p.request.get(site.url+'/'+doc)).status(),200);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  await context.close();console.log(`PASS ENG-001 ${width}: disclosure/keyboard/persistence/reset, both mortgage presets/thresholds/lot/term/context${width===1440?'/PDFs':''}, limits, manual rate, full payment, honest no-send, legal links, no overflow/errors`);
 }
 const c=await b.newContext({javaScriptEnabled:false,viewport:{width:320,height:844}}),p=await c.newPage();await maskMap(p);await p.goto(site.url);
 assert.equal(await p.locator('#toggle-filters').isVisible(),false);assert.equal(await p.locator('#catalog-controls').isVisible(),false);assert.equal(await p.locator('#plans-grid [data-lot-id]').count(),28);
 for(const item of await p.locator('.static-category').all()){if(!await item.evaluate(e=>e.open))await item.locator('summary').first().click();assert.ok(await item.locator('.card').first().isVisible());}
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await c.close();console.log('PASS ENG-001 no-JS: all 28 lots accessible at 320px; protected sections/data/legal unchanged');
}finally{await b.close();await site.close();}})().catch(e=>{console.error(e);process.exitCode=1});
