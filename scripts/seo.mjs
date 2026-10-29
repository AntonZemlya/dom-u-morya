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
export function graph(file,origin,title,description) {
  const id=key=>origin?{'@id':origin+'/#'+key}:{};
  const operator={'@type':'Organization',...id('operator'),name:'ИП Саврасова Елена Анатольевна',taxID:'366210396814',identifier:{'@type':'PropertyValue',propertyID:'ОГРНИП',value:'318366800035941'},telephone:'+79529568875',email:'info@anyara.ru'};
  const developer={'@type':'Organization',...id('developer'),name:'ГК «Садовое кольцо»'};
  const complex={'@type':'ApartmentComplex',...id('complex'),name:'ЖК «Дом у моря»',description:'Жилой комплекс в Мариуполе. Застройщик — ГК «Садовое кольцо».',address:{'@type':'PostalAddress',addressLocality:'Мариуполь'}};
  const website={'@type':'WebSite',...id('website'),name:'ЖК «Дом у моря»',inLanguage:'ru',publisher:origin?id('operator'):operator,...(origin?{url:origin+'/'}:{})};
  const page={'@type':'WebPage',...(origin?{'@id':pageURL(origin,file)+'#webpage',url:pageURL(origin,file)}:{}),name:title,description,inLanguage:'ru',isPartOf:origin?id('website'):website,about:origin?id('complex'):complex,publisher:origin?id('operator'):operator};
  return {'@context':'https://schema.org','@graph':[operator,developer,complex,website,page]};
}
export function seoHTML(html,file,origin) {
  const title=html.match(/<title>(.*?)<\/title>/s)[1],description=html.match(/<meta name="description" content="(.*?)"/s)[1];
  const meta=(name,value,property=false)=>`<meta ${property?'property':'name'}="${name}" content="${escape(value)}">`;
  const tags=[...(origin?[`<link rel="canonical" href="${escape(pageURL(origin,file))}">`]:[]),
    meta('og:type','website',true),meta('og:locale','ru_RU',true),meta('og:site_name','ЖК «Дом у моря»',true),meta('og:title',title,true),meta('og:description',description,true),meta('twitter:card','summary_large_image'),meta('twitter:title',title),meta('twitter:description',description),
    ...(origin?[meta('og:url',pageURL(origin,file),true),meta('og:image',origin+'/assets/og-project.jpg',true),meta('og:image:width','1200',true),meta('og:image:height','630',true),meta('og:image:type','image/jpeg',true),meta('og:image:alt','ЖК «Дом у моря»: архитектурная визуализация и логотип проекта',true),meta('twitter:image',origin+'/assets/og-project.jpg'),meta('twitter:image:alt','ЖК «Дом у моря»: архитектурная визуализация и логотип проекта')]:[]),
    '<script type="application/ld+json">'+JSON.stringify(graph(file,origin,title,description)).replaceAll('<','\\u003c')+'</script>'];
  return html.replace('</head>',`<!-- SEO:generated -->\n${tags.join('\n')}\n<!-- /SEO:generated -->\n</head>`);
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
