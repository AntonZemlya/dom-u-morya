/* Shared by static generation and browser rendering. Data lives in data/apartments.json. */
(function(root){
  'use strict';
  const labels=['Студия','1 спальня','2 спальни','3 спальни'];
  const keys=['studio','1k','2k','3k'];
  const views={furnished:'С мебелью',unfurnished:'Без мебели',floor:'На этаже'};
  const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rub=n=>Math.round(n).toLocaleString('ru-RU')+' ₽';
  const number=n=>n.toLocaleString('ru-RU');
  function plans(data){return data.map(a=>({...a,category:keys[a.bedrooms],title:labels[a.bedrooms]+' № '+a.number,price:a.price_rub,meta:`${number(a.area_m2)} м² · ${a.floor} этаж из ${a.floors_total} · корпус ${a.building}, секция ${a.section} · ID ${a.id}`}));}
  function categories(list){return keys.map((key,i)=>{const lots=list.filter(a=>a.category===key),areas=lots.map(a=>a.area_m2),min=Math.min(...areas),max=Math.max(...areas);return {key,title:i?labels[i]:'Студии',count:lots.length,price:'от '+rub(Math.min(...lots.map(a=>a.price))),area:(min===max?number(min):number(min)+'–'+number(max))+' м² · чистовая отделка'};});}
  function card(p,view='furnished'){
    const asset=p.plans.find(x=>x.type===view);
    return `<article class="card card-hover" data-lot-id="${p.id}" data-layout="${p.plan_group_id}">
      <div class="card-heading"><div class="plan-title">${esc(p.title)}</div><span class="card-edition">Корпус ${esc(p.building)}</span></div>
      <a class="plan-thumb" href="${esc(asset.local_path)}" data-action="open-plan-image" data-id="${p.id}" aria-label="Открыть схему: ${esc(p.title)}"><img src="${esc(asset.local_path)}" width="400" height="300" loading="lazy" decoding="async" alt="${esc(p.title)} — ${views[view]}"><span class="plan-thumb-label">Рассмотреть планировку</span></a>
      <div class="plan-variants" aria-label="Вид схемы квартиры № ${p.number}">${Object.entries(views).map(([key,label])=>`<a href="${esc(p.plans.find(v=>v.type===key).local_path)}" data-plan-view="${key}" data-id="${p.id}" role="button" aria-pressed="${view===key}">${label}</a>`).join('')}</div>
      <div class="card-facts"><div class="plan-meta"><strong>${number(p.area_m2)} <small>м²</small></strong><span>${p.floor} этаж из ${p.floors_total}</span></div><div class="plan-price">${rub(p.price)}</div></div>
      <details class="lot-details"><summary>О квартире</summary><p>Корпус ${esc(p.building)}, секция ${esc(p.section)} · ID ${p.id}</p><p>${p.features.map(esc).join(' · ')}</p><p>${rub(p.price_per_m2_rub)} / м²</p><a href="${esc(p.source_url)}" target="_blank" rel="noopener">Карточка застройщика ↗</a></details>
      <div class="plan-links"><a href="#contact" data-action="ask-plan" data-id="${p.id}">Уточнить наличие</a><a href="#calculator" class="plan-link-calc link-hover-gold" data-action="calc-here" data-id="${p.id}">Рассчитать ипотеку</a></div></article>`;
  }
  function category(c){return `<article class="category-card card-hover"><div class="category-title">${c.title}</div><div class="category-note">${c.count} опубликованных предложений · корпус 1</div><div class="category-price">${c.price}</div><div class="category-area">${c.area}</div><div class="category-actions"><a href="#plans" data-category="${c.key}" data-category-action="lots">Смотреть квартиры →</a><a href="#contact" data-category="${c.key}" data-category-action="ask">Запросить подборку →</a></div></article>`;}
  function photo(m,index,mode,month=''){return `<a class="gallery-item" href="${esc(m.src)}" data-action="open-${mode}-image" data-index="${index}"${month?` data-month="${month}"`:''} aria-label="Открыть: ${esc(m.title)}"><img src="${esc(m.src)}" srcset="${esc(m.srcset)}" sizes="${mode==='construction'&&index===0?'(max-width:600px) 90vw, 1000px':'(max-width:600px) 90vw, (max-width:1000px) 45vw, 620px'}" width="${m.width}" height="${m.height}" loading="lazy" decoding="async" alt="${esc(m.title)}"><span class="gallery-item-label">${esc(m.title)}</span></a>`;}
  const api={labels,keys,views,esc,rub,plans,categories,card,category,photo};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ContentModel=api;
})(typeof window==='undefined'?globalThis:window);
