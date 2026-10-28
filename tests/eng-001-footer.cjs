const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {root,server,browser,stable,maskMap}=require('./helpers.cjs');
const out=process.env.QA_OUTPUT_DIR;
(async()=>{const site=await server(path.join(root,'dist')),b=await browser();try{
 for(const width of [1440,768,390,320]){
  const p=await b.newPage({viewport:{width,height:width<500?844:1000},reducedMotion:'reduce'});await maskMap(p);await p.goto(site.url);await stable(p);await p.locator('#cookie-decline').click();
  const footer=p.locator('footer');await footer.scrollIntoViewIfNeeded();
  assert.equal(await footer.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(33, 55, 60)');
  assert.equal(await footer.locator('.footer-agency').count(),0);assert.equal(await footer.locator('.footer-bottom').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
  assert.match(await footer.locator('.footer-operator').innerText(),/Саврасова Елена Анатольевна.*366210396814.*318366800035941/);
  const logo=footer.locator('img');assert.equal(await logo.getAttribute('src'),'assets/logo-cropped.webp');await logo.evaluate(i=>i.decode());assert.ok(await logo.evaluate(i=>i.naturalWidth>0&&getComputedStyle(i).filter.includes('brightness(0)')));
  assert.equal(await footer.locator('.footer-phone').getAttribute('href'),'tel:+79529568875');assert.equal(await footer.locator('.footer-email').getAttribute('href'),'mailto:info@anyara.ru');
  for(const doc of ['privacy.html','consent-personal-data.html']){
   const link=footer.locator(`a[href="${doc}"]`);assert.equal(await link.count(),1);await link.focus();assert.equal(await link.evaluate(e=>e===document.activeElement),true);assert.ok((await link.boundingBox()).height>=44);assert.equal((await p.request.get(site.url+'/'+doc)).status(),200);
  }
  await footer.locator('summary').focus();await p.keyboard.press('Enter');assert.equal(await footer.locator('details').evaluate(e=>e.open),true);await p.keyboard.press('Enter');
  // Local links and all footer targets have a destination; external project link is retained.
  assert.deepEqual(await footer.locator('a[href^="#"]').evaluateAll(es=>es.filter(e=>!document.getElementById(e.hash.slice(1))).map(e=>e.hash)),[]);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(out){await p.locator('body').click({position:{x:5,y:5}});await footer.screenshot({path:path.join(out,`footer-after-${width}.png`)});}
  await p.close();console.log(`PASS ENG-001 footer ${width}: dark background, local contrast logo, compact operator, contacts/legal/keyboard/no overflow`);
 }
}finally{await b.close();await site.close();}})().catch(e=>{console.error(e);process.exitCode=1});
