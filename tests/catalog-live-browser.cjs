// Same packaged page and PHP routes as the Apache matrix, with external requests blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const {browser, stable} = require('./helpers.cjs');

const [loopback, statePath, partial, confirmed, lotId, price] = process.argv.slice(2);
assert.match(loopback, /^http:\/\/127\.0\.0\.1:\d+$/);
const site = 'https://zhk-dom-umorya.ru';

function publish(fixture) {
  const pending = statePath + '.test';
  fs.writeFileSync(pending, fs.readFileSync(fixture), {mode: 0o600});
  fs.renameSync(pending, statePath);
}

function relay(route) {
  const requested = new URL(route.request().url());
  const method = route.request().method();
  if (requested.origin !== site || !['GET', 'HEAD'].includes(method)) return route.abort();
  const target = loopback + requested.pathname + requested.search;
  return new Promise((resolve, reject) => {
    const request = http.request(target, {
      method, headers: {host: requested.host, 'X-Forwarded-Protocol': 'https'},
    }, response => {
      const chunks = [];
      response.on('data', bytes => chunks.push(bytes));
      response.on('end', () => {
        const headers = {...response.headers};
        delete headers['transfer-encoding'];
        delete headers['content-length'];
        delete headers.connection;
        route.fulfill({status: response.statusCode, headers, body: Buffer.concat(chunks)}).then(resolve, reject);
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  });
}

async function open(context, status, version) {
  const tab = await context.newPage();
  const reply = await tab.goto(site+'/');
  assert.equal(reply.status(), 200);
  assert.equal(reply.headers()['x-dom-catalog-status'], status);
  if (version) assert.equal(reply.headers()['x-dom-catalog-snapshot'], version);
  await stable(tab);
  if (await tab.locator('#cookie-decline').isVisible()) await tab.locator('#cookie-decline').click();
  await tab.locator(`[data-action="calc-here"][data-id="${lotId}"]`).click();
  return tab;
}

async function download(tab) {
  const pending = tab.waitForEvent('download', {timeout: 15000});
  await tab.locator('#download-calc').click();
  const artifact = await pending;
  assert.match(artifact.suggestedFilename(), /\.pdf$/);
  assert.equal(fs.readFileSync(await artifact.path()).subarray(0, 4).toString(), '%PDF');
  await tab.waitForFunction(() => !document.querySelector('#download-calc').disabled);
}

async function blocked(tab) {
  let downloaded = false;
  tab.once('download', () => { downloaded = true; });
  await tab.locator('#download-calc').click();
  await tab.waitForFunction(() => document.querySelector('#pdf-status').textContent.includes('Обновите страницу'));
  assert.equal(downloaded, false);
}

(async () => {
  const chromium = await browser();
  try {
    const context = await chromium.newContext({acceptDownloads: true, viewport: {width: 390, height: 844}});
    await context.route('**/*', relay);
    const website = await open(context, 'confirmed', 'bundled');
    await download(website);
    publish(partial);
    await blocked(website);

    const active = await open(context, 'confirmed');
    assert.match(await active.locator('#catalog-checked-at').textContent(), /Цены и наличие проверены.*МСК/);
    assert.doesNotMatch(await active.locator('#plans').textContent(), /Ассортимент уточняется|ошибка импорта/);
    assert.equal(await active.locator('#price-range').inputValue(), price);
    await download(active);
    publish(confirmed);
    await blocked(active);

    const noJs = await chromium.newContext({javaScriptEnabled: false});
    await noJs.route('**/*', relay);
    const html = await noJs.newPage();
    const response = await html.goto(site+'/');
    assert.equal(response.status(), 200);
    assert.equal(response.headers()['x-dom-catalog-status'], 'confirmed');
    assert.equal(await html.locator('#plans-grid article').count(), 27);
    assert.match(await html.locator('#catalog-checked-at').textContent(), /Цены и наличие проверены.*МСК/);
    const nextPrice = Number(price) + 11000;
    assert.equal(await html.locator('#price-range').inputValue(), String(nextPrice));
    assert.match(await html.locator(`[data-lot-id="${lotId}"] .plan-price`).textContent(),
      new RegExp(String(nextPrice).replace(/\B(?=(\d{3})+(?!\d))/g, '\\s')));
    console.log('PASS bundled→runtime stale PDF, valid PDF during hidden partial import, active stale PDF and updated catalogue without JavaScript');
  } finally {
    await chromium.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
