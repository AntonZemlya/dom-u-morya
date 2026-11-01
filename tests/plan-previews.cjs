const {previewURL}=require('./helpers.cjs');
// Independent Chromium rendering of every original and derivative at card size, including DPR 2.
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),sharp=require('sharp');
const {browser}=require('./helpers.cjs');
const originals=require('./seo-originals.json');
const out=process.env.QA_OUTPUT_DIR||path.join(os.tmpdir(),'seo-001-qa','plans');fs.mkdirSync(out,{recursive:true});
(async()=>{const b=await browser(),results=[];try{
for(const [width,dpr] of [[1440,1],[390,2]]){const c=await b.newContext({viewport:{width,height:900},deviceScaleFactor:dpr}),p=await c.newPage();let index=0;
 for(const src of Object.keys(originals)){const preview=src.replace(/\.svg$/,'.preview.webp');await p.setContent(`<style>body{margin:0;background:white}img{display:block;width:300px;height:220px;object-fit:contain}</style><img id="original" src="${previewURL}/${src}"><img id="preview" src="${previewURL}/${preview}">`);await p.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));
 const a=await p.locator('#original').screenshot(),z=await p.locator('#preview').screenshot();const ar=await sharp(a).removeAlpha().raw().toBuffer(),zr=await sharp(z).removeAlpha().raw().toBuffer();let sum=0,changed=0;for(let i=0;i<ar.length;i++){const d=Math.abs(ar[i]-zr[i]);sum+=d;if(d>24)changed++}const mae=sum/ar.length;results.push({src,width,dpr,mae,changedFraction:changed/ar.length});assert.ok(mae<5,'Rasterization MAE >5: '+src);
 if(dpr===2){await sharp({create:{width:1200,height:440,channels:3,background:'white'}}).composite([{input:a,left:0,top:0},{input:z,left:600,top:0}]).png().toFile(path.join(out,`${String(index).padStart(2,'0')}-comparison.png`));}index++;
 }await c.close();}
 fs.writeFileSync(path.join(out,'render-diff.json'),JSON.stringify(results,null,2));console.log('PASS 57 SVG/preview pairs × 1440 DPR1 and 390 DPR2; max pixel MAE',Math.max(...results.map(x=>x.mae)).toFixed(3));
}finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
