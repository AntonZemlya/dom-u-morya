// Originals remain immutable. Deduplicate by canonical SHA path, preserve aspect ratio/alpha.
const fs=require('fs'),path=require('path'),sharp=require('sharp');
const root=path.resolve(__dirname,'..');
(async()=>{const a=require('../data/apartments.json'),paths=[...new Set(a.flatMap(a=>a.plans.map(p=>p.local_path)))].sort();let before=0,after=0;
for(const src of paths){const output=src.replace(/\.svg$/,'.preview.webp'),input=path.join(root,src);await sharp(input,{density:288,limitInputPixels:100000000}).resize(960,960,{fit:'inside'}).webp({lossless:true,effort:6}).toFile(path.join(root,output));const old=fs.statSync(input).size,next=fs.statSync(path.join(root,output)).size;if(next>=old)throw Error('Preview is not lighter: '+src);before+=old;after+=next;}
fs.writeFileSync(path.join(root,'scripts/preview-files.mjs'),'// Generated from unique canonical plan paths.\nexport const PREVIEW_FILES=Object.freeze('+JSON.stringify(paths.map(p=>p.replace(/\.svg$/,'.preview.webp')),null,2)+');\n');console.log({originals:paths.length,before,after});
})().catch(e=>{console.error(e);process.exitCode=1});
