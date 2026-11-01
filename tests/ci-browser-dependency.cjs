const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();console.log(await b.version());await b.close();})().catch(e=>{console.error(e);process.exitCode=1});
