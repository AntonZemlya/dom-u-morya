import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
const root=fileURLToPath(new URL('..',import.meta.url));
const php=process.env.PHP84_BIN||'php';
const run=args=>{const p=spawnSync(php,['-n',...args],{cwd:root,encoding:'utf8'});if(p.status!==0)throw Error(p.stderr||p.stdout);process.stdout.write(p.stdout);};
const version=spawnSync(php,['-n','-r','echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;'],{encoding:'utf8'});
if(version.stdout!=='8.4')throw Error('Set PHP84_BIN to a PHP 8.4 binary');
for(const name of ['api/lead-core.php','api/lead.php','api/form-status.php','ops/config.example.php','tests/lead-contract.php','tests/lead-router.php'])run(['-l',name]);
run(['tests/lead-contract.php']);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'dom-form-browser-'));fs.chmodSync(temp,0o700);
fs.mkdirSync(path.join(temp,'state'),{mode:0o700});
const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const origin=`http://127.0.0.1:${port}`;
const cfg=path.join(temp,'config.php');
fs.writeFileSync(cfg,`<?php return ['FORM_ENABLED'=>true,'DELIVERY_VERIFIED'=>true,'LEGAL_APPROVED'=>'2026-10-30','HMAC_SECRET'=>'${'test-fixture-'.repeat(4)}','STATE_DIR'=>'${temp}/state','ORIGIN'=>'${origin}'];`,{mode:0o600});
// Real mail is disabled at the PHP runtime as well as replaced by a test callback.
const server=spawn(php,['-n','-d','disable_functions=mail','-d','display_errors=0','-S',`127.0.0.1:${port}`,'-t',root,path.join(root,'tests/lead-router.php')],{cwd:root,env:{...process.env,LEAD_CONFIG:cfg},stdio:['ignore','ignore','pipe']});
let log='';server.stderr.on('data',b=>{log=(log+b).slice(-4000)});
try{
 let ready=false;for(let i=0;i<100;i++){try{await fetch(origin+'/api/form-status.php');ready=true;break;}catch{}await new Promise(r=>setTimeout(r,50));}
 if(!ready)throw Error('Temporary PHP server failed: '+log);
 const child=spawn(process.execPath,['tests/lead-browser.cjs'],{cwd:root,env:{...process.env,LEAD_QA_URL:origin,LEAD_QA_DIR:temp},stdio:'inherit'});
 const status=await new Promise(r=>child.once('exit',r));if(status!==0)throw Error('Browser form QA failed');
}finally{
 server.kill('SIGTERM');await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));
 fs.rmSync(temp,{recursive:true,force:true});
 console.log('Temporary PHP server stopped; fake messages and private test state removed');
}
