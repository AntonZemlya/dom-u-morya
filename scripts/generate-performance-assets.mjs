// Maintenance-only: regenerate when the approved source images/fonts change.
// npm run build uses the reviewed manifest and never silently rewrites assets.
import sharp from 'sharp';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const directory=new URL('../assets/performance/',import.meta.url);
const manifestURL=new URL('../data/performance-assets.json',import.meta.url);
await fs.mkdir(directory,{recursive:true});
let previous={};try{previous=JSON.parse(await fs.readFile(manifestURL,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
const manifest={};
async function save(name,buffer,width){
 const ext=width?'webp':'woff2';
 const file=`${name}${width?'-'+width:''}-${createHash('sha256').update(buffer).digest('hex').slice(0,16)}.${ext}`;
 await fs.writeFile(new URL(file,directory),buffer);
 return {src:'assets/performance/'+file,...width?{width}:{},bytes:buffer.length};
}
async function image(name,source,width,extract){
 let pipeline=sharp(new URL('../assets/'+source,import.meta.url).pathname);
 if(extract)pipeline=pipeline.extract(extract);
 const buffer=await pipeline.resize({width,withoutEnlargement:true}).webp({quality:90,effort:6}).toBuffer();
 (manifest[name]??=[]).push(await save(name,buffer,width));
}
for(const width of [208,416])await image('logo','logo-cropped.webp',width);
for(const width of [480,768,1024])await image('location','location.webp',width);
await image('architecture','architecture.webp',768);
// Preserve the full source height: the original centre crop stays identical up to 450px.
for(const width of [432,864])await image('architecture-mobile','architecture.webp',width,{left:336,top:0,width:864,height:1024});
manifest.fonts=[];
for(let i=1;i<=9;i++)manifest.fonts.push(await save(`font-${i}`,await fs.readFile(new URL(`../assets/fonts/font-${i}.woff2`,import.meta.url))));
let fonts=await fs.readFile(new URL('../assets/fonts/fonts.css',import.meta.url),'utf8');
fonts=fonts.replace(/url\((?:font-(\d).woff2|\.\.\/performance\/font-(\d)-[a-f0-9]{16}.woff2)\)/g,(_,a,b)=>'url(../performance/'+manifest.fonts[Number(a||b)-1].src.split('/').at(-1)+')');
await fs.writeFile(new URL('../assets/fonts/fonts.css',import.meta.url),fonts);
// Keep previously released content URLs for open tabs and rollback. Pruning is a separate decision.
const current=new Set(Object.values(manifest).flat().map(a=>a.src));
manifest.retained=Object.values(previous).flat().filter(a=>!current.has(a.src));
await fs.writeFile(manifestURL,JSON.stringify(manifest,null,2)+'\n');
console.log('Generated',current.size,'assets; retained',manifest.retained.length,'previous content URLs. Update HTML srcset references explicitly, then npm run content.');
