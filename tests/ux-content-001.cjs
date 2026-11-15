const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {root,server,browser,maskMap}=require('./helpers.cjs');
const M=require('../content-model.js'),apartments=require('../data/apartments.json');
const evidence=process.env.UX_EVIDENCE_DIR;
const out=evidence?path.resolve(evidence):null;
const money=s=>Number(s.replace(/\D/g,''));
const results=[];
async function prepare(p,url,js=true){
  await maskMap(p);await p.goto(url);await p.evaluate(()=>document.fonts.ready);
  if(js){await p.locator('#cookie-decline').click();await p.addStyleTag({content:'html{scroll-behavior:auto!important}[data-reveal-key]{opacity:1!important;transform:none!important}'});}
}
const range=(p,id,value)=>p.locator('#'+id+'-range').evaluate((el,v)=>{el.value=String(v);el.dispatchEvent(new Event('input',{bubbles:true}));},value);
async function settled(p){await p.waitForFunction(()=>!lb.settling);await p.locator('#lightbox-asset').evaluate(i=>i.decode());}
async function touchDriver(p){
  const cdp=await p.context().newCDPSession(p);
  const send=(type,points=[])=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([x,y,id=1])=>({x,y,id,radiusX:1,radiusY:1,force:1}))});
  const box=()=>p.locator('#lightbox-image').boundingBox();
  async function swipe(dx,{steps=8,delay=20,hold=0,cancel=false,capture}={}){
    const r=await box(),x=r.x+r.width*.65,y=r.y+r.height*.5;
    await send('touchStart',[[x,y]]);
    for(let i=1;i<=steps;i++){await send('touchMove',[[x+dx*i/steps,y]]);if(delay)await p.waitForTimeout(delay);}
    await p.waitForFunction(dx=>lb.gesture && Math.abs(lb.gesture.dx-dx)<1,dx,{polling:'raf',timeout:2000});
    const offset=await p.locator('#lightbox-track').evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).m41+e.clientWidth);
    assert.ok(Math.abs(offset-dx)<2,`progressive drag ${offset} follows ${dx}`);
    if(capture&&out)await p.screenshot({path:path.join(out,capture)});
    if(hold)await p.waitForTimeout(hold);
    await send(cancel?'touchCancel':'touchEnd');await settled(p);
  }
  return {send,box,swipe,close:()=>cdp.detach()};
}
(async()=>{
 const site=await server(path.join(root,'dist')),b=await browser();
 if(out)fs.mkdirSync(out,{recursive:true});
 try{
  // Initial HTML and live state must display identical amounts at all requested widths.
  for(const width of [1440,768,390,320]){
    let staticAmounts;
    for(const js of [false,true]){
      const context=await b.newContext({viewport:{width,height:width<500?844:1000},javaScriptEnabled:js});
      const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
      await prepare(p,site.url,js);
      const amounts=await p.locator('#price-label,#down-label,#loan-label,#payment-label,#income-label').allTextContents();
      if(!js)staticAmounts=amounts;else assert.deepEqual(amounts,staticAmounts,'No hydration jump');
      assert.equal(await p.locator('#down-range').inputValue(),'15');
      assert.equal(money(await p.locator('#loan-label').textContent()),5931456);
      assert.equal(await p.locator('#plan-views,#category-grid,.category-card').count(),0);
      assert.equal(await p.locator('#catalog-controls').isVisible(),false);
      assert.equal(await p.locator('.catalog-footnote').innerText(),'Мебель на схемах — пример расстановки.');
      assert.doesNotMatch(await p.locator('#plans .lot-details').allTextContents().then(s=>s.join(' ')),/\d{2}\.\d{2}\.\d{4}/);
      assert.doesNotMatch(await p.locator('.footer-role').innerText(),/не является застройщиком/);
      assert.equal(await p.locator('.location-style-6').innerText(),'Дом строится на проспекте Адмирала Лунина, 25.');
      assert.match(await p.locator('#location').innerText(),/≈ 6 км на машине до драмтеатра/);
      assert.doesNotMatch(await p.locator('#progress').innerText(),/По сообщению застройщика|Последняя подтверждённая/);
      if(js){
        assert.equal(await p.locator('#mortgage-warning').isVisible(),false);
        assert.equal(await p.locator('#plan-tabs button').count(),4);
        await p.locator('#toggle-filters').click();await p.locator('#budget-filter').selectOption('8000000');await p.locator('#toggle-filters').click();
        assert.equal(await p.locator('#budget-filter').inputValue(),'8000000');assert.equal(await p.locator('#catalog-controls').isVisible(),false);
        await p.locator('#reset-filters-compact').click();assert.equal(await p.locator('#toggle-filters').evaluate(e=>document.activeElement===e),true);
      }else{
        assert.equal(await p.locator('[data-lot-id]').count(),28);
        for(const disclosure of await p.locator('.static-category,.construction-album,.gallery-more').all())if(!await disclosure.evaluate(e=>e.open))await disclosure.locator('summary').first().click();
        for(const card of await p.locator('.plan-thumb').all())assert.equal(await card.isVisible(),true);
        assert.equal(await p.locator('#gallery .gallery-item:visible').count(),8);
        assert.equal(await p.locator('#progress .gallery-item:visible').count(),35);
        assert.ok((await p.locator('#location noscript').innerHTML()).includes('openstreetmap'));
      }
      if(out){
        const suffix=`${width}${js?'':'-nojs'}`;
        for(const [selector,name] of [['#hero-section','desktop'],['#plans','catalog'],['#calculator','calculator'],['#location','location'],['#progress','construction'],['footer','footer']]){
          if(!js&&!['#plans','#calculator'].includes(selector))continue;
          await p.locator(selector).screenshot({path:path.join(out,`${name}-${suffix}.png`),style:'#site-header,#scroll-top-btn{visibility:hidden!important}'});
        }
      }
      assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
      await context.close();results.push({width,js,status:'PASS'});
      console.log(`PASS UX ${width}px JS=${js}: content, catalogue, initial calculator, no overflow/errors`);
    }
  }
  const p=await b.newPage({viewport:{width:1440,height:1000}});await prepare(p,site.url);
  // Automatic mode uses the exact selected lot, both programmes and custom prices.
  for(const id of ['23037','22825']){
    const lot=apartments.find(a=>a.id===id);await p.locator(`[data-tab="${M.keys[lot.bedrooms]}"]`).click();await p.locator(`[data-lot-id="${id}"] [data-action="calc-here"]`).click();
    assert.equal(await p.locator('#down-range').inputValue(),String(M.minimumDownPayment(lot.price_rub,M.mortgagePrograms.regional).value));
    assert.equal(await p.locator('#mortgage-warning').isVisible(),false);
    await p.locator('[data-mortgage-program="family"]').click();assert.equal(await p.locator('#down-range').inputValue(),String(M.minimumDownPayment(lot.price_rub,M.mortgagePrograms.family).value));
    await p.locator('[data-mortgage-program="regional"]').click();
  }
  // Manual settings survive price, term, programme, lot, request and ordinary renders.
  await range(p,'down',40);await range(p,'term',19);await range(p,'price',10000000);
  await p.locator('[data-mortgage-program="family"]').click();await p.locator('[data-mortgage-program="regional"]').click();
  await p.locator('[data-tab="studio"]').click();await p.locator('[data-lot-id="22825"] [data-action="calc-here"]').click();
  await p.evaluate(()=>renderCalculator());assert.equal(await p.locator('#down-range').inputValue(),'40');assert.match(await p.locator('#down-mode').textContent(),/Ручная настройка/);
  await range(p,'down',10);await p.locator('[data-mortgage-program="family"]').click();assert.equal(await p.locator('#down-range').inputValue(),'20');assert.match(await p.locator('#down-mode').textContent(),/повышен до 20%/);
  await p.locator('[data-mortgage-program="regional"]').click();await range(p,'price',10000000);await range(p,'down',39);assert.equal(await p.locator('#mortgage-warning').isVisible(),true);
  await p.locator('#send-to-form').click();assert.equal(await p.evaluate(()=>state.snapshot.calculation.downPct),39);assert.match(await p.locator('#snapshot-slot').innerText(),/превышает лимит/);
  await p.locator('#down-auto').click();assert.equal(await p.locator('#down-range').inputValue(),'40');assert.equal(await p.locator('#mortgage-warning').isVisible(),false);assert.equal(await p.locator('#down-range').evaluate(e=>e===document.activeElement),true);
  // Impossible limits remain honestly visible; bounds and warning are not bypassed.
  await p.evaluate(()=>{document.getElementById('down-range').max='20';state.price=20000000;updateAutomaticDownPayment();renderCalculator();});
  assert.equal(await p.locator('#down-range').inputValue(),'20');assert.equal(await p.locator('#mortgage-warning').isVisible(),true);
  await p.close();console.log('PASS UX automatic/manual down payment, programme minimum, limit boundaries, impossible limit and request snapshot');

  for(const width of [390,320]){
    const context=await b.newContext({viewport:{width,height:844},hasTouch:true,isMobile:true,...(out&&width===390?{recordVideo:{dir:path.join(out,'video'),size:{width:390,height:844}}}:{})});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await prepare(page,site.url);
    for(const mode of ['gallery','construction','plan']){
      const opener=mode==='gallery'?page.locator('#gallery-view-all'):mode==='construction'?page.locator('.construction-album:not([hidden]) .album-view-all'):page.locator('#plans-grid .plan-thumb').first();
      await opener.click();await settled(page);
      const driver=await touchDriver(page),position=()=>page.locator('#lightbox-position').textContent(),count=await page.evaluate(()=>lb.items.length);
      assert.equal(await position(),`1 из ${count}`);
      for(const id of ['lightbox-prev','lightbox-next']){
        const r=await page.locator('#'+id).boundingBox(),surface=await driver.box();assert.ok(r.width>=44&&r.height>=44);assert.ok(r.x>=0&&r.x+r.width<=width+1&&r.y>=surface.y&&r.y+r.height<=surface.y+surface.height+1);
      }
      await driver.swipe(-18,{steps:4,delay:60,hold:150});assert.equal(await position(),`1 из ${count}`,'short drag returns');
      await driver.swipe(-120,{capture:`swipe-${mode}-${width}.png`});assert.equal(await position(),`2 из ${count}`);
      await driver.swipe(120);assert.equal(await position(),`1 из ${count}`);
      await driver.swipe(-45,{steps:2,delay:4});assert.equal(await position(),`2 из ${count}`,'fast flick');
      await driver.swipe(-100,{cancel:true});assert.equal(await position(),`2 из ${count}`,'interrupted gesture never changes frame');
      // Real multi-touch pinch and pan, then lift one finger and continue panning.
      const r=await driver.box(),x=r.x+r.width/2,y=r.y+r.height/2;
      await driver.send('touchStart',[[x-35,y,1],[x+35,y,2]]);
      await driver.send('touchMove',[[x-70,y,1],[x+70,y,2]]);await page.waitForTimeout(30);
      assert.ok(await page.evaluate(()=>lb.zoom)>1.8,'pinch zooms');
      const before=await page.evaluate(()=>lb.x);
      await driver.send('touchMove',[[x-45,y+20,1],[x+95,y+20,2]]);
      await driver.send('touchEnd',[[x-45,y+20,1]]);await driver.send('touchMove',[[x-85,y+20,1]]);await driver.send('touchEnd');
      assert.equal(await position(),`2 из ${count}`,'pinch/pan never swipes');assert.notEqual(await page.evaluate(()=>lb.x),before);
      const panBefore=await page.evaluate(()=>lb.x);
      await driver.send('touchStart',[[x,y,1]]);await driver.send('touchMove',[[x-60,y,1]]);await driver.send('touchEnd');
      assert.notEqual(await page.evaluate(()=>lb.x),panBefore);assert.equal(await position(),`2 из ${count}`);
      if(out)await page.screenshot({path:path.join(out,`zoom-${mode}-${width}.png`)});
      await page.locator('#zoom-reset').click();assert.equal(await page.locator('#zoom-reset').textContent(),'100%');
      await page.locator('#lightbox-next').click();await settled(page);assert.equal(await position(),`3 из ${count}`);
      await page.keyboard.press('ArrowLeft');await settled(page);assert.equal(await position(),`2 из ${count}`);
      await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.getElementById('lightbox').contains(document.activeElement)),true);
      if(out)await page.screenshot({path:path.join(out,`lightbox-${mode}-${width}.png`)});
      if(mode==='plan'){
        await page.locator('[data-lb-view="2"]').click();await page.locator('#lightbox-calc').click();assert.equal(await page.locator('#lightbox').isVisible(),false);assert.match(await page.locator('#calc-plan-meta').innerText(),/На этаже/);
      }else{await page.keyboard.press('Escape');assert.equal(await opener.evaluate(e=>e===document.activeElement),true);}
      await driver.close();console.log(`PASS UX real touch ${width} ${mode}: progressive/short/long/fast/cancel, pinch/pan, arrows, keyboard/focus`);
    }
    await page.locator('#gallery-view-all').click();await settled(page);const d=await touchDriver(page),r=await d.box();
    await d.send('touchStart',[[r.x+r.width*.65,r.y+r.height/2]]);await d.send('touchMove',[[r.x+r.width*.3,r.y+r.height/2]]);
    const previous=await page.locator('#lightbox-position').textContent();await page.setViewportSize({width:844,height:390});await d.send('touchEnd');await settled(page);assert.equal(await page.locator('#lightbox-position').textContent(),previous);
    await page.setViewportSize({width,height:844});await page.emulateMedia({reducedMotion:'reduce'});
    await page.locator('#lightbox-next').click();assert.equal(await page.evaluate(()=>lb.settling),false);assert.equal(await page.locator('#lightbox-position').textContent(),'2 из 8');
    await page.locator('#lightbox-prev').click();await page.locator('#lightbox-prev').click();assert.equal(await page.locator('#lightbox-position').textContent(),'8 из 8','wrap without a blank frame');
    await page.keyboard.press('Escape');await d.close();assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const video=page.video();await context.close();if(video&&out)await video.saveAs(path.join(out,'mobile-gallery-390.webm'));
    console.log(`PASS UX ${width}: orientation interrupt, reduced motion, wrap, no errors`);
  }
  if(out)fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({status:'PASS',viewports:results,realTouch:['gallery','construction','plan'],widths:[390,320]},null,2)+'\n');
 }finally{await b.close();await site.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
