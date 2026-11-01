import {privacyConfig as c} from './config.js';
import {createConsentController,createAnalyticsLifecycle,deploymentBlockers,safePage} from './core.js';
import {createMetricaAdapter,createReceiptAdapter} from './metrica.js';
const deploymentOff=deploymentBlockers(c,location.hostname).length>0;
const controller=createConsentController({config:c,storage:{getItem:k=>localStorage.getItem(k),setItem:(k,v)=>localStorage.setItem(k,v)},onChange:()=>sync()});
// Snapshot authored IDs before any visitor input or third-party code can change the DOM.
const anchors=[...document.querySelectorAll('[id]')].map(el=>el.id);
const page=()=>safePage(location,c.siteOrigin,{referrer:document.referrer,anchors});
const lifecycle=createAnalyticsLifecycle({config:c,host:location.hostname,controller,adapter:createMetricaAdapter({window,document,config:c,page}),evidence:createReceiptAdapter(window.fetch.bind(window),c.receiptEndpoint),page});
// No extra pageview on anchor navigation. Stop if a later fragment is unsafe.
addEventListener('hashchange',()=>{if(!page())lifecycle.stop();});
const banner=document.createElement('aside');banner.className='privacy-banner';banner.id='cookie-banner';banner.setAttribute('aria-label','Аналитика и конфиденциальность');banner.hidden=true;
banner.setAttribute('aria-labelledby','privacy-banner-title');
banner.innerHTML='<div class="privacy-banner-copy"><h2 id="privacy-banner-title">Аналитика — по вашему выбору</h2><p>С вашего разрешения мы сможем использовать Яндекс.Метрику, чтобы понимать, как пользуются сайтом. Без аналитики сайт работает как обычно.</p></div><div class="privacy-actions"><button type="button" class="privacy-action" id="cookie-accept" data-privacy-choice="granted">Разрешить аналитику</button><button type="button" class="privacy-action" id="cookie-decline" data-privacy-choice="denied">Продолжить без аналитики</button></div><div class="privacy-banner-secondary"><p class="privacy-banner-note">Внешняя аналитика отключена. Здесь сохраняется только ваш выбор.</p><nav class="privacy-banner-links" aria-label="Подробности об аналитике"><span><a href="/consent-analytics.html">Условия согласия</a></span><button type="button" class="privacy-configure" data-privacy-settings>Настроить</button></nav></div>';
if(!deploymentOff)banner.querySelector('.privacy-banner-note').hidden=true;
document.body.append(banner);
const settings=document.createElement('dialog');settings.id='privacy-settings';settings.className='privacy-settings';settings.setAttribute('data-simple-overlay','');settings.setAttribute('aria-labelledby','privacy-title');
settings.innerHTML='<div><button type="button" class="privacy-close dialog-close" aria-label="Закрыть настройки аналитики">×</button><span class="eyebrow">КОНФИДЕНЦИАЛЬНОСТЬ</span><h2 id="privacy-title">Настройки аналитики</h2><p>Вы можете разрешить или отключить необязательную аналитику. Без неё сайт продолжит работать как обычно.</p><section class="privacy-group"><h3>Технические механизмы</h3><p>Доставка и защита сайта, форма и внешняя карта OpenStreetMap работают независимо от аналитики.</p><details class="privacy-details"><summary>Как хранится выбор</summary><p>Выбор хранится в localStorage этого домена до 180 дней: состояние, цель, версия текста, время и срок. При разрешении хранится случайная ссылка на серверное подтверждение; она не передаётся Яндексу. Это срок настройки, а не срок хранения данных у Яндекса.</p></details></section><section class="privacy-group"><label class="privacy-toggle"><input id="privacy-analytics" type="checkbox"><span><strong>Аналитика использования сайта</strong></span></label><p class="privacy-analytics-description">С вашего разрешения мы сможем использовать Яндекс.Метрику для анализа посещений. Поля форм и личные вопросы не передаются в аналитику.</p><p><a href="/consent-analytics.html" target="_blank" rel="noopener noreferrer">Условия обработки аналитических данных</a></p><p class="privacy-status">Внешняя аналитика отключена при любом выборе.</p></section><div class="privacy-actions"><button type="button" class="privacy-action" data-privacy-save>Сохранить выбор</button><button type="button" class="privacy-action" data-privacy-deny>Продолжить без аналитики</button><button type="button" class="privacy-action" data-privacy-withdraw hidden>Отозвать разрешение</button></div><p class="privacy-status" role="status" data-privacy-status></p></div>';
if(!deploymentOff)settings.querySelector('.privacy-status').textContent='Аналитика включается только после вашего разрешения и подтверждённого допуска сайта.';
document.body.append(settings);let opener=null,pageY=0;
function modalActive(){return !!document.querySelector('dialog[open]:not(#privacy-settings)')||document.querySelector('.menu-toggle')?.getAttribute('aria-expanded')==='true';}
function updateBanner(){banner.hidden=controller.state!=='unknown'||settings.open||modalActive();document.getElementById('scroll-top-btn')?.classList.toggle('no-cookie-banner',banner.hidden);}
let expiryTimer;
function sync(){clearTimeout(expiryTimer);if(controller.record)expiryTimer=setTimeout(()=>controller.refresh(),Math.min(2147483647,Math.max(1,controller.record.expiry-Date.now())));
 const updateActiveStatus=()=>{if(controller.state==='granted'&&!deploymentOff){settings.querySelector('[data-privacy-status]').textContent=lifecycle.active?'Яндекс.Метрика включена по вашему разрешению.':!page()?'Разрешение сохранено. Аналитика отключена для защиты данных в адресе страницы или источнике перехода.':'Согласие сохранено. Аналитика недоступна или заблокирована; сайт работает как обычно.';}};
 void lifecycle.sync().then(()=>{updateActiveStatus();if(controller.state==='withdrawn'&&!controller.record?.operation){settings.querySelector('[data-privacy-save]').disabled=false;settings.querySelector('[data-privacy-status]').textContent='Аналитика отключена. Отзыв подтверждён сервером.';}},updateActiveStatus);
 const state=controller.state,granted=state==='granted';
 settings.querySelector('[data-privacy-withdraw]').hidden=!granted;settings.querySelector('[data-privacy-save]').disabled=controller.record?.operation==='withdraw';
 settings.querySelector('[data-privacy-deny]').hidden=granted;
 settings.querySelector('[data-privacy-status]').textContent=controller.record?.operation==='withdraw'?'Аналитика выключена. Подтверждение отзыва будет повторено при восстановлении связи.':controller.storageAvailable?({unknown:'Согласие ещё не дано.',denied:'Аналитика отключена.',withdrawn:'Аналитика отключена.',granted:deploymentOff?'Разрешение сохранено. Внешняя аналитика отключена.':'Разрешение сохранено. Проверяем подключение аналитики…'}[state]):'Не удалось сохранить выбор в браузере. Аналитика остаётся отключённой.';updateBanner();}
function restorePrivacyFocus(){updateBanner();const target=opener?.getClientRects().length?opener:document.querySelector('.logo-link');target?.focus({preventScroll:true});}
function close(){settings.close();scrollTo({top:pageY,behavior:'instant'});restorePrivacyFocus();}
function open(from){if(modalActive())return;opener=from;pageY=scrollY;settings.querySelector('#privacy-analytics').checked=controller.state==='granted';settings.showModal();updateBanner();settings.querySelector('.privacy-close').focus();sync();}
// Fixed payload-free events; never read form fields or forward IDs/calculation values.
document.addEventListener('click',e=>{
 const a=e.target instanceof Element?e.target.closest('a[href]'):null;
 if(!a)return;
 if(a.getAttribute('href')==='tel:+79529568875')lifecycle.emit('phone_click');
 if(a.getAttribute('href')==='mailto:info@anyara.ru')lifecycle.emit('email_click');
});
for(const [dom,goal] of [['dom:lead-accepted','lead_accepted'],['dom:pdf-download','pdf_download'],['dom:plan-open','plan_open']])document.addEventListener(dom,()=>lifecycle.emit(goal));
document.addEventListener('click',e=>{const target=e.target.closest('[data-privacy-settings]');if(target){e.preventDefault();open(target);}const choice=e.target.closest('[data-privacy-choice]');if(choice){controller.choose(choice.dataset.privacyChoice);}});
settings.querySelector('.privacy-close').addEventListener('click',close);settings.addEventListener('cancel',e=>{e.preventDefault();close();});
settings.querySelector('[data-privacy-save]').addEventListener('click',()=>{const grant=settings.querySelector('#privacy-analytics').checked;controller.choose(grant?'granted':controller.state==='granted'?'withdrawn':'denied');close();});
settings.querySelector('[data-privacy-deny]').addEventListener('click',()=>{controller.choose('denied');settings.querySelector('#privacy-analytics').checked=false;close();});
settings.querySelector('[data-privacy-withdraw]').addEventListener('click',()=>{controller.choose('withdrawn');settings.querySelector('#privacy-analytics').checked=false;close();});
settings.addEventListener('keydown',e=>{if(e.key!=='Tab')return;const all=[...settings.querySelectorAll('button,input,a[href],summary')].filter(el=>!el.disabled&&el.getClientRects().length),first=all[0],last=all.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}});
new MutationObserver(updateBanner).observe(document.body,{subtree:true,attributes:true,attributeFilter:['open','aria-expanded']});
addEventListener('storage',e=>{if(e.key===c.preferenceKey||e.key===null){controller.refresh();settings.querySelector('#privacy-analytics').checked=controller.state==='granted';}});
// Normal cross-page navigation must preserve consented analytics cookies;
// browser unload stops this document. Explicit denial/withdrawal still destroys the counter.
addEventListener('online',()=>controller.refresh());
addEventListener('pageshow',()=>{controller.refresh();});
document.addEventListener('visibilitychange',()=>{controller.refresh();});
// Expiry timer, foreground refresh and every emission all fail closed. No timer implies acceptance.
sync();
