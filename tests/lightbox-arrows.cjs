const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {root,server,browser,maskMap}=require('./helpers.cjs');
const before=process.env.ARROWS_PHASE==='before',out=process.env.ARROWS_EVIDENCE_DIR;
const evidence=out?path.resolve(out):null,records=[];
// Measure the painted object-fit rectangle independently of application CSS variables.
async function geometry(p){return p.evaluate(()=>{
 const img=document.getElementById('lightbox-asset'),r=img.getBoundingClientRect(),ratio=img.naturalWidth/img.naturalHeight;
 const w=Math.min(r.width,r.height*ratio),h=w/ratio;
 const frame={left:r.left+(r.width-w)/2,right:r.left+(r.width+w)/2,top:r.top+(r.height-h)/2,bottom:r.top+(r.height+h)/2,width:w,height:h};
 const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
 return {frame,viewport:{width:innerWidth,height:innerHeight},buttons:['lightbox-prev','lightbox-next'].map(id=>{const el=document.getElementById(id),s=getComputedStyle(el,'::before');return {id,...rect(el),circle:parseFloat(s.width),visible:getComputedStyle(el).visibility,stroke:getComputedStyle(el.querySelector('path')).stroke,vectorEffect:getComputedStyle(el.querySelector('path')).vectorEffect};}),controls:['lightbox-close','lightbox-zoom','lightbox-position'].map(id=>{const el=id==='lightbox-zoom'?document.querySelector('.lightbox-zoom'):document.getElementById(id);return rect(el);})};
});}
const anchors=g=>g.buttons.map(({id,left,right,top,bottom,width,height})=>({id,left,right,top,bottom,width,height}));
const overlaps=(a,b)=>Math.min(a.right,b.right)>Math.max(a.left,b.left)+1&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+1;
async function ready(p){
 await p.waitForFunction(()=>!lb.settling);await p.waitForFunction(async()=>{const i=document.getElementById('lightbox-asset');if(!i?.complete||!i.naturalWidth)return false;try{await i.decode();return i===document.getElementById('lightbox-asset')&&i.complete;}catch{return false;}});
 await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 if(!before){await p.waitForFunction(()=>!lb.navigationFrame&&document.querySelector('.lightbox-navigation').classList.contains('is-positioned')); }
 // Wait for the finite position easing, keeping real carousel animation enabled.
 if(!before)await p.waitForFunction(()=>document.getElementById('lightbox').getAnimations({subtree:true}).every(a=>a.playState==='finished'||a.effect?.getComputedTiming().duration===Infinity));
}
function validate(g,label){
 const {frame:f,buttons,viewport:v}=g;
 assert.ok(f.width>0&&f.height>0,label+' image decoded');
 for(const b of buttons){
  const hit=v.width>600?48:44;
  assert.ok(b.width>=hit&&b.height>=hit,label+' touch target');
  assert.ok(b.left>=0&&b.top>=0&&b.right<=v.width+.5&&b.bottom<=v.height+.5,label+' viewport bounds');
  assert.ok(Math.abs((b.top+b.bottom)/2-(f.top+f.bottom)/2)<1.5,label+' actual photograph centre');
  assert.equal(b.vectorEffect,'non-scaling-stroke',label+' readable thin stroke at CSS size');
  assert.ok(b.circle>=(v.width>600?36:32)&&b.circle<=(v.width>600?40:36),label+' lighter visible circle');
  for(const control of g.controls)assert.equal(overlaps(b,control),false,label+' toolbar/close separation');
 }
 if(v.width>600){
  assert.ok(buttons[0].right<=f.left-11,label+' previous fully outside photo');
  assert.ok(buttons[1].left>=f.right+11,label+' next fully outside photo');
  assert.ok(f.left-buttons[0].right<=20.5&&buttons[1].left-f.right<=20.5,label+' adjacent to photo, not container');
 }else{
  for(const b of buttons){
   const visible={left:(b.left+b.right-b.circle)/2,right:(b.left+b.right+b.circle)/2,top:(b.top+b.bottom-b.circle)/2,bottom:(b.top+b.bottom+b.circle)/2};
   const overlap=Math.max(0,Math.min(visible.right,f.right)-Math.max(visible.left,f.left));
   assert.ok(overlap<=28,label+' minimal visible mobile overlap');
  }
 }
}
async function capture(p,label,width){
 await ready(p);const g=await geometry(p);if(!before)validate(g,label+' '+width);
 records.push({label,width,...g});
 if(evidence)await p.screenshot({path:path.join(evidence,`${label}-${width}.png`),type:'png'});
 return g;
}
(async()=>{
 if(evidence)fs.mkdirSync(evidence,{recursive:true});
 const site=await server(path.join(root,'dist')),b=await browser();
 try{
  for(const width of [1440,768,390,320]){
   const c=await b.newContext({viewport:{width,height:width<500?844:1000},hasTouch:width<500,isMobile:width<500});
   const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await maskMap(p);await p.goto(site.url);await p.evaluate(()=>document.fonts.ready);await p.locator('#cookie-decline').click();
   // Include the three owner-named frames: intermediate tower, wide terraces, portrait lobby.
   await p.locator('#gallery-view-all').click();
   for(const [index,label] of [[0,'tower'],[1,'horizontal'],[5,'vertical']]){
    await p.evaluate(index=>{cancelLightboxMotion();lb.index=index;renderLightbox();},index);
    await capture(p,label,width);
   }
   if(!before){
    // Rapid queued navigation ends with positions belonging to the final visible photo.
    await p.evaluate(()=>{lightboxNav(1);lightboxNav(1);lightboxNav(1);});await ready(p);validate(await geometry(p),'rapid '+width);
    const original=await p.locator('#lightbox-position').textContent();
    await p.locator('#lightbox-prev').click();await ready(p);assert.notEqual(await p.locator('#lightbox-position').textContent(),original);
    await p.locator('#zoom-in').click();assert.equal(await p.locator('#zoom-reset').textContent(),'150%');await p.keyboard.press('ArrowRight');assert.equal(await p.locator('#zoom-reset').textContent(),'150%');await p.keyboard.press('0');await ready(p);
   }
   await p.keyboard.press('Escape');assert.equal(await p.locator('#gallery-view-all').evaluate(el=>el===document.activeElement),true);
   await p.locator('.construction-album:not([hidden]) .album-view-all').click();await capture(p,'construction',width);await p.keyboard.press('Escape');
   await p.locator('#plans-grid .plan-thumb').first().click();await capture(p,'plan',width);
   if(!before){
    // SVG variants and the floor plan retain their correct fitted geometry.
    await p.locator('[data-lb-view="2"]').click();await ready(p);validate(await geometry(p),'floor SVG '+width);
    await p.locator('#lightbox-close').focus();await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.getElementById('lightbox').contains(document.activeElement)),true);
    if(width<500){
     await p.keyboard.press('Escape');await p.locator('#gallery-view-all').click();await ready(p);
     const cdp=await c.newCDPSession(p),box=await p.locator('#lightbox-image').boundingBox(),x=box.x+box.width*.7,y=box.y+box.height*.5;
     const send=(type,points=[])=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([x,y,id=1])=>({x,y,id}))});
     const start=await geometry(p);
     await send('touchStart',[[x,y]]);
     for(const dx of [-20,-45,-70,-100]){await send('touchMove',[[x+dx,y]]);await p.waitForTimeout(25);const moving=await geometry(p);assert.deepEqual(anchors(moving),anchors(start),'arrows freeze during real finger movement');}
     if(evidence)await p.screenshot({path:path.join(evidence,`swipe-${width}.png`)});
     await send('touchEnd');await ready(p);assert.equal(await p.locator('#lightbox-position').textContent(),'2 из 8');validate(await geometry(p),'after real swipe '+width);
     await p.locator('#lightbox-next').click();await ready(p);assert.equal(await p.locator('#lightbox-position').textContent(),'3 из 8');
     // Pinch/pan positions are stable, rather than chasing the enlarged image.
     const g=await geometry(p);await send('touchStart',[[x-70,y,1],[x,y,2]]);await send('touchMove',[[x-105,y,1],[x+35,y,2]]);await p.waitForFunction(()=>lb.zoom>1.5);await send('touchEnd');
     assert.deepEqual(anchors(await geometry(p)),anchors(g),'arrows freeze during pinch');await p.locator('#zoom-reset').click();
     // Orientation and a return to portrait recalculate against the new actual frame.
     await p.setViewportSize({width:844,height:390});await ready(p);validate(await geometry(p),'landscape resize '+width);
     await p.setViewportSize({width,height:844});await ready(p);validate(await geometry(p),'portrait resize '+width);
     await p.emulateMedia({reducedMotion:'reduce'});await p.locator('#lightbox-next').click();await ready(p);validate(await geometry(p),'reduced motion '+width);await cdp.detach();
    }
    // Missing image data uses a safe fitted-box fallback; stale decode callbacks cannot move a new frame.
    await p.evaluate(()=>{cancelLightboxMotion();lb.items[lb.index]={src:'data:image/png;base64,AA==',preview:'',title:'Geometry fallback',caption:''};renderLightbox();});
    await p.waitForFunction(()=>document.getElementById('lightbox-asset').complete);await p.waitForTimeout(200);
    const fallback=await p.locator('#lightbox-next').boundingBox();assert.ok(fallback.x>=0&&fallback.y>=0&&fallback.x+fallback.width<=width);
   }
   await p.keyboard.press('Escape');assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
   await c.close();console.log(`PASS lightbox arrows ${before?'baseline':'candidate'} ${width}px: tower / terraces / lobby / construction / SVG${before?'':' geometry, hit areas, rapid changes, focus, mobile gestures/resize'}`);
  }
  if(evidence)fs.writeFileSync(path.join(evidence,'geometry.json'),JSON.stringify({phase:before?'before':'after',records},null,2)+'\n');
 }finally{await b.close();await site.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
