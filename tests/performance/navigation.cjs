const assert=require('node:assert/strict');
const {browser,server,root,maskMap,stable}=require('../helpers.cjs');
const fs=require('node:fs'),path=require('node:path');
(async()=>{const site=await server(root+'/dist'),b=await browser();let evidence=[];try{
for(const width of [1440,768,390,320])for(const js of [true,false]){
 const c=await b.newContext({viewport:{width,height:844},deviceScaleFactor:width<500?2:1,javaScriptEnabled:js,reducedMotion:'reduce'}),p=await c.newPage();let mapRequests=0,errors=[],localRequests=[];
 await c.route('https://www.openstreetmap.org/**',r=>r.fulfill({contentType:'text/html',body:'<body>Local map fixture</body>'}));p.on('request',r=>{if(r.url().includes('openstreetmap.org'))mapRequests++;if(r.url().startsWith(site.url))localRequests.push(r.url());});p.on('pageerror',e=>errors.push(e.message));
 await p.goto(site.url+'/?utm_source=logo-qa#top');if(js)await stable(p);
 assert.equal(await p.locator('.logo-link').getAttribute('href'),'/');assert.equal(await p.locator('.footer-brand').getAttribute('href'),'/');
 if(js){await p.waitForTimeout(300);assert.equal(mapRequests,0,'Map must not fetch at initial viewport');assert.equal(await p.locator('iframe#location-map').count(),0);await p.locator('#cookie-decline').click();}
 // Keyboard activation preserves query and navigation timing when scrolling locally.
 const reservedHeight=(await p.locator('#map-container').boundingBox()).height;assert.ok(reservedHeight>=260,'Map reserves its final height before loading');
 const navigation=await p.evaluate(()=>performance.timeOrigin);
 await p.locator('.logo-link').focus();await p.keyboard.press('Enter');
 if(js){assert.equal(await p.evaluate(()=>performance.timeOrigin),navigation);assert.equal(new URL(p.url()).search,'?utm_source=logo-qa');assert.equal(new URL(p.url()).hash,'');assert.equal(await p.locator('#main-content').evaluate(e=>e===document.activeElement),true);}
 else {await p.waitForURL(site.url+'/');assert.equal(p.url(),site.url+'/');}
 // Menu jump to location and proximity scrolling both work; one frame/request at most.
 if(js&&width<1141){await p.locator('#nav-toggle').click();await p.locator('#mobile-menu a[href="#location"]').click();}
 else await p.locator('#location').scrollIntoViewIfNeeded();
 await p.locator('#map-container').scrollIntoViewIfNeeded();await p.waitForFunction(()=>!!document.querySelector('iframe#location-map'));
 assert.ok(Math.abs((await p.locator('#map-container').boundingBox()).height-reservedHeight)<0.5,'Map loading must not shift the page');
 if(js){await p.locator('#map-unlock').focus();await p.keyboard.press('Enter');assert.equal(await p.locator('#location-map').getAttribute('tabindex'),'0');await p.locator('.logo-link').focus();await p.waitForTimeout(100);assert.equal(await p.locator('#map-unlock').isVisible(),true);assert.equal(mapRequests,1);}
 else {assert.equal(await p.locator('#map-unlock').isVisible(),false);assert.equal(await p.locator('#location-map').getAttribute('tabindex'),'0');assert.equal(await p.locator('#location-map').evaluate(e=>getComputedStyle(e).pointerEvents),'auto');const fallback=p.locator('a.map-unlock');assert.equal(await fallback.isVisible(),true);await fallback.focus();const popup=c.waitForEvent('page');await p.keyboard.press('Enter');const external=await popup;await external.waitForLoadState();assert.match(external.url(),/^https:\/\/www\.openstreetmap\.org\//);await external.close();}
 if(js){await p.evaluate(()=>history.replaceState(null,'','/?utm_source=logo-qa#location'));await p.locator('footer').scrollIntoViewIfNeeded();await p.locator('.footer-brand').focus();await p.keyboard.press('Enter');assert.equal(p.url(),site.url+'/?utm_source=logo-qa');assert.equal(await p.evaluate(()=>performance.timeOrigin),navigation);}
 for(const file of ['privacy.html','consent-personal-data.html','consent-analytics.html']){
  await p.goto(site.url+'/'+file+'?internal=1');assert.equal(await p.locator('.logo-link').getAttribute('href'),'/');assert.equal(await p.locator('.footer-brand').getAttribute('href'),'/');await p.locator('.logo-link').click();assert.equal(p.url(),site.url+'/');
  await p.goto(site.url+'/'+file);await p.locator('.footer-brand').click();assert.equal(p.url(),site.url+'/');
 }
 await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(100);assert.deepEqual(errors,[]);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow ${width} JS=${js}`);
 // No original + variant of either large photo is fetched for a single viewport.
 const initialImages=localRequests.filter(u=>/architecture|location-\d|location.webp|logo-\d|logo-cropped/.test(u));
 evidence.push({width,js,mapRequests,images:[...new Set(initialImages)]});await c.close();console.log(`PASS logo/map ${width}, JS=${js}: canonical, keyboard, query, focus, menu, no-JS`);
}
// A deep link on initial navigation still loads the map.
{const p=await b.newPage();await maskMap(p);await p.goto(site.url+'/#location');await p.locator('#map-container').scrollIntoViewIfNeeded();await p.waitForFunction(()=>!!document.querySelector('iframe#location-map'));await p.locator('#map-unlock').click();assert.equal(await p.locator('#location-map').getAttribute('tabindex'),'0');await p.close();}
if(process.env.QA_OUTPUT_DIR){fs.mkdirSync(process.env.QA_OUTPUT_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.QA_OUTPUT_DIR,'navigation.json'),JSON.stringify(evidence,null,2));}
}finally{await b.close();await site.close();}})().catch(e=>{console.error(e);process.exitCode=1});
