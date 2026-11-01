// Adapted from Rehab Profi ab3e365: versioned choice and epoch/abort lifecycle.
const DAY=86400000, tokenPattern=/^[a-f0-9]{64}$/;
export function validRecord(raw,c,now=Date.now()){
 try{const r=JSON.parse(raw);
  if(!r||r.schemaVersion!==c.schemaVersion||r.consentVersion!==c.analyticsConsentVersion||r.purpose!==c.purpose
   ||!['denied','granted','withdrawn'].includes(r.choice)||!Number.isFinite(r.time)||!Number.isFinite(r.expiry)
   ||r.time>now+300000||r.expiry<=now||r.expiry-r.time>c.preferenceTtlDays*DAY)return null;
  if(r.choice==='granted'&&(!tokenPattern.test(r.token)||!['allow','validate'].includes(r.operation)))return null;
  if(r.token&&!tokenPattern.test(r.token))return null;
  return r;
 }catch{return null;}
}
export function deploymentBlockers(c,host){return [!c.analyticsEnabled&&'deployment_off',!c.operatorPolicyApproved&&'policy_unapproved',
 !c.approvedProductionHosts.includes(host)&&'host_unapproved',!(Number.isSafeInteger(c.metricaCounterId)&&c.metricaCounterId>0)&&'counter_missing',
 !(c.consentEvidenceMode==='server-receipt'&&/^\/[a-z/-]+\.php$/.test(c.receiptEndpoint))&&'receipt_unavailable',
 !c.vendorPayloadReviewApproved&&'vendor_payload_unverified'].filter(Boolean);}
export function createConsentController({config:c,storage,clock=Date.now,onChange=()=>{},randomToken=()=>{
 const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}}){
 let record=null,storageAvailable=true,explicitAllow=false;
 const save=next=>{try{storage.setItem(c.preferenceKey,JSON.stringify(next));storageAvailable=true;record=next;return true;}
 catch{storageAvailable=false;record=null;return false;}};
 function read(){explicitAllow=false;if(record?.operation==='withdraw'&&!storageAvailable)return;try{record=validRecord(storage.getItem(c.preferenceKey),c,clock());storageAvailable=true;}catch{storageAvailable=false;record=null;}}
 read();return {
  get mayAllow(){return explicitAllow;},get state(){return validRecord(JSON.stringify(record),c,clock())?.choice||'unknown';},get record(){return record;},get storageAvailable(){return storageAvailable;},
  refresh(){read();onChange();},
  choose(choice){if(!['denied','granted','withdrawn'].includes(choice))return false;
   // Keep an unconfirmed withdrawal capability until acknowledged; never re-enable on retry.
   if(choice==='granted'&&record?.operation==='withdraw')return false;
   if(choice==='granted'&&this.state==='granted'){if(record.operation==='allow'){const now=clock();save({...record,time:now,expiry:now+c.preferenceTtlDays*DAY});}explicitAllow=true;onChange();return true;}
   const time=clock(),next={schemaVersion:c.schemaVersion,consentVersion:c.analyticsConsentVersion,purpose:c.purpose,choice,time,expiry:time+c.preferenceTtlDays*DAY};
   if(choice==='granted'){next.token=randomToken();next.operation='allow';}
   else if(record?.token&&(record.choice==='granted'||record.operation==='withdraw')){next.choice='withdrawn';next.token=record.token;next.operation='withdraw';}
   explicitAllow=choice==='granted';const ok=save(next);if(!ok&&next.operation==='withdraw')record=next;onChange();return ok;
  },
  confirm(token,r){if(this.state!=='granted'||record.token!==token)return false;
   // The server owns the original date and expiry; validation never extends them.
   explicitAllow=false;return save({...record,operation:'validate',time:r.receivedAt,expiry:r.expiresAt});},
  withdrawn(token){if(record?.token!==token||record.operation!=='withdraw')return;const {token:_,operation:__,...next}=record;save(next);}
 };
}
// Fixed routes and a deliberately small attribution vocabulary. Unknown data fails closed.
// tag.js can read the real document, so filtering just the explicit hit is insufficient.
export const metricaPaths=Object.freeze(['/','/index.html','/privacy.html','/consent-personal-data.html','/consent-analytics.html']);
const allowedPaths=new Set(metricaPaths);
// These are channel/campaign labels, never visitor-supplied free text.
// Neutral lower-case campaign slugs; no clinic dictionary. Syntax cannot prove provenance.
function campaignLabel(value){return value.length<=96 && /^[a-z][a-z0-9_-]*$/.test(value)
 && !/[0-9]{10,}/.test(value) && !/(?:private|sentinel|token|password|secret|email|phone|firstname|lastname)/i.test(value);}
function clickId(key,value){
 // Provider IDs are opaque; reject free text, phone-sized numbers and encoded data.
 // This validates the transport shape, not the provenance of a purported ad click.
 const numeric=/^[0-9]{1,9}$/.test(value)||/^[0-9]{12,24}$/.test(value);
 if(['yclid','ymclid','yzclid'].includes(key))return numeric;
 const format=key==='ysclid'?/^[a-z0-9]{5,32}$/:key==='gclid'?/^[A-Za-z0-9_-]{20,128}$/:/^[A-Za-z0-9_-]{5,64}$/;
 return numeric||(format.test(value)&&/[a-zA-Z]/.test(value)&&/[0-9]/.test(value)&&!/[0-9]{10,}/.test(value));
}
const clickKeys=new Set(['yclid','ysclid','gclid','yqrid','ymclid','yzclid']);
export function safeReferrer(raw,origin){
 if(!raw)return '';
 try{
  if(raw.length>512||/[\\\s%]/.test(raw))return null;
  const u=new URL(raw);
  if(u.href!==raw||!['https:','http:'].includes(u.protocol)||u.username||u.password||u.hash||u.port)return null;
  if(!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(u.hostname)||u.hostname.includes('xn--'))return null;
  if(u.search&&(u.origin!==origin||!safePage(u,origin,{referrer:''})))return null;
  // Arbitrary referral paths can contain names, tokens or private conversation IDs.
  if(u.pathname!=='/'&&!(u.origin===origin&&allowedPaths.has(u.pathname))&&
   !(/^https:\/\/(?:yandex\.ru|yandex\.com|ya\.ru)$/.test(u.origin)&&/^\/maps\/?$/.test(u.pathname)))return null;
  return u.origin===origin?new URL(u.pathname+u.search,origin).href:u.origin+'/';
 }catch{return null;}
}
export function safePage(location,origin,context){
 // During the three-file release an older privacy.js may import the new core.
 // Keep its original query/hash block until the referrer-aware caller is installed.
 if(!context&&(location.search||location.hash))return null;
 const {referrer='',anchors=[]}=context||{};
 const path=location.pathname;
 if(!allowedPaths.has(path))return null;
 if(location.href){try{const u=new URL(location.href);if(u.protocol!=='https:'||u.username||u.password)return null;}catch{return null;}}
 // Only site-authored anchors (plus the neutral documented example) may be
 // visible to the tag. No arbitrary fragment/free text; native navigation stays intact.
 if(location.hash&&location.hash!=='#section'&&!anchors.includes(location.hash.slice(1)))return null;
 const referer=safeReferrer(referrer,origin);
 if(referer===null)return null;
 const search=location.search||'';
 if(search.length>1024)return null;
 const seen=new Set();
 if(search){
  // Require the actual vendor-visible bytes to match the accepted representation:
  // URLSearchParams alone would quietly repair malformed escapes, duplicates, '+', etc.
  if(!/^\?[^?#]+$/.test(search))return null;
  for(const pair of search.slice(1).split('&')){
   const match=/^([a-z_]+)=([A-Za-z0-9_.:/-]+)$/.exec(pair);
   if(!match||seen.has(match[1]))return null;
   const [,key,value]=match;seen.add(key);
   if(clickKeys.has(key)){if(!clickId(key,value))return null;}
   else if(key==='utm_source'){if(!campaignLabel(value))return null;}
   else if(key==='utm_medium'){if(!campaignLabel(value))return null;}
   else if(['utm_campaign','utm_content','utm_term'].includes(key)){if(!campaignLabel(value))return null;}
   else if(key==='utm_referrer'){const url=value.includes('://')?value:'https://'+value+'/';if(safeReferrer(url,origin)!==url)return null;}
   else return null;
  }
 }
 return {url:new URL(path+search,origin).href,title:'ЖК «Дом у моря»',referer};
}

export function createAnalyticsLifecycle({config:c,host,controller,adapter,evidence,page}){
 let epoch=0,pending=null,active=false,wanted=false,withdrawPending=null;
 const eligible=()=>controller.state==='granted'&&deploymentBlockers(c,host).length===0&&page()!==null;
 function stop(){++epoch;pending?.abort();pending=null;wanted=false;adapter.stop();active=false;}
 return {async sync(){
   const r=controller.record;
   if(r?.operation==='withdraw'){
    stop();if(withdrawPending){await withdrawPending;return controller.record?.operation==='withdraw'?this.sync():undefined;}
    withdrawPending=Promise.resolve().then(()=>evidence({action:'withdraw',token:r.token,purpose:c.purpose,consentVersion:c.analyticsConsentVersion}))
     .then(()=>controller.withdrawn(r.token)).catch(()=>{}).finally(()=>{withdrawPending=null;});return withdrawPending;
   }
   if(!eligible()){stop();return;}
   if(wanted){if(active){const ticket=epoch;try{await evidence({action:'validate',token:r.token,purpose:c.purpose,consentVersion:c.analyticsConsentVersion});}
    catch{if(ticket===epoch)stop();}}return;}wanted=true;
   const ticket=++epoch,abort=new AbortController();pending=abort;
   try{
    const payload={purpose:c.purpose,consentVersion:c.analyticsConsentVersion,action:r.operation==='allow'&&controller.mayAllow?'allow':'validate',token:r.token};
    if(payload.action==='allow')payload.clientTime=r.time;
    const receipt=await evidence(payload,abort.signal);
    if(ticket!==epoch||abort.signal.aborted||!eligible()||!controller.confirm(r.token,receipt))return;
    await adapter.start(abort.signal);
    if(ticket!==epoch||abort.signal.aborted||!eligible())return;
    active=true;pending=null;adapter.pageview(page());
   }catch{if(ticket===epoch)stop();}
  },stop,
  emit(name){if(!active||!eligible()){if(!eligible())stop();return false;}
   if(!c.allowedEvents.includes(name))return false;adapter.event(name);return true;},get active(){return active;}
 };
}
