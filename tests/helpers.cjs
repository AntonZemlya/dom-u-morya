const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2','.ttf':'font/ttf','.pdf':'application/pdf'};
function server(directory = root, port = 0) {
  if (process.env.QA_BASE_URL) {
    if (process.env.QA_BASE_URL !== 'http://127.0.0.1:4183/') throw Error('Use the approved preview URL');
    return Promise.resolve({url:process.env.QA_BASE_URL.replace(/\/$/, ''), close:async()=>{}});
  }
  const instance = http.createServer((req,res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(directory, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(directory + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (error, data) => { if(error) res.writeHead(404).end(); else {res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream'); res.end(data);} });
  });
  return new Promise(resolve => instance.listen(port,'127.0.0.1', () => resolve({url:`http://127.0.0.1:${instance.address().port}`, close:()=>new Promise(r=>instance.close(r))})));
}
async function browser(){
  const {chromium} = require('playwright');
  return chromium.launch(process.env.CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.CHROMIUM_EXECUTABLE_PATH} : {});
}
async function stable(page){
  await page.evaluate(()=>document.fonts.ready);
  await page.addStyleTag({content:'html{scroll-behavior:auto!important} *,*::before,*::after{animation:none!important;transition:none!important} [data-reveal-key]{opacity:1!important;transform:none!important}'});
}
async function maskMap(page){
  // Third-party tiles change independently of the design. Keep the iframe dimensions.
  await page.route('https://www.openstreetmap.org/**', route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body style="margin:0;background:#EEE8DC"></body></html>'}));
}
module.exports={root,server,browser,stable,maskMap};
