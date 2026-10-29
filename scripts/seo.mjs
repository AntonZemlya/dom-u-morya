import fs from 'node:fs/promises';
import path from 'node:path';
import {isIP} from 'node:net';
export const SEO_PAGES = ['index.html','privacy.html','consent-personal-data.html'];
export function siteOrigin(value='', target='preview') {
  if (!['preview','production'].includes(target)) throw Error('BUILD_TARGET must be preview or production');
  if (!value) {if(target==='production') throw Error('Production requires SITE_URL');return '';}
  let u;try {u=new URL(value);}catch {throw Error('SITE_URL must be an HTTPS origin');}
  const host=u.hostname.toLowerCase();
  if (u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||u.pathname!=='/'||isIP(host)||host.includes(':')||!host.includes('.')||/(?:^|\.)(?:localhost|local|test|invalid|example|example\.com|example\.org|example\.net)$/.test(host)||/(?:^|[.-])(?:example|placeholder|todo|test)(?:[.-]|$)/.test(host)||value.trim()!==value) throw Error('SITE_URL must be a real public HTTPS origin without path, port, credentials or placeholders');
  return u.origin;
}
export const pageURL=(origin,file)=>origin+(file==='index.html'?'/':'/'+file);
const escape=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export function seoHTML(html,file,origin) {
  const tags=origin?`<link rel="canonical" href="${escape(pageURL(origin,file))}">\n`:'';
  return tags?html.replace('</head>',`<!-- SEO:generated -->\n${tags}<!-- /SEO:generated -->\n</head>`):html;
}
export function indexingFiles(origin) {
  const result={'robots.txt':'User-agent: *\nAllow: /\n'+(origin?`Sitemap: ${origin}/sitemap.xml\n`:'')};
  if(origin)result['sitemap.xml']='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+SEO_PAGES.map(file=>`  <url><loc>${escape(pageURL(origin,file))}</loc></url>`).join('\n')+'\n</urlset>\n';
  return result;
}
export async function generateSEO(directory,origin) {
  for(const file of SEO_PAGES){const p=path.join(directory,file);await fs.writeFile(p,seoHTML(await fs.readFile(p,'utf8'),file,origin));}
  for(const [file,body] of Object.entries(indexingFiles(origin)))await fs.writeFile(path.join(directory,file),body);
}
