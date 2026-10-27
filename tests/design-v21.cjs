const assert=require('node:assert/strict');
const path=require('node:path');
const {root,server,browser,stable,maskMap}=require('./helpers.cjs');
(async()=>{
 const site=await server(path.join(root,'dist')),b=await browser();
 try{
  for(const width of [1440,768,390,320]){
   const p=await b.newPage({viewport:{width,height:900}});const errors=[];
   p.on('pageerror',e=>errors.push(e.message));
   await maskMap(p);await p.goto(site.url);await stable(p);
   assert.doesNotMatch(await p.locator('#cookie-banner').innerText(),/для работы сайта и аналитики|соглашаетесь/);
   await p.locator('#cookie-decline').click();
   assert.equal(await p.locator('#request-form').count(),1);
   assert.equal(await p.locator('a[href*="sadovoe-kolco.ru/news/"]').count(),0);
   const order=await p.evaluate(()=>['.content-faq','#contact','footer'].map(s=>document.querySelector(s).getBoundingClientRect().top));
   assert.ok(order[0]<order[1]&&order[1]<order[2],'FAQ → single CTA → footer');
   assert.equal(await p.locator('#progress time').getAttribute('datetime'),'2026-10-16');
   assert.equal(await p.locator('[data-month="2026-10"]').count(),0);
   assert.doesNotMatch(await p.locator('.consent-label').innerText(),/принимаю|политик/);
   assert.equal(await p.locator('.form-legal-note a[href="privacy.html"]').count(),1);
   for(const selector of ['#plans .plan-variants a','#plans .plan-links a','.footer-legal a','#construction-tabs button']){
    for(const box of await p.locator(selector).evaluateAll(els=>els.map(e=>({h:e.getBoundingClientRect().height,font:parseFloat(getComputedStyle(e).fontSize)})))){
     assert.ok(box.h>=44,`${width}: ${selector} height ${box.h}`);assert.ok(box.font>=12,`${width}: ${selector} font ${box.font}`);
    }
   }
   const variant=p.locator('[data-plan-view="unfurnished"]').first();await p.keyboard.press('Tab');await variant.focus();
   assert.notEqual(await variant.evaluate(e=>getComputedStyle(e).outlineStyle),'none');
   await p.keyboard.press('Space');assert.equal(await variant.getAttribute('aria-pressed'),'true');
   await p.keyboard.press('Tab');await p.keyboard.press('Enter');
   assert.equal(await p.locator('[data-plan-view="floor"]').first().getAttribute('aria-pressed'),'true');
   const faq=p.locator('.content-faq summary').first();await faq.focus();await p.keyboard.press('Enter');
   assert.equal(await p.locator('.content-faq details').first().getAttribute('open'),'');
   await p.locator('.faq-contact').click();assert.equal(new URL(p.url()).hash,'#contact');
   const legal=p.locator('footer .footer-legal a').first();await p.keyboard.press('Tab');await legal.focus();
   assert.notEqual(await legal.evaluate(e=>getComputedStyle(e).outlineStyle),'none');
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.deepEqual(errors,[]);await p.close();
   console.log(`PASS V2.1 ${width}: section order, no external news, dated status, separate consent, 44px controls, keyboard/focus, anchors and no overflow`);
  }
 }finally{await b.close();await site.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
