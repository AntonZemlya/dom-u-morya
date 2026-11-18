import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import M from '../content-model.js';
import {browserLots, catalogMarkup, calculatorDefaults} from './catalog-presentation.mjs';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const read=n=>JSON.parse(fs.readFileSync(path.join(root,'data',n+'.json'),'utf8'));
const apartments=read('apartments'),media=read('media'),groups=read('plan-groups');
// Provenance stays in data/*.json; the browser only receives local asset paths.
const publicApartments = browserLots(apartments);
const publicPhoto = ({id, title, src, width, height, srcset, variants}) => ({
  id, title, src, width, height, srcset, variants,
});
const publicMedia = {
  gallery: media.gallery.map(publicPhoto),
  construction: media.construction.map(({month, title, images}) => ({
    month, title, images: images.map(publicPhoto),
  })),
};
const snapshotDate = apartments.map(lot => lot.snapshot_date).sort().at(-1);

let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const original=html;
const fonts=fs.readFileSync(path.join(root,'assets/fonts/fonts.css'),'utf8').replace(/url\(([^)]*)\)/g,(_,url)=>'url('+path.posix.normalize('assets/fonts/'+url)+')');
const fontRegion=/<!-- PERFORMANCE:fonts:start -->[\s\S]*?<!-- PERFORMANCE:fonts:end -->/;
const withFonts=page=>page.replace(fontRegion,'<!-- PERFORMANCE:fonts:start -->\n<style id="local-fonts">\n'+fonts+'</style>\n<!-- PERFORMANCE:fonts:end -->');
html=withFonts(html);
// One authored footer; checked-in HTML stays fully usable without JavaScript.
const footer=fs.readFileSync(path.join(root,'templates/footer.html'),'utf8').trimEnd();
const withFooter=(page,name)=>{
 const region=/<!-- CONTENT:footer:start -->[\s\S]*?<!-- CONTENT:footer:end -->/;
 if(!region.test(page))throw Error('Missing shared footer region: '+name);
 return page.replace(region,`<!-- CONTENT:footer:start -->\n${footer}\n<!-- CONTENT:footer:end -->`);
};
html=withFooter(html,'index.html');
const documents=['privacy.html','consent-personal-data.html','consent-analytics.html'].map(name=>{
 const original=fs.readFileSync(path.join(root,name),'utf8');return {name,original,html:withFonts(withFooter(original,name))};
});
const region=(name,text)=>{const re=new RegExp(`<!-- CONTENT:${name}:start -->[\\s\\S]*?<!-- CONTENT:${name}:end -->`);if(!re.test(html))throw Error('Missing region '+name);html=html.replace(re,`<!-- CONTENT:${name}:start -->\n${text}\n<!-- CONTENT:${name}:end -->`);};
region('catalog',catalogMarkup(apartments,groups.length));
// Three editorial frames; all eight originals remain in native HTML for no-JS.
const featured=[0,1,5],remaining=media.gallery.map((m,i)=>({m,i})).filter(({i})=>!featured.includes(i));
region('gallery',`<div id="gallery-grid" class="gallery-grid gallery-style-2">${featured.map(i=>M.photo(media.gallery[i],i,'gallery')).join('')}<details class="gallery-more"><summary>Ещё ${remaining.length} визуализаций</summary><div class="gallery-overflow">${remaining.map(({m,i})=>M.photo(m,i,'gallery')).join('')}</div></details></div><div class="gallery-bottom"><span>Визуализация · 8 ракурсов</span><button type="button" id="gallery-view-all" class="editorial-button enhanced-only">Смотреть все фото <span aria-hidden="true">↗</span></button></div>`);
region('construction',`<div class="month-tabs enhanced-only" id="construction-tabs" aria-label="Месяц фотоальбома"></div><div id="construction-albums">${media.construction.map((m,i)=>`<details class="construction-album" data-album="${m.month}"${i===0?' open':''}><summary>${m.title}</summary><div class="construction-grid">${m.images.map((photo,j)=>M.photo(photo,j,'construction',m.month)).join('')}</div><button type="button" class="editorial-button album-view-all enhanced-only" data-action="open-construction-image" data-index="0" data-month="${m.month}">Все фото альбома · ${m.images.length} <span aria-hidden="true">↗</span></button></details>`).join('')}</div>`);
region('payload',`<script id="site-data" type="application/json">${JSON.stringify({snapshot_date:snapshotDate,apartments:publicApartments,media:publicMedia}).replace(/</g,'\\u003c')}</script>`);
const calculator = calculatorDefaults(apartments);
for (const [id, value] of Object.entries(calculator.labels)) {
 html = html.replace(new RegExp(`(<(?:span|div) id="${id}"[^>]*>)[\\s\\S]*?(</(?:span|div)>)`), (_, a, b) => a + value + b);
}
for (const [id, input] of Object.entries(calculator.inputs)) {
 html = html.replace(new RegExp(`<input type="range"[^>]*id="${id}"[^>]*>`), () => input);
}
// News dates and source URLs remain in data/news.json; no duplicate news feed.
// Keep the approved REC-002 architectural composition; never replace it with catalog media.
html=html.replace(/(<div class="loc-zoom about-style-4"[^>]*?) style="[^"]*"/,'$1');
const paths=[...new Set([...apartments.flatMap(a=>a.plans.map(p=>p.local_path)),...media.gallery.flatMap(m=>m.variants.map(v=>v.src)),...media.construction.flatMap(m=>m.images.flatMap(i=>i.variants.map(v=>v.src)))])].sort();
const manifest='// Generated from canonical data, never from a recursive directory glob.\nexport const CONTENT_FILES = Object.freeze('+JSON.stringify(paths,null,2)+');\n';
if(process.argv.includes('--check')){
 if(html!==original||documents.some(d=>d.html!==d.original)||manifest!==fs.readFileSync(path.join(root,'scripts/content-files.mjs'),'utf8'))throw Error('Generated content/footer is stale: npm run content');
 console.log('PASS generated HTML, shared footer on four pages, embedded data, calculator baseline and media allowlist');
}else{fs.writeFileSync(path.join(root,'index.html'),html);for(const d of documents)fs.writeFileSync(path.join(root,d.name),d.html);fs.writeFileSync(path.join(root,'scripts/content-files.mjs'),manifest);console.log('Generated canonical content and shared footer on four pages');}
