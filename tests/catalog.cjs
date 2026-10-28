const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {PDFDocument}=require('pdf-lib');
const {root,server,browser,stable,maskMap}=require('./helpers.cjs');
const M=require('../content-model.js'),apartments=require('../data/apartments.json'),media=require('../data/media.json');
const siteRoot=process.argv.includes('--root')?path.resolve(root,process.argv[process.argv.indexOf('--root')+1]):root;
const evidence=process.env.QA_OUTPUT_DIR; if(evidence)fs.mkdirSync(evidence,{recursive:true});
const num=s=>Number(s.replace(/\D/g,''));
(async()=>{const site=await server(siteRoot),b=await browser(),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rec004-'));try{
for(const width of [1440,768,390,320]){
 const context=await b.newContext({viewport:{width,height:width<500?844:1000},acceptDownloads:true});const page=await context.newPage();const errors=[],external=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(site.url)&&r.status()>=400)errors.push(r.status()+' '+r.url());});page.on('request',r=>{if(r.url().includes('sadovoe-kolco.ru'))external.push(r.url());});
 await maskMap(page);await page.goto(site.url);await stable(page);await page.locator('#cookie-decline').click();
 // Every lot remains reachable; pagination retains exact IDs and category membership.
 for(const [bedrooms,key] of M.keys.entries()){
   await page.locator(`[data-tab="${key}"]`).click();while(await page.locator('#show-more-plans').isVisible())await page.locator('#show-more-plans').click();
   assert.deepEqual((await page.locator('#plans-grid [data-lot-id]').evaluateAll(els=>els.map(e=>e.dataset.lotId))).sort(),apartments.filter(a=>a.bedrooms===bedrooms).map(a=>a.id).sort());
 }
 await page.locator('[data-tab="1k"]').click();await page.locator('#toggle-filters').click();await page.locator('#budget-filter').selectOption('8000000');assert.equal(await page.locator('#plans-grid .card').count(),2);assert.equal(await page.locator('#plans-grid .card').first().getAttribute('data-lot-id'),'22890');
 await page.locator('#floor-filter').selectOption('2');assert.equal(await page.locator('#plans-grid .card').count(),0);assert.match(await page.locator('#plans-grid').textContent(),/предложений нет/);await page.locator('#reset-filters').click();
 await page.locator('#layout-filter').selectOption('layout-12c10e0ed8f5');assert.deepEqual((await page.locator('#plans-grid .card').evaluateAll(els=>els.map(e=>e.dataset.lotId))).sort(),['22890','22906','22938']);await page.locator('#reset-filters').click();
 await page.locator('#sea-filter').check();for(const id of await page.locator('#plans-grid .card').evaluateAll(els=>els.map(e=>e.dataset.lotId)))assert.ok(apartments.find(p=>p.id===id).features.includes('Вид на море'));await page.locator('#reset-filters').click();
 // Minimum and maximum: exact currency, IDs, floor, view, snapshot and PDF all agree.
 for(const id of ['22825','23037']){
  const p=apartments.find(a=>a.id===id);await page.locator(`[data-tab="${M.keys[p.bedrooms]}"]`).click();const card=page.locator(`[data-lot-id="${id}"]`);
  assert.equal(num(await card.locator('.plan-price').textContent()),p.price_rub);
  await card.locator('[data-plan-view="unfurnished"]').click();const opener=card.locator('.plan-thumb');await opener.click();assert.match(await page.locator('#lightbox-title-text').textContent(),/Без мебели/);
  await page.keyboard.press('ArrowRight');assert.match(await page.locator('#lightbox-title-text').textContent(),/На этаже/);assert.ok((await page.locator('#lightbox-asset').getAttribute('src')).includes(p.plans.find(a=>a.type==='floor').sha256));
  await page.locator('#zoom-in').click();assert.equal(await page.locator('#zoom-reset').textContent(),'150%');await page.keyboard.press('+');assert.equal(await page.locator('#zoom-reset').textContent(),'200%');await page.keyboard.press('ArrowRight');await page.keyboard.press('0');assert.equal(await page.locator('#zoom-reset').textContent(),'100%');
  const surface=page.locator('#lightbox-image');await surface.dispatchEvent('touchstart',{touches:[{identifier:0,clientX:100,clientY:100},{identifier:1,clientX:200,clientY:100}]});await surface.dispatchEvent('touchmove',{touches:[{identifier:0,clientX:50,clientY:100},{identifier:1,clientX:250,clientY:100}]});await surface.dispatchEvent('touchend',{touches:[],changedTouches:[{identifier:0,clientX:50,clientY:100}]});assert.equal(await page.locator('#zoom-reset').textContent(),'200%');await page.locator('#zoom-reset').click();
  if(evidence&&id==='23037')await page.screenshot({path:path.join(evidence,`plan-${width}.png`)});
  await page.keyboard.press('Escape');assert.equal(await opener.evaluate(el=>el===document.activeElement),true);
  await card.locator('[data-action="calc-here"]').click();assert.equal(num(await page.locator('#price-label').textContent()),p.price_rub);assert.equal(Number(await page.locator('#price-range').inputValue()),p.price_rub);assert.match(await page.locator('#calc-plan-meta').textContent(),new RegExp('ID '+id));assert.match(await page.locator('#calc-plan-meta').textContent(),/На этаже/);
  await page.locator('#send-to-form').click();assert.match(await page.locator('#snapshot-slot').textContent(),new RegExp('ID '+id));assert.equal(await page.evaluate(()=>state.snapshot.lotId),id);assert.equal(await page.evaluate(()=>state.snapshot.planView),'floor');
  if(width===1440){
   await page.evaluate(()=>{window.__originalPdf=makeCalcPdf;makeCalcPdf=(html,name)=>{window.__pdfHtml=html;return window.__originalPdf(html,name);};});
   const downloadPromise=page.waitForEvent('download');await page.locator('#download-calc').click();const download=await downloadPromise;const target=path.join(tmp,id+'.pdf');await download.saveAs(target);const pdf=await PDFDocument.load(fs.readFileSync(target));assert.equal(pdf.getPageCount(),1);
   const pdfHtml=await page.evaluate(()=>window.__pdfHtml);for(const value of ['ID '+id,M.rub(p.price_rub),p.source_url,'На этаже','27.10.2026','+7 (952) 956-88-75','info@anyara.ru'])assert.ok(pdfHtml.includes(value),value);assert.doesNotMatch(pdfHtml,/775-28-92|info@sk-gc/);
   if(evidence)fs.copyFileSync(target,path.join(evidence,'mortgage-'+id+'.pdf'));
   await page.evaluate(()=>{makeCalcPdf=window.__originalPdf;});
  }
 }
 // Month controls contain actual dated album photos, with no fake October album.
 for(const album of media.construction){await page.locator(`#construction-tabs [data-month="${album.month}"]`).click();const grid=page.locator(`[data-album="${album.month}"]`);assert.equal(await grid.isVisible(),true);assert.equal(await grid.locator('.gallery-item').count(),album.images.length);await grid.locator('.gallery-item').first().click();assert.match(await page.locator('#lightbox-caption').textContent(),/Фото строительства/);await page.keyboard.press('Escape');}
 if(evidence){
  await page.locator('[data-tab="studio"]').click();await page.locator('#plans').screenshot({path:path.join(evidence,`catalog-${width}.jpg`),type:'jpeg',quality:88});
  for(const [section,name] of [['#gallery','gallery'],['#progress','construction']])await page.locator(section).screenshot({path:path.join(evidence,`${name}-${width}.jpg`),type:'jpeg',quality:85});
 }
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();console.log(`PASS catalog ${width}px: all 28 lots, filters/groups, 3 plan views, pinch/zoom, IDs/prices in calculation/snapshot${width===1440?'/PDF':''}, monthly photos, no overflow/errors/hotlinks`);
}
// No-script users have native category disclosures, all 28 offers and all media links.
const context=await b.newContext({javaScriptEnabled:false,viewport:{width:320,height:844}}),page=await context.newPage();await maskMap(page);await page.goto(site.url);assert.equal(await page.locator('.static-category').count(),4);for(const category of await page.locator('.static-category').all()){if(!await category.getAttribute('open')&&await category.getAttribute('open')===null)await category.locator('summary').first().click();assert.ok(await category.locator('.plan-thumb').first().isVisible());}assert.equal(await page.locator('[data-lot-id]').count(),28);assert.equal(await page.locator('.construction-album').count(),6);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await context.close();console.log('PASS no-JavaScript catalog and six albums at 320px');
}finally{await b.close();await site.close();fs.rmSync(tmp,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
