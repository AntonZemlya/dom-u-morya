const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {PDFDocument} = require('pdf-lib');
const {root,server,browser,stable,maskMap} = require('./helpers.cjs');
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === '--root'), 'Usage: node tests/ui.cjs [--root dist]');
const siteRoot = args.length ? path.resolve(root, args[1]) : root;
const results=[];
const evidence = process.env.QA_OUTPUT_DIR ? path.resolve(process.env.QA_OUTPUT_DIR) : null;
if(evidence) fs.mkdirSync(evidence,{recursive:true});
const documents = ['privacy.html','consent-personal-data.html'];
async function verifyContacts(page) {
 assert.ok(await page.locator('a[href="tel:+79529568875"]').count());
 assert.ok(await page.locator('a[href="mailto:info@anyara.ru"]').count());
 const text=await page.locator('body').textContent();
 for(const value of ['Саврасова Елена Анатольевна','366210396814','318366800035941']) assert.ok(text.includes(value),value);
 for(const value of ['775-28-92','info@sk-gc.ru','Артёма','© 2026 ГК']) assert.ok(!text.includes(value),value);
 for(const link of await page.locator('a[href^="tel:"]').all()) assert.equal(await link.getAttribute('href'),'tel:+79529568875');
 for(const link of await page.locator('a[href^="mailto:"]').all()) assert.equal(await link.getAttribute('href'),'mailto:info@anyara.ru');
}
async function verifyDocument(page, url, width, javaScriptEnabled) {
 const failures=[];page.on('pageerror',e=>failures.push(e.message));
 page.on('response',r=>{if(r.url().startsWith(url) && r.status()>=400)failures.push(r.status()+' '+r.url());});
 const response=await page.goto(url,{waitUntil:'load'});assert.equal(response.status(),200);
 assert.equal(await page.locator('h1').count(),1);assert.ok(await page.title());
 assert.ok(await page.locator('meta[name="description"]').getAttribute('content'));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await verifyContacts(page);
 assert.equal(await page.locator('script').count(),0,'Legal documents must be independent of JavaScript');
 assert.doesNotMatch(await page.locator('main').textContent(),/черновик|проект документа|подлежит согласованию|TODO/i);
 for(const link of await page.locator('a[href^="#"]').all()) {
  const href=await link.getAttribute('href');assert.equal(await page.locator(href).count(),1,href);
 }
 await page.locator('.legal-toc a').first().click();
 assert.ok(await page.locator('section').first().isVisible());
 await page.locator('.legal-back').focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
 assert.equal(await page.locator('.legal-back').evaluate(el=>el===document.activeElement),true);
 assert.notEqual(await page.locator('.legal-back').evaluate(el=>getComputedStyle(el).outlineStyle),'none');
 assert.deepEqual(failures,[]);
 if(evidence && javaScriptEnabled) {
  await page.locator('.legal-back').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(evidence,path.basename(new URL(url).pathname,'.html')+'-'+width+'.jpg'),fullPage:true,type:'jpeg',quality:80});
 }
}
const money = s => Number(s.replace(/\D/g,''));
const annuity=(p,d,t,r)=>p*(1-d/100)*(r/1200)/(1-(1+r/1200)**(-t*12));
(async()=>{
 const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dom-u-morya-ui-'));
 const site=await server(siteRoot);let b;
 try {
  b=await browser();
  console.log('Testing '+siteRoot);
  for(const width of [1440,768,390]){
   const context=await b.newContext({viewport:{width,height:width===390?844:1000},acceptDownloads:true});const page=await context.newPage();
   const errors=[],requests=[];page.on('response',r=>{if(r.url().startsWith(site.url) && r.status()>=400)errors.push(r.status()+' '+r.url())});page.on('requestfailed',r=>{if(r.url().startsWith(site.url))errors.push(r.failure().errorText+' '+r.url())});page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});page.on('request',r=>{if(r.method()!=='GET' || ['fetch','xhr'].includes(r.resourceType()) || /test%40example|Тестовая|%D0%A2%D0%B5%D1%81%D1%82|70000000000/i.test(r.url()))requests.push({method:r.method(),url:r.url()})});
   await maskMap(page);await page.goto(site.url,{waitUntil:'domcontentloaded'});await stable(page);
   assert.equal(await page.locator('h1').count(),1);assert.ok(await page.title());assert.equal(await page.locator('meta[name=description]').count(),1);await verifyContacts(page);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('a[href^="#"]')].filter(a=>!document.getElementById(a.hash.slice(1))).map(a=>a.hash)),[]);
   const images=await page.evaluate(async()=>{
    const urls=new Set([...document.images].map(i=>i.src));
    document.querySelectorAll('*').forEach(el=>{const bg=getComputedStyle(el).backgroundImage;if(bg.includes('data:'))return;for(const m of bg.matchAll(/url\(["']?([^"')]+)["']?\)/g))if(!m[1].startsWith('data:'))urls.add(new URL(m[1],location.href).href)});
    return Promise.all([...urls].map(url=>new Promise(resolve=>{const i=new Image();i.onload=()=>resolve({url,ok:true});i.onerror=()=>resolve({url,ok:false});i.src=url})));
   });assert.ok(images.every(i=>i.ok),JSON.stringify(images));
   // Both informational notice choices persist independently; neither enables analytics.
   assert.equal(await page.locator('#cookie-banner').isVisible(),true);await page.locator('#cookie-accept').click();await page.reload({waitUntil:'domcontentloaded'});await stable(page);assert.equal(await page.locator('#cookie-banner').isVisible(),false);
   await page.evaluate(()=>localStorage.removeItem('domUMorya_cookieChoice'));await page.reload({waitUntil:'domcontentloaded'});await stable(page);await page.locator('#cookie-decline').click();await page.reload({waitUntil:'domcontentloaded'});await stable(page);assert.equal(await page.locator('#cookie-banner').isVisible(),false);assert.equal(await page.evaluate(()=>localStorage.getItem('domUMorya_cookieChoice')),'declined');
   if(width<=1140){await page.locator('#nav-toggle').click();assert.equal(await page.locator('#nav-toggle').getAttribute('aria-expanded'),'true');await page.keyboard.press('Escape');assert.equal(await page.locator('#nav-toggle').getAttribute('aria-expanded'),'false');await page.locator('#nav-toggle').click();await page.locator('#mobile-menu a[href="#about"]').click();assert.equal(await page.locator('#nav-toggle').getAttribute('aria-expanded'),'false');}
   const heights=[];for(const tab of ['arch','yard','service']){await page.locator('[data-about-tab="'+tab+'"]').click();heights.push(await page.locator('#about').evaluate(el=>el.getBoundingClientRect().height));}assert.ok(Math.max(...heights)-Math.min(...heights)<1,JSON.stringify(heights));
   await page.locator('[data-about-tab="service"]').focus();await page.keyboard.press('ArrowLeft');assert.equal(await page.locator('[data-about-tab="yard"]').getAttribute('aria-selected'),'true');await page.keyboard.press('Home');assert.equal(await page.locator('[data-about-tab="arch"]').getAttribute('aria-selected'),'true');
   for(const [category,count] of [['studio',5],['1k',3],['2k',1],['3k',1]]){await page.locator('[data-tab="'+category+'"]').click();assert.equal(await page.locator('#plans-grid .card').count(),count);}
   await page.locator('[data-view="cats"]').click();assert.equal(await page.locator('#category-grid .category-card').count(),4);await page.locator('[data-category="1k"][data-category-action="lots"]').click();assert.equal(await page.locator('#plans-grid .card').count(),3);
   const thumb=page.locator('#plans-grid .plan-thumb').first();await thumb.click();assert.equal(await page.locator('#lightbox').isVisible(),true);await page.keyboard.press('ArrowRight');assert.match(await page.locator('#lightbox-position').textContent(),/2 из 3/);await page.keyboard.press('Tab');assert.ok(await page.evaluate(()=>document.getElementById('lightbox').contains(document.activeElement)));await page.keyboard.press('Escape');assert.equal(await page.locator('#lightbox').isVisible(),false);assert.equal(await thumb.evaluate(el=>el===document.activeElement),true);
   await page.locator('#gallery-grid .gallery-item').first().click();await page.keyboard.press('ArrowLeft');assert.match(await page.locator('#lightbox-position').textContent(),/6 из 6/);
   await page.locator('#lightbox-image').dispatchEvent('touchstart',{touches:[{identifier:0,clientX:250,clientY:250}]});
   await page.locator('#lightbox-image').dispatchEvent('touchmove',{touches:[{identifier:0,clientX:100,clientY:250}]});
   await page.locator('#lightbox-image').dispatchEvent('touchend',{touches:[],changedTouches:[{identifier:0,clientX:100,clientY:250}]});
   assert.match(await page.locator('#lightbox-position').textContent(),/1 из 6/);
   await page.locator('#lightbox-close').click();
   await page.locator('#plans-grid [data-action="calc-here"]').nth(1).click();assert.match(await page.locator('#calc-plan-title').textContent(),/1 спальня/);assert.equal(money(await page.locator('#price-label').textContent()),7885023);
   const setRange=async(id,value)=>page.locator('#'+id+'-range').evaluate((el,value)=>{el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));},value);
   await setRange('down',20);await setRange('term',20);await setRange('rate',6);
   assert.equal(money(await page.locator('#payment-label').textContent()),Math.round(annuity(7885023,20,20,6)));
   assert.equal(money(await page.locator('#income-label').textContent()),Math.round(annuity(7885023,20,20,6)/.4));
   assert.equal(money(await page.locator('#loan-label').textContent()),Math.round(7885023*.8));
   await page.locator('#send-to-form').click();assert.match(await page.locator('#form-title').textContent(),/Обсудим ваш расчёт/);assert.match(await page.locator('#snapshot-slot').textContent(),/Платёж/);
   assert.equal(await page.locator('#submit-btn').isEnabled(),false);await page.locator('#name-input').fill('Тестовая заявка');await page.locator('#phone-input').fill('70000000000');
   assert.equal(await page.locator('#consent-input').isChecked(),false);
   assert.equal(await page.locator('#submit-btn').isEnabled(),false);
   await page.locator('#request-form').evaluate(el=>el.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
   assert.equal(await page.locator('#form-status').isVisible(),false);
   for(const filename of documents) {
    const link=page.locator('#request-form a[href="'+filename+'"]').first();
    assert.equal(await link.getAttribute('target'),'_blank');
    await link.focus();const popupPromise=page.waitForEvent('popup');await page.keyboard.press('Enter');
    const popup=await popupPromise;await popup.waitForLoadState('load');assert.equal(new URL(popup.url()).pathname,'/'+filename);await popup.close();
    assert.equal(await page.locator('#name-input').inputValue(),'Тестовая заявка');
    assert.equal(await page.locator('#phone-input').inputValue(),'+7 (000) 000-00-00');
    assert.equal(await page.locator('#consent-input').isChecked(),false,'Opening consent must not select it');
   }
   // Mouse navigation is independently available, with the same preservation guarantee.
   const mousePopupPromise=page.waitForEvent('popup');await page.locator('#request-form a[href="consent-personal-data.html"]').click();
   const mousePopup=await mousePopupPromise;await mousePopup.waitForLoadState('load');await mousePopup.close();
   assert.equal(await page.locator('#consent-input').isChecked(),false);
   assert.equal(await page.locator('#phone-input').inputValue(),'+7 (000) 000-00-00');await page.locator('#consent-input').check();
   await page.locator('.more-field-btn[data-field="email"]').click();await page.locator('#email-input').fill('bad');await page.locator('#name-input').focus();assert.equal(await page.locator('#email-error').isVisible(),true);assert.equal(await page.locator('#submit-btn').isEnabled(),false);await page.locator('#email-input').fill('test@example.invalid');
   await page.locator('#consent-input').uncheck();assert.equal(await page.locator('#submit-btn').isEnabled(),false);
   await page.locator('#consent-input').focus();await page.keyboard.press('Space');assert.equal(await page.locator('#consent-input').isChecked(),true);
   for(const f of ['channel','time']){await page.locator('.more-field-btn[data-field="'+f+'"]').click();}await page.locator('[data-chip-value="Telegram"]').click();await page.locator('[data-chip-value="12-15"]').click();
   await page.locator('#submit-btn').click();assert.match(await page.locator('#form-status').textContent(),/Данные не отправлены/);assert.equal(await page.locator('text=Заявка принята').count(),0);assert.deepEqual(requests,[]);
   await page.locator('#snapshot-remove-btn').click();assert.equal(await page.locator('#snapshot-slot').isVisible(),false);
   // Exercise input bounds and detach a selected plan on a custom price change.
   await setRange('price',20000000);await setRange('down',70);await setRange('term',3);await setRange('rate',20);assert.equal(money(await page.locator('#payment-label').textContent()),Math.round(annuity(20000000,70,3,20)));assert.match(await page.locator('#calc-plan-title').textContent(),/не выбрана/);
   await page.locator('#map-unlock').click();assert.equal(await page.locator('#location-map').getAttribute('tabindex'),'0');await page.locator('#phone-input').focus();assert.equal(await page.locator('#map-unlock').isVisible(),true);
   if(width===1440){
    // The exported PDF is rasterized; inspect its source sheet as well as the resulting download.
    const originalMakePdf=await page.evaluate(()=>{window.__qaOriginalMakePdf=makeCalcPdf;makeCalcPdf=(html,filename)=>{window.__qaPdfHtml=html;return window.__qaOriginalMakePdf(html,filename)};return true;});
    assert.equal(originalMakePdf,true);
    const downloadPromise=page.waitForEvent('download');await page.locator('#download-calc').click();const download=await downloadPromise;const target=path.join(temp,'mortgage-example.pdf');await download.saveAs(target);const bytes=fs.readFileSync(target);assert.equal(bytes.subarray(0,4).toString(),'%PDF');const pdf=await PDFDocument.load(bytes);assert.equal(pdf.getPageCount(),1);assert.ok(bytes.length>20000);assert.equal(await page.locator('#pdf-status').isVisible(),false);
    const pdfHtml=await page.evaluate(()=>window.__qaPdfHtml);
    for(const value of ['Консультации агентства','Саврасова Елена Анатольевна','366210396814','318366800035941','+7 (952) 956-88-75','info@anyara.ru']) assert.ok(pdfHtml.includes(value),value);
    assert.doesNotMatch(pdfHtml,/775-28-92|info@sk-gc.ru|Офис продаж|Артёма/);
    if(evidence) fs.copyFileSync(target,path.join(evidence,'mortgage-example.pdf'));
   }
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.deepEqual(errors,[]);
   if(evidence) {
    await page.locator('#contact').screenshot({path:path.join(evidence,'contact-'+width+'.jpg'),type:'jpeg',quality:85,style:'#site-header, #scroll-top-btn, .page-style-1, .page-style-2 {visibility:hidden!important}'});
    await page.locator('footer').screenshot({path:path.join(evidence,'footer-'+width+'.jpg'),type:'jpeg',quality:85,style:'#site-header, #scroll-top-btn, .page-style-1, .page-style-2 {visibility:hidden!important}'});
   }
   for(const filename of documents) {
    const documentPage=await context.newPage();await verifyDocument(documentPage,site.url+'/'+filename,width,true);await documentPage.close();
   }
   results.push({width,status:'passed',aboutHeights:heights,localImages:images.length,consoleErrors:errors,nonGetRequests:requests.length});await context.close();console.log('PASS '+width+'px: layout, images, anchors, cookies, tabs, plans, lightbox, calculator, form, map'+(width===1440?', PDF':''));
  }
  const motionPage=await b.newPage({viewport:{width:1440,height:1000}});await maskMap(motionPage);await motionPage.goto(site.url,{waitUntil:'domcontentloaded'});
  await motionPage.waitForSelector('html.reveal-ready');
  await motionPage.waitForFunction(()=>getComputedStyle(document.getElementById('about')).opacity==='0');
  assert.equal(await motionPage.locator('#about').evaluate(el=>getComputedStyle(el).opacity),'0');
  assert.equal(await motionPage.locator('.loc-zoom').first().evaluate(el=>getComputedStyle(el).animationName),'locZoom');
  await motionPage.locator('#cookie-decline').click();await motionPage.locator('#about').scrollIntoViewIfNeeded();
  await motionPage.waitForFunction(()=>getComputedStyle(document.getElementById('about')).opacity==='1');
  assert.equal(await motionPage.locator('#scroll-top-btn').isVisible(),true);
  await motionPage.emulateMedia({reducedMotion:'reduce'});assert.equal(await motionPage.locator('.loc-zoom').first().evaluate(el=>getComputedStyle(el).animationName),'none');
  await motionPage.locator('.skip-link').focus();assert.equal(await motionPage.locator('.skip-link').evaluate(el=>getComputedStyle(el).clipPath),'none');await motionPage.close();
  console.log('PASS reveal animations, reduced motion and skip-link focus');
  const offline=await b.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});const p=await offline.newPage();await p.goto(site.url);assert.equal(await p.locator('h1').count(),1);assert.equal(await p.locator('#request-form').count(),1);assert.equal(await p.locator('#plans-grid .card').count(),5);assert.equal(await p.locator('#gallery-grid .gallery-item').count(),6);assert.match(await p.locator('#form-title').textContent(),/Оставьте заявку/);assert.equal(await p.locator('#about').isVisible(),true);await offline.close();
  for(const width of [1440,768,390]) {
   const noScript=await b.newContext({javaScriptEnabled:false,viewport:{width,height:1000}});
   for(const filename of documents) {
    const documentPage=await noScript.newPage();await verifyDocument(documentPage,site.url+'/'+filename,width,false);await documentPage.close();
   }
   await noScript.close();
  }
  console.log('PASS '+results.length+' viewports: legal pages with/without JavaScript, agency contacts, independent consent, preserved form data and updated PDF');
 }finally{if(b)await b.close();await site.close();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
