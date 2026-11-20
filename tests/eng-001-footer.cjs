// Shared footer regression: reuse the existing responsive footer check on all pages.
const assert=require('node:assert/strict'),path=require('node:path');
const {root,server,browser,stable,maskMap}=require('./helpers.cjs');
const out=process.env.QA_OUTPUT_DIR,pages=['index.html','privacy.html','consent-personal-data.html','consent-analytics.html'];
const tolerance=2;
const near=(a,b,message)=>assert.ok(Math.abs(a-b)<=tolerance,`${message}: ${a}px vs ${b}px`);
(async()=>{const site=await server(path.join(root,'dist')),b=await browser();try{
 for(const width of [1440,768,640,390,320]){
  const context=await b.newContext({viewport:{width,height:width<500?844:1000},reducedMotion:'reduce'}),p=await context.newPage();await maskMap(p);
  let baseline;
  for(const name of pages){
   await p.goto(site.url+'/'+name);await stable(p);if(await p.locator('#cookie-banner').isVisible())await p.locator('#cookie-decline').click();
   const footer=p.locator('footer');await footer.scrollIntoViewIfNeeded();
   const layout=await footer.evaluate(e=>{
    const style=getComputedStyle(e),box=e.getBoundingClientRect();return {background:style.backgroundColor,width:box.width,height:box.height,
     children:[...e.querySelectorAll('.footer-main,.footer-bottom')].map(c=>{const r=c.getBoundingClientRect();return {x:r.x-box.x,y:r.y-box.y,width:r.width,height:r.height};})};
   });
   assert.equal(layout.background,'rgb(33, 55, 60)');if(baseline)assert.deepEqual(layout,baseline,name+': same responsive footer');else baseline=layout;
   assert.equal(await footer.locator('.footer-agency').innerText(),'Агентство недвижимости «Яра»');
   assert.equal((await footer.innerText()).match(/«Яра»/g)?.length,1);
   assert.equal(await footer.locator('.footer-operator').count(),0,name+': operator details are not repeated in the footer');
   assert.doesNotMatch(await footer.innerText(),/Саврасова|ОГРНИП|ИНН/,name+': full registration details remain on the legal pages, not in footer');
   assert.equal(await footer.locator('.footer-role').innerText(),'Застройщик ЖК — ГК «Садовое кольцо».');
   assert.equal(await footer.locator('.footer-contact span').innerText(),'Консультации и подбор квартир');
   assert.equal(await footer.locator('.footer-details > .footer-copyright:last-child').innerText(),'© 2026 · Дом у моря');
   const logo=footer.locator('img');assert.equal(await logo.count(),1);assert.equal(await logo.getAttribute('src'),'assets/logo-cropped.webp');await logo.evaluate(i=>i.decode());assert.ok(await logo.evaluate(i=>i.naturalWidth>0&&getComputedStyle(i).filter.includes('brightness(0)')));
   assert.equal(await footer.locator('.footer-brand').getAttribute('href'),'/');
   assert.equal(await footer.locator('.footer-phone').getAttribute('href'),'tel:+79529568875');assert.equal(await footer.locator('.footer-email').getAttribute('href'),'mailto:info@anyara.ru');
   const link=footer.locator('a[href="privacy.html"]'),settings=footer.locator('[data-privacy-settings]');assert.equal(await link.count(),1);
   const disclaimer=footer.locator('.footer-legal > .footer-offer:last-child');
   assert.equal(await disclaimer.innerText(),'Информация не является публичной офертой');
   const [left,right]=await footer.locator('.footer-bottom').evaluate(grid=>{
    const dividerY=grid.getBoundingClientRect().top;
    const box=({left,right,top,bottom})=>({left,right,top:top-dividerY,bottom:bottom-dividerY});
    return [...grid.children].map(column=>[...column.children].map(row=>{
     const range=document.createRange();
     // Measure visible text rather than the surrounding 44px hit area or the screen-reader suffix.
     range.selectNodeContents([...row.childNodes].find(node=>node.nodeType===Node.TEXT_NODE&&node.textContent.trim()));
     return {...box(row.getBoundingClientRect()),lines:[...range.getClientRects()].map(box)};
    }));
   });
   for(const rows of [left,right]){
    assert.equal(rows.length,3);
    for(const [i,row] of rows.entries()){
     if(i>0)assert.ok(rows[i-1].bottom<=row.top,name+': rows do not overlap');
     near(row.left,rows[0].left,name+': rows share a left edge');
     assert.ok(row.lines.length>0&&row.lines.every(line=>line.left>=row.left-1&&line.right<=row.right+1&&
      line.top>=row.top-1&&line.bottom<=row.bottom+1),name+': text stays inside the row');
    }
   }
   if(width>=640){
    assert.equal(right[0].lines.length,1,name+': policy fits on one line in the two-column layout');
    for(const [i,row] of left.entries()){
     assert.ok(row.right<=right[i].left,name+': columns do not overlap');
     near(row.top,right[i].top,name+': both columns share row '+(i+1));
    }
   }else{
    assert.ok(left[2].bottom<=right[0].top,name+': agency information precedes legal links on mobile');
    near(left[0].left,right[0].left,name+': stacked columns share a left edge');
   }
   if(width===1440){
    const interval=left[1].lines[0].top-left[0].lines[0].top;
    for(const [i,row] of left.entries()){
     assert.equal(row.lines.length,1);
     assert.equal(right[i].lines.length,1);
     near(row.lines[0].top,right[i].lines[0].top,name+': text on opposite sides of row '+(i+1));
     if(i>0)for(const rows of [left,right])near(rows[i].lines[0].top-rows[i-1].lines[0].top,interval,name+': consistent text intervals');
    }
    if(name==='index.html')console.log('Desktop text tops from divider (px): '+JSON.stringify([left,right].map(rows=>rows.map(row=>row.lines[0].top))));
   }
   for(const [target,label] of [[link,'policy'],[settings,'settings']]){
    await p.mouse.move(0,0);const idle=await target.evaluate(e=>getComputedStyle(e).color);await target.hover();
    const hover=await target.evaluate(e=>({color:getComputedStyle(e).color,underline:getComputedStyle(e).textDecorationColor}));
    assert.notEqual(hover.color,idle,label+': visible hover');assert.equal(hover.color,'rgb(241, 208, 155)');assert.equal(hover.underline,hover.color);
    if(out&&width===1440&&name==='privacy.html')await footer.screenshot({path:path.join(out,`footer-hover-${label}-1440.png`)});
   }
   await link.focus();assert.equal(await link.evaluate(e=>e===document.activeElement),true);
   for(const target of [link,settings]){
    const bounds=await target.boundingBox();
    assert.ok(bounds.height>=44&&bounds.width>=44,name+': legal control has a 44px hit area');
   }
   const [policy]=await Promise.all([p.waitForEvent('popup'),p.keyboard.press('Enter')]);
   await policy.waitForURL(site.url+'/privacy.html');
   await policy.getByRole('heading',{level:1,name:'Политика в отношении обработки персональных данных'}).waitFor();
   await policy.close();
   await link.focus();await p.keyboard.press('Tab');
   assert.ok(await settings.evaluate(e=>e===document.activeElement&&getComputedStyle(e).outlineStyle==='solid'));
   await p.keyboard.press('Enter');assert.equal(await p.locator('#privacy-settings').isVisible(),true);await p.keyboard.press('Escape');
   assert.equal(await p.locator('#privacy-settings').isVisible(),false);
   assert.ok(await settings.evaluate(e=>e===document.activeElement));
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name+' '+width+': no horizontal overflow');
   if(name==='index.html'){
    await p.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
    const button=p.locator('#scroll-top-btn');await button.waitFor();
    const {x,y,width:buttonWidth,height}=await button.boundingBox();
    assert.ok(await disclaimer.evaluate((el,button)=>{
     const text=document.createRange();text.selectNodeContents(el);
     return [...text.getClientRects()].every(line=>line.right<=button.x||line.left>=button.right||line.bottom<=button.y||line.top>=button.bottom);
    },{x,y,right:x+buttonWidth,bottom:y+height}),width+': back-to-top button clears the disclaimer');
   }
   if(out){
    await p.mouse.move(0,0);
    await settings.blur();
    await footer.screenshot({path:path.join(out,`shared-footer-${name.replace('.html','')}-${width}.png`)});
   }
  }
  await context.close();console.log(`PASS shared footer ${width}: four pages, identical layout, contacts/links/keyboard/no overflow`);
 }
 // The common footer and document link are present before any JavaScript runs.
 const context=await b.newContext({javaScriptEnabled:false}),p=await context.newPage();await maskMap(p);
 for(const name of pages){await p.goto(site.url+'/'+name);assert.equal(await p.locator('footer.finale-footer .footer-phone').count(),1);assert.equal(await p.locator('footer a[href="privacy.html"]').count(),1);}
 await context.close();console.log('PASS shared footer no-JS on four pages');
}finally{await b.close();await site.close();}})().catch(e=>{console.error(e);process.exitCode=1});
