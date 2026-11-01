import {safePage} from './core.js';
// Official ym adapter. No script or global queue is created until the lifecycle permits start.
// Payload review/account settings are an independent mandatory production gate.
export function createMetricaAdapter({window:w,document:d,config:c,page=()=>safePage(w.location,c.siteOrigin,{referrer:d.referrer})}){
 let script=null,initialized=false,loaded=false;
 const id=c.metricaCounterId;
 function purge(){
  for(const key of [...c.analyticsStorageKeys,...['lastHit','lsid','reqNum'].map(s=>'_ym'+id+'_'+s)]){try{w.localStorage.removeItem(key);}catch{}}
  for(const key of ['_ym_debugger_state','_ym_turbo_uid']){try{w.sessionStorage?.removeItem(key);}catch{}}
  for(const name of c.analyticsCookieNames){if(!/^_ym_[a-zA-Z0-9_]+$/.test(name))continue;
   for(const domain of ['',w.location.hostname])d.cookie=name+'=; Max-Age=0; Path=/; SameSite=Lax'+(domain?'; Domain='+domain:'');
  }
 }
 function stop(){w['disableYaCounter'+id]=true;script?.remove();script=null;if(initialized){w.ym?.(id,'destruct');initialized=false;}purge();}
 return {
  async start(signal){if(signal.aborted||!page())throw Error('Unsafe analytics context');w['disableYaCounter'+id]=false;
   // Metrica requires its bootstrap function before tag.js executes.
   if(!w.ym){w.ym=function(){(w.ym.a=w.ym.a||[]).push(arguments);};w.ym.l=Date.now();}
   if(!loaded){
    // Fetch is abortable; removing a downloading <script> alone cannot stop its
    // late execution. Recheck before synchronous insertion so no tag can read
    // an unsafe URL after withdrawal or a fragment change during the download.
    const response=await w.fetch('https://mc.yandex.ru/metrika/tag.js',{mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',signal});
    if(!response.ok)throw Error('Analytics unavailable');
    const source=await response.text();
    if(signal.aborted||!page())throw Error('Unsafe analytics context');
    script=d.createElement('script');script.textContent=source;d.head.append(script);loaded=true;
   }
   const current=page();
   if(signal.aborted||!current)throw Error('Unsafe analytics context');
   w.ym(id,'init',{url:current.url,referrer:current.referer,defer:true,webvisor:false,clickmap:false,trackLinks:false,trackHash:false,accurateTrackBounce:false,ecommerce:false,sendTitle:false,disableYtm:true});initialized=true;
  },
  pageview(page){if(initialized&&page)w.ym(id,'hit',page.url,{title:page.title,referer:page.referer});},
  event(name){if(initialized)w.ym(id,'reachGoal',name);},stop
 };
}
export function createReceiptAdapter(fetcher,endpoint){return async (payload,signal)=>{
 const response=await fetcher(endpoint,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
 referrerPolicy:'no-referrer',cache:'no-store',body:JSON.stringify(payload),signal});
 if(!response.ok)throw Error('Receipt unavailable');const r=await response.json();
 if(r.schemaVersion!==1||r.purpose!==payload.purpose||r.consentVersion!==payload.consentVersion||r.action!==payload.action||r.mode==='mock-only')throw Error('Invalid receipt');
 if(payload.action!=='withdraw'&&(!/^[a-f0-9]{32}$/.test(r.receiptId)||!Number.isSafeInteger(r.receivedAt)
  ||!Number.isSafeInteger(r.expiresAt)||r.expiresAt<=Date.now()||r.expiresAt-r.receivedAt!==180*86400000||!/^[a-f0-9]{64}$/.test(r.documentSha256)))throw Error('Invalid receipt');
 return r;
};}
