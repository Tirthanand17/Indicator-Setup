'use strict';
const $=id=>document.getElementById(id);
const request=m=>new Promise(resolve=>chrome.runtime.sendMessage(m,r=>resolve(chrome.runtime.lastError?{error:chrome.runtime.lastError.message}:r||{error:'No reply'})));
const n=v=>Number.isFinite(v)?v.toLocaleString('en-IN',{maximumFractionDigits:4}):'—';
function renderValues(v){const root=$('values');root.replaceChildren();if(!v){root.textContent='Waiting for live chart values…';return;}
 const items=[['Symbol',v.symbol],['Candle','5 minutes (forming)'],['Futures last / C',n(v.close)],['Futures volume',n(v.volume)],['VWAP · yellow',n(v.vwap)],['EMA 9 · blue',n(v.ema9)],['EMA 21 · purple',n(v.ema21)],['+DI · green',n(v.plusDI)],['−DI · red',n(v.minusDI)],['ADX · pink',n(v.adx)],['ATR · orange',n(v.atr)]];
 for(const [label,value]of items){const box=document.createElement('div');box.className='metric';const l=document.createElement('small');l.textContent=label;const val=document.createElement('strong');val.textContent=value;box.append(l,val);root.append(box);}}
function time(v){return v?new Date(v).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',hour12:true,day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';}
function displayLog(logs){const root=$('logs');root.replaceChildren();(logs||[]).slice(0,20).forEach(log=>{const li=document.createElement('li');li.textContent=`${time(log.at)} · ${log.status} · ${log.symbol||''} · ${(log.reasons||[]).join('; ')}`;root.append(li);});}
async function refresh(){const r=await request({type:'GET_STATE'});if(r.error){$('chart').textContent='Error: '+r.error;return;}
 $('autoEnabled').checked=!!r.autoEnabled;$('armed').checked=!!r.armed;
 $('chart').textContent=r.chartOpen?`Kite chart open: ${r.chartSymbol}. Automatic read: ${r.lastReadAt&&Date.now()-r.lastReadAt<15000?'RUNNING':'WAITING'}.`:'WAIT_DATA — open the current-month NIFTY futures chart.';
 $('updated').textContent=r.lastReadAt?`Last visible-value reading: ${time(r.lastReadAt)} IST`:'No chart values received from nested TradingView frame.';
 renderValues(r.latest);
 const state=$('result');state.textContent=r.status||'WAIT_DATA';state.className='result '+(r.status==='REVIEW_CE'?'good':r.status==='REVIEW_PE'?'bad':r.status==='WAIT_DATA'?'muted':'');
 $('reasons').textContent=(r.reasons||[]).join(' · ');
 $('closedBar').textContent=r.lastCandle?`Last recorded near-close 5-minute sample: ${time(r.lastCandle.end)} IST; source captured ${time(r.lastCandle.observedAt)} IST. Completed observations collected: ${r.barCount}. Quality: ${r.quality}.`:'Waiting for a candle boundary with a reading from its final seconds.';
 $('virtual').textContent=r.virtual?`Paper-only ${r.virtual.direction} example based on NIFTY FUTURES: reference ${n(r.virtual.entry)}, underlying invalidation ${n(r.virtual.stop)}, underlying target ${n(r.virtual.target)}. NOT an actual CE/PE position.`:'No virtual candidate active; extension has no broker holdings access.';
 displayLog(r.logs);
}
$('autoEnabled').addEventListener('change',async e=>{const r=await request({type:'SET_AUTOMATIC',enabled:e.target.checked});if(r.error)alert(r.error);refresh();});
$('armed').addEventListener('change',async e=>{const r=await request({type:'SET_ARMED',armed:e.target.checked});if(r.error)alert(r.error);refresh();});
$('test').addEventListener('click',async()=>{const r=await request({type:'TEST_NOTICE'});if(r.error)alert('Notification test failed: '+r.error);});
$('reset').addEventListener('click',async()=>{const r=await request({type:'RESET_MONITOR'});if(r.error)alert(r.error);refresh();});

let activePairCode=null;
async function renderPhone(){
 const state=await request({type:'PHONE_STATUS'});
 if(state.error){$('phoneStatus').textContent='Telegram status error: '+state.error;return;}
 $('phoneStatus').textContent=state.linked?'Paired to @'+(state.botUsername||'bot')+' (private chat ending '+state.chatTail+'). Telegram alerts '+(state.enabled?'ENABLED':'PAUSED')+'.':'Not paired — phone notifications are OFF.';
 $('phoneEnabled').disabled=!state.linked;
 $('phoneEnabled').checked=!!state.enabled;
 $('phoneTest').disabled=!state.linked;
 $('phoneForget').disabled=!state.linked;
 let delivery=state.lastDelivery;
 $('phoneLastDelivery').textContent=!delivery?'No Telegram delivery attempted.':('Last phone delivery ('+delivery.status+'): '+(delivery.ok?'CONFIRMED by Telegram API':'FAILED: '+(delivery.error||'unknown'))+' at '+time(delivery.at)+'.');
}
function phoneFeedback(s){$('phoneSetupResult').textContent=s;}
$('phoneBegin').addEventListener('click',async()=>{
 const r=await request({type:'PHONE_BEGIN_PAIR'});
 if(r.error){phoneFeedback(r.error);return;}
 activePairCode=r.code;
 $('phoneCode').textContent=r.code;
 phoneFeedback('Generated. Message your own Telegram bot with /start '+r.code+'. Pair within 10 minutes.');
});
$('phoneCopy').addEventListener('click',async()=>{
 if(!activePairCode){phoneFeedback('Generate a code first.');return;}
 try{await navigator.clipboard.writeText('/start '+activePairCode);phoneFeedback('Copied your unique /start code. Paste it into your Telegram bot chat on the phone.');}
 catch{phoneFeedback('Clipboard unavailable; copy the shown code manually.');}
});
$('phonePair').addEventListener('click',async()=>{
 if(!activePairCode){phoneFeedback('Generate a pairing code and send /start CODE to the new Telegram bot first.');return;}
 const token=$('phoneToken').value.trim();
 if(!token){phoneFeedback('Paste your BotFather token in the local dashboard input.');return;}
 $('phonePair').disabled=true;
 phoneFeedback('Checking optional Telegram permission, then pairing only to the matching private chat…');
 try{
   const granted=await chrome.permissions.request({origins:['https://api.telegram.org/*']});
   if(!granted){phoneFeedback('Permission denied. Phone notifications remain OFF.');return;}
   const r=await request({type:'PHONE_PAIR',token,code:activePairCode});
   if(r.error){phoneFeedback(r.error);return;}
   $('phoneToken').value='';activePairCode=null;$('phoneCode').textContent='Paired';
   phoneFeedback('Connected to @'+r.botUsername+'. Check your Telegram app for the confirmation message.');
   await renderPhone();
 }catch{phoneFeedback('Browser permission request failed. Phone notifications remain OFF.');}
 finally{$('phonePair').disabled=false;}
});
$('phoneEnabled').addEventListener('change',async e=>{
 const r=await request({type:'PHONE_TOGGLE',enabled:e.target.checked});
 if(r.error)phoneFeedback(r.error);
 await renderPhone();
});
$('phoneTest').addEventListener('click',async()=>{
 $('phoneTest').disabled=true;
 phoneFeedback('Sending a TEST message to the paired Telegram chat…');
 const r=await request({type:'PHONE_TEST'});
 phoneFeedback(r.error?'Telegram TEST failed: '+r.error:'TEST sent. Check your phone and allow notifications for this Telegram chat.');
 await renderPhone();
});
$('phoneForget').addEventListener('click',async()=>{
 if(!confirm('Disconnect Telegram and permanently erase the locally stored bot token from this Chrome extension?'))return;
 const r=await request({type:'PHONE_FORGET'});
 if(r.error)phoneFeedback(r.error);else {phoneFeedback('Phone alerts disconnected.');$('phoneToken').value='';activePairCode=null;$('phoneCode').textContent='Not generated';}
 await renderPhone();
});

refresh();setInterval(refresh,3000);
renderPhone();setInterval(renderPhone,6000);
