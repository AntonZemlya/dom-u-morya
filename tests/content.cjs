const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),read=n=>JSON.parse(fs.readFileSync(path.join(root,'data',n+'.json'))),a=read('apartments'),groups=read('plan-groups'),media=read('media');
const M=require('../content-model.js'),plans=M.plans(a),ids=a.map(p=>p.id),hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
assert.equal(a.length,28);assert.equal(new Set(ids).size,28);assert.deepEqual([0,1,2,3].map(n=>a.filter(p=>p.bedrooms===n).length),[4,16,6,2]);assert.equal(groups.length,19);
assert.deepEqual(groups.flatMap(g=>g.apartments).sort(),[...ids].sort());
assert.equal(Math.min(...a.map(p=>p.price_rub)),6978183);assert.equal(Math.max(...a.map(p=>p.price_rub)),15154854);
const paths=new Set();for(const p of a){assert.equal(p.project_id,'24');assert.equal(p.project_slug,'house-by-the-sea');assert.equal(p.availability_confirmed_by_agent,false);assert.equal(p.snapshot_date,'2026-10-27');assert.equal(groups.find(g=>g.id===p.plan_group_id).apartments.includes(p.id),true);assert.deepEqual(p.plans.map(v=>v.type).sort(),['floor','furnished','unfurnished']);for(const v of p.plans){paths.add(v.local_path);const bytes=fs.readFileSync(path.join(root,v.local_path));assert.equal(hash(bytes),v.sha256);assert.doesNotMatch(bytes.toString(),/<script\b|\bon\w+\s*=|<foreignObject\b/i);}}
assert.equal(paths.size,57);
assert.equal(media.gallery.length,8);assert.deepEqual(media.construction.map(a=>a.month),['2026-09','2026-08','2026-07','2026-06','2026-05','2026-04']);assert.equal(new Set(media.construction.flatMap(a=>a.images.map(i=>i.sha256))).size,29);
for(const photo of [...media.gallery,...media.construction.flatMap(m=>m.images)]){assert.equal(photo.rights_status,'permission_not_verified');assert.ok(photo.source_url.startsWith('https://sadovoe-kolco.ru/'));assert.ok(photo.width>0&&photo.height>0);for(const v of photo.variants)assert.ok(fs.existsSync(path.join(root,v.src)));}
const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),data=JSON.parse(html.match(/<script id="site-data" type="application\/json">(.*?)<\/script>/s)[1]);assert.deepEqual(data.apartments,a);assert.deepEqual(data.media,media);
for(const p of plans){assert.ok(html.includes(`data-lot-id="${p.id}"`));assert.ok(html.includes(M.rub(p.price)));}
for(const c of M.categories(plans))assert.ok(html.includes(c.price));
// Frozen hero: exact source and the three image hashes, independent of generated content.
const {execFileSync}=require('node:child_process');const base=execFileSync('git',['show','b63b88e:index.html'],{cwd:root,encoding:'utf8'});const hero=s=>s.match(/<section id="hero-section"[\s\S]*?<\/section>/)[0];assert.equal(hero(html),hero(base));
for(const name of ['hero-desktop.webp','hero-tablet.webp','hero-mobile.webp'])assert.equal(hash(fs.readFileSync(path.join(root,'assets',name))),hash(execFileSync('git',['show','b63b88e:assets/'+name],{cwd:root,maxBuffer:5*1024*1024})));
// V2.2 removes two unused hint rules; every other rule of the approved stylesheet remains intact.
const withoutHints=css=>css.replace(/\.form-hint(?:-dot)?\{[^}]*\}\n/g,'');
assert.ok(withoutHints(fs.readFileSync(path.join(root,'styles.css'),'utf8')).startsWith(withoutHints(execFileSync('git',['show','b63b88e:styles.css'],{cwd:root,encoding:'utf8'}))), 'Approved CSS, including every hero breakpoint and animation, remains unchanged except removed obsolete form hints');
console.log('PASS 28 IDs, categories 4/16/6/2, 19 groups, 84 links/57 byte-identical SVG, media provenance, generated HTML and frozen hero sources');
