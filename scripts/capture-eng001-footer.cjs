// Capture only through the one approved preview; always restore ENG-001 afterwards.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {root,browser,stable,maskMap}=require('../tests/helpers.cjs');
const preview='/Users/azm1982/Documents/Projects/dom-u-morya-preview/preview.py';
const before='/Users/azm1982/.codex/worktrees/dom-u-morya-design-v22/dom-u-morya/dist';
const after=path.join(root,'dist'),out=path.join(root,'review/eng-001');
const use=dir=>execFileSync('python3',[preview,'use',dir]);
const normalize=s=>s.replace(/\?build=[a-f0-9]+/g,'').replace(/<meta name="dom-preview-revision" content="[^"]+">/,'');
(async()=>{
 assert.equal(fs.readFileSync(path.join(before,'index.html'),'utf8'),execFileSync('git',['show','1d79ebc:index.html'],{cwd:root,encoding:'utf8'}));
 fs.mkdirSync(out,{recursive:true});const b=await browser();
 try{
  for(const [label,dir] of [['before',before],['after',after]]){
   use(dir);
   assert.equal(normalize(await (await fetch('http://127.0.0.1:4183/')).text()),fs.readFileSync(path.join(dir,'index.html'),'utf8'));
   for(const width of [1440,768,390,320]){
    const p=await b.newPage({viewport:{width,height:width<500?844:1000},reducedMotion:'reduce'});
    await maskMap(p);await p.goto('http://127.0.0.1:4183/');await stable(p);await p.locator('#cookie-decline').click();
    await p.locator('footer').scrollIntoViewIfNeeded();
    await p.locator('footer img').evaluateAll(imgs=>Promise.all(imgs.map(i=>i.decode())));
    // Only browser capture styling: omit floating header/back-to-top over the footer.
    await p.addStyleTag({content:'#site-header,#scroll-top-btn{visibility:hidden!important}'});
    await p.locator('footer').screenshot({path:path.join(out,`footer-${label}-${width}.png`)});await p.close();
   }
   console.log('CAPTURED footer '+label+': 1440/768/390/320; source matched preview');
  }
 }finally{use(after);await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
