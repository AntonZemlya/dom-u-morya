const {previewURL}=require('./helpers.cjs');
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
const assert=require('node:assert/strict');
const {chromium}=require(root+'/node_modules/playwright');
const phase=process.argv[2]||'current', out=path.join(process.env.QA_OUTPUT_DIR||require('os').tmpdir()+'/seo-001-qa',phase);fs.mkdirSync(out,{recursive:true});
(async()=>{const b=await chromium.launch();const results=[];try{
for(const width of [1440,768,390,320,390]){const slow=results.length===4;const record={width,slow,runs:[]};
for(let rep=0;rep<3;rep++){
 const c=await b.newContext({viewport:{width,height:width===1440?900:width===768?1024:844},deviceScaleFactor:width<500?2:1,isMobile:width<500,hasTouch:width<500,reducedMotion:'reduce',serviceWorkers:'block'}),p=await c.newPage(),cdp=await c.newCDPSession(p);let net=[],responses={},errors=[];
 await p.route('https://www.openstreetmap.org/**',r=>r.fulfill({contentType:'text/html',body:'<body style="margin:0;background:#EEE8DC">'}));
 await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
 if(slow){await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:210000,uploadThroughput:85000,connectionType:'cellular4g'});await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});}
 cdp.on('Network.responseReceived',e=>responses[e.requestId]={url:e.response.url,status:e.response.status});cdp.on('Network.loadingFinished',e=>{if(responses[e.requestId])net.push({...responses[e.requestId],bytes:e.encodedDataLength})});p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{window.__lcp=0;window.__cls=0;new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lcp=e.startTime}).observe({type:'largest-contentful-paint',buffered:true});new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__cls+=e.value}).observe({type:'layout-shift',buffered:true})});
 await p.goto((previewURL+'/'),{waitUntil:'load'});await p.waitForTimeout(slow?7000:2200);
 const initial=await p.evaluate(()=>({lcp:window.__lcp,cls:window.__cls,overflow:document.documentElement.scrollWidth>innerWidth,fonts:[...document.fonts].filter(f=>f.status==='loaded').map(f=>[f.family,f.style,f.weight]),hero:getComputedStyle(document.querySelector('#hero-photo')).backgroundImage}));
 const local=net.filter(x=>x.url.startsWith((previewURL+'/')));initial.bytes=local.reduce((a,x)=>a+x.bytes,0);initial.requests=local.length;initial.errors=errors;initial.bad=net.filter(x=>x.status>=400);initial.resources=local;record.runs.push(initial);console.log(phase,width,slow,rep,initial.bytes,Math.round(initial.lcp),initial.cls);
 if(process.env.QA_SCREENSHOTS==='1'&&rep===0&&!slow){await p.evaluate(()=>document.fonts.ready);await p.addStyleTag({content:'html{scroll-behavior:auto!important} *,*::before,*::after{animation:none!important;transition:none!important}[data-reveal-key]{opacity:1!important;transform:none!important}'});await p.locator('#cookie-decline').click();
 const geometry={};for(const selector of ['#hero-section','#about','#location','#gallery','#plans','#progress','#contact','footer']){const el=p.locator(selector).first();if(!await el.count())continue;await el.scrollIntoViewIfNeeded();await p.waitForTimeout(400);await p.evaluate(()=>Promise.all([...document.images].filter(i=>i.getBoundingClientRect().top<innerHeight&&i.getBoundingClientRect().bottom>0).map(i=>i.decode().catch(()=>{}))));geometry[selector]=await el.boundingBox();await el.screenshot({path:path.join(out,selector.replace(/[#.]/g,'')+'-'+width+'.png')});}
 fs.writeFileSync(path.join(out,'geometry-'+width+'.json'),JSON.stringify(geometry,null,2));
 for(const doc of ['privacy.html','consent-personal-data.html']){await p.goto((previewURL+'/')+doc);await p.evaluate(()=>document.fonts.ready);await p.screenshot({path:path.join(out,doc+'-'+width+'.png'),fullPage:true})}
 }await c.close();}
const median=key=>record.runs.map(r=>r[key]).sort((a,b)=>a-b)[1];record.median={lcp:median('lcp'),cls:median('cls'),bytes:median('bytes'),requests:median('requests')};assert.ok(record.median.lcp<2500,'LCP budget');assert.ok(record.median.cls<0.1,'CLS budget');for(const r of record.runs){assert.equal(r.overflow,false);assert.deepEqual(r.errors,[]);assert.deepEqual(r.bad,[]);}results.push(record);fs.writeFileSync(path.join(out,'measurements.json'),JSON.stringify(results,null,2));}
}finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
