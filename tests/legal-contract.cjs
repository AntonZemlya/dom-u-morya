const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {withNofollow}=require('./external-links.cjs');
module.exports=function legalContract(root){
 for(const [name,sections] of [['privacy.html',['general','data','operations','conditions','security','updates']],['consent-personal-data.html',['confirmation','duration','withdrawal']]]){
  const html=fs.readFileSync(path.join(root,name),'utf8');
  const old=withNofollow(execFileSync('git',['show','f2f61dd:'+name],{cwd:root,encoding:'utf8'}));
  const unchanged=text=>{
   for(const id of sections)text=text.replace(new RegExp(`<section id="${id}"[\\s\\S]*?<\\/section>`),'');
   return text.replace(/<p class="legal-date">[\s\S]*?<\/p>/,'');
  };
  assert.equal(unchanged(html),unchanged(old),'Only FORM-004 legal content boundaries may change: '+name);
  for(const value of ['ИП Саврасов','2026-10-31','Jino','sales@zhk-dom-umorya.ru','info@anyara.ru','azm1982@yandex.ru','SMTP','STARTTLS','пока не установлены','не более 30 дней','рассыл'])assert.ok(html.includes(value),name+': '+value);
  assert.doesNotMatch(html,/Сейчас отправка формы на сайте не подключена|Код сайта не отправляет поля|серверный приём формы не подключён/);
 }
};
