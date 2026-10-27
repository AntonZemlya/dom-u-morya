import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import M from '../content-model.js';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const read=n=>JSON.parse(fs.readFileSync(path.join(root,'data',n+'.json'),'utf8'));
const apartments=read('apartments'),media=read('media'),groups=read('plan-groups');
const list=M.plans(apartments),categories=M.categories(list),min=Math.min(...list.map(a=>a.price));
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const original=html;
const region=(name,text)=>{const re=new RegExp(`<!-- CONTENT:${name}:start -->[\\s\\S]*?<!-- CONTENT:${name}:end -->`);if(!re.test(html))throw Error('Missing region '+name);html=html.replace(re,`<!-- CONTENT:${name}:start -->\n${text}\n<!-- CONTENT:${name}:end -->`);};
region('catalog',`<h2 id="plans-heading" class="plans-style-5">Квартира под ваш ритм</h2>
<p class="plans-style-6">${list.length} опубликованных предложений · ${groups.length} планировок · корпус 1. Чистовая отделка в каждой квартире.</p>
<p class="content-note">Данные проверены 27.10.2026; цену и наличие уточнит агентство. Мебель на схемах — пример расстановки.</p>
<div class="plans-style-7 enhanced-only"><div id="plan-tabs" class="plans-style-8"></div><div id="plan-views" class="plans-style-9"><button type="button" class="view-chip" data-view="cats" aria-pressed="false">Категории</button><button type="button" class="view-chip active" data-view="lots" aria-pressed="true">Квартиры</button></div></div>
<div id="catalog-controls" class="catalog-controls enhanced-only">
<label>Бюджет<select id="budget-filter"><option value="">Любой</option><option value="8000000">До 8 млн ₽</option><option value="10000000">До 10 млн ₽</option><option value="12000000">До 12 млн ₽</option><option value="16000000">До 16 млн ₽</option></select></label>
<label>Этаж<select id="floor-filter"><option value="">Любой</option>${[...new Set(list.map(p=>p.floor))].sort((a,b)=>a-b).map(f=>`<option value="${f}">${f} этаж</option>`).join('')}</select></label>
<label>Планировка<select id="layout-filter"><option value="">Все планировки</option></select></label>
<label>Порядок<select id="sort-filter"><option value="price">Сначала дешевле</option><option value="area">По площади</option><option value="floor">По этажу</option></select></label>
<label class="sea-filter"><input type="checkbox" id="sea-filter">Вид на море по карточке</label><button type="button" id="reset-filters" class="view-chip">Сбросить</button>
</div>
<p id="catalog-result" class="content-note enhanced-only" role="status" aria-live="polite"></p>
<div id="plans-grid" class="plans-grid plans-style-10">${categories.map((c,i)=>`<details class="static-category"${i===0?' open':''}><summary>${c.title} · ${c.count} предложений · ${c.price}</summary><div class="plans-grid">${list.filter(p=>p.category===c.key).map(p=>M.card(p)).join('')}</div></details>`).join('')}</div>
<button type="button" id="show-more-plans" class="view-chip enhanced-only" hidden>Показать ещё</button>
<div id="category-grid" class="plans-grid" hidden>${categories.map(M.category).join('')}</div>`);
region('gallery',`<div id="gallery-grid" class="gallery-grid gallery-style-2">${media.gallery.map((m,i)=>M.photo(m,i,'gallery')).join('')}</div>`);
region('construction',`<p class="content-note">Фотоальбомы: апрель–сентябрь 2026. Месяц относится к альбому застройщика; точные даты съёмки неизвестны.</p><div class="month-tabs enhanced-only" id="construction-tabs" aria-label="Месяц фотоальбома"></div><div id="construction-albums">${media.construction.map((m,i)=>`<details class="construction-album" data-album="${m.month}"${i===0?' open':''}><summary>${m.title} · ${m.images.length} фото</summary><p class="content-note"><a href="${M.esc(m.source_url)}" target="_blank" rel="noopener">Фотоальбом застройщика ↗</a></p><div class="construction-grid">${m.images.map((photo,j)=>M.photo(photo,j,'construction',m.month)).join('')}</div></details>`).join('')}</div>`);
region('payload',`<script id="site-data" type="application/json">${JSON.stringify({snapshot_date:'2026-10-27',apartments,media}).replace(/</g,'\\u003c')}</script>`);
// All initial calculator amounts use the same canonical minimum; no selected lot until chosen.
const down=min*.1,loan=min-down,rate=.02/12,payment=loan*rate/(1-(1+rate)**-360);
for(const [id,value] of Object.entries({'price-label':M.rub(min),'down-label':'10% · '+M.rub(down),'loan-label':M.rub(loan),'payment-label':M.rub(payment)+' / мес','income-label':M.rub(payment/.4)+' / мес'})){
 html=html.replace(new RegExp(`(<(?:span|div) id="${id}"[^>]*>)[\\s\\S]*?(</(?:span|div)>)`),(_,a,b)=>a+value+b);
}
html=html.replace(/<input type="range"[^>]*id="price-range"[^>]*>/,`<input type="range" min="${min}" max="20000000" step="1" value="${min}" id="price-range" aria-label="Стоимость квартиры" class="pricing-style-16">`);
const news=read('news');html=html.replace(/(<article><time datetime="(2026-(?:05-25|07-31|10-16))">[\s\S]*?)(<\/article>)/g,(all,start,date,end)=>start.replace(/<a [\s\S]*?<\/a>$/,'')+`<a href="${news.find(n=>n.date===date).source_url}" target="_blank" rel="noopener">Источник ↗</a>`+end);
// Use a real future-complex rendering below hero only.
html=html.replace(/(<div class="loc-zoom about-style-4"[^>]*)(>)/,(_,a,b)=>a.replace(/ style="[^"]*"/,'')+` style="background-image:url('${media.gallery[0].src}')"`+b);
const paths=[...new Set([...apartments.flatMap(a=>a.plans.map(p=>p.local_path)),...media.gallery.flatMap(m=>m.variants.map(v=>v.src)),...media.construction.flatMap(m=>m.images.flatMap(i=>i.variants.map(v=>v.src)))])].sort();
const manifest='// Generated from canonical data, never from a recursive directory glob.\nexport const CONTENT_FILES = Object.freeze('+JSON.stringify(paths,null,2)+');\n';
if(process.argv.includes('--check')){
 if(html!==original||manifest!==fs.readFileSync(path.join(root,'scripts/content-files.mjs'),'utf8'))throw Error('Generated content is stale: npm run content');
 console.log('PASS generated HTML, embedded data, calculator baseline and media allowlist');
}else{fs.writeFileSync(path.join(root,'index.html'),html);fs.writeFileSync(path.join(root,'scripts/content-files.mjs'),manifest);console.log('Generated 28 lots, categories, media and payload from canonical data');}
