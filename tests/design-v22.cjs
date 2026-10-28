const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {root,server,browser,stable,maskMap}=require('./helpers.cjs');
const media=require('../data/media.json');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const baseline=execFileSync('git',['show','ed656502d09bc934f91e400e69b56cc32f299788:index.html'],{cwd:root,encoding:'utf8'});
for(const re of [/<section id="hero-section"[\s\S]*?<\/section>/,/<section id="about"[\s\S]*?<\/section>/])assert.equal(html.match(re)[0],baseline.match(re)[0],'Frozen hero/about source; footer separately reviewed under ENG-001');
for(const name of ['privacy.html','consent-personal-data.html','assets/cta.webp','data/apartments.json','data/plan-groups.json','data/media.json','data/media-provenance.json','data/project-facts.json'])assert.deepEqual(fs.readFileSync(path.join(root,name)),execFileSync('git',['show','ed656502:'+name],{cwd:root,maxBuffer:10e6}),name+' unchanged');
const out=process.env.QA_OUTPUT_DIR;
if(out)fs.mkdirSync(out,{recursive:true});
(async()=>{const site=await server(path.join(root,'dist')),b=await browser();
try{
 for(const width of [1440,768,390,320]){
  const p=await b.newPage({viewport:{width,height:width<500?844:1000},reducedMotion:'reduce'}),errors=[];
  p.on('pageerror',e=>errors.push(e.message));await maskMap(p);assert.equal((await p.goto(site.url)).status(),200);await stable(p);await p.locator('#cookie-decline').click();
  assert.deepEqual(await p.locator('main>section, main>div>section').evaluateAll(es=>es.filter(e=>['location','gallery','plans','pricing','progress','developer','contact'].includes(e.id)).map(e=>e.id)),['location','gallery','plans','pricing','progress','developer','contact']);
  for(const nav of ['.nav-links','#mobile-menu'])assert.deepEqual(await p.locator(nav+' a').evaluateAll(es=>es.slice(1,4).map(e=>e.hash)),['#location','#gallery','#plans']);
  assert.equal(await p.locator('a[href*="sadovoe-kolco.ru"]').count(),0,'No developer exits in funnel');
  assert.equal(await p.locator('#developer a[href*="69398"]').count(),1,'Required disclosure retained');
  assert.equal(await p.locator('#gallery-grid>.gallery-item:visible').count(),3);
  const composition=await p.locator('#gallery-grid').boundingBox();assert.ok(composition.height<=500,'Compact gallery');
  await p.locator('#gallery-view-all').click();
  for(let i=0;i<8;i++){
   assert.equal(await p.locator('#lightbox-position').innerText(),`${i+1} из 8`);
   assert.equal(await p.locator('#lightbox-asset').getAttribute('src'),media.gallery[i].variants.at(-1).src);
   await p.locator('#lightbox-asset').evaluate(i=>i.decode());
   const box=await p.locator('#lightbox-asset').boundingBox();assert.ok(box.width<=1100&&box.height<= (width<500?844:1000)*.82);
   if(i<7)await p.keyboard.press('ArrowRight');
  }
  await p.locator('#zoom-in').click();assert.equal(await p.locator('#zoom-reset').innerText(),'150%');
  await p.keyboard.press('Escape');assert.equal(await p.locator('#gallery-view-all').evaluate(e=>e===document.activeElement),true);
  for(const mode of ['cats','lots']){
   await p.locator(`[data-view="${mode}"]`).click();
   if(mode==='lots'){await p.locator('[data-tab="1k"]').click();while(await p.locator('#show-more-plans').isVisible())await p.locator('#show-more-plans').click();}
   assert.equal(await p.locator('.catalog-footnote').count(),1);
   const positions=await p.evaluate(mode=>{const note=document.querySelector('.catalog-footnote').getBoundingClientRect();const grid=document.querySelector(mode==='cats'?'#category-grid':'#plans-grid').getBoundingClientRect();return {note:note.top,bottom:grid.bottom};},mode);
   assert.ok(positions.note>positions.bottom,JSON.stringify(positions));
  }
  await p.locator('[data-tab="studio"]').click();
  const ask=p.locator('[data-action="ask-plan"]').first();await ask.hover();
  for(const action of ['hover','focus']){if(action==='focus')await ask.focus();const css=await ask.evaluate(e=>{const s=getComputedStyle(e);return {radius:s.borderRadius,h:e.getBoundingClientRect().height,outline:s.outlineStyle};});assert.equal(css.radius,'99px');assert.ok(css.h>=44);}
  await ask.click();assert.equal(await p.evaluate(()=>state.snapshot.lotId),'22825');
  assert.match(await p.locator('#snapshot-slot').innerText(),/29 м².*2 этаж.*ID 22825.*6\s*978\s*183/);
  assert.ok((await p.locator('#snapshot-slot').boundingBox()).height<200,'Compact request');
  assert.equal(await p.locator('#plan-locked-slot').isVisible(),false,'No duplicate selection');
  assert.equal(await p.locator('#form-hint').count(),0);assert.equal(await p.locator('#request-form a[href="privacy.html"]').count(),0);
  assert.equal(await p.locator('#request-form a[href="consent-personal-data.html"]').count(),1);assert.equal(await p.locator('#consent-input').isChecked(),false);
  await p.locator('#request-form').evaluate(f=>f.requestSubmit());
  for(const id of ['name','phone','consent']){assert.equal(await p.locator(`#${id}-input`).getAttribute('aria-invalid'),'true');assert.equal(await p.locator(`#${id}-error`).isVisible(),true);}
  await p.locator('#name-input').fill('Тест');await p.locator('#phone-input').fill('70000000000');assert.equal(await p.locator('#submit-btn').isEnabled(),false);
  await p.locator('#consent-input').check();assert.equal(await p.locator('#submit-btn').isEnabled(),true);
  await p.locator('#snapshot-remove-btn').click();assert.equal(await p.locator('#snapshot-slot').isVisible(),false);
  await p.locator('[data-view="cats"]').click();await p.locator('[data-category="2k"][data-category-action="ask"]').click();assert.match(await p.locator('#snapshot-slot').innerText(),/2 спальни/);assert.ok((await p.locator('#snapshot-slot').boundingBox()).height<200,'Compact category request');
  const cta=await p.locator('.contact-panorama').boundingBox(),shell=await p.locator('.contact-shell').boundingBox(),form=await p.locator('#request-form').boundingBox();
  assert.ok(Math.abs(cta.width-shell.width)<1&&form.y>cta.y+cta.height,'Panorama spans full column; form below');
  await p.locator('.contact-form-link').click();assert.equal(new URL(p.url()).hash,'#request-form');
  assert.equal(await p.locator('.faq-questions details').count(),5);
  const questions=p.locator('.faq-questions summary');
  for(let i=0;i<5;i++){await questions.nth(i).focus();await p.keyboard.press('Enter');await p.waitForTimeout(30);assert.equal(await p.locator('.faq-questions details[open]').count(),1);assert.equal(await questions.nth(i).getAttribute('aria-expanded'),'true');}
  await p.keyboard.press('Space');await p.waitForTimeout(30);assert.equal(await p.locator('.faq-questions details[open]').count(),0);
  for(const album of media.construction){
   const tab=p.locator(`#construction-tabs button[data-month="${album.month}"]`);await tab.click();
   assert.equal(await tab.getAttribute('aria-pressed'),'true');
   const current=p.locator(`[data-album="${album.month}"]`);assert.equal(await current.locator('.gallery-item:visible').count(),4);
   const primary=await current.locator('.gallery-item').first().boundingBox();assert.ok(primary.width<=950&&primary.height<=450);
   assert.doesNotMatch(await current.innerText(),/Источник|точная дата|Сентябрь/);
   await current.locator('.album-view-all').click();
   for(let i=0;i<album.images.length;i++){assert.equal(await p.locator('#lightbox-position').innerText(),`${i+1} из ${album.images.length}`);await p.locator('#lightbox-asset').evaluate(i=>i.decode());if(i<album.images.length-1)await p.keyboard.press('ArrowRight');}
   if(out&&album.month==='2026-04')await p.screenshot({path:path.join(out,`album-viewer-${width}.jpg`),type:'jpeg',quality:85});
   await p.keyboard.press('Escape');
  }
  const last=p.locator('#construction-tabs button').last();assert.ok(await last.evaluate(e=>{const r=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect();return r.left>=p.left&&r.right<=p.right+1;}),'Last month reachable inside scroll row');
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);await p.close();
  console.log(`PASS V2.2 ${width}: order/navigation, 8 full-quality views, 29 album photos, compact layout, price note both modes, pill/focus/context, required consent/errors, 5 single-open FAQ, no developer exits`);
 }
 const p=await b.newPage({javaScriptEnabled:false,viewport:{width:320,height:844}});await maskMap(p);await p.goto(site.url);
 assert.equal(await p.locator('#plans-grid .card').count(),28);assert.equal(await p.locator('#gallery-grid .gallery-item').count(),8);
 await p.locator('.gallery-more summary').click();assert.equal(await p.locator('#gallery-grid .gallery-item:visible').count(),8);
 assert.equal(await p.locator('.construction-album .gallery-item').count(),29);
 for(const album of await p.locator('.construction-album').all()){if(!await album.evaluate(e=>e.open))await album.locator('summary').click();for(const photo of await album.locator('.gallery-item').all())assert.equal(await photo.isVisible(),true);}
 await p.locator('.faq-questions summary').last().click();assert.equal(await p.locator('.faq-questions details').last().evaluate(e=>e.open),true);
 assert.equal(await p.locator('#consent-input').getAttribute('required'),'');assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.close();
 console.log('PASS V2.2 no-JS: all 28 lots, 8 images, 29 photos/6 albums, native FAQ and required consent; frozen hero/about/legal/media/data verified');
}finally{await b.close();await site.close();}})().catch(e=>{console.error(e);process.exitCode=1});
