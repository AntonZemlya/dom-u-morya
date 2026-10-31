import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const root=fileURLToPath(new URL('..',import.meta.url)),php=process.env.PHP84_BIN||'php';
const run=(bin,args)=>{const p=spawnSync(bin,args,{cwd:root,encoding:'utf8'});if(p.status!==0)throw Error(p.stderr||p.stdout);return p.stdout;};
assert.equal(run(php,['-n','-r','echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;']),'8.4','Set PHP84_BIN to PHP 8.4 with OpenSSL/ctype');
for(const name of ['api/lead-core.php','api/lead.php','api/form-status.php','api/lead-smtp.php','api/smtp-manifest.php','api/lead-catalog.php','ops/config.example.php','tests/lead-contract.php'])run(php,['-n','-l',name]);
console.log(run(php,['-n','tests/lead-contract.php']).trim());
const runtime=JSON.parse(run(process.execPath,['scripts/smtp-runtime.mjs']));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'dom-smtp-'));fs.chmodSync(temp,0o700);
fs.mkdirSync(path.join(temp,'state'),{mode:0o700});
const privateRuntime=path.join(temp,runtime.identity);
fs.cpSync(runtime.privateRuntime,privateRuntime,{recursive:true});fs.chmodSync(privateRuntime,0o700);
const cert=args=>run('openssl',args);
cert(['req','-x509','-newkey','rsa:2048','-nodes','-keyout',temp+'/ca.key','-out',temp+'/ca.crt','-days','1','-subj','/CN=Local SMTP QA CA']);
cert(['req','-newkey','rsa:2048','-nodes','-keyout',temp+'/server.key','-out',temp+'/server.csr','-subj','/CN=Local SMTP QA']);
for(const [stem,san] of [['server','IP:127.0.0.1'],['wrong','DNS:wrong.invalid']]){
 fs.writeFileSync(temp+'/san',`subjectAltName=${san}\n`);
 cert(['x509','-req','-in',temp+'/server.csr','-CA',temp+'/ca.crt','-CAkey',temp+'/ca.key','-CAcreateserial','-out',temp+'/'+stem+'.crt','-days','1','-extfile',temp+'/san']);
}
for(const f of fs.readdirSync(temp))if(fs.statSync(path.join(temp,f)).isFile())fs.chmodSync(path.join(temp,f),0o600);
fs.writeFileSync(temp+'/mode','success');
const smtp=spawn('python3',['-B','tests/smtp-fixture.py',temp],{cwd:root,stdio:['ignore','ignore','pipe']});
const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const origin=`http://127.0.0.1:${port}`,cfgPath=path.join(temp,'config.php');
const base={FORM_ENABLED:true,DELIVERY_VERIFIED:true,LEGAL_APPROVED:'2026-10-30',HMAC_SECRET:'fixture-only-'.repeat(4),STATE_DIR:temp+'/state',ORIGIN:origin,
 MAIL_FROM:'sales@zhk-dom-umorya.ru',MAIL_TO:'azm1982@yandex.ru',DELIVERY_VERIFIED_TO:'azm1982@yandex.ru',LEGAL_MAIL_TO:'azm1982@yandex.ru',
 SMTP_HOST:'127.0.0.1',SMTP_SECURITY:'starttls',SMTP_USERNAME:'fixture-user',SMTP_PASSWORD:'fixture-password',SMTP_TEST_CA:temp+'/ca.crt',SMTP_RUNTIME:privateRuntime};
const config=(extra={})=>fs.writeFileSync(cfgPath,'<?php return json_decode('+JSON.stringify(JSON.stringify({...base,...extra}))+', true);',{mode:0o600});
const reset=(mode='success')=>{fs.writeFileSync(temp+'/mode',mode);fs.writeFileSync(temp+'/state/state.json','{"items":{},"rates":{}}',{mode:0o600});for(const f of ['fake-mail.json','smtp-audit.jsonl'])fs.rmSync(temp+'/'+f,{force:true});};
const mails=()=>fs.existsSync(temp+'/fake-mail.json')?JSON.parse(fs.readFileSync(temp+'/fake-mail.json')):[];
const audit=()=>fs.existsSync(temp+'/smtp-audit.jsonl')?fs.readFileSync(temp+'/smtp-audit.jsonl','utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const previewDir=path.join(root,'.test-output/form-003');fs.mkdirSync(previewDir,{recursive:true});
const plain=m=>m.body.replace(/\r\n/g,'\n').trimEnd();
const moscow=seconds=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(seconds*1000)).map(p=>[p.type,p.value]));return `${parts.day}.${parts.month}.${parts.year}, ${parts.hour}:${parts.minute}:${parts.second} МСК`;};
const privateAudit=id=>Object.values(JSON.parse(fs.readFileSync(temp+'/state/state.json')).items).find(item=>item.id===id);
const formatChecks=(m,id)=>{
 assert.equal(m.subject,'ЖК «Дом у моря» — новая заявка');assert.equal(m.messageId,'<'+id+'@zhk-dom-umorya.ru>');
 for(const secret of [id,'Оператор:','соглас','UTC','consent-personal-data.html','/#contact','family','regional','custom'])assert.ok(![m.subject,m.body].join(' ').includes(secret),'No technical value: '+secret);
 const audit=privateAudit(id);assert.equal(audit.consentVersion,'2026-10-30');assert.equal(audit.status,'accepted');
 assert.equal(plain(m).split('\n')[1],'Дата и время: '+moscow(audit.created));assert.doesNotMatch(plain(m),/\n{3,}/);
 return moscow(audit.created);
};
const preview=(m,name)=>{fs.writeFileSync(path.join(previewDir,name+'-email.txt'),'Тема: '+m.subject+'\n\n'+plain(m)+'\n');fs.copyFileSync(temp+'/received.eml',path.join(previewDir,name+'.eml'));};
let server,log='',smtpLog='';smtp.stderr.on('data',b=>{smtpLog+=b;});
try{
 for(let i=0;!fs.existsSync(temp+'/smtps-port')&&i<100;i++)await pause(50);
 assert.ok(fs.existsSync(temp+'/smtps-port'),'Local SMTP fixture started');base.SMTP_PORT=Number(fs.readFileSync(temp+'/smtp-port'));config();
 assert.ok(fs.existsSync(path.join(root,'dist/api/lead-smtp.php')),'Build dist first');
 // Real public handlers in built dist, without a PHP router or fake callback.
 server=spawn(php,['-n','-d','disable_functions=mail','-d','display_errors=0','-S',`127.0.0.1:${port}`,'-t',path.join(root,'dist')],
  {cwd:root,env:{...process.env,LEAD_CONFIG:cfgPath,LEAD_SMTP_TEST:'1'},stdio:['ignore','ignore','pipe']});server.stderr.on('data',b=>{log+=b;});
 let ready=false;for(let i=0;i<100;i++){try{await fetch(origin+'/api/form-status.php');ready=true;break;}catch{}await pause(50);}assert.ok(ready);
 const payload={name:'Синтетический SMTP E2E',phone:'+70000000000',consent:true,consentVersion:'2026-10-30',lotId:'22825',category:'studio',planView:'furnished',
  requestKind:'calc',email:'synthetic@example.invalid',channel:'Telegram',callTime:'12-15',calculation:{price:6978183,downPct:20,term:20,rate:6,program:'family'}};
 const post=(p=payload,key=randomUUID(),headers={})=>fetch(origin+'/api/lead.php',{method:'POST',headers:{'Content-Type':'application/json','Origin':origin,'X-Lead-Request':'1','Idempotency-Key':key,...headers},body:typeof p==='string'?p:JSON.stringify(p)});
 const status=async()=>await(await fetch(origin+'/api/form-status.php')).json();
 reset();assert.equal((await status()).enabled,true);const key=randomUUID(),accepted=await post(payload,key);assert.equal(accepted.status,202);const result=await accepted.json();
 assert.match(accepted.headers.get('cache-control'),/no-store/);assert.equal(mails().length,1);const m=mails()[0];
 const fullDate=formatChecks(m,result.id);
 assert.equal(m.from,'ЖК Дом у моря <sales@zhk-dom-umorya.ru>');assert.equal(m.to,'azm1982@yandex.ru');assert.equal(m.replyTo,payload.email);
 assert.equal(m.sender,'<sales@zhk-dom-umorya.ru>');assert.deepEqual(m.recipients,['<azm1982@yandex.ru>']);assert.equal(m.contentType,'text/plain');assert.equal(m.charset,'utf-8');assert.equal(m.encoding,'base64');
 assert.equal(plain(m),['Новая заявка с сайта ЖК «Дом у моря»','Дата и время: '+fullDate,'','КОНТАКТЫ','Имя: '+payload.name,'Телефон: '+payload.phone,
  'E-mail: '+payload.email,'Способ связи: Telegram','Удобное время: 12:00–15:00','','КВАРТИРА','Категория: Студия','Квартира № 6 (лот 22825)',
  'Этаж: 2','Площадь: 29 м²','Стоимость по каталогу: 6 978 183 ₽','Вид планировки: с мебелью','','ИПОТЕЧНЫЙ РАСЧЁТ','Стоимость для расчёта: 6 978 183 ₽',
  'Первоначальный взнос: 20%','Срок: 20 лет','Ставка: 6%','Программа: Семейная ипотека','','Расчёт предварительный и не является предложением банка.',
  '', 'Стоимость и наличие квартиры требуют подтверждения агентством.'].join('\n'));
 preview(m,'full');
 assert.ok(audit().some(x=>x.auth===true&&x.tls));assert.ok(audit().filter(x=>['AUTH','MAIL','RCPT','DATA'].includes(x.command)).every(x=>x.tls));
 assert.equal((await post(payload,key)).status,202);assert.equal((await post(payload)).status,202);assert.equal(mails().length,1);assert.equal((await post({...payload,name:'Изменено'},key)).status,409);
 reset();const concurrentKey=randomUUID(),concurrent=await Promise.all([post(payload,concurrentKey),post(payload,concurrentKey)]);assert.ok(concurrent.every(r=>r.status===202));assert.equal(mails().length,1);
 console.log('PASS FORM-003 full received MIME: exact human subject/body, Moscow seconds, private consent audit, unchanged Message-ID/Reply-To/TLS/replay');
 for(const mode of ['no_starttls','wrong_name','auth_fail','rcpt_fail','data_fail','accept_drop','accept_timeout']){
  reset(mode);config();const key=randomUUID(),reply=await post(payload,key);assert.equal(reply.status,502,mode);assert.equal((await reply.json()).error,'mail_unavailable');
  const stored=mails().length;assert.equal(stored,['accept_drop','accept_timeout'].includes(mode)?1:0,mode);
  const replay=await post(payload,key);assert.equal(replay.status,409);assert.equal((await replay.json()).error,'delivery_uncertain');assert.equal(mails().length,stored);
  assert.equal((await post(payload)).status,409);assert.equal(mails().length,stored);if(['no_starttls','wrong_name'].includes(mode))assert.ok(!audit().some(x=>x.command==='AUTH'));
 }
 console.log('PASS absent STARTTLS, wrong TLS hostname, AUTH/RCPT/DATA errors, accepted-then-disconnect/timeout: opaque errors and no duplicate sends');
 reset();config({SMTP_TEST_CA:temp+'/server.crt'});assert.equal((await post()).status,502);assert.equal(mails().length,0);assert.ok(!audit().some(x=>x.command==='AUTH'));
 reset();config({SMTP_PORT:Number(fs.readFileSync(temp+'/smtps-port')),SMTP_SECURITY:'smtps'});assert.equal((await post()).status,202);assert.equal(mails().length,1);
 reset();config({MAIL_TO:'info@anyara.ru'});assert.equal((await status()).enabled,false);assert.equal((await post()).status,503);assert.equal(mails().length,0);
 config({MAIL_TO:'info@anyara.ru',DELIVERY_VERIFIED_TO:'info@anyara.ru',LEGAL_MAIL_TO:'info@anyara.ru'});assert.equal((await post()).status,202);assert.equal(mails()[0].to,'info@anyara.ru');
 for(const extra of [{SMTP_SECURITY:'plain'},{SMTP_HOST:'external.invalid'},{MAIL_TO:'intruder@example.invalid'},{SMTP_PASSWORD:''},{SMTP_RUNTIME:root},{FORM_ENABLED:false},{LEGAL_MAIL_TO:''},{DELIVERY_VERIFIED_TO:''}]){
  reset();config(extra);assert.equal((await status()).enabled,false);assert.ok([502,503].includes((await post()).status));assert.equal(mails().length,0);
 }
 reset();config();
 for(const bad of [{...payload,to:'intruder@example.invalid'},{...payload,MAIL_TO:'info@anyara.ru'},{...payload,consent:false},{...payload,name:'Bad\r\nBcc: inject@example.invalid'},
  {...payload,email:'a@example.invalid\r\nBcc: b@example.invalid'},{...payload,name:'<b>HTML</b>'},{...payload,website:'bot'},{...payload,lotId:'does-not-exist'},
  {...payload,calculation:{...payload.calculation,price:7000000}}])assert.equal((await post(bad)).status,422);
 for(const [raw,headers,code] of [['{broken',{},400],['[]',{},400],['{}',{'Origin':'https://forged.invalid'},403],['{}',{'Content-Type':'text/plain'},415],['x'.repeat(8193),{},413],['{}',{'Idempotency-Key':''},400]]){
  const r=await post(raw,randomUUID(),headers);assert.equal(r.status,code);assert.match(r.headers.get('cache-control'),/no-store/);assert.equal(r.headers.get('access-control-allow-origin'),null);
 }
 assert.equal((await fetch(origin+'/api/lead.php')).status,405);assert.equal(mails().length,0);
 reset();const minimal={name:payload.name,phone:payload.phone,consent:true,consentVersion:payload.consentVersion};const minimalResponse=await post(minimal);assert.equal(minimalResponse.status,202);
 const minimalResult=await minimalResponse.json();const minimalMail=mails()[0];const minimalDate=formatChecks(minimalMail,minimalResult.id);
 assert.equal(minimalMail.replyTo,'');assert.equal(minimalMail.contentType,'text/plain');assert.equal(minimalMail.charset,'utf-8');
 assert.equal(plain(minimalMail),['Новая заявка с сайта ЖК «Дом у моря»','Дата и время: '+minimalDate,'','КОНТАКТЫ','Имя: '+payload.name,'Телефон: '+payload.phone].join('\n'));
 for(const absent of ['E-mail:','Способ связи:','Удобное время:','Категория:','Вид планировки:','не указан','КВАРТИРА','ИПОТЕЧНЫЙ РАСЧЁТ'])assert.ok(!minimalMail.body.includes(absent));
 preview(minimalMail,'minimal');
 fs.writeFileSync(path.join(previewDir,'format-results.json'),JSON.stringify({full_received_mime:'PASS',minimal_received_mime:'PASS',
  subject:'ЖК «Дом у моря» — новая заявка',full_moscow_time:fullDate,minimal_moscow_time:minimalDate,
  private_consent_audit_preserved:true,header_message_id_preserved:true,reply_to_preserved:true,public_or_real_mail:false},null,2)+'\n');
 console.log('PASS FORM-003 minimal received MIME: only actual contact fields, no empty sections; full/minimal previews saved');
 for(let i=0;i<2;i++)assert.equal((await post({...minimal,name:'Синтетический '+i})).status,202);assert.equal((await post({...minimal,name:'Лимит'})).status,429);assert.equal(mails().length,3);
 reset();config();fs.chmodSync(cfgPath,0o644);assert.equal((await status()).enabled,false);assert.equal((await post(payload,randomUUID(),{'Origin':'https://zhk-dom-umorya.ru'})).status,503);fs.chmodSync(cfgPath,0o600);
 console.log('PASS untrusted CA, explicit SMTPS, recipient/approval binding, config permissions, injection/JSON/Origin/size/rate limits and optional-field omission');
 reset();config();const child=spawn(process.execPath,['tests/lead-browser.cjs'],{cwd:root,env:{...process.env,LEAD_QA_URL:origin,LEAD_QA_DIR:temp},stdio:'inherit'});
 assert.equal(await new Promise(r=>child.once('exit',r)),0,'Browser SMTP E2E');
 for(const source of [log,smtpLog,fs.readFileSync(temp+'/smtp-audit.jsonl','utf8')])for(const secret of [payload.name,payload.phone,payload.email,base.SMTP_PASSWORD,base.SMTP_USERNAME,Buffer.from(base.SMTP_PASSWORD).toString('base64')])assert.ok(!source.includes(secret),'No credentials or payload in logs');
 const state=fs.readFileSync(temp+'/state/state.json','utf8');for(const secret of [payload.name,payload.phone,payload.email,base.SMTP_PASSWORD,'127.0.0.1'])assert.ok(!state.includes(secret));
 console.log('PASS no credentials/PII in technical logs or state; all deliveries captured only in disposable loopback sink');
} finally {
 for(const child of [server,smtp].filter(Boolean)){child.kill('SIGTERM');await new Promise(r=>child.exitCode!==null||child.signalCode!==null?r():child.once('exit',r));}
 fs.rmSync(temp,{recursive:true,force:true});console.log('Local PHP/SMTP stopped; private config, certificates, captured messages and state removed');
}
