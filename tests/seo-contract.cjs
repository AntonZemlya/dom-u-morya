// Reverse only explicitly authorized SEO rendering changes for frozen-source guards.
function semantic(s){return s.replace(/([a-f0-9]{64})\.preview\.webp/g,'$1.svg').replace('<h1 id="hero-section-heading" class="hero-style-7">ЖК «Дом у моря» — Мариуполь, первая береговая линия</h1>','<div class="hero-style-7">ЖК «Дом у моря» — Мариуполь, первая береговая линия</div>').replace('<p class="hero-style-8">Квартиры, обращённые <i>к горизонту</i>\n</p>','<h1 id="hero-section-heading" class="hero-style-8">Квартиры, обращённые <i>к горизонту</i>\n</h1>').replace(/<h3([^>]*)>Посчитайте платёж и нужный доход<\/h3>/g,'<h2$1>Посчитайте платёж и нужный доход</h2>');}
const body=s=>s.slice(s.indexOf('<body>'));
const css=s=>s.replace('color: rgb(232, 210, 160); margin: 0 0 clamp(10px, 2vw, 22px);','color: rgb(232, 210, 160); margin-bottom: clamp(10px, 2vw, 22px);');
module.exports={semantic,body,css};
