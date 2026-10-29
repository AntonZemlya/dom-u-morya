// Deterministic derivative from local approved hero/logo; no new photo source.
const sharp=require('sharp'),path=require('path');
const root=path.resolve(__dirname,'..');
(async()=>{
 const logo=await sharp(path.join(root,'assets/logo-cropped.webp')).resize({width:360}).png().toBuffer();
 const shade=Buffer.from('<svg width="1200" height="630"><defs><linearGradient id="g"><stop stop-color="#142429" stop-opacity=".8"/><stop offset="1" stop-color="#142429" stop-opacity=".08"/></linearGradient></defs><rect width="1200" height="630" fill="url(#g)"/></svg>');
 await sharp(path.join(root,'assets/hero-desktop.webp')).resize(1200,630,{fit:'cover',position:'centre'}).composite([{input:shade},{input:logo,left:60,top:50}]).jpeg({quality:90,mozjpeg:true}).toFile(path.join(root,'assets/og-project.jpg'));
 console.log('Generated OG JPEG 1200×630 from unchanged hero and logo');
})().catch(e=>{console.error(e);process.exitCode=1});
