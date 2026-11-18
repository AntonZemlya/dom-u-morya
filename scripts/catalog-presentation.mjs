import M from '../content-model.js';

export const browserLots = apartments => apartments.map(({source_url, plans, ...lot}) => ({
  ...lot,
  plans: plans.map(({type, local_path}) => ({type, local_path})),
}));

export function catalogMarkup(apartments, groups) {
 const date = apartments.map(lot=>lot.snapshot_date).sort().at(-1);
 const list = M.plans(apartments);
 const categories = M.categories(list);
 return `<h2 id="plans-heading" class="plans-style-5">Квартира под ваш ритм</h2>
<p class="plans-style-6">От первого собственного пространства до большой квартиры для семьи. Найдите площадь, этаж и вид, которые подходят именно вам.</p>
<p class="content-note">${list.length} квартир · ${groups} планировок${list.every(p=>p.finishing==='Чистовая отделка')?' · чистовая отделка':''}</p>
<div class="plans-style-7 enhanced-only"><div id="plan-tabs" class="plans-style-8"></div><div class="catalog-toolbar"><div id="catalog-filter-actions"><button type="button" id="toggle-filters" class="view-chip" aria-expanded="false" aria-controls="catalog-controls">Фильтры <span id="filter-count" hidden></span><span id="filter-disclosure-status">Скрыты</span></button><button type="button" id="reset-filters-compact" class="view-chip" hidden>Сбросить фильтры</button></div></div></div>
<div id="catalog-controls" class="catalog-controls enhanced-only" hidden>
<label>Бюджет<select id="budget-filter"><option value="">Любой</option><option value="8000000">До 8 млн ₽</option><option value="10000000">До 10 млн ₽</option><option value="12000000">До 12 млн ₽</option><option value="16000000">До 16 млн ₽</option></select></label>
<label>Этаж<select id="floor-filter"><option value="">Любой</option>${[...new Set(list.map(p=>p.floor))].sort((a,b)=>a-b).map(f=>`<option value="${f}">${f} этаж</option>`).join('')}</select></label>
<label>Планировка<select id="layout-filter"><option value="">Все планировки</option></select></label>
<label>Порядок<select id="sort-filter"><option value="price">Сначала дешевле</option><option value="area">По площади</option><option value="floor">По этажу</option></select></label>
<label class="sea-filter"><input type="checkbox" id="sea-filter">С видом на море</label><button type="button" id="reset-filters" class="view-chip">Сбросить</button>
</div>
<p id="catalog-result" class="content-note enhanced-only" role="status" aria-live="polite"></p>
<div id="plans-grid" class="plans-grid plans-style-10">${categories.map((c,i)=>`<details class="static-category"${i===0?' open':''}><summary>${c.title} · ${c.count} предложений · ${c.price}</summary><div class="plans-grid">${list.filter(p=>p.category===c.key).map(p=>M.card(p)).join('')}</div></details>`).join('')}</div>
<button type="button" id="show-more-plans" class="view-chip enhanced-only" hidden>Показать ещё</button>
<p class="catalog-footnote">Мебель на схемах — пример расстановки.<br><span id="catalog-checked-at">Информация по состоянию на ${M.displayDate(date)}</span></p>`;
}

export function calculatorDefaults(apartments) {
 const min = Math.min(...apartments.map(lot => lot.price_rub));
 const max = Math.max(20000000, ...apartments.map(lot => lot.price_rub));
 const program = M.mortgagePrograms.regional;
 const downPct = M.minimumDownPayment(min, program).value;
 const down = min * downPct / 100;
 const loan = min - down;
 const rate = program.rate / 100 / 12;
 const payment = loan * rate / (1 - (1 + rate) ** -360);
 return {
  labels: {'price-label':M.rub(min),'down-label':downPct+'% · '+M.rub(down),'loan-label':M.rub(loan),'payment-label':M.rub(payment)+' / мес','income-label':M.rub(payment/.4)+' / мес'},
  inputs: {
   'price-range': `<input type="range" min="${min}" max="${max}" step="1" value="${min}" id="price-range" aria-label="Стоимость квартиры" class="pricing-style-16">`,
   'down-range': `<input type="range" min="${program.minDown}" max="${M.downRange.max}" step="${M.downRange.step}" value="${downPct}" id="down-range" aria-label="Первоначальный взнос, проценты" aria-describedby="down-mode" class="pricing-style-16">`
  }
 };
}
