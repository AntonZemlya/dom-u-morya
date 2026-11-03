// Responsive consent UI checks; all traffic stays on loopback, analytics stays OFF.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {root,server,browser,stable,maskMap}=require('./helpers.cjs');
const source=process.argv.includes('--root')?path.resolve(process.argv[process.argv.indexOf('--root')+1]):root;
const pages=['/','/privacy.html','/consent-personal-data.html','/consent-analytics.html'];
const key='domUMorya_analyticsConsent_v1',limits={320:140,390:120,768:100,1440:80};
const overlaps=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
(async()=>{const site=await server(source),b=await browser(),results=[];try{
 for(const mode of ['production','preview'])for(const width of [320,390,768,1440]){
  const context=await b.newContext({viewport:{width,height:width<500?844:1000},reducedMotion:'reduce'}),p=await context.newPage(),errors=[],external=[];
  p.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.origin!==site.url){external.push(url.origin);return route.abort();}
   // This changes only the approval gate in the fixture, to exercise the note's two states.
   if(mode==='production'&&url.pathname==='/privacy/config.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(source+'/privacy/config.js','utf8').replace("['zhk-dom-umorya.ru']",JSON.stringify([url.hostname])).replace('https://zhk-dom-umorya.ru',site.url)});
   return route.continue();
  });await maskMap(p);
  for(const documentPath of pages){
   assert.equal((await p.goto(site.url+documentPath)).status(),200);await stable(p);await p.locator('#cookie-banner').waitFor();
   await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   await p.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
   const banner=await p.locator('#cookie-banner').boundingBox();
   assert.ok(banner.height<=limits[width]+(mode==='preview'?45:0),`${mode} ${width} ${documentPath}: compact height ${banner.height}`);
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.equal(await p.locator('#cookie-banner').evaluate(e=>e.scrollWidth>e.clientWidth),false);
   assert.equal(await p.locator('.privacy-banner-note').isVisible(),mode==='preview');
   const controls=[];
   for(const selector of ['#cookie-accept','#cookie-decline','.privacy-banner-links a','.privacy-configure']){
    const box=await p.locator(selector).boundingBox();controls.push(box);
    assert.ok(box.height>=(selector.startsWith('#')?44:24)-.1,selector+': accessible target');
    assert.ok(box.x>=banner.x&&box.x+box.width<=banner.x+banner.width+.1&&box.y>=banner.y&&box.y+box.height<=banner.y+banner.height+.1,selector+': contained');
   }
   for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++)assert.equal(overlaps(controls[i],controls[j]),false,'no overlapping controls');
   assert.ok(Math.abs(controls[0].y-controls[1].y)<1,'both choices in one row');
   if(width>=768){const copy=await p.locator('.privacy-banner-copy').boundingBox();assert.ok(copy.x+copy.width<=controls[0].x,'desktop/tablet horizontal layout');}
   const footer=p.locator('footer');
   for(const el of await footer.locator('a,button,.footer-fineprint span').all()){
    const box=await el.boundingBox();if(box)assert.ok(box.y+box.height<=banner.y-8,'footer content above banner at end of page');
   }
   const up=p.locator('#scroll-top-btn');
   if(await up.count()&&await up.isVisible()){
    const box=await up.boundingBox();assert.equal(overlaps(box,banner),false,'scroll-to-top above banner');
    for(const el of await footer.locator('a,button,.footer-fineprint span').all())assert.equal(overlaps(box,await el.boundingBox()),false,'scroll-to-top clears footer content');
   }
   // Reading the terms, scrolling, opening and closing settings must never consent.
   assert.equal(await p.evaluate(k=>localStorage.getItem(k),key),null);
   const configure=p.locator('.privacy-configure');await p.locator('.privacy-banner-links a').focus();await p.keyboard.press('Tab');assert.equal(await configure.evaluate(e=>e===document.activeElement),true);
   const scrollY=await p.evaluate(()=>window.scrollY);await p.keyboard.press('Enter');assert.equal(await p.locator('#privacy-settings').isVisible(),true);
   assert.equal(await p.locator('#privacy-analytics').isChecked(),false);assert.equal(await p.locator('#cookie-banner').isVisible(),false);
   await p.keyboard.press('Shift+Tab');assert.equal(await p.locator('.privacy-documents a').evaluate(e=>e===document.activeElement),true);await p.keyboard.press('Tab');assert.equal(await p.locator('.privacy-close').evaluate(e=>e===document.activeElement),true);
   await p.keyboard.press('Escape');assert.equal(await configure.evaluate(e=>e===document.activeElement),true);assert.ok(Math.abs(await p.evaluate(()=>window.scrollY)-scrollY)<2,'settings preserve scroll position');
   assert.equal(await p.evaluate(k=>localStorage.getItem(k),key),null);
   if(documentPath==='/')results.push({mode,width,height:banner.height,overflow:false,footerClear:true,keyboard:true});
  }
  if(mode==='preview'){
   await p.locator('#cookie-decline').click();assert.equal(await p.locator('#cookie-banner').isVisible(),false);
   assert.equal(await p.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--privacy-banner-space').trim()),'0px');
   await p.reload();await stable(p);assert.equal(await p.locator('#cookie-banner').isVisible(),false);assert.equal(await p.evaluate(k=>JSON.parse(localStorage.getItem(k)).choice,key),'denied');
   await p.locator('footer [data-privacy-settings]').click();await p.locator('#privacy-analytics').check();await p.locator('[data-privacy-save]').click();assert.equal(await p.evaluate(k=>JSON.parse(localStorage.getItem(k)).choice,key),'granted');
   await p.locator('footer [data-privacy-settings]').click();await p.locator('[data-privacy-withdraw]').click();assert.equal(await p.evaluate(k=>JSON.parse(localStorage.getItem(k)).choice,key),'withdrawn');
   await p.evaluate(k=>localStorage.removeItem(k),key);await p.reload();await p.locator('#cookie-accept').click();await p.reload();await stable(p);assert.equal(await p.locator('#cookie-banner').isVisible(),false);assert.equal(await p.evaluate(k=>JSON.parse(localStorage.getItem(k)).choice,key),'granted');
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();console.log(`PASS banner ${mode} ${width}: four pages, compact, no overflow/overlap, keyboard${mode==='preview'?', consent/reload/withdraw':''}`);
 }
 // Rotation/viewport changes update the footer clearance without choosing consent.
 const p=await b.newPage({viewport:{width:1440,height:900}});await maskMap(p);await p.goto(site.url);await stable(p);
 for(const width of [320,390,768,1440]){await p.setViewportSize({width,height:900});await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const banner=await p.locator('#cookie-banner').boundingBox();const space=await p.evaluate(()=>parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--privacy-banner-space')));assert.ok(space>=banner.height+60);assert.equal(await p.evaluate(k=>localStorage.getItem(k),key),null);}
 await p.setViewportSize({width:320,height:240});await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await p.locator('#cookie-decline').click();assert.equal(await p.evaluate(k=>JSON.parse(localStorage.getItem(k)).choice,key),'denied');await p.close();
 fs.mkdirSync(path.join(root,'.test-output/analytics-banner'),{recursive:true});fs.writeFileSync(path.join(root,'.test-output/analytics-banner/checks.json'),JSON.stringify(results,null,2)+'\n');
 console.log('PASS resize and short viewport; all analytics traffic blocked before consent');
}finally{await b.close();await site.close()}})().catch(e=>{console.error(e);process.exitCode=1});
