// Shared footer regression: reuse the existing responsive footer check on all pages.
const assert=require('node:assert/strict'),path=require('node:path');
const {root,server,browser,stable,maskMap}=require('./helpers.cjs');
const out=process.env.QA_OUTPUT_DIR,pages=['index.html','privacy.html','consent-personal-data.html','consent-analytics.html'];
(async()=>{const site=await server(path.join(root,'dist')),b=await browser();try{
 for(const width of [1440,768,390,320]){
  const context=await b.newContext({viewport:{width,height:width<500?844:1000},reducedMotion:'reduce'}),p=await context.newPage();await maskMap(p);
  let baseline;
  for(const name of pages){
   await p.goto(site.url+'/'+name);await stable(p);if(await p.locator('#cookie-banner').isVisible())await p.locator('#cookie-decline').click();
   const footer=p.locator('footer');await footer.scrollIntoViewIfNeeded();
   const layout=await footer.evaluate(e=>{
    const style=getComputedStyle(e),box=e.getBoundingClientRect();return {background:style.backgroundColor,width:box.width,height:box.height,
     children:[...e.querySelectorAll('.footer-main,.footer-bottom,.footer-fineprint')].map(c=>{const r=c.getBoundingClientRect();return {x:r.x-box.x,y:r.y-box.y,width:r.width,height:r.height};})};
   });
   assert.equal(layout.background,'rgb(33, 55, 60)');if(baseline)assert.deepEqual(layout,baseline,name+': same responsive footer');else baseline=layout;
   assert.equal(await footer.locator('.footer-agency,.footer-operator').count(),0);assert.doesNotMatch(await footer.innerText(),/Саврасов|ОГРНИП|ИНН/);
   const logo=footer.locator('img');assert.equal(await logo.getAttribute('src'),'assets/logo-cropped.webp');await logo.evaluate(i=>i.decode());assert.ok(await logo.evaluate(i=>i.naturalWidth>0&&getComputedStyle(i).filter.includes('brightness(0)')));
   assert.equal(await footer.locator('.footer-brand').getAttribute('href'),'index.html#top');
   assert.equal(await footer.locator('.footer-phone').getAttribute('href'),'tel:+79529568875');assert.equal(await footer.locator('.footer-email').getAttribute('href'),'mailto:info@anyara.ru');
   const link=footer.locator('a[href="privacy.html"]');assert.equal(await link.count(),1);await link.focus();assert.equal(await link.evaluate(e=>e===document.activeElement),true);assert.ok((await link.boundingBox()).height>=44);
   const settings=footer.locator('[data-privacy-settings]');assert.ok((await settings.boundingBox()).height>=44);await settings.click();assert.equal(await p.locator('#privacy-settings').isVisible(),true);await p.keyboard.press('Escape');
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name+' '+width+': no horizontal overflow');
   if(out)await footer.screenshot({path:path.join(out,`shared-footer-${name.replace('.html','')}-${width}.png`)});
  }
  await context.close();console.log(`PASS shared footer ${width}: four pages, identical layout, contacts/links/keyboard/no overflow`);
 }
 // The common footer and document link are present before any JavaScript runs.
 const context=await b.newContext({javaScriptEnabled:false}),p=await context.newPage();await maskMap(p);
 for(const name of pages){await p.goto(site.url+'/'+name);assert.equal(await p.locator('footer.finale-footer .footer-phone').count(),1);assert.equal(await p.locator('footer a[href="privacy.html"]').count(),1);}
 await context.close();console.log('PASS shared footer no-JS on four pages');
}finally{await b.close();await site.close();}})().catch(e=>{console.error(e);process.exitCode=1});
