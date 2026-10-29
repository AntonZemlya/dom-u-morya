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
  const id=key=>({'@id':origin?origin+'/#'+key:'_:'+key});
  const operator={'@type':'Organization',...id('operator'),name:'ИП Саврасова Елена Анатольевна',taxID:'366210396814',identifier:{'@type':'PropertyValue',propertyID:'ОГРНИП',value:'318366800035941'},telephone:'+79529568875',email:'info@anyara.ru'};
  const developer={'@type':'Organization',...id('developer'),name:'ГК «Садовое кольцо»'};
  const complex={'@type':'ApartmentComplex',...id('complex'),name:'ЖК «Дом у моря»',description:'Жилой комплекс в Мариуполе. Застройщик — ГК «Садовое кольцо».',address:{'@type':'PostalAddress',addressLocality:'Мариуполь'}};
  const website={'@type':'WebSite',...id('website'),name:'ЖК «Дом у моря»',inLanguage:'ru',publisher:id('operator'),...(origin?{url:origin+'/'}:{})};
  const page={'@type':'WebPage',...(origin?{'@id':pageURL(origin,file)+'#webpage',url:pageURL(origin,file)}:id('webpage')),name:title,description,inLanguage:'ru',isPartOf:id('website'),about:id('complex'),publisher:id('operator')};
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

// Check the emitted artifacts together before accepting a release.
export async function validateSEO(directory,origin) {
  for(const [file,expected] of Object.entries(indexingFiles(origin)))if(await fs.readFile(path.join(directory,file),'utf8')!==expected)throw Error('Inconsistent indexing artifact: '+file);
  if(!origin){try{await fs.access(path.join(directory,'sitemap.xml'));throw Error('Preview must not contain sitemap');}catch(e){if(e.code!=='ENOENT')throw e;}}
  for(const file of SEO_PAGES){
    const html=await fs.readFile(path.join(directory,file),'utf8');
    const canonical=[...html.matchAll(/<link rel="canonical" href="([^"]+)">/g)].map(x=>x[1]);
    if(JSON.stringify(canonical)!==JSON.stringify(origin?[pageURL(origin,file)]:[]))throw Error('Canonical mismatch: '+file);
    const section=html.match(/<!-- SEO:generated -->(.*?)<!-- \/SEO:generated -->/s)?.[1];if(!section)throw Error('Missing SEO metadata: '+file);
    if(/localhost|127\.0\.0\.1|example\.|TODO/.test(origin?section.replaceAll(origin,''):section))throw Error('Placeholder SEO URL');
    const graphs=[...section.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)];if(graphs.length!==1)throw Error('Duplicate/missing graph');
    const data=JSON.parse(graphs[0][1]),nodes=data['@graph'];if(nodes.length!==5)throw Error('Graph shape');
    const ids=nodes.map(x=>x['@id']).filter(Boolean);if(new Set(ids).size!==ids.length)throw Error('Duplicate graph IDs');
    if(origin){if(!section.includes(`property="og:url" content="${pageURL(origin,file)}"`)||!section.includes(`property="og:image" content="${origin}/assets/og-project.jpg"`))throw Error('OG URL mismatch');}
    else if(ids.some(id=>!id.startsWith('_:'))||/property="og:(?:url|image)"/.test(section))throw Error('Preview has public identities');
  }
}
