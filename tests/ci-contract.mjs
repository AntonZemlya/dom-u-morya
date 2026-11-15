import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {validateRelease,buildRelease} from '../scripts/build-release.mjs';
import {createHash} from 'node:crypto';
const first=await validateRelease('dist');
const second=await buildRelease({target:'production',siteUrl:'https://zhk-dom-umorya.ru'});assert.equal(first.sha256,second.sha256);
const M=(await import('../content-model.js')).default, lots=JSON.parse(fs.readFileSync('data/apartments.json'));
assert.equal(lots.length,28);assert.equal(new Set(lots.map(l=>l.id)).size,28);
for(const lot of lots){const p=M.plans([lot])[0];for(const v of Object.keys(M.views)){const card=M.card(p,v);assert.ok(card.includes(lot.id));assert.ok(card.includes(M.rub(lot.price_rub)));}}
// Execute the actual pure calculator functions extracted from the application source.
const src=fs.readFileSync('script.js','utf8');
const match=src.match(/function calcNumbers\(\)\s*\{[\s\S]*?\n\}/);
assert.ok(match,'Actual calculator primitive exists');
const context=vm.createContext({Math,state:{price:5000000,downPct:20,rate:6,term:20}});vm.runInContext(match[0],context);
let result=context.calcNumbers();assert.equal(result.downPayment,1000000);assert.equal(result.loanAmount,4000000);
assert.ok(Math.abs(result.payment-28657.2423)<0.01);assert.equal(result.income,result.payment/0.4);
context.state.rate=0;assert.equal(context.calcNumbers().payment,4000000/240);
context.state.downPct=100;assert.equal(context.calcNumbers().payment,0);
// Auto down-payment boundaries, programme minimums and step alignment.
assert.deepEqual(M.minimumDownPayment(6978183,M.mortgagePrograms.regional),{value:15,feasible:true});
assert.equal(M.minimumDownPayment(10000000,M.mortgagePrograms.regional).value,40);
assert.equal(M.minimumDownPayment(20000000,M.mortgagePrograms.regional).value,70);
assert.deepEqual(M.minimumDownPayment(21000000,M.mortgagePrograms.regional),{value:70,feasible:false});
assert.equal(M.minimumDownPayment(15154854,M.mortgagePrograms.family).value,21);
assert.equal(M.minimumDownPayment(6978183,M.mortgagePrograms.family).value,20);
assert.equal(M.minimumDownPayment(6978183,M.mortgagePrograms.regional,{min:10,max:70,step:2}).value,16);
const html=fs.readFileSync('dist/index.html','utf8');assert.match(html,/rel="canonical" href="https:\/\/zhk-dom-umorya.ru\/"/);
assert.equal((html.match(/<h1\b/g)||[]).length,1);
console.log('PASS deterministic production bytes, allowlist, local links, 28 catalog lots, calculator and SEO');
