"use strict";

/* ---------- static data ---------- */
const PLANS = [
  {id:'s1',category:'studio',title:'Студия А',meta:'32 м² · окна на юг',price:3900000},
  {id:'s2',category:'studio',title:'Студия B',meta:'36 м² · угловые окна',price:4250000},
  {id:'s3',category:'studio',title:'Студия C',meta:'29 м² · компактная',price:3550000},
  {id:'o1',category:'1k',title:'1-комнатная А',meta:'44 м² · спальня + гостиная-кухня',price:5400000},
  {id:'o2',category:'1k',title:'1-комнатная B',meta:'48 м² · с балконом вдоль фасада',price:5800000},
  {id:'o3',category:'1k',title:'1-комнатная C',meta:'41 м² · евроформат',price:5050000},
  {id:'t1',category:'2k',title:'2-комнатная А',meta:'62 м² · окна на две стороны',price:7300000},
  {id:'t2',category:'2k',title:'2-комнатная B',meta:'68 м² · с угловой террасой',price:7950000},
  {id:'t3',category:'2k',title:'2-комнатная C',meta:'58 м² · компактная семейная',price:6900000},
  {id:'r1',category:'3k',title:'3-комнатная А',meta:'86 м² · с гардеробной',price:10400000},
  {id:'r2',category:'3k',title:'3-комнатная B — пентхаус',meta:'104 м² · терраса 22 м², верхний этаж',price:13900000},
  {id:'r3',category:'3k',title:'3-комнатная C',meta:'79 м² · семейная, вид на двор',price:9700000},
];
const TABS = [
  {key:'studio',label:'Студии'},
  {key:'1k',label:'1-комнатные'},
  {key:'2k',label:'2-комнатные'},
  {key:'3k',label:'3-комнатные'},
];
const ICONS = {
  calc: 'M7.5 3h9a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1M9.5 7.5h5M9.5 12h1.5M9.5 16h1.5M14 12v4.5',
  plan: 'M4 4h16v16H4zM4 14h8M12 4v16',
  installment: 'M4 6.5h16v13.5H4zM4 10.5h16M8.5 3.5v4M15.5 3.5v4',
  full: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M8.5 12l2.5 2.5 4.5-5',
};
const CAT_LABEL = {studio:'Студия','1k':'1-комнатная','2k':'2-комнатная','3k':'3-комнатная / пентхаус'};
const GALLERY = [
  'фасад — вид с набережной','фасад — вид со двора','двор — терраса и амфитеатр',
  'холл первого этажа','детская зона','вид из окна на залив'
];
const FIELD_LABELS = {
  plan: ['Интересующая планировка', 'интересующую планировку'],
  email: ['E-mail', 'e-mail для подборки'],
  channel: ['Как удобнее связаться', 'способ связи'],
  time: ['Удобное время звонка', 'удобное время звонка'],
};
const FIELD_RESETS = { plan: { planChoice: '' }, email: { email: '' }, channel: { channel: 'Звонок' }, time: { callTime: '' } };
const CHANNELS = ['Звонок', 'MAX', 'Telegram'];
const CALL_TIMES = [['', 'Любое время'], ['9-12', '9:00–12:00'], ['12-15', '12:00–15:00'], ['15-18', '15:00–18:00'], ['18-20', '18:00–20:00']];
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
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Newsreader:wght@400;500&family=Sora:wght@400;500;600&display=swap" rel="stylesheet">
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
<p class="sub">Расчёт по программе застройщика ЖК «Дом у моря». Точную ставку и решение банк выдаёт индивидуально.</p>
<div class="kick">${d.custom ? 'Произвольный расчёт' : 'Выбранная планировка'}</div>
<div class="obj"><div class="t">${d.objectTitle}</div><div class="m">${d.objectMeta}</div></div>
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
<div><b>Отдел продаж</b>+7 (900) 123-45-67<br>sales@dom-u-morya.ru</div>
<div><b>Офис продаж</b>Набережная ул., 14, шоурум ЖК<br>Ежедневно, 9:00–20:00</div>
<div><b>ЖК «Дом у моря»</b>Проектная декларация — наш.дом.рф<br>© 2026</div>
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
    loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'),
    loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'),
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
    const tab = window.open(url, '_blank');
    if (!tab) {
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } finally {
    frame.remove();
  }
}

/* ---------- app state ---------- */
const state = {
  filter: 'studio',
  price: 7300000, downPct: 20, term: 20, rate: 6.5,
  selectedPlanId: null,
  snapshot: null,
  name: '', phone: '', email: '', planChoice: '', consent: false,
  channel: 'Звонок', callTime: '',
  opts: [],
  blurred: {},
  submitted: false,
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
  header.classList.toggle('header-hidden', !!state.headerHidden);

  const heroPhoto = document.getElementById('hero-photo');
  if (heroPhoto) heroPhoto.style.transform = 'translateY(' + Math.min(6, y * 0.05).toFixed(1) + 'px)';

  const scrollBtn = document.getElementById('scroll-top-btn');
  scrollBtn.classList.toggle('visible', state.scrolled);
  scrollBtn.classList.toggle('no-cookie-banner', !!state.cookieChoice);
}

function applyMenuState(){
  document.getElementById('mobile-menu').classList.toggle('open', state.menuOpen);
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
  window.addEventListener('scroll', onScroll, { passive: true });
}

function setupRevealObserver(){
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
}
function wireCookieBanner(){
  try {
    const saved = localStorage.getItem('domUMorya_cookieChoice');
    if (saved) state.cookieChoice = saved;
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
function currentFilteredPlans(){ return PLANS.filter(p => p.category === state.filter); }

function renderTabs(){
  document.getElementById('plan-tabs').innerHTML = TABS.map(t =>
    `<div class="tab-chip${state.filter === t.key ? ' active' : ''}" data-tab="${t.key}">${t.label}</div>`
  ).join('');
}
function renderPlansGrid(){
  const list = currentFilteredPlans();
  document.getElementById('plans-grid').innerHTML = list.map((p, i) => `
    <div class="card card-hover">
      <div class="plan-thumb" data-action="open-plan-image" data-index="${i}">
        <svg width="30" height="30" viewBox="0 0 30 30" fill="none" style="opacity:.35"><rect x="3" y="3" width="24" height="24" rx="2" stroke="#5A6068" stroke-width="1.6"></rect><path d="M3 21L10 14L15 18L25 8" stroke="#5A6068" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></svg>
        <span class="plan-thumb-label">схема планировки — открыть</span>
      </div>
      <div class="plan-title">${p.title}</div>
      <div class="plan-meta">${p.meta}</div>
      <div class="plan-price">от ${rub(p.price)}</div>
      <div class="plan-links">
        <a href="#contact" data-action="ask-plan" data-id="${p.id}">Запросить планировку →</a>
        <a href="#calculator" class="plan-link-calc link-hover-gold" data-action="calc-here" data-id="${p.id}"><span class="dot"></span>Рассчитать ипотеку →</a>
      </div>
    </div>`).join('');
}
function askPlan(plan){
  state.snapshot = {
    kind: 'plan', kicker: 'Ваш запрос', planChoice: plan.category,
    objectTitle: plan.title, objectMeta: plan.meta + ' · от ' + rub(plan.price),
    rows: [{ k: 'Тип', v: CAT_LABEL[plan.category] }, { k: 'Стоимость', v: 'от ' + rub(plan.price) }],
  };
  state.planChoice = state.snapshot.planChoice || state.planChoice;
  if (!state.submitted) updateForm();
  scrollToForm();
}
function calcHere(plan){
  state.selectedPlanId = plan.id;
  state.price = plan.price;
  document.getElementById('price-range').value = plan.price;
  renderCalculator();
  scrollToEl('calculator', 80);
}
function wirePlansEvents(){
  document.getElementById('plan-tabs').addEventListener('click', e => {
    const tab = e.target.closest('[data-tab]');
    if (!tab) return;
    state.filter = tab.dataset.tab;
    renderTabs(); renderPlansGrid();
  });
  document.getElementById('plans-grid').addEventListener('click', e => {
    const thumb = e.target.closest('[data-action="open-plan-image"]');
    if (thumb) { openLightbox('plan', Number(thumb.dataset.index)); return; }
    const ask = e.target.closest('[data-action="ask-plan"]');
    if (ask) { e.preventDefault(); askPlan(currentFilteredPlans().find(p => p.id === ask.dataset.id)); return; }
    const calc = e.target.closest('[data-action="calc-here"]');
    if (calc) { e.preventDefault(); calcHere(currentFilteredPlans().find(p => p.id === calc.dataset.id)); return; }
  });
}

/* ================= gallery ================= */
function renderGallery(){
  document.getElementById('gallery-grid').innerHTML = GALLERY.map((label, i) => `
    <div class="gallery-item" data-action="open-gallery-image" data-index="${i}">
      <svg width="34" height="34" viewBox="0 0 34 34" fill="none" style="opacity:.3"><rect x="4" y="7" width="26" height="20" rx="2" stroke="#5A6068" stroke-width="1.6"></rect><circle cx="12" cy="14" r="2.5" stroke="#5A6068" stroke-width="1.6"></circle><path d="M4 24L12 17L18 21L30 11" stroke="#5A6068" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></svg>
      <span class="gallery-item-label">${label}</span>
    </div>`).join('');
}
function wireGalleryEvents(){
  document.getElementById('gallery-grid').addEventListener('click', e => {
    const item = e.target.closest('[data-action="open-gallery-image"]');
    if (item) openLightbox('gallery', Number(item.dataset.index));
  });
}

/* ================= lightbox (shared: plans + gallery) ================= */
const lb = { mode: null, index: null };
function lightboxCount(){ return lb.mode === 'plan' ? currentFilteredPlans().length : GALLERY.length; }
function lightboxTitle(i){ return lb.mode === 'plan' ? currentFilteredPlans()[i].title : GALLERY[i]; }
function openLightbox(mode, index){
  lb.mode = mode; lb.index = index;
  renderLightbox();
  document.getElementById('lightbox').classList.add('open');
}
function closeLightbox(){
  document.getElementById('lightbox').classList.remove('open');
  lb.mode = null; lb.index = null;
}
function renderLightbox(){
  if (lb.index == null) return;
  const count = lightboxCount();
  document.getElementById('lightbox-title-text').textContent = lightboxTitle(lb.index);
  document.getElementById('lightbox-position').textContent = (lb.index + 1) + ' из ' + count;
  document.getElementById('lightbox-image').style.transform = 'translate(0,0)';
}
function lightboxNav(dir){
  const count = lightboxCount();
  lb.index = ((lb.index + dir) % count + count) % count;
  renderLightbox();
}
function wireLightboxEvents(){
  const overlay = document.getElementById('lightbox');
  const inner = document.getElementById('lightbox-inner');
  const image = document.getElementById('lightbox-image');
  overlay.addEventListener('click', closeLightbox);
  inner.addEventListener('click', e => e.stopPropagation());
  document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
  document.getElementById('lightbox-prev').addEventListener('click', () => lightboxNav(-1));
  document.getElementById('lightbox-next').addEventListener('click', () => lightboxNav(1));

  document.addEventListener('keydown', e => {
    if (lb.index == null) return;
    if (e.key === 'Escape') { closeLightbox(); return; }
    if (e.key === 'ArrowLeft') lightboxNav(-1);
    else if (e.key === 'ArrowRight') lightboxNav(1);
  });

  let touchX = null, touchY = null, axis = null;
  const body = overlay.querySelector('.lightbox-body');
  body.addEventListener('touchstart', e => {
    const t = e.touches[0];
    touchX = t.clientX; touchY = t.clientY; axis = null;
  }, { passive: true });
  body.addEventListener('touchmove', e => {
    if (touchX == null) return;
    const t = e.touches[0];
    const dx = t.clientX - touchX, dy = t.clientY - touchY;
    if (!axis && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (axis === 'x') image.style.transform = 'translate(' + dx + 'px,0)';
    else if (axis === 'y') image.style.transform = 'translate(0,' + dy + 'px)';
  }, { passive: true });
  body.addEventListener('touchend', e => {
    const t = e.changedTouches[0];
    const dx = touchX != null ? t.clientX - touchX : 0;
    const dy = touchY != null ? t.clientY - touchY : 0;
    touchX = null;
    if (axis === 'x' && Math.abs(dx) > 60) { lightboxNav(dx < 0 ? 1 : -1); axis = null; return; }
    if (axis === 'y' && Math.abs(dy) > 90) { closeLightbox(); axis = null; return; }
    axis = null;
    image.style.transform = 'translate(0,0)';
  });
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
  document.getElementById('calc-plan-kicker').textContent = selectedPlan ? 'Расчёт для объекта' : 'Произвольный расчёт';
  document.getElementById('calc-plan-title').textContent = selectedPlan ? selectedPlan.title : 'Планировка не выбрана';
  const metaEl = document.getElementById('calc-plan-meta');
  if (selectedPlan) metaEl.textContent = selectedPlan.meta + ' · от ' + rub(selectedPlan.price);
  else metaEl.innerHTML = 'Выберите планировку в разделе <a href="#plans" id="calc-goto-plans">«Планировки»</a> — цена подставится сюда';
  document.getElementById('calc-plan-clear').hidden = !selectedPlan;

  document.getElementById('pdf-label').textContent = s.pdfBusy ? 'Готовим PDF…' : 'Скачать расчёт';
  document.getElementById('download-calc').classList.toggle('busy', s.pdfBusy);
}
function sendToForm(){
  const s = state;
  const selectedPlan = s.selectedPlanId ? PLANS.find(p => p.id === s.selectedPlanId) : null;
  const { downPayment, payment } = calcNumbers();
  state.planChoice = selectedPlan ? selectedPlan.category : (s.planChoice || 'unsure');
  state.snapshot = {
    kind: 'calc', kicker: 'Ваш расчёт',
    planTitle: selectedPlan ? selectedPlan.title : '',
    objectTitle: selectedPlan ? selectedPlan.title : 'Произвольный расчёт',
    objectMeta: selectedPlan ? selectedPlan.meta : 'Планировка не выбрана — расчёт по указанной стоимости',
    rows: [
      { k: 'Стоимость', v: rub(s.price) },
      { k: 'Первый взнос', v: s.downPct + '% · ' + rub(downPayment) },
      { k: 'Срок / ставка', v: s.term + ' лет · ' + s.rate.toFixed(1) + '%' },
      { k: 'Платёж', v: rub(payment) + ' / мес' },
    ],
  };
  if (!state.submitted) updateForm();
  scrollToForm();
}
function downloadCalc(){
  if (state.pdfBusy) return;
  const s = state;
  const selectedPlan = s.selectedPlanId ? PLANS.find(p => p.id === s.selectedPlanId) : null;
  const { downPayment, loanAmount, payment, income } = calcNumbers();
  const d = {
    date: new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }),
    custom: !selectedPlan,
    objectTitle: selectedPlan ? selectedPlan.title : 'Произвольный расчёт',
    objectMeta: selectedPlan ? selectedPlan.meta + ' · ' + CAT_LABEL[selectedPlan.category] : 'Планировка не выбрана — расчёт по указанной стоимости',
    price: rub(s.price), down: s.downPct + '% · ' + rub(downPayment), loan: rub(loanAmount),
    term: s.term + ' лет', rate: s.rate.toFixed(1) + '%',
    income: rub(income) + ' / мес', payment: rub(payment) + ' / мес',
  };
  const logo = new URL('assets/logo-cropped.webp', document.baseURI).href;
  state.pdfBusy = true; renderCalculator();
  makeCalcPdf(calcDocHtml(d, logo), 'Расчёт ипотеки — Дом у моря.pdf')
    .catch(() => {})
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
    openGenericRequest({ kind: 'installment', kicker: 'Ваш запрос', objectTitle: 'Рассрочка от застройщика', objectMeta: 'Запрос графика платежей · первый взнос от 30%, 0% на весь срок' });
  });
  const fullpay = document.querySelector('[data-action="ask-fullpay"]');
  fullpay.addEventListener('click', e => {
    e.preventDefault();
    openGenericRequest({ kind: 'full', kicker: 'Ваш запрос', objectTitle: '100% оплата', objectMeta: 'Запрос прайса со скидкой 5% и приоритетом в выборе этажа' });
  });
}
function openGenericRequest(req){
  state.snapshot = req;
  state.planChoice = req.planChoice || state.planChoice;
  if (!state.submitted) updateForm();
  scrollToForm();
}

/* ================= contact form ================= */
function formShellHTML(){
  return `<form id="request-form" class="request-form" novalidate>
    <div>
      <div class="form-kicker">Заявка</div>
      <div class="form-title" id="form-title"></div>
      <div class="form-sub" id="form-sub"></div>
    </div>
    <div id="snapshot-slot" hidden></div>
    <label class="field-label">
      <span class="field-label-text">Имя <span class="req">*</span></span>
      <input class="field-input" id="name-input" placeholder="Как к вам обращаться" autocomplete="name" name="name">
      <div class="field-error" id="name-error" hidden>Укажите, как к вам обращаться</div>
    </label>
    <label class="field-label">
      <span class="field-label-text">Телефон <span class="req">*</span></span>
      <input class="field-input" id="phone-input" placeholder="+7 (___) ___-__-__" type="tel" inputmode="tel" autocomplete="tel" name="phone">
      <div class="field-error" id="phone-error" hidden>Номер введён не полностью — 10 цифр после +7</div>
    </label>
    <div class="plan-locked-row" id="plan-locked-slot" hidden>
      <span class="field-label-text">Интересующая планировка <span class="req">*</span></span>
      <div class="plan-locked-box">
        <span class="plan-locked-value" id="plan-locked-value"></span>
        <span class="plan-locked-note" id="plan-locked-note"></span>
      </div>
    </div>
    <div id="opened-fields-container"></div>
    <div class="more-fields-row" id="more-fields-row" hidden></div>
    <label class="consent-label">
      <input type="checkbox" id="consent-input">
      <span>Даю согласие на обработку персональных данных и принимаю <a href="#contact">политику конфиденциальности</a> <span class="req">*</span></span>
    </label>
    <div class="form-footnotes">
      <div class="footnote-star"><span class="req">*</span> — обязательные поля</div>
      <div class="form-hint" id="form-hint" hidden><span class="form-hint-dot"></span><span id="form-hint-text"></span></div>
    </div>
    <button type="submit" class="submit-btn" id="submit-btn" disabled>Отправить заявку</button>
    <div class="submit-note">Ответим за 20 минут в рабочее время. Данные не передаём третьим лицам.</div>
  </form>`;
}
function successHTML(){
  const steps = [
    { n: '1', t: 'Менеджер звонит в течение 20 минут и уточняет запрос' },
    { n: '2', t: 'Присылаем подборку планировок и актуальный прайс' },
    { n: '3', t: 'Показ на объекте или онлайн — в удобное вам время' },
  ];
  return `<div class="success-card">
    <div>
      <div class="form-kicker">Готово</div>
      <div class="form-title">Заявка принята</div>
    </div>
    <div class="success-steps">
      ${steps.map(st => `<div class="success-step"><span class="success-step-n">${st.n}</span><span class="success-step-t">${st.t}</span></div>`).join('')}
    </div>
    <button type="button" class="success-reset btn-hover-white" id="success-reset-btn">Отправить ещё одну</button>
  </div>`;
}
function createFieldEl(key){
  const wrap = document.createElement('div');
  wrap.className = 'opened-field';
  wrap.dataset.field = key;
  const label = FIELD_LABELS[key][0];
  let bodyHtml = '';
  if (key === 'plan') {
    bodyHtml = `<select class="field-select" id="plan-select">
      <option value="" disabled>Выберите тип квартиры</option>
      <option value="studio">Студия</option>
      <option value="1k">1-комнатная</option>
      <option value="2k">2-комнатная</option>
      <option value="3k">3-комнатная / пентхаус</option>
      <option value="unsure">Пока не определился(-лась)</option>
    </select>`;
  } else if (key === 'email') {
    bodyHtml = `<input class="field-input" id="email-input" type="email" autocomplete="email" name="email" placeholder="пришлём подборку и прайс">
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
  const label = state.opts.length === 0 ? 'Можно сразу указать' : 'Ещё можно указать';
  const sig = label + '|' + remaining.join(',');
  if (row.dataset.sig === sig) return; // avoid rebuilding mid-click (blur on another field would destroy the button being clicked)
  row.dataset.sig = sig;
  if (remaining.length === 0) { row.hidden = true; row.innerHTML = ''; return; }
  row.hidden = false;
  row.innerHTML = `<span>${label}</span>` + remaining.map((k, i) =>
    `<button type="button" class="more-field-btn" data-field="${k}">${FIELD_LABELS[k][1]}${i < remaining.length - 1 ? ',' : ''}</button>`
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
  const iconPath = ICONS[snap.kind] || ICONS.calc;
  slot.innerHTML = `<div class="snap-card">
    <div class="snap-head">
      <div class="snap-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="${iconPath}" stroke="#C8A96A" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path></svg></div>
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
  slot.hidden = !locked;
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
  titleEl.textContent = snapKind === 'calc' ? 'Обсудим ваш расчёт' : (snap ? 'Обсудим ваш запрос' : 'Оставьте заявку на подбор');
  subEl.textContent = snapKind === 'calc'
    ? 'Проверим условия расчёта, зафиксируем платёж и покажем планировку — на объекте или онлайн.'
    : (snapKind === 'plan'
      ? 'Покажем эту планировку на объекте или онлайн, пришлём подборку похожих и актуальный прайс.'
      : (snap
        ? 'Уточним условия оплаты, пришлём документы и ответим на вопросы по вашему запросу.'
        : 'Перезвоним в течение 20 минут в рабочее время и подберём планировку под ваш запрос.'));
}
function updateForm(){
  if (state.submitted) return;
  const s = state;
  const phoneOk = /^\+7 \(\d{3}\) \d{3}-\d{2}-\d{2}$/.test(s.phone);
  const emailBad = !!s.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.email);
  const formMissing = [];
  if (!s.name.trim()) formMissing.push('имя');
  if (!phoneOk) formMissing.push(s.phone ? 'телефон полностью' : 'телефон');
  if (!s.consent) formMissing.push('согласие на обработку данных');
  if (emailBad) formMissing.push('корректный e-mail');
  const formTouched = !!(s.name || s.phone || s.consent || s.email);
  const formReady = !!(s.name.trim() && phoneOk && s.consent && !emailBad);

  const nameErr = !!s.blurred.name && !s.name.trim();
  document.getElementById('name-input').classList.toggle('error', nameErr);
  document.getElementById('name-error').hidden = !nameErr;

  const phoneErr = !!s.blurred.phone && !!s.phone && !phoneOk;
  document.getElementById('phone-input').classList.toggle('error', phoneErr);
  document.getElementById('phone-error').hidden = !phoneErr;

  syncOpenedFields();

  const emailInput = document.getElementById('email-input');
  if (emailInput) {
    const showErr = emailBad && !!s.blurred.email;
    emailInput.classList.toggle('error', showErr);
    const err = document.getElementById('email-error');
    if (err) err.hidden = !showErr;
  }
  const planSelect = document.getElementById('plan-select');
  if (planSelect) planSelect.classList.toggle('chosen', !!s.planChoice);
  document.querySelectorAll('#channel-chips .chip').forEach(b => b.classList.toggle('active', b.dataset.chipValue === s.channel));
  document.querySelectorAll('#time-chips .chip').forEach(b => b.classList.toggle('active', b.dataset.chipValue === s.callTime));

  renderMoreFieldsRow();
  renderPlanLocked();
  renderSnapshot();
  renderFormTitleSub();

  const btn = document.getElementById('submit-btn');
  btn.classList.toggle('ready', formReady);
  btn.disabled = !formReady;
  const hintWrap = document.getElementById('form-hint');
  const showHint = !!(formMissing.length && formTouched);
  hintWrap.hidden = !showHint;
  document.getElementById('form-hint-text').textContent = formMissing.length ? 'Осталось: ' + formMissing.join(', ') : '';
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
function resetFormState(){
  state.submitted = false; state.name = ''; state.phone = ''; state.planChoice = '';
  state.consent = false; state.snapshot = null; state.email = ''; state.channel = 'Звонок';
  state.callTime = ''; state.opts = []; state.blurred = {};
}
function handleSubmit(){
  const phoneOk = /^\+7 \(\d{3}\) \d{3}-\d{2}-\d{2}$/.test(state.phone);
  const emailBad = !!state.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(state.email);
  const formReady = !!(state.name.trim() && phoneOk && state.consent && !emailBad);
  if (!formReady) {
    state.blurred = { name: true, phone: true, email: true };
    updateForm();
    return;
  }
  state.submitted = true;
  renderContactArea();
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
  const area = document.getElementById('contact-form-area');
  if (state.submitted) {
    area.innerHTML = successHTML();
    document.getElementById('success-reset-btn').addEventListener('click', () => {
      resetFormState(); renderContactArea();
    });
  } else {
    area.innerHTML = formShellHTML();
    bindFormEvents();
    updateForm();
  }
}

/* ================= init ================= */
function init(){
  renderTabs(); renderPlansGrid(); wirePlansEvents();
  renderGallery(); wireGalleryEvents();
  wireCalculatorEvents(); renderCalculator();
  renderContactArea();
  wireHeaderEvents();
  wireLightboxEvents();
  wireCookieBanner(); applyCookieBanner();
  wireScrollTopBtn();
  wirePricingCtas();
  setupRevealObserver();
  onScroll();
}
document.addEventListener('DOMContentLoaded', init);
