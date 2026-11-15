const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path');
const before=process.env.BEFORE_URL,after=process.env.AFTER_URL,out=process.env.QA_OUTPUT_DIR;
if(!before||!after||!out)throw Error('Set BEFORE_URL, AFTER_URL, QA_OUTPUT_DIR');
(async()=>{fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch();let data=[];try{
for(const width of [1440,768,390,320])for(const js of [true,false])for(const [phase,url]of [['before',before],['after',after]]){
 const c=await browser.newContext({viewport:{width,height:844},deviceScaleFactor:1,javaScriptEnabled:js,reducedMotion:'reduce'}),p=await c.newPage();let requests=[];p.on('request',r=>requests.push(r.url()));await p.route('https://www.openstreetmap.org/**',r=>r.fulfill({contentType:'text/html',body:'<body style="margin:0;background:#EEE8DC">'}));await p.goto(url);await p.waitForFunction(()=>document.fonts.status==='loaded');await p.evaluate(content=>{const style=document.createElement('style');style.textContent=content;document.head.append(style);},'html{scroll-behavior:auto!important}*,*::before,*::after{animation:none!important;transition:none!important}[data-reveal-key]{opacity:1!important;transform:none!important}');await p.waitForTimeout(150);
 const geometry=await p.evaluate(()=>Object.fromEntries(['#hero-section','#about','#location','#gallery','#plans','#pricing','#progress','#contact','footer'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return[s,{x:r.x,y:r.y+scrollY,width:r.width,height:r.height}]})));
 for(const selector of ['#hero-section','#about','#location','#gallery','#plans','#pricing','#progress','#contact','footer']){
  const key=selector.replace('#','');if(key!=='hero-section'){
   if(js&&await p.locator('#cookie-banner').isVisible())await p.locator('#cookie-decline').click();
   await p.evaluate(selector=>scrollTo(0,document.querySelector(selector).getBoundingClientRect().top+scrollY),selector);await p.waitForTimeout(120);
  }
  await p.evaluate(()=>Promise.all([...document.images].filter(i=>{const r=i.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0}).map(i=>i.decode().catch(()=>{}))));await p.screenshot({path:path.join(out,`${phase}-${width}-${js?'js':'nojs'}-${key}.png`)});
 }
 data.push({phase,width,js,geometry,photos:await p.evaluate(()=>[...document.querySelectorAll('.about-style-4 img,.location-style-11 img,.logo,.footer-logo')].map(i=>({src:i.currentSrc,width:i.naturalWidth,height:i.naturalHeight,box:i.getBoundingClientRect().toJSON()}))),photoRequests:requests.filter(u=>/architecture|location\.webp|location-\d|logo/.test(u))});await c.close();console.log('Captured',phase,width,js);
}
fs.writeFileSync(path.join(out,'visual.json'),JSON.stringify(data,null,2));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
