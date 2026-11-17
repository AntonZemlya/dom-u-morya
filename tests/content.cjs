const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),read=n=>JSON.parse(fs.readFileSync(path.join(root,'data',n+'.json'))),a=read('apartments'),groups=read('plan-groups'),media=read('media');
const M=require('../content-model.js'),plans=M.plans(a),ids=a.map(p=>p.id),hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
assert.equal(a.length,28);assert.equal(new Set(ids).size,28);assert.deepEqual([0,1,2,3].map(n=>a.filter(p=>p.bedrooms===n).length),[4,16,6,2]);assert.equal(groups.length,20);
assert.deepEqual(groups.flatMap(g=>g.apartments).sort(),[...ids].sort());
assert.equal(Math.min(...a.map(p=>p.price_rub)),7117760);assert.equal(Math.max(...a.map(p=>p.price_rub)),15154854);
const paths=new Set();for(const p of a){assert.equal(p.project_id,'24');assert.equal(p.project_slug,'house-by-the-sea');assert.equal(p.availability_confirmed_by_agent,false);assert.match(p.snapshot_date,/^\d{4}-\d{2}-\d{2}$/);assert.equal(groups.find(g=>g.id===p.plan_group_id).apartments.includes(p.id),true);assert.deepEqual(p.plans.map(v=>v.type).sort(),['floor','furnished','unfurnished']);for(const v of p.plans){paths.add(v.local_path);const bytes=fs.readFileSync(path.join(root,v.local_path));assert.equal(hash(bytes),v.sha256);assert.doesNotMatch(bytes.toString(),/<script\b|\bon\w+\s*=|<foreignObject\b/i);}}
assert.equal(paths.size,60);
assert.equal(media.gallery.length,8);assert.deepEqual(media.construction.map(a=>a.month),['2026-10','2026-09','2026-08','2026-07','2026-06','2026-05','2026-04']);assert.equal(new Set(media.construction.flatMap(a=>a.images.map(i=>i.sha256))).size,35);
for(const photo of [...media.gallery,...media.construction.flatMap(m=>m.images)]){assert.equal(photo.rights_status,photo.album_month==='2026-10'?'owner_confirmed':'permission_not_verified');assert.ok(photo.source_url.startsWith('https://sadovoe-kolco.ru/'));assert.ok(photo.width>0&&photo.height>0);for(const v of photo.variants)assert.ok(fs.existsSync(path.join(root,v.src)));}
const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),data=JSON.parse(html.match(/<script id="site-data" type="application\/json">(.*?)<\/script>/s)[1]);assert.deepEqual(data.apartments.map(p=>[p.id,p.price_rub,p.developer_availability]),a.map(p=>[p.id,p.price_rub,p.developer_availability]));
assert.deepEqual(data.media.gallery.map(p=>p.src),media.gallery.map(p=>p.src));
assert.deepEqual(data.media.construction.map(m=>m.images.map(p=>p.src)),media.construction.map(m=>m.images.map(p=>p.src)));
assert.doesNotMatch(JSON.stringify(data), /source_url|origin_page|https?:/);
for(const p of plans){assert.ok(html.includes(`data-lot-id="${p.id}"`));assert.ok(html.includes(M.rub(p.price)));}
for(const c of M.categories(plans))assert.ok(html.includes(c.price));
// Frozen hero: exact source and the three image hashes, independent of generated content.
const {execFileSync}=require('node:child_process');const base=execFileSync('git',['show','b63b88e:index.html'],{cwd:root,encoding:'utf8'});const hero=s=>s.match(/<section id="hero-section"[\s\S]*?<\/section>/)[0];assert.equal(require('./seo-contract.cjs').semantic(hero(html)),hero(base));
for(const name of ['hero-desktop.webp','hero-tablet.webp','hero-mobile.webp'])assert.equal(hash(fs.readFileSync(path.join(root,'assets',name))),hash(execFileSync('git',['show','b63b88e:assets/'+name],{cwd:root,maxBuffer:5*1024*1024})));
// The new, owner-approved album is additive; the full old catalogue/media remain frozen.
const oldMedia=JSON.parse(execFileSync('git',['show','b686c5f:data/media.json'],{cwd:root,encoding:'utf8'}));
assert.deepEqual(media.gallery,oldMedia.gallery);
assert.deepEqual(media.construction.filter(album=>album.month!=='2026-10'),oldMedia.construction);
const october=media.construction[0];assert.equal(october.images.length,6);assert.equal(october.rights_status,'owner_confirmed');
// PRICE-SYNC-001: preserve old units' structural facts and all legacy SVG bytes;
 // only two explicitly verified official IDs are replaced; historic snapshots remain in git.
const originalLots=JSON.parse(execFileSync('git',['show','b686c5f:data/apartments.json'],{cwd:root,encoding:'utf8',maxBuffer:5e6}));
const prevById=new Map(originalLots.map(p=>[p.id,p]));
assert.deepEqual(originalLots.filter(p=>!ids.includes(p.id)).map(p=>p.id).sort(),['22820','22918']);
assert.deepEqual(a.filter(p=>!prevById.has(p.id)).map(p=>p.id).sort(),['22821','23022']);
const mutable=new Set(['price_rub','price_per_m2_rub','snapshot_date','fetched_at','price_matches_listing','detail_verified']);
const stable=p=>Object.fromEntries(Object.entries(p).filter(([key])=>!mutable.has(key)));
for(const lot of a){
 assert.equal(lot.source_url.startsWith('https://sadovoe-kolco.ru/projects/mariupol/house-by-the-sea/'+lot.id),true);
 if(prevById.has(lot.id))assert.deepEqual(stable(lot),stable(prevById.get(lot.id)),'Frozen structural fact changed: '+lot.id);
}
for(const group of groups){
 const members=a.filter(lot=>lot.plan_group_id===group.id);
 assert.equal(group.count,members.length);assert.deepEqual(group.apartments,members.map(lot=>lot.id));
 assert.equal(group.price_min_rub,Math.min(...members.map(lot=>lot.price_rub)));
 assert.equal(group.price_max_rub,Math.max(...members.map(lot=>lot.price_rub)));
 assert.equal(group.furnished_sha256,members[0].plans[0].sha256);
}

const provenance=read('media-provenance');
for(const record of provenance.sources.filter(row=>row.rights_status==='owner_confirmed'))for(const output of record.outputs)assert.equal(hash(fs.readFileSync(path.join(root,output.path))),output.sha256);
// Only obsolete form hints and the removed category mode are exempt from the frozen CSS contract.
const withoutHints=css=>css.replace(/\.form-hint(?:-dot)?\{[^}]*\}\n/g,'').replace(/^\.category-(?:card|title|note|price|area|actions)[^\n]*\n/gm,'').replace(/^\.plans-style-9[^\n]*\n/gm,'');
assert.ok(withoutHints(require('./seo-contract.cjs').css(fs.readFileSync(path.join(root,'styles.css'),'utf8'))).startsWith(withoutHints(execFileSync('git',['show','b63b88e:styles.css'],{cwd:root,encoding:'utf8'}))), 'Approved CSS, including every hero breakpoint and animation, remains unchanged except removed obsolete form hints/category mode');
console.log('PASS refreshed 28 IDs, categories 4/16/6/2, 20 groups, 84 links/60 unique SVG, frozen original unit structures and hero sources');
