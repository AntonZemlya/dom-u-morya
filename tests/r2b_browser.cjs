const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {chromium} = require('playwright');

(async () => {
  const [root, origin, home, fixtureFile, output] = process.argv.slice(2);
  assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  const [a,b,c] = JSON.parse(fs.readFileSync(fixtureFile)).packages;
  const commands = [], downloads = [];
  function command(action, bundle, expect) {
    const args = ['-B', path.join(root,'ops/catalog_publisher.py'), action,
      '--home',home,'--url',origin,'--expect',expect];
    if (bundle) args.push('--package',bundle.directory,'--sha',bundle.package);
    if (action === 'invalidate') args.push('--expect-package',b.package);
    commands.push(['python3',...args]);
    const p = spawnSync('python3',args,{encoding:'utf8'});
    assert.equal(p.status,0,p.stderr);
    return JSON.parse(p.stdout);
  }
  const browser = await chromium.launch(process.env.CHROMIUM_EXECUTABLE_PATH
    ? {executablePath:process.env.CHROMIUM_EXECUTABLE_PATH} : {});
  try {
    const tab = await browser.newPage({acceptDownloads:true,serviceWorkers:'block'});
    const blocked = [];
    await tab.route('**/*',route => {
      const req = route.request();
      if (new URL(req.url()).origin === origin && ['GET','HEAD'].includes(req.method())) return route.continue();
      blocked.push({method:req.method(),url:new URL(req.url()).origin});
      return route.abort();
    });
    let seen = 0;
    tab.on('download',()=>seen++);
    async function open(version) {
      const response = await tab.goto(origin+'/',{waitUntil:'domcontentloaded'});
      assert.equal(response.headers()['x-dom-catalog-snapshot'],version);
      assert.equal(await tab.evaluate(()=>JSON.parse(document.getElementById('site-data').textContent).catalog_version), version);
      await tab.addStyleTag({content:'html{scroll-behavior:auto!important} *,*::before,*::after{animation:none!important;transition:none!important}'});
      if (await tab.locator('#cookie-decline').isVisible()) await tab.locator('#cookie-decline').click();
      // The selected price/ID stays unchanged in B; another price changes and an ID disappears.
      await tab.locator('[data-action="calc-here"][data-id="900002"]').first().click();
      assert.equal(await tab.locator('#price-range').inputValue(),'7000000');
      await tab.evaluate(()=>{
        const original = window.makeCalcPdf;
        window.makeCalcPdf = function(html,name) {
          window.r2bSheet = new DOMParser().parseFromString(html,'text/html').body.textContent;
          return original(html,name);
        };
      });
    }
    async function pdf(label) {
      const event = tab.waitForEvent('download',{timeout:25000});
      await tab.locator('#download-calc').click();
      const download = await event;
      const raw = fs.readFileSync(await download.path());
      assert.equal(raw.subarray(0,5).toString(),'%PDF-');
      assert(raw.length > 5000);
      const sheet = (await tab.evaluate(()=>window.r2bSheet)).replace(/\s/g,'');
      assert(sheet.includes('Стоимостьквартиры7000000₽'));
      assert(sheet.includes('ID900002'));
      const file = path.join(path.dirname(output),label+'.pdf');
      fs.writeFileSync(file,raw);
      downloads.push({label,file,bytes:raw.length,sha256:crypto.createHash('sha256').update(raw).digest('hex'),id:'900002',price:7000000});
      await tab.waitForFunction(()=>!document.querySelector('#download-calc').disabled);
    }
    async function stale() {
      const count = seen;
      await tab.locator('#download-calc').click();
      await tab.waitForFunction(()=>document.getElementById('pdf-status').textContent.includes('Обновите страницу'));
      assert.equal(seen,count);
    }
    await open(a.native);
    await pdf('a-current');
    command('install',b,a.native);
    await stale();
    const old = await tab.request.get(origin+'/_validate?id=900002&price=7000000&version='+a.native);
    assert.equal(old.status(),409);
    await open(b.native);
    await pdf('b-current');
    command('invalidate',null,b.native);
    await stale();
    assert.equal(command('install',b,b.native).status,'unconfirmed');
    command('install',c,b.native);
    await open(c.native);
    await pdf('c-reconfirmed');
    const report = {status:'PASS',browser:await browser.version(),id:'900002',price:7000000,
      staleVersionWithUnchangedPrice:409,stalePdfBlocked:true,unconfirmedPdfBlocked:true,
      freshConfirmationRestored:true,commands,downloads,blockedExternalOrNonRead:blocked};
    fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
