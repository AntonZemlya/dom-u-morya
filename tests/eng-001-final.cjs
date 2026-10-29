const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {PDFDocument}=require('pdf-lib');
const {root,server,browser,stable,maskMap}=require('./helpers.cjs');
const {withNofollow}=require('./external-links.cjs');
const pages=['index.html','privacy.html','consent-personal-data.html'];
// Exact comparisons preserve every URL, text, target, noopener and internal link.
for(const name of pages){
 const before=execFileSync('git',['show','1c5d513:'+name],{cwd:root,encoding:'utf8',maxBuffer:1e6});
 const source=fs.readFileSync(path.join(root,name),'utf8');
 assert.equal(require('./seo-contract.cjs').semantic(require('./seo-contract.cjs').body(source)),require('./seo-contract.cjs').body(withNofollow(before)),name+': only external nofollow additions');
 assert.equal(fs.readFileSync(path.join(root,'dist',name),'utf8'),source,name+': build preserves attributes');
}
(async()=>{const site=await server(path.join(root,'dist')),b=await browser();try{
 for(const width of [1440,390]){
  const context=await b.newContext({viewport:{width,height:width===390?844:1000},reducedMotion:'reduce',acceptDownloads:true});
  const p=await context.newPage();await maskMap(p);
  for(const name of pages){
   await p.goto(site.url+'/'+name);await stable(p);
   // Parse the built response independently of JavaScript, then inspect rendered DOM.
   const raw=await (await p.request.get(site.url+'/'+name)).text();
   const counts=await p.evaluate(raw=>{
    const audit=doc=>[...doc.querySelectorAll('a[href]')].filter(a=>/^(?:https?:)?\/\//i.test(a.getAttribute('href'))).map(a=>({href:a.getAttribute('href'),nofollow:a.relList.contains('nofollow'),safe:a.target!=='_blank'||a.relList.contains('noopener')}));
    return {built:audit(new DOMParser().parseFromString(raw,'text/html')),dom:audit(document)};
   },raw);
   assert.deepEqual(counts.dom,counts.built,name+': static and rendered links match');
   assert.equal(counts.dom.length,{'index.html':3,'privacy.html':2,'consent-personal-data.html':1}[name]);
   for(const link of counts.dom){assert.ok(link.nofollow,link.href);assert.ok(link.safe,link.href);}
  }
  await p.goto(site.url);await stable(p);await p.locator('#cookie-decline').click();
  const button=p.locator('#download-calc');await button.scrollIntoViewIfNeeded();
  const css=()=>button.evaluate(e=>{const s=getComputedStyle(e);return {cursor:s.cursor,bg:s.backgroundColor,border:s.borderColor,shadow:s.boxShadow,outline:s.outlineStyle,opacity:s.opacity,width:e.offsetWidth,height:e.offsetHeight};});
  const capture=async state=>{if(process.env.QA_OUTPUT_DIR)await button.screenshot({path:path.join(process.env.QA_OUTPUT_DIR,`download-${state}-${width}.png`)});};
  await p.mouse.move(0,0);const idle=await css();assert.equal(idle.cursor,'pointer');await capture('idle');
  await button.hover();const hover=await css();assert.notEqual(hover.bg,idle.bg);assert.notEqual(hover.border,idle.border);await capture('hover');
  await p.mouse.down();const active=await css();assert.notEqual(active.bg,hover.bg);await p.mouse.move(0,0);await p.mouse.up();
  await p.locator('#send-to-form').focus();await p.keyboard.press('Tab');
  assert.equal(await button.evaluate(e=>document.activeElement===e&&e.matches(':focus-visible')),true);
  assert.equal((await css()).outline,'solid');await capture('focus');
  await button.evaluate(e=>{e.blur();e.disabled=true;});await button.hover({force:true});const disabled=await css();
  assert.equal(disabled.cursor,'not-allowed');assert.equal(disabled.bg,idle.bg);assert.equal(disabled.border,idle.border);assert.ok(Number(disabled.opacity)<1);await capture('disabled');
  await button.evaluate(e=>{e.disabled=false;e.classList.add('busy');});assert.equal((await css()).cursor,'progress');assert.equal((await css()).bg,idle.bg);
  await button.evaluate(e=>e.classList.remove('busy'));
  assert.deepEqual({width:hover.width,height:hover.height},{width:idle.width,height:idle.height},'No button resize');
  // Exercise real PDF generation; hold it briefly to verify busy/duplicate blocking.
  await p.locator('[data-tab="3k"]').click();await p.locator('[data-lot-id="23037"] [data-action="calc-here"]').click();
  await p.locator('[data-mortgage-program="family"]').click();
  await p.evaluate(()=>{const original=makeCalcPdf;window.__pdfCalls=0;makeCalcPdf=(html,name)=>{window.__pdfCalls++;window.__pdfHtml=html;return new Promise(resolve=>window.__releasePdf=resolve).then(()=>original(html,name));};});
  await p.locator('#send-to-form').focus();await p.keyboard.press('Tab');assert.equal(await button.evaluate(e=>document.activeElement===e),true);
  const download=p.waitForEvent('download');await p.keyboard.press(width===1440?'Enter':'Space');
  assert.equal(await button.isDisabled(),true);assert.equal(await button.evaluate(e=>e.classList.contains('busy')),true);
  assert.equal((await css()).cursor,'progress');assert.equal((await css()).bg,idle.bg);assert.match(await button.innerText(),/Готовим PDF/);await capture('busy');
  await button.evaluate(e=>e.click());await p.evaluate(()=>downloadCalc());assert.equal(await p.evaluate(()=>window.__pdfCalls),1);
  await p.evaluate(()=>window.__releasePdf());const dl=await download;const bytes=fs.readFileSync(await dl.path());
  assert.equal((await PDFDocument.load(bytes)).getPageCount(),1);assert.ok(bytes.length>20000);
  const html=await p.evaluate(()=>window.__pdfHtml),lot=require('../data/apartments.json').find(a=>a.id==='23037');
  for(const value of ['ID 23037',lot.price_rub.toLocaleString('ru-RU'),'6.0%','Семейная ипотека','не означает её доступность на всю сумму'])assert.ok(html.includes(value),value);
  if(process.env.QA_OUTPUT_DIR)await dl.saveAs(path.join(process.env.QA_OUTPUT_DIR,`download-${width}.pdf`));
  await p.waitForFunction(()=>!state.pdfBusy);assert.equal(await button.isEnabled(),true);assert.equal((await css()).cursor,'pointer');
  assert.equal(await p.locator('#pdf-status').getAttribute('role'),'status');assert.equal(await p.locator('#pdf-status').isVisible(),false);
  await context.close();console.log(`PASS ENG-001 final ${width}: 6 built/rendered external links; cursor/hover/active/focus/disabled/busy; keyboard PDF, lot/price/rate/conditions, duplicate blocking`);
 }
}finally{await b.close();await site.close();}})().catch(e=>{console.error(e);process.exitCode=1});
