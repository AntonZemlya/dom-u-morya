const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {root,server,browser,stable,maskMap}=require('./helpers.cjs');
(async()=>{const site={url:'http://127.0.0.1:4183'},b=await browser();try{
for(const width of [1440,768,390,320])for(const js of [true,false]){
 const c=await b.newContext({viewport:{width,height:844},javaScriptEnabled:js,reducedMotion:'reduce'}),p=await c.newPage();await maskMap(p);await p.goto(site.url);if(js)await stable(p);else await p.waitForFunction(()=>document.fonts.status==='loaded');
 assert.equal(await p.locator('h1').count(),1);assert.equal(await p.locator('h1').textContent(),'ЖК «Дом у моря» — Мариуполь, первая береговая линия');assert.equal(await p.locator('h1').isVisible(),true);assert.equal(await p.locator('#hero-section').getAttribute('aria-labelledby'),await p.locator('h1').getAttribute('id'));
 const issues=await p.evaluate(()=>{
 const errors=[];for(const i of document.images){if(i.id==='lightbox-asset')continue;if(!i.hasAttribute('alt'))errors.push('alt '+i.src);if(!i.hasAttribute('width')||!i.hasAttribute('height'))errors.push('size '+i.src)}
 for(const a of document.querySelectorAll('a[href^="#"]'))if(!document.getElementById(a.hash.slice(1)))errors.push(a.hash);
 for(const s of document.querySelectorAll('script[type="application/ld+json"]'))JSON.parse(s.textContent);
 if(document.documentElement.lang!=='ru')errors.push('lang');if(document.documentElement.scrollWidth>innerWidth)errors.push('overflow');return errors;});assert.deepEqual(issues,[]);
 for(const selector of ['.about-style-4','.location-style-11','.contact-panorama']){const img=p.locator(selector+' > img.deferred-background');await img.scrollIntoViewIfNeeded();await p.waitForFunction(selector=>{const i=document.querySelector(selector+' > img.deferred-background');return i.complete&&i.naturalWidth>0},selector);assert.ok(await img.evaluate(i=>i.naturalWidth===1536));}
 if(!js){assert.equal(await p.locator('[data-lot-id]').count(),28);for(const d of await p.locator('.static-category').all())if(!await d.evaluate(e=>e.open))await d.locator('summary').first().click();for(const a of await p.locator('.plan-thumb').all())assert.ok((await a.getAttribute('href')).endsWith('.svg'));}
 // Validate source and every srcset candidate against the real dist, not a test server.
 const references=await p.evaluate(()=>[...document.querySelectorAll('[srcset]')].flatMap(e=>e.getAttribute('srcset').split(',').map(x=>x.trim().split(/\s+/)[0])));
 for(const src of references)assert.ok(fs.existsSync(path.join(root,'dist',src)),src);
 await c.close();console.log('PASS SEO '+width+' JS='+js+': exact visible H1, headings, alt/dimensions, real lazy backgrounds, srcsets, no overflow');
}
const c=await b.newContext({javaScriptEnabled:false}),p=await c.newPage();
for(const file of ['index.html','privacy.html','consent-personal-data.html']){const response=await p.goto(site.url+'/'+file);assert.equal(response.status(),200);const raw=await response.text();assert.doesNotMatch(raw,/https?:\/\/(?:localhost|127\.0\.0\.1|example\.)/);assert.equal(await p.locator('meta[property="og:title"]').getAttribute('content'),await p.title());}
await c.close();
}finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
