const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const sharp = require('sharp');
const {root,server,browser,stable,maskMap} = require('./helpers.cjs');
const out=path.join(root,'docs/qa');
const sections=['hero-section','about','location','plans','pricing','progress','developer','gallery','contact'];
(async()=>{
 let extracted;
 let reference=process.env.REFERENCE_DIR;
 if(!reference){
  extracted=fs.mkdtempSync(path.join(os.tmpdir(),'dom-u-morya-reference-'));
  execFileSync('python3',['-c','import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',path.join(root,'reference/claude-design-2026-10-26.zip'),extracted]);reference=extracted;
 }
 const site=await server();const ref=await server(path.resolve(reference));const b=await browser();const metrics=[];
 try{
  for(const width of [1440,768,390]){
   const height=width===390?844:1000;const pairs={};
   for(const [kind,url] of [['reference',ref.url+'/index.dc.html'],['implementation',site.url]]){
    const p=await b.newPage({viewport:{width,height},deviceScaleFactor:1});await maskMap(p);
    await p.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:fs.readFileSync(path.join(root,'assets/fonts/fonts.css'),'utf8').replace(/url\(([^)]+)\)/g, (_,file)=>'url('+site.url+'/assets/fonts/'+file+')')}));
    await p.goto(url,{waitUntil:'domcontentloaded'});await p.waitForSelector('#site-header');await stable(p);
    const dir=path.join(out,String(width));fs.mkdirSync(dir,{recursive:true});
    await p.screenshot({path:path.join(dir,kind+'-hero-cookie.png')});
    await p.getByRole('button',{name:'Отклонить',exact:true}).click();
    await p.screenshot({path:path.join(dir,kind+'-full.png'),fullPage:true});
    const boxes={};
    for(const id of sections){
     const locator=p.locator('#'+id);await p.evaluate(id=>window.scrollTo(0,document.getElementById(id).getBoundingClientRect().top+scrollY),id);
     // Header/parallax and remote tiles cannot obscure the component comparison.
     await p.addStyleTag({content:'#site-header,button[aria-label="Наверх"]{visibility:hidden!important}'});
     await locator.screenshot({path:path.join(dir,kind+'-'+id+'.png')});
     boxes[id]=await locator.evaluate(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}));
    }
    pairs[kind]=boxes;
    // Important state evidence for tabs and mobile navigation.
    for(const [name,index] of [['yard',1],['service',2]]){
     if(kind==='reference')await p.locator('#about').getByText(name==='yard'?'Двор и территория':'Сервис в доме',{exact:true}).click();
     else await p.locator('[data-about-tab="'+name+'"]').click();
     await p.locator('#about').screenshot({path:path.join(dir,kind+'-about-'+name+'.png')});
    }
    for(const suffix of ['hero-cookie','full']){const png=path.join(dir,kind+'-'+suffix+'.png');await sharp(png).webp({lossless:true,effort:5}).toFile(path.join(dir,kind+'-'+suffix+'.webp'));}
    await p.close();
   }
   for(const id of sections){
    const dir=path.join(out,String(width));const a=path.join(dir,'reference-'+id+'.png'),c=path.join(dir,'implementation-'+id+'.png');
    const am=await sharp(a).metadata(),cm=await sharp(c).metadata();
    // Put each pair in the same image for human comparison; maintain native pixels.
    const joined=path.join(dir,'compare-'+id+'.jpg');
    await sharp({create:{width:am.width+cm.width,height:Math.max(am.height,cm.height),channels:3,background:'#ddd'}}).composite([{input:a,left:0,top:0},{input:c,left:am.width,top:0}]).jpeg({quality:85}).toFile(joined);
    let mae=null;
    if(am.width===cm.width){const sharedHeight=Math.min(am.height,cm.height);const ar=await sharp(a).extract({left:0,top:0,width:am.width,height:sharedHeight}).removeAlpha().raw().toBuffer(),cr=await sharp(c).extract({left:0,top:0,width:cm.width,height:sharedHeight}).removeAlpha().raw().toBuffer();let sum=0;for(let i=0;i<ar.length;i++)sum+=Math.abs(ar[i]-cr[i]);mae=+(sum/ar.length).toFixed(3);}
    metrics.push({viewport:{width,height,dpr:1},section:id,pixelDimensions:{reference:{width:am.width,height:am.height},implementation:{width:cm.width,height:cm.height}},reference:pairs.reference[id],implementation:pairs.implementation[id],meanAbsoluteChannelError:mae,comparison:path.relative(root,joined)});
   }
   const dir=path.join(out,String(width));
   for(const state of ['yard','service']){const a=path.join(dir,'reference-about-'+state+'.png'),c=path.join(dir,'implementation-about-'+state+'.png');const am=await sharp(a).metadata(),cm=await sharp(c).metadata();await sharp({create:{width:am.width+cm.width,height:Math.max(am.height,cm.height),channels:3,background:'#ddd'}}).composite([{input:a,left:0,top:0},{input:c,left:am.width,top:0}]).jpeg({quality:85}).toFile(path.join(dir,'compare-about-'+state+'.jpg'));}
   const fullA=path.join(dir,'reference-full.webp'),fullB=path.join(dir,'implementation-full.webp');
   const fullAM=await sharp(fullA).metadata(),fullBM=await sharp(fullB).metadata();
   await sharp({create:{width:fullAM.width+fullBM.width,height:Math.max(fullAM.height,fullBM.height),channels:3,background:'#ddd'}}).composite([{input:fullA,left:0,top:0},{input:fullB,left:fullAM.width,top:0}]).jpeg({quality:82}).toFile(path.join(dir,'compare-full.jpg'));
   // Lossless full captures plus paired section crops retain the evidence without redundant PNG copies.
   for(const file of fs.readdirSync(dir))if(file.endsWith('.png'))fs.unlinkSync(path.join(dir,file));
   console.log('CAPTURED '+width+'px: full page, cookie, 9 sections, 2 tab states, combined comparisons');
  }
  fs.writeFileSync(path.join(out,'visual-metrics.json'),JSON.stringify(metrics,null,2)+'\n');
 }finally{await b.close();await site.close();await ref.close();if(extracted)fs.rmSync(extracted,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
