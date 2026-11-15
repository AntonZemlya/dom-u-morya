const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {root,server,browser,maskMap}=require('./helpers.cjs');
const out=process.env.ARROWS_EVIDENCE_DIR?path.resolve(process.env.ARROWS_EVIDENCE_DIR):null,records=[];
const app=fs.readFileSync(path.join(root,'script.js'),'utf8');
assert.doesNotMatch(app,/positionLightboxNavigation|scheduleLightboxNavigation|resetLightboxNavigation|navigationFrame|navigationVersion|ResizeObserver/,'Image-driven navigation machinery must be removed');
assert.doesNotMatch(fs.readFileSync(path.join(root,'styles.css'),'utf8'),/--lightbox-arrow-inset|is-positioned|over-image/,'No old image-driven CSS positioning');
async function geometry(p){return p.evaluate(()=>{
 const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
 const img=document.getElementById('lightbox-asset'),r=img.getBoundingClientRect(),ratio=img.naturalWidth/img.naturalHeight;
 const w=Math.min(r.width,r.height*ratio),h=w/ratio;
 return {viewport:{width:innerWidth,height:innerHeight},mode:document.getElementById('lightbox').dataset.mode,stage:rect(document.querySelector('.lightbox-body')),image:rect(document.querySelector('.lightbox-image')),frame:{left:r.left+(r.width-w)/2,right:r.left+(r.width+w)/2,top:r.top+(r.height-h)/2,bottom:r.top+(r.height+h)/2,width:w,height:h},buttons:['lightbox-prev','lightbox-next'].map(id=>{const e=document.getElementById(id),s=getComputedStyle(e);return {id,...rect(e),icon:rect(e.querySelector('svg')),background:s.backgroundColor,opacity:Number(s.opacity),before:getComputedStyle(e,'::before').content};}),controls:[document.querySelector('.lightbox-head'),document.querySelector('.lightbox-bottom'),document.querySelector('.lightbox-caption'),document.querySelector('#lightbox-variants')].filter(e=>e.getClientRects().length).map(rect),overflow:document.documentElement.scrollWidth>innerWidth};
});}
const overlap=(a,b)=>Math.min(a.right,b.right)>Math.max(a.left,b.left)+1&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+1;
function same(a,b,label){
 for(let i=0;i<2;i++)for(const key of ['x','y','width','height'])assert.ok(Math.abs(a.buttons[i][key]-b.buttons[i][key])<=1,`${label}: ${a.buttons[i].id} ${key}: ${a.buttons[i][key]} != ${b.buttons[i][key]}`);
}
function validate(g,label){
 const desktop=g.viewport.width>600,min=desktop?48:44;
 assert.equal(g.overflow,false,label+' horizontal overflow');
 for(const b of g.buttons){
  assert.ok(b.width>=min&&b.height>=min,label+' hit area');assert.ok(b.left>=0&&b.right<=g.viewport.width+.5&&b.top>=0&&b.bottom<=g.viewport.height+.5,label+' viewport containment');
  assert.ok(Math.abs((b.icon.top+b.icon.bottom)/2-(g.stage.top+g.stage.bottom)/2)<=1,label+' fixed stage centre');
  assert.ok(b.before==='none'||b.before==='normal',label+' no decorative disc');
  for(const c of g.controls)assert.equal(overlap(b,c),false,label+' title/zoom/caption separation');
 }
 if(desktop){assert.ok(g.buttons[0].right<=g.image.left-11,label+' left reserved column');assert.ok(g.buttons[1].left>=g.image.right+11,label+' right reserved column');}
 else{assert.ok(g.image.width>=g.stage.width-1,label+' full mobile photograph width');assert.ok(g.buttons[0].left===g.stage.left&&g.buttons[1].right===g.stage.right,label+' fixed mobile edges');}
}
async function ready(p){
 await p.waitForFunction(()=>!lb.settling);
 await p.waitForFunction(async()=>{const i=document.getElementById('lightbox-asset');if(!i?.complete||!i.naturalWidth)return false;try{await i.decode();return i===document.getElementById('lightbox-asset')&&i.complete;}catch{return false;}});
 await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function measure(p,reference,label,width,capture=false){
 await ready(p);const g=await geometry(p);same(g,reference,label);validate(g,label);records.push({label,width,...g});
 if(out&&capture)await p.screenshot({path:path.join(out,`${label}-${width}.png`)});return g;
}
(async()=>{
 if(out)fs.mkdirSync(out,{recursive:true});const site=await server(path.join(root,'dist')),b=await browser();
 try{for(const width of [1440,768,390,320]){
  const c=await b.newContext({viewport:{width,height:width<500?844:1000},hasTouch:width<500,isMobile:width<500}),p=await c.newPage(),errors=[];
  p.on('pageerror',e=>errors.push(e.message));await maskMap(p);await p.goto(site.url);await p.evaluate(()=>document.fonts.ready);await p.locator('#cookie-decline').click();await p.addStyleTag({content:'html{scroll-behavior:auto!important}'});
  await p.locator('#gallery-view-all').click();await ready(p);const reference=await geometry(p);validate(reference,'initial '+width);
  assert.equal(await p.locator('#lightbox-track .lightbox-slide img[src]').count(),3,'Three neighbouring frames remain preloaded');
  await measure(p,reference,'tower',width,true);
  // Actual button navigation through all eight proportions; no direct index assignment.
  for(let i=1;i<8;i++){await p.locator('#lightbox-next').click();await measure(p,reference,i===1?'horizontal':i===5?'vertical':'gallery-'+i,width,[1,5].includes(i));}
  await p.locator('#lightbox-next').click();await measure(p,reference,'wrap',width);
  await p.evaluate(()=>{lightboxNav(1);lightboxNav(1);lightboxNav(1);});await measure(p,reference,'rapid',width);
  // Enlarging and moving the image must never move the controls.
  await p.locator('#zoom-in').click();await p.keyboard.press('ArrowRight');same(await geometry(p),reference,'zoom/pan '+width);await p.keyboard.press('0');
  await p.keyboard.press('Escape');assert.equal(await p.locator('#gallery-view-all').evaluate(e=>e===document.activeElement),true);
  await p.locator('.construction-album:not([hidden]) .album-view-all').click();await measure(p,reference,'construction',width,true);
  const count=await p.evaluate(()=>lb.items.length);for(let i=1;i<count;i++){await p.locator('#lightbox-next').click();await measure(p,reference,'construction-'+i,width);}
  await p.keyboard.press('Escape');await p.locator('#plans-grid .plan-thumb').first().click();await measure(p,reference,'plan',width,true);
  for(const i of [1,2,0]){await p.locator(`[data-lb-view="${i}"]`).click();await measure(p,reference,'plan-'+i,width);}
  // Keyboard focus remains contained and visibly identifies the side control.
  await p.locator('#lightbox-close').focus();await p.keyboard.press('Tab');await p.keyboard.press('Tab');await p.keyboard.press('Tab');await p.keyboard.press('Tab');
  assert.equal(await p.locator('#lightbox-prev').evaluate(e=>e===document.activeElement&&e.matches(':focus-visible')),true);
  assert.equal(await p.locator('#lightbox-prev').evaluate(e=>getComputedStyle(e).outlineStyle),'solid');
  await p.locator('[data-lb-view="2"]').click();await p.locator('#lightbox-calc').click();assert.match(await p.locator('#calc-plan-meta').innerText(),/На этаже/);
  await p.locator('#gallery-view-all').click();await ready(p);same(await geometry(p),reference,'reopen '+width);
  // Intrinsic size and decode completion are deliberately irrelevant to layout.
  for(const [w,h] of [[8,32],[5000,1200]]){
   await p.evaluate(([w,h])=>{lb.items[0]={src:`data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"></svg>`,preview:'',title:'Intrinsic-size fixture',caption:'Short caption'};lb.index=0;renderLightbox();},[w,h]);
   same(await geometry(p),reference,'before decode '+width);await measure(p,reference,'intrinsic-'+w,width);
  }
  // Long captions/titles and a failed image cannot change the permanent stage.
  await p.evaluate(()=>{lb.items[0]={src:'data:image/png;base64,AA==',preview:'',title:'Заголовок для проверки постоянной области',caption:'Подпись '.repeat(60)};renderLightbox();});
  await p.waitForFunction(()=>document.getElementById('lightbox-asset').complete);same(await geometry(p),reference,'failed asset/caption '+width);validate(await geometry(p),'failed asset '+width);
  await p.keyboard.press('Escape');await p.locator('#gallery-view-all').click();await ready(p);
  if(width<500){
   const cdp=await c.newCDPSession(p),r=await p.locator('#lightbox-image').boundingBox(),x=r.x+r.width*.7,y=r.y+r.height/2;
   const send=(type,points=[])=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([x,y,id=1])=>({x,y,id}))});
   await send('touchStart',[[x,y]]);for(const dx of [-25,-55,-85,-120]){await send('touchMove',[[x+dx,y]]);same(await geometry(p),reference,'finger move '+width);}
   if(out)await p.screenshot({path:path.join(out,`swipe-${width}.png`)});
   await send('touchEnd');await measure(p,reference,'touch-swipe',width);assert.equal(await p.locator('#lightbox-position').textContent(),'2 из 8');
   await send('touchStart',[[x-70,y,1],[x,y,2]]);await send('touchMove',[[x-105,y,1],[x+35,y,2]]);await p.waitForFunction(()=>lb.zoom>1.5);same(await geometry(p),reference,'pinch '+width);await send('touchEnd');
   await send('touchStart',[[x,y]]);await send('touchMove',[[x-50,y+20]]);await send('touchEnd');same(await geometry(p),reference,'touch pan '+width);await p.locator('#zoom-reset').click();
   await p.setViewportSize({width:844,height:390});await ready(p);const landscape=await geometry(p);validate(landscape,'landscape '+width);
   await p.locator('#lightbox-next').click();await measure(p,landscape,'landscape-next',844);
   await p.setViewportSize({width,height:844});await measure(p,reference,'orientation-return',width);await cdp.detach();
  }
  await p.emulateMedia({reducedMotion:'reduce'});await p.locator('#lightbox-next').click();await measure(p,reference,'reduced-motion',width);
  await p.keyboard.press('Escape');assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  await c.close();console.log(`PASS fixed lightbox nav ${width}px: constant X/Y across all frames/modes, 5 required images, zoom/pan, loading, captions, hit areas, focus${width<500?', real touch/orientation':''}`);
 }
 if(out)fs.writeFileSync(path.join(out,'geometry.json'),JSON.stringify({status:'PASS',toleranceCssPx:1,records},null,2)+'\n');
 }finally{await b.close();await site.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
