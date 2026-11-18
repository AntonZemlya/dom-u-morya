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
${row('Программа', d.program)}
${row('Стоимость квартиры', d.price)}
${row('Первоначальный взнос', d.down)}
${row('Сумма кредита', d.loan)}
${row('Срок кредита', d.term)}
${row('Ставка', d.rate)}
${row('Необходимый доход', d.income)}
</table>
${d.warning ? `<p class="note">${d.warning}</p>` : ''}
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
    document.dispatchEvent(new Event('dom:pdf-download'));
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } finally {
    frame.remove();
  }
}

/* ---------- app state ---------- */
const state = {
  filtersOpen: false, mortgageProgram: 'regional',
  filter: PLANS[0].category, budget:0, floor:0, layout:'', sort:'price', sea:false, limit:6, planViews:{}, selectedPlanView:'furnished',
  price: Math.min(...PLANS.map(p=>p.price)), downPct: ContentModel.minimumDownPayment(Math.min(...PLANS.map(p=>p.price)), ContentModel.mortgagePrograms.regional).value, downMode:'auto', downAdjustment:'', term: 30, rate: 2,
  aboutTab: 'arch',
  selectedPlanId: null,
  snapshot: null,
  formEnabled: false, formBusy: false, formAttempt: null,
  name: '', phone: '', email: '', planChoice: '', consent: false,
  channel: 'Звонок', callTime: '',
  opts: [],
  blurred: {},
  pdfBusy: false,
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
  scrollBtn.classList.toggle('no-cookie-banner', document.getElementById('cookie-banner')?.hidden !== false);
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
function renderFilterDisclosure(){
  const count = [state.budget, state.floor, state.layout, state.sea, state.sort !== 'price'].filter(Boolean).length;
  const open = state.filtersOpen;
  document.getElementById('catalog-controls').hidden = !open;
  document.getElementById('toggle-filters').setAttribute('aria-expanded', String(open));
  document.getElementById('filter-disclosure-status').textContent = open ? 'Открыты' : 'Скрыты';
  const badge = document.getElementById('filter-count');
  badge.textContent = String(count);
  badge.setAttribute('aria-label', 'Активных условий: ' + count);
  badge.hidden = !count;
  document.getElementById('reset-filters-compact').hidden = !count;
}
function resetCatalogFilters(){
  const compactFocused = document.activeElement.id === 'reset-filters-compact';
  Object.assign(state, {budget:0, floor:0, layout:'', sort:'price', sea:false, limit:6});
  for (const id of ['budget','floor','layout']) document.getElementById(id+'-filter').value = '';
  document.getElementById('sort-filter').value = 'price';
  document.getElementById('sea-filter').checked = false;
  renderPlansGrid();
  if (compactFocused) document.getElementById('toggle-filters').focus({preventScroll:true});
}
function renderPlansGrid(){
  renderFilterDisclosure();
  const list=currentFilteredPlans();
  document.getElementById('plans-grid').innerHTML=list.slice(0,state.limit).map(p=>ContentModel.card(p,state.planViews[p.id]||p.plans[0].type)).join('')||'<div class="empty-catalog">По этим условиям предложений нет. Измените фильтры или сбросьте их.</div>';
  document.getElementById('catalog-result').textContent=`Найдено: ${list.length} · показано: ${Math.min(state.limit,list.length)}`;
  document.getElementById('show-more-plans').hidden=list.length<=state.limit;
}
function planViewLabel(p){return ContentModel.views[state.planViews[p.id]||p.plans[0].type];}
function askPlan(plan){
  state.snapshot={kind:'plan',kicker:'Ваш запрос',planChoice:plan.category,lotId:plan.id,lotPrice:plan.price,planView:state.planViews[plan.id]||plan.plans[0].type,sourceUrl:plan.source_url,snapshotDate:plan.snapshot_date,objectTitle:plan.title,objectMeta:plan.area_m2.toLocaleString('ru-RU')+' м² · '+plan.floor+' этаж · ID '+plan.id+' · '+rub(plan.price)+' · '+planViewLabel(plan),rows:[]};
  state.planChoice=plan.category;updateForm();scrollToForm();
}
function calcHere(plan){state.selectedPlanId=plan.id;state.price=plan.price;state.selectedPlanView=state.planViews[plan.id]||plan.plans[0].type;document.getElementById('price-range').value=plan.price;updateAutomaticDownPayment();renderCalculator();scrollToEl('calculator',80);}
function wirePlansEvents(){
  // These progressive-enhancement links act as buttons once the catalog is live.
  document.getElementById('plans-grid').addEventListener('keydown',e=>{
    const variant=e.target.closest('[data-plan-view]');
    if(variant&&e.key===' '){e.preventDefault();variant.click();}
  });
  document.getElementById('plan-tabs').addEventListener('click',e=>{const tab=e.target.closest('[data-tab]');if(!tab)return;state.filter=tab.dataset.tab;state.layout='';state.limit=6;renderTabs();renderPlansGrid();});
  document.getElementById('plans-grid').addEventListener('click',e=>{
    const variant=e.target.closest('[data-plan-view]');
    if(variant){e.preventDefault();const id=variant.dataset.id;state.planViews[id]=variant.dataset.planView;const card=variant.closest('[data-lot-id]'),plan=PLANS.find(p=>p.id===id),asset=plan.plans.find(p=>p.type===variant.dataset.planView);card.querySelector('img').src=ContentModel.previewPath(asset);card.querySelector('img').alt=plan.title+' — '+planViewLabel(plan);card.querySelector('.plan-thumb').href=asset.local_path;card.querySelectorAll('[data-plan-view]').forEach(b=>b.setAttribute('aria-pressed',String(b===variant)));return;}
    const el=e.target.closest('[data-action]');if(!el)return;const plan=PLANS.find(p=>p.id===el.dataset.id);if(!plan)return;e.preventDefault();
    if(el.dataset.action==='open-plan-image')openLightbox('plan',plan.plans.findIndex(a=>a.type===(state.planViews[plan.id]||plan.plans[0].type)),plan.id);
    else if(el.dataset.action==='ask-plan')askPlan(plan);else if(el.dataset.action==='calc-here')calcHere(plan);
  });
  for(const [id,key] of [['budget','budget'],['floor','floor'],['layout','layout'],['sort','sort'],['sea','sea']])document.getElementById(id+'-filter').addEventListener('change',e=>{state[key]=key==='sea'?e.target.checked:['budget','floor'].includes(key)?Number(e.target.value):e.target.value;state.limit=6;renderPlansGrid();});
  for (const id of ['reset-filters','reset-filters-compact']) document.getElementById(id).addEventListener('click', resetCatalogFilters);
  document.getElementById('toggle-filters').addEventListener('click', () => {
    state.filtersOpen = !state.filtersOpen; renderFilterDisclosure();
  });
  document.getElementById('catalog-controls').addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault(); state.filtersOpen = false; renderFilterDisclosure();
      document.getElementById('toggle-filters').focus({preventScroll:true});
    }
  });
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
const lb={mode:null,index:null,opener:null,lotId:null,month:null,zoom:1,x:0,y:0,items:[],pointers:new Map(),gesture:null,settling:false,queued:0};
function lightboxItems(){
  if(lb.mode==='plan'){
    const p=PLANS.find(p=>p.id===lb.lotId);
    return p.plans.map(a=>({src:a.local_path,preview:ContentModel.previewPath(a),title:p.title+' · '+ContentModel.views[a.type],type:a.type,caption:p.meta+' · '+rub(p.price)+' · мебель приобретается отдельно'}));
  }
  const items=lb.mode==='gallery'?GALLERY:SITE_DATA.media.construction.find(m=>m.month===lb.month).images;
  return items.map(m=>({...m,preview:m.src,src:m.variants.at(-1).src,caption:lb.mode==='gallery'?'Визуализация застройщика':'Фото строительства'}));
}
function lightboxCount(){return lb.items.length;}
function lightboxTrack(offset=0){
  document.getElementById('lightbox-track').style.transform=`translate3d(calc(-100% + ${offset}px),0,0)`;
}
function resetLightboxGesture(){
  const image=document.getElementById('lightbox-image');
  // Clear state before releasing capture: lostpointercapture can be synchronous.
  const ids=[...lb.pointers.keys()];lb.pointers.clear();lb.gesture=null;
  ids.forEach(id=>{if(image.hasPointerCapture(id))image.releasePointerCapture(id);});
  image.classList.remove('is-dragging');
}
function cancelLightboxMotion(){
  lb.queued=0;
  lb.finish?.();
  resetLightboxGesture();
  lightboxTrack();
}
function openLightbox(mode,index,id){
  lb.opener=document.activeElement;lb.mode=mode;lb.index=index;lb.lotId=mode==='plan'?id:null;lb.month=mode==='construction'?id:null;
  lb.items=lightboxItems();lb.queued=0;
  const overlay=document.getElementById('lightbox');overlay.hidden=false;overlay.classList.add('open');
  lb.background=[...document.body.children].filter(el=>el!==overlay&&el.tagName!=='SCRIPT').map(el=>[el,el.inert]);lb.background.forEach(([el])=>el.inert=true);
  lb.overflow=document.body.style.overflow;document.body.style.overflow='hidden';renderLightbox();document.getElementById('lightbox-close').focus();
  if(mode==='plan')document.dispatchEvent(new Event('dom:plan-open'));
}
function closeLightbox(){
  if(lb.index==null)return;
  cancelLightboxMotion();
  const overlay=document.getElementById('lightbox');overlay.classList.remove('open');overlay.hidden=true;
  lb.background?.forEach(([el,inert])=>el.inert=inert);document.body.style.overflow=lb.overflow||'';
  if(lb.opener?.isConnected)lb.opener.focus({preventScroll:true});lb.mode=null;lb.index=null;lb.items=[];
  // Drop decoded full-size neighbours when the viewer is closed.
  document.querySelectorAll('.lightbox-slide').forEach(slide=>{slide.style.backgroundImage='';const img=slide.querySelector('img');img.removeAttribute('src');img.removeAttribute('srcset');});
}
function applyZoom(){
  lb.zoom=Math.max(1,Math.min(4,lb.zoom));
  const box=document.getElementById('lightbox-image').getBoundingClientRect();
  lb.x=Math.max(-box.width*(lb.zoom-1)/2,Math.min(box.width*(lb.zoom-1)/2,lb.x));lb.y=Math.max(-box.height*(lb.zoom-1)/2,Math.min(box.height*(lb.zoom-1)/2,lb.y));
  const image=document.getElementById('lightbox-asset');
  image.style.transform=`translate(${lb.x}px,${lb.y}px) scale(${lb.zoom})`;
  image.parentElement.style.backgroundImage=lb.zoom>1?'none':`url("${lb.items[lb.index].preview}")`;
  document.getElementById('zoom-reset').textContent=Math.round(lb.zoom*100)+'%';document.getElementById('zoom-out').disabled=lb.zoom===1;document.getElementById('zoom-in').disabled=lb.zoom===4;
}
function setLightboxSlide(slide,index,active){
  const item=lb.items[(index+lightboxCount())%lightboxCount()],img=slide.querySelector('img');
  if(active){img.id='lightbox-asset';slide.removeAttribute('aria-hidden');}else{img.removeAttribute('id');slide.setAttribute('aria-hidden','true');}
  img.style.transform='';img.alt=active?item.title:'';
  // The already loaded thumbnail remains visible while the prepared large variant decodes.
  slide.style.backgroundImage=`url("${item.preview}")`;
  if(item.srcset){img.srcset=item.srcset;img.sizes=Math.min(innerWidth,1100)+'px';}else{img.removeAttribute('srcset');img.removeAttribute('sizes');}
  if(img.getAttribute('src')!==item.src)img.src=item.src;
}
function renderLightbox(preserveSlides=false){
  if(lb.index==null)return;
  const items=lb.items,item=items[lb.index],track=document.getElementById('lightbox-track');
  // Clear the former active ID first, including after a slide rotation.
  track.querySelectorAll('[id]').forEach(img=>img.removeAttribute('id'));
  [...track.children].forEach((slide,i)=>{
    if(!preserveSlides||i!==1)setLightboxSlide(slide,lb.index+i-1,i===1);
    else {const img=slide.querySelector('img');img.id='lightbox-asset';img.alt=item.title;img.style.transform='';slide.removeAttribute('aria-hidden');}
  });
  lightboxTrack();
  document.getElementById('lightbox-title-text').textContent=item.title;document.getElementById('lightbox-position').textContent=(lb.index+1)+' из '+items.length;
  document.getElementById('lightbox-caption').textContent=item.caption;
  document.getElementById('lightbox').dataset.mode=lb.mode;
  document.getElementById('lightbox-calc').hidden=lb.mode!=='plan';
  for(const id of ['lightbox-prev','lightbox-next'])document.getElementById(id).disabled=items.length<2;
  const variants=document.getElementById('lightbox-variants');variants.hidden=lb.mode!=='plan';
  if(lb.mode==='plan'){
    if(variants.children.length!==items.length)variants.innerHTML=items.map((m,i)=>`<button type="button" data-lb-view="${i}">${ContentModel.views[m.type]}</button>`).join('');
    [...variants.children].forEach((b,i)=>b.setAttribute('aria-pressed',String(i===lb.index)));
    state.planViews[lb.lotId]=item.type;
    const card=document.querySelector(`[data-lot-id="${lb.lotId}"]`);
    if(card){card.querySelector('img').src=item.preview;card.querySelector('img').alt=item.title;card.querySelector('.plan-thumb').href=item.src;card.querySelectorAll('[data-plan-view]').forEach(v=>v.setAttribute('aria-pressed',String(v.dataset.planView===item.type)));}
  }else variants.replaceChildren();
  lb.zoom=1;lb.x=lb.y=0;applyZoom();
}
function settleLightbox(dir=0){
  const track=document.getElementById('lightbox-track'),width=document.getElementById('lightbox-image').clientWidth;
  lb.settling=true;
  const finish=()=>{
    if(lb.finish!==finish)return;
    clearTimeout(lb.timer);track.removeEventListener('transitionend',ended);track.classList.remove('is-settling');
    lb.finish=null;lb.settling=false;
    if(dir){
      // Rotate the decoded DOM node into the centre; never replace a visible frame.
      if(dir>0)track.append(track.firstElementChild);else track.prepend(track.lastElementChild);
      lb.index=(lb.index+dir+lightboxCount())%lightboxCount();renderLightbox(true);
    }else lightboxTrack();
    const next=Math.sign(lb.queued);lb.queued-=next;
    if(next)lightboxNav(next);
  };
  const ended=e=>{if(e.target===track&&e.propertyName==='transform')finish();};
  lb.finish=finish;
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){finish();return;}
  // Commit the dragged position before adding the settling transition.
  void track.offsetWidth;track.classList.add('is-settling');
  track.addEventListener('transitionend',ended);
  lightboxTrack(-dir*width);
  lb.timer=setTimeout(finish,340);
}
function lightboxNav(dir){
  if(lb.index==null||lightboxCount()<2)return;
  if(lb.settling){lb.queued=Math.max(-3,Math.min(3,lb.queued+dir));return;}
  resetLightboxGesture();lb.zoom=1;lb.x=lb.y=0;applyZoom();settleLightbox(dir);
}
function wireLightboxEvents(){
  const overlay=document.getElementById('lightbox'),inner=document.getElementById('lightbox-inner'),image=document.getElementById('lightbox-image');
  document.getElementById('lightbox-calc').addEventListener('click',()=>{const id=lb.lotId;closeLightbox();calcHere(PLANS.find(p=>p.id===id));});
  overlay.addEventListener('click',closeLightbox);inner.addEventListener('click',e=>e.stopPropagation());document.getElementById('lightbox-close').addEventListener('click',closeLightbox);
  document.getElementById('lightbox-prev').addEventListener('click',()=>lightboxNav(-1));document.getElementById('lightbox-next').addEventListener('click',()=>lightboxNav(1));
  document.getElementById('lightbox-variants').addEventListener('click',e=>{const b=e.target.closest('[data-lb-view]');if(b){cancelLightboxMotion();lb.index=Number(b.dataset.lbView);renderLightbox();b.focus();}});
  for(const [id,change] of [['zoom-in',.5],['zoom-out',-.5],['zoom-reset',0]])document.getElementById(id).addEventListener('click',()=>{cancelLightboxMotion();lb.zoom=change?lb.zoom+change:1;applyZoom();});
  image.addEventListener('dblclick',()=>{if(performance.now()<(lb.suppressDoubleClickUntil||0))return;cancelLightboxMotion();lb.zoom=lb.zoom===1?2:1;applyZoom();});
  document.addEventListener('keydown',e=>{
    if(lb.index==null)return;
    if(e.key==='Escape'){e.preventDefault();closeLightbox();return;}
    if(e.key==='Tab'){const controls=[...overlay.querySelectorAll('button,a[href]')].filter(b=>!b.disabled&&b.getClientRects().length);const i=controls.indexOf(document.activeElement);e.preventDefault();controls[(i+(e.shiftKey?-1:1)+controls.length)%controls.length].focus();}
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','0'].includes(e.key))e.preventDefault();
    if(e.key==='+'||e.key==='='||e.key==='-'||e.key==='0'){cancelLightboxMotion();lb.zoom=e.key==='0'?1:lb.zoom+(e.key==='-'?-.5:.5);applyZoom();}
    else if(lb.zoom>1){if(e.key==='ArrowLeft')lb.x+=50;if(e.key==='ArrowRight')lb.x-=50;if(e.key==='ArrowUp')lb.y+=50;if(e.key==='ArrowDown')lb.y-=50;applyZoom();}
    else if(e.key==='ArrowLeft')lightboxNav(-1);else if(e.key==='ArrowRight')lightboxNav(1);
  });
  const points=()=>[...lb.pointers.values()];
  const midpoint=([a,b])=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  const distance=([a,b])=>Math.hypot(a.x-b.x,a.y-b.y);
  function startGesture(blockSwipe=false){
    const ps=points();
    if(ps.length>1){
      const mid=midpoint(ps),rect=image.getBoundingClientRect();
      lightboxTrack();
      lb.gesture={kind:'pinch',distance:Math.max(1,distance(ps)),zoom:lb.zoom,panX:lb.x,panY:lb.y,mid,center:{x:rect.left+rect.width/2,y:rect.top+rect.height/2},blockSwipe:true};
    }else if(ps.length){
      const p=ps[0];lb.gesture={kind:lb.zoom>1||blockSwipe?'pan':'pending',x:p.x,y:p.y,panX:lb.x,panY:lb.y,dx:0,dy:0,samples:[{x:p.x,t:performance.now()}],blockSwipe};
    }else lb.gesture=null;
  }
  image.addEventListener('pointerdown',e=>{
    if(e.button!==0||lb.index==null)return;
    lb.queued=0;lb.finish?.();
    lb.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});image.setPointerCapture(e.pointerId);startGesture();
  });
  image.addEventListener('pointermove',e=>{
    if(!lb.pointers.has(e.pointerId)||!lb.gesture)return;
    lb.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    const g=lb.gesture,ps=points();
    if(ps.length>1){
      const mid=midpoint(ps);lb.zoom=Math.max(1,Math.min(4,g.zoom*distance(ps)/g.distance));
      const ratio=lb.zoom/g.zoom;
      lb.x=(g.panX-(g.mid.x-g.center.x))*ratio+mid.x-g.center.x;
      lb.y=(g.panY-(g.mid.y-g.center.y))*ratio+mid.y-g.center.y;applyZoom();
    }else{
      g.dx=e.clientX-g.x;g.dy=e.clientY-g.y;
      if(g.kind==='pending'&&Math.hypot(g.dx,g.dy)>6)g.kind=Math.abs(g.dx)>Math.abs(g.dy)*1.1?'swipe':'vertical';
      if(g.kind==='pan'){lb.x=g.panX+g.dx;lb.y=g.panY+g.dy;applyZoom();}
      else if(g.kind==='swipe'){
        // One frame at most; the adjacent frame always occupies the revealed area.
        lightboxTrack(Math.max(-image.clientWidth,Math.min(image.clientWidth,g.dx)));
        const t=performance.now();g.samples.push({x:e.clientX,t});g.samples=g.samples.filter(s=>s.t>=t-100);
      }
      if(Math.hypot(g.dx,g.dy)>6)image.classList.add('is-dragging');
    }
  });
  function endPointer(e,cancelled=false){
    if(!lb.pointers.has(e.pointerId))return;
    const g=lb.gesture;
    lb.pointers.delete(e.pointerId);
    if(image.hasPointerCapture(e.pointerId))image.releasePointerCapture(e.pointerId);
    image.classList.remove('is-dragging');
    if(cancelled){resetLightboxGesture();if(lb.index!=null)settleLightbox();return;}
    if(lb.pointers.size){startGesture(true);return;}
    lb.gesture=null;
    if(!g)return;
    if(g.kind!=='pending')lb.suppressDoubleClickUntil=performance.now()+350;
    if(g.kind==='swipe'){
      const dx=e.clientX-g.x,dy=e.clientY-g.y,last=g.samples[0],velocity=last?(e.clientX-last.x)/Math.max(1,performance.now()-last.t):0;
      const enough=Math.abs(dx)>image.clientWidth*.22||Math.abs(dx)>24&&Math.abs(velocity)>.45&&Math.sign(velocity)===Math.sign(dx);
      settleLightbox(enough&&Math.abs(dx)>Math.abs(dy)*1.1?(dx<0?1:-1):0);
    }else if(g.kind==='vertical'&&Math.abs(g.dy)>120&&Math.abs(g.dy)>Math.abs(g.dx)*1.2&&!g.blockSwipe)closeLightbox();
  }
  image.addEventListener('pointerup',e=>endPointer(e));
  image.addEventListener('pointercancel',e=>endPointer(e,true));
  image.addEventListener('lostpointercapture',e=>{if(lb.pointers.has(e.pointerId))endPointer(e,true);});
  let resizeFrame;
  window.addEventListener('resize',()=>{if(lb.index==null)return;cancelLightboxMotion();cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{if(lb.index!=null){document.querySelectorAll('.lightbox-slide img[srcset]').forEach(img=>img.sizes=Math.min(innerWidth,1100)+'px');applyZoom();}});});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&lb.index!=null)cancelLightboxMotion();});
}


/* ================= calculator ================= */
// Presets reflect the published site content, not a bank eligibility decision.
const MORTGAGE_PROGRAMS = ContentModel.mortgagePrograms;
function updateAutomaticDownPayment(){
  if(state.downMode!=='auto')return;
  const range=document.getElementById('down-range');
  state.downPct=ContentModel.minimumDownPayment(state.price,MORTGAGE_PROGRAMS[state.mortgageProgram],{min:ContentModel.downRange.min,max:Number(range.max),step:Number(range.step)}).value;
}
function mortgageContext(){
  const program = MORTGAGE_PROGRAMS[state.mortgageProgram];
  const range=document.getElementById('down-range');
  const impossible=program&&!ContentModel.minimumDownPayment(state.price,program,{min:ContentModel.downRange.min,max:Number(range.max),step:Number(range.step)}).feasible;
  const warning = program && calcNumbers().loanAmount > program.limit
    ? `Сумма кредита превышает лимит программы ${rub(program.limit)}. Расчёт по ставке ${program.rate}% не означает её доступность на всю сумму. Комбинированная ипотека не моделируется; условия уточнит банк.${impossible?` Даже при взносе ${range.max}% кредит не укладывается в лимит программы.`:""}` : '';
  return {program, title:program ? program.title : 'Индивидуальная ставка', warning};
}
function selectMortgageProgram(key){
  const program = MORTGAGE_PROGRAMS[key];
  state.mortgageProgram = key;
  state.rate = program.rate;
  state.downAdjustment='';
  if(state.downMode==='auto')updateAutomaticDownPayment();
  else if(state.downPct<program.minDown){
    state.downPct=program.minDown;
    state.downAdjustment=`Взнос повышен до ${program.minDown}% — минимум выбранной программы.`;
  }
  renderCalculator();
  scrollToEl('calculator', 80);
  document.getElementById('mortgage-program').focus({preventScroll:true});
}
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
  const {program, title, warning} = mortgageContext();
  document.getElementById('mortgage-program').textContent = title + (program ? ` · взнос от ${program.minDown}% · лимит ${rub(program.limit)}` : ' · расчёт на всю сумму');
  const warningEl = document.getElementById('mortgage-warning');
  warningEl.textContent = warning; warningEl.hidden = !warning;
  document.getElementById('rate-range').value = s.rate;
  document.getElementById('down-range').min = program ? program.minDown : 10;
  document.getElementById('down-range').value = s.downPct;
  document.getElementById('price-label').textContent = rub(s.price);
  document.getElementById('down-label').textContent = s.downPct + '% · ' + rub(downPayment);
  document.getElementById('down-mode').textContent = s.downAdjustment || (s.downMode==='auto' ? (program ? 'Взнос подобран автоматически по лимиту программы.' : 'Автоматически: минимальный взнос для расчёта.') : 'Ручная настройка: выбранный вами взнос.');
  document.getElementById('down-auto').hidden = s.downMode==='auto';
  document.getElementById('term-label').textContent = s.term + ' лет';
  document.getElementById('rate-label').textContent = s.rate.toFixed(1) + '%';
  document.getElementById('payment-label').textContent = rub(payment) + ' / мес';
  document.getElementById('income-label').textContent = rub(income) + ' / мес';
  document.getElementById('loan-label').textContent = rub(loanAmount);

  const selectedPlan = s.selectedPlanId ? PLANS.find(p => p.id === s.selectedPlanId) : null;
  document.getElementById('calc-thumb').classList.toggle('has-plan', !!selectedPlan);
  document.getElementById('calc-thumb').innerHTML=selectedPlan?`<img src="${ContentModel.previewPath(selectedPlan.plans.find(p=>p.type===s.selectedPlanView))}" alt="${ContentModel.esc(selectedPlan.title)}" width="120" height="100">`:'';
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
  const {title, warning} = mortgageContext();
  state.planChoice = selectedPlan ? selectedPlan.category : (s.planChoice || 'unsure');
  state.snapshot = {
    kind: 'calc', kicker: 'Ваш расчёт', lotId:selectedPlan?.id||null, lotPrice:selectedPlan?.price||null, planView:selectedPlan?s.selectedPlanView:null, sourceUrl:selectedPlan?.source_url||null, snapshotDate:selectedPlan?.snapshot_date||SITE_DATA.snapshot_date,
    calculation: {price:s.price, downPct:s.downPct, term:s.term, rate:s.rate, program:s.mortgageProgram},
    planTitle: selectedPlan ? selectedPlan.title : '',
    objectTitle: selectedPlan ? selectedPlan.title : 'Произвольный расчёт',
    objectMeta: selectedPlan ? selectedPlan.meta + ' · '+ContentModel.views[s.selectedPlanView]+' · данные '+ContentModel.displayDate(selectedPlan.snapshot_date) : 'Планировка не выбрана — расчёт по указанной стоимости',
    rows: [
      { k: 'Программа', v: title },
      { k: 'Стоимость', v: rub(s.price) },
      { k: 'Первый взнос', v: s.downPct + '% · ' + rub(downPayment) },
      { k: 'Срок / ставка', v: s.term + ' лет · ' + s.rate.toFixed(1) + '%' },
      { k: 'Платёж', v: rub(payment) + ' / мес' },
      ...(warning ? [{k:'Ограничение', v:warning}] : []),
    ],
  };
  updateForm();
  scrollToForm();
}
async function downloadCalc(){
  if (state.pdfBusy) return;
  if (SITE_DATA.catalog_version) {
    const status = document.getElementById('pdf-status');
    try {
      const response = await fetch('/', {method:'HEAD',cache:'no-store',signal:AbortSignal.timeout(5000)});
      const selected = PLANS.find(lot => lot.id === state.selectedPlanId);
      if ((selected && selected.developer_availability !== 'InStock') || !response.ok
          || response.headers.get('X-Dom-Catalog-Snapshot') !== SITE_DATA.catalog_version
          || response.headers.get('X-Dom-Catalog-Status') !== 'confirmed') throw Error('Catalog changed');
    } catch {
      status.hidden = false;
      status.textContent = 'Обновите страницу и проверьте актуальность цен перед скачиванием расчёта.';
      return;
    }
  }
  if (state.pdfBusy) return;
  const s = state;
  const selectedPlan = s.selectedPlanId ? PLANS.find(p => p.id === s.selectedPlanId) : null;
  const { downPayment, loanAmount, payment, income } = calcNumbers();
  const d = {
    date: new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }),
    program: mortgageContext().title, warning: mortgageContext().warning,
    custom: !selectedPlan, lotId:selectedPlan?.id||null, sourceUrl:selectedPlan?.source_url||null,
    objectTitle: selectedPlan ? selectedPlan.title : 'Произвольный расчёт',
    objectMeta: selectedPlan ? selectedPlan.meta + ' · ' + ContentModel.views[s.selectedPlanView] + ' · данные '+ContentModel.displayDate(selectedPlan.snapshot_date) : 'Планировка не выбрана — расчёт по указанной стоимости',
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
    state.price = Number(e.target.value); state.selectedPlanId = null; updateAutomaticDownPayment(); renderCalculator();
  });
  document.getElementById('down-range').addEventListener('input', e => {
    state.downPct = Number(e.target.value); state.downMode='manual'; state.downAdjustment=''; renderCalculator();
  });
  document.getElementById('down-auto').addEventListener('click', () => {
    state.downMode='auto'; state.downAdjustment=''; updateAutomaticDownPayment(); renderCalculator();
    document.getElementById('down-range').focus({preventScroll:true});
  });
  document.getElementById('term-range').addEventListener('input', e => {
    state.term = Number(e.target.value); renderCalculator();
  });
  document.getElementById('rate-range').addEventListener('input', e => {
    state.rate = Number(e.target.value); state.mortgageProgram = null; updateAutomaticDownPayment(); renderCalculator();
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
  document.querySelectorAll('[data-mortgage-program]').forEach(link => link.addEventListener('click', e => {
    e.preventDefault(); selectMortgageProgram(link.dataset.mortgageProgram);
  }));
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
    bodyHtml = `<input class="field-input" id="email-input" aria-label="E-mail" aria-describedby="email-error" type="email" maxlength="254" autocomplete="email" name="email" placeholder="пришлём подборку и прайс">
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
  const nameOk = !!s.name.trim() && s.name.trim().length <= 80 && !/[\p{C}<>]/u.test(s.name);
  const formReady = !!(nameOk && phoneOk && s.consent && !emailBad);

  const nameErr = !!s.blurred.name && !nameOk;
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
  btn.disabled = !formReady || !s.formEnabled || s.formBusy;
  btn.textContent = s.formBusy ? 'Отправляем…' : 'Отправить заявку';
  document.getElementById('request-form').setAttribute('aria-busy', String(s.formBusy));

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
async function handleSubmit(){
  if (state.formBusy) return;
  const phoneOk = /^\+7 \(\d{3}\) \d{3}-\d{2}-\d{2}$/.test(state.phone);
  const emailBad = !!state.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(state.email);
  const formReady = !!(state.name.trim() && state.name.trim().length <= 80 && !/[\p{C}<>]/u.test(state.name) && phoneOk && state.consent && !emailBad);
  if (!formReady) {
    state.blurred = { name: true, phone: true, email: true, consent: true };
    updateForm();
    document.querySelector('#request-form [aria-invalid="true"]')?.focus();
    return;
  }
  const status = document.getElementById('form-status');
  status.hidden = false;
  if (!state.formEnabled) {
    status.textContent = 'Приём заявок через форму временно выключен. Данные не отправлены. Позвоните +7 (952) 956-88-75 или напишите info@anyara.ru.';
    status.focus();
    return;
  }
  const payload = {name:state.name.trim(), phone:'+' + state.phone.replace(/\D/g, ''), consent:true,
    consentVersion:'2026-10-31', lotId:state.snapshot?.lotId || '', category:state.planChoice || '',
    requestKind:state.snapshot?.kind || 'general', planView:state.snapshot?.planView || '',
    email:state.email.trim(), channel:state.channel, callTime:state.callTime,
    website:document.getElementById('website-input').value};
  if (state.snapshot?.lotId) payload.lotPrice = state.snapshot.lotPrice;
  if (state.snapshot?.calculation) payload.calculation = state.snapshot.calculation;
  const serialized = JSON.stringify(payload);
  // Retain only in this tab; retry after a lost response uses exactly the same key.
  if (!state.formAttempt || state.formAttempt.payload !== serialized) state.formAttempt = {payload:serialized,key:crypto.randomUUID()};
  const attempt = state.formAttempt;
  state.formBusy = true;
  updateForm();
  status.textContent = 'Передаём запрос на обработку…';
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), 12000);
  let failureMessage = 'Ответ сервера не подтвердил приём. Позвоните или напишите агентству.';
  try {
    const response = await fetch('api/lead.php', {method:'POST', credentials:'same-origin', cache:'no-store',
      headers:{'Content-Type':'application/json','X-Lead-Request':'1','Idempotency-Key':attempt.key},
      body:attempt.payload, signal:controller.signal});
    const result = await response.json();
    if (response.status !== 202 || result.ok !== true || !/^\d{8}-[a-f0-9]{16}$/.test(result.id)) {
      const messages = {422:'Проверьте имя, телефон, выбранную квартиру и отдельное согласие.',
        429:'Слишком много попыток. Попробуйте через 10 минут или позвоните агентству.',
        409:'Повторная отправка остановлена. Уточните приём запроса по телефону агентства.',
        503:'Приём через форму временно недоступен. Позвоните или напишите агентству.'};
      failureMessage = {
        catalog_price_changed: 'Цена или наличие квартиры изменились. Обновите страницу и проверьте предложение перед отправкой.',
        catalog_unconfirmed: 'Актуальность предложения пока уточняется. Свяжитесь с агентством для проверки.',
      }[result.error] || messages[response.status] || 'Запрос не принят. Позвоните или напишите агентству.';
      throw new Error('rejected');
    }
    status.textContent = 'Запрос принят на обработку. Номер: ' + result.id + '. Агентство свяжется с вами по указанным контактам.';
    if(!attempt.analyticsEmitted){attempt.analyticsEmitted=true;document.dispatchEvent(new Event('dom:lead-accepted'));}
    state.consent = false;
    state.blurred.consent = false; // The post-success reset must not show a new consent error.
    document.getElementById('consent-input').checked = false;
  } catch (error) {
    status.textContent = error.name === 'AbortError' || error instanceof TypeError
      ? 'Не удалось подтвердить приём. Повторите без изменения полей или позвоните агентству.'
      : failureMessage;
  } finally {
    clearTimeout(timer);
    state.formBusy = false;
    updateForm();
    status.focus();
  }
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
  // Static Mac preview stays local and makes no requests to a production backend.
  const local = ['127.0.0.1','localhost'].includes(location.hostname);
  if (local && !new URLSearchParams(location.search).has('form-qa')) return;
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), 5000);
  fetch('api/form-status.php', {cache:'no-store', credentials:'same-origin', signal:controller.signal})
    .then(r=>r.ok ? r.json() : null).then(result=>{
      state.formEnabled = result?.enabled === true && result.consentVersion === '2026-10-31';
      // Keep the disabled/no-JS fallback, but no redundant explanation on an active form.
      document.getElementById('form-availability').hidden = state.formEnabled;
      updateForm();
    }).catch(()=>{}).finally(()=>clearTimeout(timer));
}

/* ================= init ================= */
function init(){
  document.documentElement.classList.add('content-ready');
  setupAbout();
  renderTabs(); renderPlansGrid(); wirePlansEvents();  setupMap();
  renderGallery(); wireGalleryEvents();
  document.querySelectorAll('.faq-questions details').forEach(d=>{
    const summary=d.querySelector('summary');
    const sync=()=>summary.setAttribute('aria-expanded',String(d.open));
    sync();d.addEventListener('toggle',()=>{if(d.open)document.querySelectorAll('.faq-questions details').forEach(other=>{if(other!==d)other.open=false;});sync();});
  });
  wireCalculatorEvents(); renderCalculator();
  renderContactArea();
  wireHeaderEvents(); applyMenuState();
  setupHomeLinks();
  wireLightboxEvents();
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

// Canonical links keep native new-tab/download/modifier behaviour.
function setupHomeLinks(){
  document.querySelectorAll('.logo-link[href="/"], .footer-brand[href="/"]').forEach(link => {
    link.addEventListener('click', event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.hasAttribute('download') || (link.target && link.target !== '_self') || location.pathname !== '/') return;
      event.preventDefault();
      if (location.hash) history.replaceState(history.state, '', location.pathname + location.search);
      state.menuOpen = false;
      applyMenuState();
      document.getElementById('main-content').focus({preventScroll:true});
      window.scrollTo({top:0, behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
    });
  });
}

function setupMap(){
  const container = document.getElementById('map-container');
  const template = document.getElementById('location-map-template');
  const button = document.getElementById('map-unlock');
  let frame;
  const load = () => {
    if (!frame) {
      frame = template.content.firstElementChild.cloneNode(true);
      container.prepend(frame);
      frame.addEventListener('blur', lock);
    }
    return frame;
  };
  const lock = () => {
    if (frame) { frame.style.pointerEvents = 'none'; frame.tabIndex = -1; }
    button.hidden = false;
  };
  button.addEventListener('click', () => {
    const map = load();
    map.style.pointerEvents = 'auto'; map.tabIndex = 0;
    button.hidden = true; map.focus();
  });
  container.addEventListener('mouseleave', lock);
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { load(); observer.disconnect(); }
    }, {rootMargin:'200px 0px'});
    observer.observe(container);
  } else load();
}

if (SITE_DATA.catalog_version) addEventListener('pageshow', event => {
  if (event.persisted) location.reload();
});
