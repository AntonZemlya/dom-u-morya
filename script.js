"use strict";

/* ---------- static data ---------- */
const SITE_DATA = JSON.parse(document.getElementById('site-data').textContent);
const PLANS = ContentModel.plans(SITE_DATA.apartments);
const CATEGORIES = ContentModel.categories(PLANS);
const TABS = CATEGORIES.map(c=>({key:c.key,label:c.title+' · '+c.count}));
const ICONS = {
  calc: 'M7.5 3h9a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1M9.5 7.5h5M9.5 12h1.5M9.5 16h1.5M14 12v4.5',
  plan: 'M4 4h16v16H4zM4 14h8M12 4v16',
  installment: 'M4 6.5h16v13.5H4zM4 10.5h16M8.5 3.5v4M15.5 3.5v4',
  full: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M8.5 12l2.5 2.5 4.5-5',
};
const ABOUT_THEMES = [
  {key:'arch',label:'Архитектура и виды',photo:true,media:'визуализация фасада',
   title:'Дом-маяк на первой береговой линии',
   lead:'18 этажей над водой: чем выше квартира, тем шире панорама Азовского моря и городской набережной.',
   items:[
     {t:'Морские пейзажи за окном',d:'Первая береговая линия — вид на воду и набережную.'},
     {t:'18 этажей, один корпус',d:'258 квартир в проекте, от студий до квартир с тремя спальнями.'},
     {t:'Отделка «под ключ»',d:'Все квартиры сдаются с чистовой отделкой.'},
     {t:'Рядом с побережьем',d:'Комплекс рядом с побережьем; время маршрута не измерялось.'},
   ]},
  {key:'yard',label:'Двор и территория',photo:false,media:'проект благоустройства',
   title:'Закрытая озеленённая территория',
   lead:'Двор для жителей: игровые комплексы, спорт и зоны отдыха, машины — по периметру.',
   items:[
     {t:'Закрытый двор',d:'В материалах застройщика предусмотрены озеленение и видеонаблюдение.'},
     {t:'Детские площадки',d:'Игровые комплексы и зона отдыха с каучуковым покрытием.'},
     {t:'Спортивная площадка',d:'Комплекс уличных тренажёров на территории.'},
     {t:'Паркинг',d:'В материалах проекта предусмотрены парковочные места.'},
   ]},
  {key:'service',label:'Сервис в доме',photo:false,media:'визуализация входной группы',
   title:'Всё необходимое — не выходя за периметр',
   lead:'В проекте предусмотрены коммерческие помещения, входные группы и помещения для хранения.',
   items:[
     {t:'Коммерческая галерея',d:'Предусмотрены 15 коммерческих помещений площадью 26–65 м².'},
     {t:'Консьерж и охрана',d:'По презентации планируются ресепшен и видеонаблюдение.'},
     {t:'Колясочная и велосипедная',d:'Отдельные помещения, безбарьерная среда и пандусы.'},
     {t:'Кладовые',d:'По презентации: 73 кладовые площадью 2,8–7 м².'},
   ]},
];
const CAT_LABEL = {studio:'Студия','1k':'1 спальня','2k':'2 спальни','3k':'3 спальни'};
const GALLERY = SITE_DATA.media.gallery;
const FIELD_LABELS = {
  plan: ['Интересующая планировка', 'интересующую планировку'],
  email: ['E-mail', 'e-mail для подборки'],
  channel: ['Как удобнее связаться', 'способ связи'],
  time: ['Удобное время звонка', 'удобное время звонка'],
};
const FIELD_RESETS = { plan: { planChoice: '' }, email: { email: '' }, channel: { channel: 'Звонок' }, time: { callTime: '' } };
const CHANNELS = ['Звонок', 'MAX', 'Telegram'];
const CALL_TIMES = [['', 'Любое время'], ['9-12', '9:00–12:00'], ['12-15', '12:00–15:00'], ['15-18', '15:00–18:00']];
const FIELD_ORDER = ['plan', 'email', 'channel', 'time'];

function rub(n){ return Math.round(n).toLocaleString('ru-RU') + ' ₽'; }

function formatRuPhone(raw){
  let d = raw.replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('8')) d = '7' + d.slice(1);
  if (!d.startsWith('7')) d = '7' + d;
  d = d.slice(0, 11);
  const rest = d.slice(1);
  let out = '+7';
  if (rest.length) out += ' (' + rest.slice(0, 3);
  if (rest.length >= 3) out += ')';
  if (rest.length > 3) out += ' ' + rest.slice(3, 6);
  if (rest.length > 6) out += '-' + rest.slice(6, 8);
  if (rest.length > 8) out += '-' + rest.slice(8, 10);
  return out;
}

/* ---------- PDF export (mortgage calc sheet) ---------- */
function calcDocHtml(d, logo){
  const row = (k, v) => `<tr><td class="k">${k}</td><td class="v">${v}</td></tr>`;
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>Расчёт ипотеки — ЖК «Дом у моря»</title>
<link rel="stylesheet" href="${new URL('assets/fonts/fonts.css', document.baseURI).href}">
<style>
@page{size:A4;margin:0}
*{box-sizing:border-box}
body{margin:0;background:#F8F6F2;font-family:Sora,sans-serif;color:#25282D;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{width:210mm;min-height:297mm;margin:0 auto;background:#FBFAF7;padding:22mm 20mm 18mm;display:flex;flex-direction:column}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;padding-bottom:14px;border-bottom:1px solid rgba(37,40,45,.14)}
.top img{height:46px;width:auto;display:block}
.date{font:400 11px Sora;color:#5A6068;text-align:right;line-height:1.6}
h1{font:500 30px/1.2 Newsreader,serif;margin:26px 0 6px}
.sub{font:400 12.5px/1.6 Sora;color:#5A6068;margin:0 0 26px;max-width:60ch}
.kick{font:500 10px Sora;letter-spacing:.09em;text-transform:uppercase;color:#C8A96A;margin-bottom:9px}
.obj{background:#F2EEE7;border-radius:14px;padding:20px 22px;margin-bottom:26px}
.obj .t{font:500 17px Sora;margin-bottom:5px}
.obj .m{font:400 12.5px Sora;color:#5A6068}
table{width:100%;border-collapse:collapse}
td{padding:12px 0;border-bottom:1px solid rgba(37,40,45,.10);vertical-align:baseline}
.k{font:400 12.5px Sora;color:#5A6068}
.v{font:500 13.5px Sora;text-align:right}
.hl{background:#F2EEE7;border-radius:14px;padding:18px 22px;margin-top:24px;display:flex;justify-content:space-between;align-items:baseline;gap:16px}
.hl .l{font:400 12.5px Sora;color:#5A6068}
.hl .r{font:400 26px Newsreader,serif}
.foot{margin-top:auto;padding-top:22px;border-top:1px solid rgba(37,40,45,.14);display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap}
.foot div{font:400 11.5px/1.8 Sora;color:#5A6068}
.foot b{display:block;font:500 12.5px Sora;color:#25282D;margin-bottom:4px}
.note{font:400 10.5px/1.6 Sora;color:#5A6068;margin-top:14px}
@media print{body{background:#FBFAF7}.sheet{margin:0}}
</style></head><body><div class="sheet">
<div class="top"><img src="${logo}" alt="Дом у моря"><div class="date">Расчёт от ${d.date}<br>Ориентировочный</div></div>
<h1>Расчёт ипотеки</h1>
<p class="sub">Расчёт по ЖК «Дом у моря», г. Мариуполь, пр. Адмирала Лунина, 25. Единая выбранная ставка применяется ко всей сумме. Льготный лимит и условия банка требуют отдельной проверки; комбинированная ипотека не моделируется.</p>
<div class="kick">${d.custom ? 'Произвольный расчёт' : 'Выбранная планировка'}</div>
<div class="obj"><div class="t">${d.objectTitle}</div><div class="m">${d.objectMeta}</div>${d.sourceUrl?`<div class="m" style="margin-top:8px;overflow-wrap:anywhere;font-size:10px">Источник: ${d.sourceUrl.replaceAll("&","&amp;")}<br>Цену и наличие уточнит агентство.</div>`:""}</div>
<div class="kick">Параметры</div>
<table>
${row('Стоимость квартиры', d.price)}
${row('Первоначальный взнос', d.down)}
${row('Сумма кредита', d.loan)}
${row('Срок кредита', d.term)}
${row('Ставка', d.rate)}
${row('Необходимый доход', d.income)}
</table>
<div class="hl"><span class="l">Ежемесячный платёж</span><span class="r">${d.payment}</span></div>
<p class="note">Доход рассчитан из условия, что платёж не превышает 40% ежемесячного дохода — стандартное требование банков при одобрении. Материалы носят информационный характер и не являются офертой.</p>
<div class="foot">
<div><b>Консультации агентства по ЖК «Дом у моря»</b>ИП Саврасова Елена Анатольевна<br>+7 (952) 956-88-75 · info@anyara.ru<br>ИНН 366210396814 · ОГРНИП 318366800035941</div>
<div><b>Застройщик — ГК «Садовое кольцо»</b>Проектная декларация — наш.дом.рф, объект 69398</div>
</div>
</div>
</body></html>`;
}
function loadScriptOnce(src){
  if (!window.__scriptCache) window.__scriptCache = {};
  if (window.__scriptCache[src]) return window.__scriptCache[src];
  window.__scriptCache[src] = new Promise((res, rej) => {
    const el = document.createElement('script');
    el.src = src; el.onload = res; el.onerror = rej;
    document.head.appendChild(el);
  });
  return window.__scriptCache[src];
}
async function makeCalcPdf(html, filename){
  await Promise.all([
    loadScriptOnce('assets/vendor/html2canvas.min.js'),
    loadScriptOnce('assets/vendor/jspdf.umd.min.js'),
  ]);
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0;opacity:0;pointer-events:none';
  document.body.appendChild(frame);
  try {
    await new Promise(res => { frame.onload = res; frame.srcdoc = html; });
    const doc = frame.contentDocument;
    if (doc.fonts && doc.fonts.ready) { try { await doc.fonts.ready; } catch (e) {} }
    await Promise.all(Array.from(doc.images).map(img => img.complete ? Promise.resolve() : new Promise(r => { img.onload = img.onerror = r; })));
    await new Promise(r => setTimeout(r, 120));
    const sheet = doc.querySelector('.sheet');
    const canvas = await window.html2canvas(sheet, { scale: 2, backgroundColor: '#FBFAF7', useCORS: true, windowWidth: 794, width: sheet.offsetWidth, height: sheet.offsetHeight });
    const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const w = pdf.internal.pageSize.getWidth();
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, w, w * canvas.height / canvas.width, undefined, 'FAST');
    const blob = pdf.output('blob');
    const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } finally {
    frame.remove();
  }
}

/* ---------- app state ---------- */
const state = {
  filter: 'studio', budget:0, floor:0, layout:'', sort:'price', sea:false, limit:6, planViews:{}, selectedPlanView:'furnished',
  price: Math.min(...PLANS.map(p=>p.price)), downPct: 10, term: 30, rate: 2,
  plansView: 'lots', aboutTab: 'arch',
  selectedPlanId: null,
  snapshot: null,
  name: '', phone: '', email: '', planChoice: '', consent: false,
  channel: 'Звонок', callTime: '',
  opts: [],
  blurred: {},
  pdfBusy: false,
  cookieChoice: null,
  menuOpen: false,
  scrolled: false,
  headerHidden: false,
};

function planLockedActive(){
  const snap = state.snapshot;
  if (!snap) return false;
  return !!(snap.planTitle || (snap.kind === 'plan' ? snap.objectTitle : ''));
}
function snapPlanTitle(){
  const snap = state.snapshot;
  if (!snap) return '';
  return snap.planTitle || (snap.kind === 'plan' ? snap.objectTitle : '');
}

function scrollToEl(id, gap){
  const el = document.getElementById(id);
  if (!el) return;
  window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - gap, behavior: 'smooth' });
}
function scrollToForm(){
  requestAnimationFrame(() => {
    const el = document.getElementById('request-form') || document.getElementById('contact');
    if (!el) return;
    const gap = window.innerWidth < 700 ? 84 : 108;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - gap, behavior: 'smooth' });
  });
}

/* ================= header / nav / reveal / scroll ================= */
let lastScrollY = window.scrollY;
function onScroll(){
  const y = window.scrollY;
  const hero = document.getElementById('hero-section');
  const crossed = hero ? hero.getBoundingClientRect().bottom <= 0 : y > window.innerHeight;
  const dy = y - lastScrollY;
  state.scrolled = crossed;
  if (y < 80) state.headerHidden = false;
  else if (dy > 4) state.headerHidden = true;
  else if (dy < -4) state.headerHidden = false;
  lastScrollY = y;

  const header = document.getElementById('site-header');
  header.classList.toggle('scrolled', state.scrolled);
  header.classList.toggle('header-hidden', !!state.headerHidden && !header.contains(document.activeElement) && !state.menuOpen);

  const heroPhoto = document.getElementById('hero-photo');
  if (heroPhoto) heroPhoto.style.transform = 'translateY(' + Math.min(6, y * 0.05).toFixed(1) + 'px)';

  const scrollBtn = document.getElementById('scroll-top-btn');
  scrollBtn.classList.toggle('visible', state.scrolled);
  scrollBtn.classList.toggle('no-cookie-banner', !!state.cookieChoice);
}

function applyMenuState(){
  document.getElementById('mobile-menu').classList.toggle('open', state.menuOpen);
  document.getElementById('mobile-menu').inert = !state.menuOpen;
  document.getElementById('mobile-menu').setAttribute('aria-hidden', String(!state.menuOpen));
  const toggle = document.getElementById('nav-toggle');
  toggle.classList.toggle('open', state.menuOpen);
  toggle.setAttribute('aria-expanded', String(state.menuOpen));
}
function wireHeaderEvents(){
  document.getElementById('nav-toggle').addEventListener('click', () => {
    state.menuOpen = !state.menuOpen;
    applyMenuState();
  });
  document.querySelectorAll('.mobile-menu-link').forEach(a => {
    a.addEventListener('click', () => { state.menuOpen = false; applyMenuState(); });
  });
  document.addEventListener('click', e => {
    if (state.menuOpen && !e.target.closest('#site-header')) { state.menuOpen = false; applyMenuState(); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && state.menuOpen) { state.menuOpen = false; applyMenuState(); document.getElementById('nav-toggle').focus(); } });
  window.addEventListener('resize', () => { if (innerWidth > 1140) { state.menuOpen = false; applyMenuState(); } });
  window.addEventListener('scroll', onScroll, { passive: true });
}

function setupRevealObserver(){
  document.documentElement.classList.add('reveal-ready');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0, rootMargin: '0px 0px -10% 0px' });
  const revealAll = () => {
    document.querySelectorAll('[data-reveal-key]').forEach(el => {
      if (el.classList.contains('revealed')) return;
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) el.classList.add('revealed');
      else observer.observe(el);
    });
  };
  revealAll();
  window.addEventListener('hashchange', revealAll);
}

/* ================= cookie banner / scroll-top ================= */
function applyCookieBanner(){
  document.getElementById('cookie-banner').classList.toggle('open', !state.cookieChoice);
  document.getElementById('cookie-banner').hidden = !!state.cookieChoice;
  document.getElementById('scroll-top-btn').classList.toggle('no-cookie-banner', !!state.cookieChoice);
}
function wireCookieBanner(){
  try {
    const saved = localStorage.getItem('domUMorya_cookieChoice');
    if (['accepted', 'declined'].includes(saved)) state.cookieChoice = saved;
  } catch (e) {}
  document.getElementById('cookie-accept').addEventListener('click', () => {
    try { localStorage.setItem('domUMorya_cookieChoice', 'accepted'); } catch (e) {}
    state.cookieChoice = 'accepted'; applyCookieBanner();
  });
  document.getElementById('cookie-decline').addEventListener('click', () => {
    try { localStorage.setItem('domUMorya_cookieChoice', 'declined'); } catch (e) {}
    state.cookieChoice = 'declined'; applyCookieBanner();
  });
}
function wireScrollTopBtn(){
  document.getElementById('scroll-top-btn').addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

/* ================= plans ================= */
function currentFilteredPlans(){
  return PLANS.filter(p=>p.category===state.filter && (!state.budget||p.price<=state.budget) && (!state.floor||p.floor===state.floor) && (!state.layout||p.plan_group_id===state.layout) && (!state.sea||p.features.includes('Вид на море'))).sort((a,b)=>(state.sort==='area'?a.area_m2-b.area_m2:state.sort==='floor'?a.floor-b.floor:a.price-b.price)||a.number-b.number);
}
function renderTabs(){
  const node=document.getElementById('plan-tabs'),hadFocus=node.contains(document.activeElement);
  node.innerHTML=TABS.map(t=>`<button type="button" class="tab-chip${state.filter===t.key?' active':''}" data-tab="${t.key}" aria-pressed="${state.filter===t.key}">${t.label}</button>`).join('');
  if(hadFocus)node.querySelector(`[data-tab="${state.filter}"]`).focus({preventScroll:true});
  const groups=[...new Set(PLANS.filter(p=>p.category===state.filter).map(p=>p.plan_group_id))];
  document.getElementById('layout-filter').innerHTML='<option value="">Все планировки</option>'+groups.map((g,i)=>{const ps=PLANS.filter(p=>p.plan_group_id===g);return `<option value="${g}">Тип ${i+1} · ${ps[0].area_m2.toLocaleString('ru-RU')} м² · ${ps.length} предл.</option>`;}).join('');
  document.getElementById('layout-filter').value=state.layout;
}
function renderPlansGrid(){
  const list=currentFilteredPlans();
  document.getElementById('plans-grid').innerHTML=list.slice(0,state.limit).map(p=>ContentModel.card(p,state.planViews[p.id]||'furnished')).join('')||'<div class="empty-catalog">По этим условиям предложений нет. Измените фильтры или сбросьте их.</div>';
  document.getElementById('catalog-result').textContent=`Найдено: ${list.length} · показано: ${Math.min(state.limit,list.length)}`;
  document.getElementById('show-more-plans').hidden=list.length<=state.limit||state.plansView!=='lots';
}
function planViewLabel(p){return ContentModel.views[state.planViews[p.id]||'furnished'];}
function askPlan(plan){
  state.snapshot={kind:'plan',kicker:'Ваш запрос',planChoice:plan.category,lotId:plan.id,planView:state.planViews[plan.id]||'furnished',sourceUrl:plan.source_url,snapshotDate:SITE_DATA.snapshot_date,objectTitle:plan.title,objectMeta:plan.area_m2.toLocaleString('ru-RU')+' м² · '+plan.floor+' этаж · ID '+plan.id+' · '+rub(plan.price)+' · '+planViewLabel(plan),rows:[]};
  state.planChoice=plan.category;updateForm();scrollToForm();
}
function calcHere(plan){state.selectedPlanId=plan.id;state.price=plan.price;state.selectedPlanView=state.planViews[plan.id]||'furnished';document.getElementById('price-range').value=plan.price;renderCalculator();scrollToEl('calculator',80);}
function wirePlansEvents(){
  // These progressive-enhancement links act as buttons once the catalog is live.
  document.getElementById('plans-grid').addEventListener('keydown',e=>{
    const variant=e.target.closest('[data-plan-view]');
    if(variant&&e.key===' '){e.preventDefault();variant.click();}
  });
  document.getElementById('plan-tabs').addEventListener('click',e=>{const tab=e.target.closest('[data-tab]');if(!tab)return;state.filter=tab.dataset.tab;state.layout='';state.limit=6;renderTabs();renderPlansGrid();});
  document.getElementById('plans-grid').addEventListener('click',e=>{
    const variant=e.target.closest('[data-plan-view]');
    if(variant){e.preventDefault();const id=variant.dataset.id;state.planViews[id]=variant.dataset.planView;const card=variant.closest('[data-lot-id]'),plan=PLANS.find(p=>p.id===id),asset=plan.plans.find(p=>p.type===variant.dataset.planView);card.querySelector('img').src=asset.local_path;card.querySelector('img').alt=plan.title+' — '+planViewLabel(plan);card.querySelector('.plan-thumb').href=asset.local_path;card.querySelectorAll('[data-plan-view]').forEach(b=>b.setAttribute('aria-pressed',String(b===variant)));return;}
    const el=e.target.closest('[data-action]');if(!el)return;const plan=PLANS.find(p=>p.id===el.dataset.id);if(!plan)return;e.preventDefault();
    if(el.dataset.action==='open-plan-image')openLightbox('plan',Object.keys(ContentModel.views).indexOf(state.planViews[plan.id]||'furnished'),plan.id);
    else if(el.dataset.action==='ask-plan')askPlan(plan);else if(el.dataset.action==='calc-here')calcHere(plan);
  });
  for(const [id,key] of [['budget','budget'],['floor','floor'],['layout','layout'],['sort','sort'],['sea','sea']])document.getElementById(id+'-filter').addEventListener('change',e=>{state[key]=key==='sea'?e.target.checked:['budget','floor'].includes(key)?Number(e.target.value):e.target.value;state.limit=6;renderPlansGrid();});
  document.getElementById('reset-filters').addEventListener('click',()=>{Object.assign(state,{budget:0,floor:0,layout:'',sort:'price',sea:false,limit:6});for(const id of ['budget','floor','layout'])document.getElementById(id+'-filter').value='';document.getElementById('sort-filter').value='price';document.getElementById('sea-filter').checked=false;renderPlansGrid();});
  document.getElementById('show-more-plans').addEventListener('click',()=>{const next=currentFilteredPlans()[state.limit];state.limit+=6;renderPlansGrid();if(next)document.querySelector(`[data-lot-id="${next.id}"] .plan-thumb`).focus({preventScroll:true});});
}
/* ================= gallery and monthly albums ================= */
function renderGallery(){/* Generated semantic HTML is also the live gallery. */}
function wireGalleryEvents(){
  document.getElementById('gallery-view-all').addEventListener('click',()=>openLightbox('gallery',0));
  document.getElementById('gallery-grid').addEventListener('click',e=>{const a=e.target.closest('[data-action]');if(a){e.preventDefault();openLightbox('gallery',Number(a.dataset.index));}});
  const tabs=document.getElementById('construction-tabs');
  tabs.innerHTML=SITE_DATA.media.construction.map((m,i)=>`<button type="button" class="tab-chip${i===0?' active':''}" data-month="${m.month}" aria-pressed="${i===0}">${m.title}</button>`).join('');
  const select=month=>{document.querySelectorAll('.construction-album').forEach(d=>{d.hidden=d.dataset.album!==month;d.open=!d.hidden;});tabs.querySelectorAll('button').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.month===month));b.classList.toggle('active',b.dataset.month===month);});};
  tabs.addEventListener('click',e=>{const b=e.target.closest('[data-month]');if(b){select(b.dataset.month);b.scrollIntoView({block:"nearest",inline:"nearest",behavior:"smooth"});}});
  document.getElementById('construction-albums').addEventListener('click',e=>{const a=e.target.closest('[data-action]');if(a){e.preventDefault();openLightbox('construction',Number(a.dataset.index),a.dataset.month);}});
  select(SITE_DATA.media.construction[0].month);
}
/* ================= lightbox ================= */
const lb={mode:null,index:null,opener:null,lotId:null,month:null,zoom:1,x:0,y:0};
function lightboxItems(){
  if(lb.mode==='plan'){const p=PLANS.find(p=>p.id===lb.lotId);return p.plans.map(a=>({src:a.local_path,title:p.title+' · '+ContentModel.views[a.type],type:a.type,caption:p.meta+' · '+rub(p.price)+' · мебель приобретается отдельно'}));}
  const items=lb.mode==='gallery'?GALLERY:SITE_DATA.media.construction.find(m=>m.month===lb.month).images;
  return items.map(m=>({...m,src:m.variants.at(-1).src,caption:lb.mode==='gallery'?'Визуализация застройщика':'Фото строительства'}));
}
function lightboxCount(){return lightboxItems().length;}
function openLightbox(mode,index,id){
  lb.opener=document.activeElement;lb.mode=mode;lb.index=index;lb.lotId=mode==='plan'?id:null;lb.month=mode==='construction'?id:null;
  const overlay=document.getElementById('lightbox');overlay.hidden=false;overlay.classList.add('open');
  lb.background=[...document.body.children].filter(el=>el!==overlay&&el.tagName!=='SCRIPT').map(el=>[el,el.inert]);lb.background.forEach(([el])=>el.inert=true);
  lb.overflow=document.body.style.overflow;document.body.style.overflow='hidden';renderLightbox();document.getElementById('lightbox-close').focus();
}
function closeLightbox(){
  const overlay=document.getElementById('lightbox');overlay.classList.remove('open');overlay.hidden=true;
  lb.background?.forEach(([el,inert])=>el.inert=inert);document.body.style.overflow=lb.overflow||'';
  if(lb.opener?.isConnected)lb.opener.focus({preventScroll:true});lb.mode=null;lb.index=null;
}
function applyZoom(){
  lb.zoom=Math.max(1,Math.min(4,lb.zoom));
  const box=document.getElementById('lightbox-image').getBoundingClientRect();
  lb.x=Math.max(-box.width*(lb.zoom-1)/2,Math.min(box.width*(lb.zoom-1)/2,lb.x));lb.y=Math.max(-box.height*(lb.zoom-1)/2,Math.min(box.height*(lb.zoom-1)/2,lb.y));
  document.getElementById('lightbox-asset').style.transform=`translate(${lb.x}px,${lb.y}px) scale(${lb.zoom})`;
  document.getElementById('zoom-reset').textContent=Math.round(lb.zoom*100)+'%';document.getElementById('zoom-out').disabled=lb.zoom===1;document.getElementById('zoom-in').disabled=lb.zoom===4;
}
function renderLightbox(){
  if(lb.index==null)return;const items=lightboxItems(),item=items[lb.index];
  document.getElementById('lightbox-title-text').textContent=item.title;document.getElementById('lightbox-position').textContent=(lb.index+1)+' из '+items.length;
  document.getElementById('lightbox-caption').textContent=item.caption;
  document.getElementById('lightbox').dataset.mode=lb.mode;
  document.getElementById('lightbox-calc').hidden=lb.mode!=='plan';
  const img=document.getElementById('lightbox-asset');img.src=item.src;img.alt=item.title;
  const variants=document.getElementById('lightbox-variants');variants.hidden=lb.mode!=='plan';variants.innerHTML=lb.mode==='plan'?items.map((m,i)=>`<button type="button" data-lb-view="${i}" aria-pressed="${lb.index===i}">${ContentModel.views[m.type]}</button>`).join(''):'';
  if(lb.mode==='plan'){
    state.planViews[lb.lotId]=item.type;
    const card=document.querySelector(`[data-lot-id="${lb.lotId}"]`);
    if(card){card.querySelector('img').src=item.src;card.querySelector('img').alt=item.title;card.querySelector('.plan-thumb').href=item.src;card.querySelectorAll('[data-plan-view]').forEach(v=>v.setAttribute('aria-pressed',String(v.dataset.planView===item.type)));}
  }
  lb.zoom=1;lb.x=lb.y=0;applyZoom();
}
function lightboxNav(dir){lb.index=(lb.index+dir+lightboxCount())%lightboxCount();renderLightbox();}
function wireLightboxEvents(){
  const overlay=document.getElementById('lightbox'),inner=document.getElementById('lightbox-inner'),image=document.getElementById('lightbox-image');
  document.getElementById('lightbox-calc').addEventListener('click',()=>{const id=lb.lotId;closeLightbox();calcHere(PLANS.find(p=>p.id===id));});
  overlay.addEventListener('click',closeLightbox);inner.addEventListener('click',e=>e.stopPropagation());document.getElementById('lightbox-close').addEventListener('click',closeLightbox);
  document.getElementById('lightbox-prev').addEventListener('click',()=>lightboxNav(-1));document.getElementById('lightbox-next').addEventListener('click',()=>lightboxNav(1));
  document.getElementById('lightbox-variants').addEventListener('click',e=>{const b=e.target.closest('[data-lb-view]');if(b){lb.index=Number(b.dataset.lbView);renderLightbox();document.querySelector(`[data-lb-view="${lb.index}"]`).focus();}});
  for(const [id,change] of [['zoom-in',.5],['zoom-out',-.5],['zoom-reset',0]])document.getElementById(id).addEventListener('click',()=>{lb.zoom=change?lb.zoom+change:1;applyZoom();});
  image.addEventListener('dblclick',()=>{lb.zoom=lb.zoom===1?2:1;applyZoom();});
  document.addEventListener('keydown',e=>{
    if(lb.index==null)return;
    if(e.key==='Escape'){e.preventDefault();closeLightbox();return;}
    if(e.key==='Tab'){const controls=[...overlay.querySelectorAll('button,a[href]')].filter(b=>!b.disabled&&b.getClientRects().length);const i=controls.indexOf(document.activeElement);e.preventDefault();controls[(i+(e.shiftKey?-1:1)+controls.length)%controls.length].focus();}
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','0'].includes(e.key))e.preventDefault();
    if(e.key==='+'||e.key==='='){lb.zoom+=.5;applyZoom();}else if(e.key==='-'){lb.zoom-=.5;applyZoom();}else if(e.key==='0'){lb.zoom=1;applyZoom();}
    else if(lb.zoom>1){if(e.key==='ArrowLeft')lb.x+=50;if(e.key==='ArrowRight')lb.x-=50;if(e.key==='ArrowUp')lb.y+=50;if(e.key==='ArrowDown')lb.y-=50;applyZoom();}
    else if(e.key==='ArrowLeft')lightboxNav(-1);else if(e.key==='ArrowRight')lightboxNav(1);
  });
  let gesture=null;
  const distance=t=>Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY);
  image.addEventListener('touchstart',e=>{gesture={x:e.touches[0].clientX,y:e.touches[0].clientY,panX:lb.x,panY:lb.y,zoom:lb.zoom,pinch:e.touches.length>1?distance(e.touches):0,multi:e.touches.length>1};},{passive:true});
  image.addEventListener('touchmove',e=>{if(!gesture)return;e.preventDefault();if(e.touches.length>1){if(!gesture.pinch){gesture.pinch=distance(e.touches);gesture.zoom=lb.zoom;}gesture.multi=true;lb.zoom=gesture.zoom*distance(e.touches)/gesture.pinch;applyZoom();}else if(lb.zoom>1){lb.x=gesture.panX+e.touches[0].clientX-gesture.x;lb.y=gesture.panY+e.touches[0].clientY-gesture.y;applyZoom();}},{passive:false});
  image.addEventListener('touchend',e=>{if(!gesture)return;if(e.touches.length)return;const g=gesture;gesture=null;if(g.multi||g.zoom>1)return;const t=e.changedTouches[0],dx=t.clientX-g.x,dy=t.clientY-g.y;if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy))lightboxNav(dx<0?1:-1);else if(Math.abs(dy)>100&&Math.abs(dy)>Math.abs(dx))closeLightbox();});
  image.addEventListener('touchcancel',()=>gesture=null);
  let drag=null;image.addEventListener('pointerdown',e=>{if(e.pointerType!=='mouse'||lb.zoom===1)return;drag={x:e.clientX,y:e.clientY,panX:lb.x,panY:lb.y};image.setPointerCapture(e.pointerId);});image.addEventListener('pointermove',e=>{if(drag){lb.x=drag.panX+e.clientX-drag.x;lb.y=drag.panY+e.clientY-drag.y;applyZoom();}});image.addEventListener('pointerup',()=>drag=null);image.addEventListener('pointercancel',()=>drag=null);
}

/* ================= calculator ================= */
function calcNumbers(){
  const s = state;
  const downPayment = s.price * s.downPct / 100;
  const loanAmount = s.price - downPayment;
  const monthlyRate = s.rate / 100 / 12;
  const n = s.term * 12;
  const payment = monthlyRate === 0 ? loanAmount / n : loanAmount * monthlyRate / (1 - Math.pow(1 + monthlyRate, -n));
  const income = payment / 0.4;
  return { downPayment, loanAmount, payment, income };
}
function renderCalculator(){
  const s = state;
  const { downPayment, loanAmount, payment, income } = calcNumbers();
  document.getElementById('price-label').textContent = rub(s.price);
  document.getElementById('down-label').textContent = s.downPct + '% · ' + rub(downPayment);
  document.getElementById('term-label').textContent = s.term + ' лет';
  document.getElementById('rate-label').textContent = s.rate.toFixed(1) + '%';
  document.getElementById('payment-label').textContent = rub(payment) + ' / мес';
  document.getElementById('income-label').textContent = rub(income) + ' / мес';
  document.getElementById('loan-label').textContent = rub(loanAmount);

  const selectedPlan = s.selectedPlanId ? PLANS.find(p => p.id === s.selectedPlanId) : null;
  document.getElementById('calc-thumb').classList.toggle('has-plan', !!selectedPlan);
  document.getElementById('calc-thumb').innerHTML=selectedPlan?`<img src="${selectedPlan.plans.find(p=>p.type===s.selectedPlanView).local_path}" alt="${ContentModel.esc(selectedPlan.title)}" width="120" height="100">`:'';
  document.getElementById('calc-plan-kicker').textContent = selectedPlan ? 'Расчёт для объекта' : 'Произвольный расчёт';
  document.getElementById('calc-plan-title').textContent = selectedPlan ? selectedPlan.title : 'Планировка не выбрана';
  const metaEl = document.getElementById('calc-plan-meta');
  if (selectedPlan) metaEl.textContent = selectedPlan.meta + ' · ' + rub(selectedPlan.price) + ' · ' + ContentModel.views[s.selectedPlanView];
  else metaEl.innerHTML = 'Выберите планировку в разделе <a href="#plans" id="calc-goto-plans">«Планировки»</a> — цена подставится сюда';
  document.getElementById('calc-plan-clear').hidden = !selectedPlan;

  document.getElementById('pdf-label').textContent = s.pdfBusy ? 'Готовим PDF…' : 'Скачать расчёт';
  document.getElementById('download-calc').classList.toggle('busy', s.pdfBusy);
  document.getElementById('download-calc').disabled = s.pdfBusy;
}
function sendToForm(){
  const s = state;
  const selectedPlan = s.selectedPlanId ? PLANS.find(p => p.id === s.selectedPlanId) : null;
  const { downPayment, payment } = calcNumbers();
  state.planChoice = selectedPlan ? selectedPlan.category : (s.planChoice || 'unsure');
  state.snapshot = {
    kind: 'calc', kicker: 'Ваш расчёт', lotId:selectedPlan?.id||null, planView:selectedPlan?s.selectedPlanView:null, sourceUrl:selectedPlan?.source_url||null, snapshotDate:SITE_DATA.snapshot_date,
    planTitle: selectedPlan ? selectedPlan.title : '',
    objectTitle: selectedPlan ? selectedPlan.title : 'Произвольный расчёт',
    objectMeta: selectedPlan ? selectedPlan.meta + ' · '+ContentModel.views[s.selectedPlanView]+' · данные 27.10.2026' : 'Планировка не выбрана — расчёт по указанной стоимости',
    rows: [
      { k: 'Стоимость', v: rub(s.price) },
      { k: 'Первый взнос', v: s.downPct + '% · ' + rub(downPayment) },
      { k: 'Срок / ставка', v: s.term + ' лет · ' + s.rate.toFixed(1) + '%' },
      { k: 'Платёж', v: rub(payment) + ' / мес' },
    ],
  };
  updateForm();
  scrollToForm();
}
function downloadCalc(){
  if (state.pdfBusy) return;
  const s = state;
  const selectedPlan = s.selectedPlanId ? PLANS.find(p => p.id === s.selectedPlanId) : null;
  const { downPayment, loanAmount, payment, income } = calcNumbers();
  const d = {
    date: new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }),
    custom: !selectedPlan, lotId:selectedPlan?.id||null, sourceUrl:selectedPlan?.source_url||null,
    objectTitle: selectedPlan ? selectedPlan.title : 'Произвольный расчёт',
    objectMeta: selectedPlan ? selectedPlan.meta + ' · ' + ContentModel.views[s.selectedPlanView] + ' · данные 27.10.2026' : 'Планировка не выбрана — расчёт по указанной стоимости',
    price: rub(s.price), down: s.downPct + '% · ' + rub(downPayment), loan: rub(loanAmount),
    term: s.term + ' лет', rate: s.rate.toFixed(1) + '%',
    income: rub(income) + ' / мес', payment: rub(payment) + ' / мес',
  };
  const logo = new URL('assets/logo-cropped.webp', document.baseURI).href;
  document.getElementById('pdf-status').hidden = true;
  state.pdfBusy = true; renderCalculator();
  makeCalcPdf(calcDocHtml(d, logo), 'Расчёт ипотеки — Дом у моря.pdf')
    .catch(() => { const status = document.getElementById('pdf-status'); status.hidden = false; status.textContent = 'Не удалось создать PDF. Попробуйте ещё раз.'; })
    .then(() => { state.pdfBusy = false; renderCalculator(); });
}
function wireCalculatorEvents(){
  document.getElementById('price-range').addEventListener('input', e => {
    state.price = Number(e.target.value); state.selectedPlanId = null; renderCalculator();
  });
  document.getElementById('down-range').addEventListener('input', e => {
    state.downPct = Number(e.target.value); renderCalculator();
  });
  document.getElementById('term-range').addEventListener('input', e => {
    state.term = Number(e.target.value); renderCalculator();
  });
  document.getElementById('rate-range').addEventListener('input', e => {
    state.rate = Number(e.target.value); renderCalculator();
  });
  document.getElementById('calc-plan-clear').addEventListener('click', e => {
    e.preventDefault(); state.selectedPlanId = null; renderCalculator(); scrollToEl('plans', 80);
  });
  document.getElementById('calc-plan-meta').addEventListener('click', e => {
    if (e.target.id === 'calc-goto-plans') { e.preventDefault(); scrollToEl('plans', 80); }
  });
  document.getElementById('send-to-form').addEventListener('click', e => { e.preventDefault(); sendToForm(); });
  document.getElementById('download-calc').addEventListener('click', downloadCalc);
}

/* ================= pricing CTAs ================= */
function wirePricingCtas(){
  const installment = document.querySelector('[data-action="ask-installment"]');
  installment.addEventListener('click', e => {
    e.preventDefault();
    openGenericRequest({ kind: 'installment', kicker: 'Ваш запрос', objectTitle: 'Семейная ипотека 6%', objectMeta: 'Запрос условий · первый взнос от 20%, сумма кредита до 12 млн ₽' });
  });
  const fullpay = document.querySelector('[data-action="ask-fullpay"]');
  fullpay.addEventListener('click', e => {
    e.preventDefault();
    openGenericRequest({ kind: 'full', kicker: 'Ваш запрос', objectTitle: '100% оплата', objectMeta: 'Запрос актуального прайса и условий при полной оплате' });
  });
}
function openGenericRequest(req){
  state.snapshot = req;
  state.planChoice = req.planChoice || state.planChoice;
  updateForm();
  scrollToForm();
}

/* ================= contact form ================= */
function createFieldEl(key){
  const wrap = document.createElement('div');
  wrap.className = 'opened-field';
  wrap.dataset.field = key;
  const label = FIELD_LABELS[key][0];
  let bodyHtml = '';
  if (key === 'plan') {
    bodyHtml = `<select class="field-select" id="plan-select" name="plan" aria-label="Интересующая планировка">
      <option value="" disabled>Выберите тип квартиры</option>
      <option value="studio">Студия</option>
      <option value="1k">1 спальня</option>
      <option value="2k">2 спальни</option>
      <option value="3k">3 спальни</option>
      <option value="unsure">Пока не определился(-лась)</option>
    </select>`;
  } else if (key === 'email') {
    bodyHtml = `<input class="field-input" id="email-input" aria-label="E-mail" aria-describedby="email-error" type="email" autocomplete="email" name="email" placeholder="пришлём подборку и прайс">
      <div class="field-error" id="email-error" hidden>Проверьте адрес — похоже, в нём опечатка</div>`;
  } else if (key === 'channel') {
    bodyHtml = `<div class="chip-row" id="channel-chips">${CHANNELS.map(c => `<button type="button" class="chip" data-chip-group="channel" data-chip-value="${c}">${c}</button>`).join('')}</div>`;
  } else if (key === 'time') {
    bodyHtml = `<div class="chip-row" id="time-chips">${CALL_TIMES.map(t => `<button type="button" class="chip" data-chip-group="time" data-chip-value="${t[0]}">${t[1]}</button>`).join('')}</div>`;
  }
  wrap.innerHTML = `<div class="opened-field-head"><span class="field-label-text">${label}</span><button type="button" class="drop-field-btn" data-field="${key}">не указывать</button></div>${bodyHtml}`;
  return wrap;
}
function openField(key){
  if (state.opts.includes(key)) return;
  state.opts.push(key);
  updateForm();
}
function closeField(key){
  state.opts = state.opts.filter(k => k !== key);
  Object.assign(state, FIELD_RESETS[key]);
  updateForm();
}
function syncOpenedFields(){
  const container = document.getElementById('opened-fields-container');
  const locked = planLockedActive();
  const wanted = state.opts.filter(k => !(k === 'plan' && locked));
  container.hidden = wanted.length === 0;
  Array.from(container.children).forEach(el => {
    if (!wanted.includes(el.dataset.field)) el.remove();
  });
  wanted.forEach(key => {
    let el = container.querySelector('[data-field="' + key + '"]');
    if (!el) {
      el = createFieldEl(key);
      if (key === 'plan') el.querySelector('select').value = state.planChoice || '';
      if (key === 'email') el.querySelector('input').value = state.email || '';
    }
    container.appendChild(el);
  });
}
function renderMoreFieldsRow(){
  const row = document.getElementById('more-fields-row');
  const locked = planLockedActive();
  const remaining = FIELD_ORDER.filter(k => !state.opts.includes(k) && !(k === 'plan' && locked));
  const label = 'Дополнительно';
  const sig = label + '|' + remaining.join(',');
  if (row.dataset.sig === sig) return; // avoid rebuilding mid-click (blur on another field would destroy the button being clicked)
  row.dataset.sig = sig;
  if (remaining.length === 0) { row.hidden = true; row.innerHTML = ''; return; }
  row.hidden = false;
  row.innerHTML = `<span>${label}</span>` + remaining.map((k, i) =>
    `<button type="button" class="more-field-btn" data-field="${k}">${({plan:'Планировка',email:'E-mail',channel:'Связь',time:'Время'})[k]}</button>`
  ).join('');
}
function renderSnapshot(){
  const slot = document.getElementById('snapshot-slot');
  const snap = state.snapshot;
  const sig = JSON.stringify(snap);
  if (slot.dataset.sig === sig) return; // avoid rebuilding mid-click on "убрать"
  slot.dataset.sig = sig;
  if (!snap) { slot.hidden = true; slot.innerHTML = ''; return; }
  slot.hidden = false;
  const rows = snap.rows || [];
  slot.innerHTML = `<div class="snap-card">
    <div class="snap-head">
      <div class="snap-body">
        <div class="snap-kicker">${snap.kicker || ''}</div>
        <div class="snap-title">${snap.objectTitle || ''}</div>
        <div class="snap-meta">${snap.objectMeta || ''}</div>
      </div>
      <button type="button" class="snap-remove" id="snapshot-remove-btn" aria-label="Убрать запрос">убрать</button>
    </div>
    ${rows.length ? `<div class="snap-rows">${rows.map(r => `<div><div class="snap-row-k">${r.k}</div><div class="snap-row-v">${r.v}</div></div>`).join('')}</div>` : ''}
  </div>`;
}
function renderPlanLocked(){
  const locked = planLockedActive();
  const slot = document.getElementById('plan-locked-slot');
  slot.hidden = true; // The selected object is already shown once in the compact snapshot.
  if (locked) {
    document.getElementById('plan-locked-value').textContent = snapPlanTitle();
    document.getElementById('plan-locked-note').textContent = state.snapshot.kind === 'calc' ? 'из вашего расчёта' : 'из вашего запроса';
  }
}
function renderFormTitleSub(){
  const snap = state.snapshot;
  const snapKind = snap ? snap.kind : null;
  const titleEl = document.getElementById('form-title');
  const subEl = document.getElementById('form-sub');
  if (!titleEl) return;
  titleEl.textContent = snapKind === 'calc' ? 'Обсудим ваш расчёт' : (snap ? 'Обсудим ваш запрос' : 'Как с вами связаться');
  subEl.textContent = 'Оставьте контакты и добавьте пожелания к квартире.';
}
function updateForm(){
  const s = state;
  const phoneOk = /^\+7 \(\d{3}\) \d{3}-\d{2}-\d{2}$/.test(s.phone);
  const emailBad = !!s.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.email);
  const formReady = !!(s.name.trim() && phoneOk && s.consent && !emailBad);

  const nameErr = !!s.blurred.name && !s.name.trim();
  document.getElementById('name-input').classList.toggle('error', nameErr);
  document.getElementById('name-input').setAttribute('aria-invalid', String(nameErr));
  document.getElementById('name-error').hidden = !nameErr;

  const phoneErr = !!s.blurred.phone && !phoneOk;
  document.getElementById('phone-input').classList.toggle('error', phoneErr);
  document.getElementById('phone-input').setAttribute('aria-invalid', String(phoneErr));
  document.getElementById('phone-error').hidden = !phoneErr;
  const consentErr=!!s.blurred.consent&&!s.consent;
  document.getElementById('consent-input').setAttribute('aria-invalid',String(consentErr));
  document.getElementById('consent-error').hidden=!consentErr;

  syncOpenedFields();

  const emailInput = document.getElementById('email-input');
  if (emailInput) {
    const showErr = emailBad && !!s.blurred.email;
    emailInput.classList.toggle('error', showErr);
    emailInput.setAttribute('aria-invalid', String(showErr));
    const err = document.getElementById('email-error');
    if (err) err.hidden = !showErr;
  }
  const planSelect = document.getElementById('plan-select');
  if (planSelect) planSelect.classList.toggle('chosen', !!s.planChoice);
  document.querySelectorAll('#channel-chips .chip').forEach(b => { b.classList.toggle('active', b.dataset.chipValue === s.channel); b.setAttribute('aria-pressed', String(b.dataset.chipValue === s.channel)); });
  document.querySelectorAll('#time-chips .chip').forEach(b => { b.classList.toggle('active', b.dataset.chipValue === s.callTime); b.setAttribute('aria-pressed', String(b.dataset.chipValue === s.callTime)); });

  renderMoreFieldsRow();
  renderPlanLocked();
  renderSnapshot();
  renderFormTitleSub();

  const btn = document.getElementById('submit-btn');
  btn.classList.toggle('ready', formReady);
  btn.disabled = !formReady;

}
function handlePhoneInput(e){
  const el = e.target;
  const caret = el.selectionStart == null ? el.value.length : el.selectionStart;
  let head = el.value.slice(0, caret).replace(/\D/g, '');
  if (head.startsWith('8')) head = '7' + head.slice(1);
  else if (!head.startsWith('7')) head = '7' + head;
  const digitsBefore = head.length;
  const formatted = formatRuPhone(el.value);
  let seen = 0, pos = formatted.length;
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i])) seen++;
    if (seen === digitsBefore) { pos = i + 1; break; }
  }
  if (!formatted) pos = 0;
  el.value = formatted;
  try { el.setSelectionRange(pos, pos); } catch (err) {}
  state.phone = formatted;
  updateForm();
}
function handleSubmit(){
  const phoneOk = /^\+7 \(\d{3}\) \d{3}-\d{2}-\d{2}$/.test(state.phone);
  const emailBad = !!state.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(state.email);
  const formReady = !!(state.name.trim() && phoneOk && state.consent && !emailBad);
  if (!formReady) {
    state.blurred = { name: true, phone: true, email: true, consent: true };
    updateForm();
    document.querySelector('#request-form [aria-invalid="true"]')?.focus();
    return;
  }
  const status = document.getElementById('form-status');
  status.hidden = false;
  status.textContent = 'Отправка заявки ещё не подключена. Данные не отправлены. Свяжитесь с агентством по телефону +7 (952) 956-88-75 или e-mail info@anyara.ru.';
  status.focus();
}
function bindFormEvents(){
  const form = document.getElementById('request-form');
  form.addEventListener('input', e => {
    if (e.target.id === 'name-input') { state.name = e.target.value; updateForm(); }
    else if (e.target.id === 'phone-input') { handlePhoneInput(e); }
    else if (e.target.id === 'email-input') { state.email = e.target.value; updateForm(); }
  });
  form.addEventListener('change', e => {
    if (e.target.id === 'plan-select') { state.planChoice = e.target.value; updateForm(); }
    else if (e.target.id === 'consent-input') { state.consent = e.target.checked; updateForm(); }
  });
  form.addEventListener('focusout', e => {
    if (e.target.id === 'name-input') { state.blurred.name = true; updateForm(); }
    else if (e.target.id === 'phone-input') { state.blurred.phone = true; updateForm(); }
    else if (e.target.id === 'email-input') { state.blurred.email = true; updateForm(); }
    else if (e.target.id === 'consent-input') { state.blurred.consent = true; updateForm(); }
  });
  form.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (chip) {
      if (chip.dataset.chipGroup === 'channel') state.channel = chip.dataset.chipValue;
      else if (chip.dataset.chipGroup === 'time') state.callTime = chip.dataset.chipValue;
      updateForm();
      return;
    }
    const drop = e.target.closest('.drop-field-btn');
    if (drop) { closeField(drop.dataset.field); return; }
    const more = e.target.closest('.more-field-btn');
    if (more) { openField(more.dataset.field); return; }
    const removeSnap = e.target.closest('#snapshot-remove-btn');
    if (removeSnap) { state.snapshot = null; updateForm(); return; }
  });
  form.addEventListener('submit', e => { e.preventDefault(); handleSubmit(); });
}
function renderContactArea(){
  // Initial form is semantic HTML and remains readable without JavaScript.
  bindFormEvents();
  updateForm();
}

/* ================= init ================= */
function init(){
  document.documentElement.classList.add('content-ready');
  setupAbout();
  renderTabs(); renderPlansGrid(); wirePlansEvents(); setupPlanViews(); setupMap();
  renderGallery(); wireGalleryEvents();
  document.querySelectorAll('.faq-questions details').forEach(d=>{
    const summary=d.querySelector('summary');
    const sync=()=>summary.setAttribute('aria-expanded',String(d.open));
    sync();d.addEventListener('toggle',()=>{if(d.open)document.querySelectorAll('.faq-questions details').forEach(other=>{if(other!==d)other.open=false;});sync();});
  });
  wireCalculatorEvents(); renderCalculator();
  renderContactArea();
  wireHeaderEvents(); applyMenuState();
  wireLightboxEvents();
  wireCookieBanner(); applyCookieBanner();
  wireScrollTopBtn();
  wirePricingCtas();
  setupRevealObserver();
  onScroll();
}
document.addEventListener('DOMContentLoaded', init);

/* ================= current-design controls ================= */
function setupAbout(){
  const panel = document.getElementById('about-content');
  const buttons = [...document.querySelectorAll('[data-about-tab]')];
  const applyTheme = (root, theme) => {
    root.querySelector('#about-theme-title').textContent = theme.title;
    root.querySelector('#about-theme-lead').textContent = theme.lead;
    root.querySelectorAll('.about-item-title').forEach((el, i) => el.textContent = theme.items[i].t);
    root.querySelectorAll('.about-item-copy').forEach((el, i) => el.textContent = theme.items[i].d);
  };
  const select = key => {
    state.aboutTab = key;
    applyTheme(panel, ABOUT_THEMES.find(t => t.key === key));
    buttons.forEach(b => { const on = b.dataset.aboutTab === key; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    panel.setAttribute('aria-labelledby', 'about-tab-' + key);
  };
  buttons.forEach((b, i) => {
    b.addEventListener('click', () => select(b.dataset.aboutTab));
    b.addEventListener('keydown', e => {
      let next;
      if (e.key === 'ArrowRight') next = (i + 1) % buttons.length;
      else if (e.key === 'ArrowLeft') next = (i - 1 + buttons.length) % buttons.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = buttons.length - 1;
      if (next !== undefined) { e.preventDefault(); buttons[next].focus(); select(buttons[next].dataset.aboutTab); }
    });
  });
  // Measure all three themes at the real responsive width, without changing the visible panel.
  const reserveHeight = () => {
    const probe = panel.cloneNode(true);
    probe.removeAttribute('id'); probe.removeAttribute('role'); probe.setAttribute('aria-hidden', 'true');
    Object.assign(probe.style, {position:'absolute', left:'-10000px', top:'0', width:panel.getBoundingClientRect().width+'px', minHeight:'0', visibility:'hidden'});
    document.body.appendChild(probe);
    let height = 0;
    ABOUT_THEMES.forEach(theme => { applyTheme(probe, theme); height = Math.max(height, probe.getBoundingClientRect().height); });
    panel.style.minHeight = Math.ceil(height) + 'px';
    probe.remove();
  };
  reserveHeight();
  document.fonts.ready.then(reserveHeight);
  let scheduled;
  window.addEventListener('resize', () => { cancelAnimationFrame(scheduled); scheduled = requestAnimationFrame(reserveHeight); });
}

function setupPlanViews(){
  document.getElementById('category-grid').innerHTML = CATEGORIES.map(ContentModel.category).join('');
  const setView = view => {
    state.plansView = view;
    document.getElementById('plans-grid').hidden = view !== 'lots';
    document.getElementById('plan-tabs').hidden = view !== 'lots';
    document.getElementById('catalog-controls').hidden = view !== 'lots';
    document.getElementById('catalog-result').hidden = view !== 'lots';
    document.getElementById('show-more-plans').hidden = view !== 'lots' || currentFilteredPlans().length <= state.limit;
    document.getElementById('category-grid').hidden = view !== 'cats';
    document.querySelectorAll('[data-view]').forEach(b => { b.classList.toggle('active', b.dataset.view === view); b.setAttribute('aria-pressed', String(b.dataset.view === view)); });
  };
  document.getElementById('plan-views').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); });
  document.getElementById('category-grid').addEventListener('click', e => {
    const a = e.target.closest('[data-category]'); if (!a) return; e.preventDefault();
    const c = CATEGORIES.find(c => c.key === a.dataset.category);
    if (a.dataset.categoryAction === 'lots') { state.filter = c.key; state.layout=''; state.limit=6; renderTabs(); renderPlansGrid(); setView('lots'); document.querySelector('[data-tab="'+c.key+'"]').focus({preventScroll:true}); }
    else openGenericRequest({kind:'plan', kicker:'Ваш запрос', planChoice:c.key, objectTitle:c.title, objectMeta:c.area+' · '+c.price, rows:[]});
  });
}
function setupMap(){
  const frame = document.getElementById('location-map');
  const button = document.getElementById('map-unlock');
  const lock = () => { frame.style.pointerEvents = 'none'; frame.tabIndex = -1; button.hidden = false; };
  button.addEventListener('click', () => { frame.style.pointerEvents = 'auto'; frame.tabIndex = 0; button.hidden = true; frame.focus(); });
  document.getElementById('map-container').addEventListener('mouseleave', lock);
  frame.addEventListener('blur', lock);
}
