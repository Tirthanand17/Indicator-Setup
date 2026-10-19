/* Read-only, browser-local, event-driven paper alerts. NO broker API / execution / external network. */
'use strict';
importScripts('engine.js','auto-engine.js','auto-runner.js');
const ICON='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA6ElEQVR42mMUVLb4zzCAgIlhgMGAO4CFkAJ2y2CKLfl5fC1OOUZcaYAaFhPjECZ6WY7LXCZ6WY7L/MGVC2jhe4seQ7yhQNMQgFmOzRF0jwJcjmCil4UnSs7TzwH4gpzmDsBmOS7f0yUN4LOc6g4gNt4pcgCurEVKvJPtAHTL8eVzYnxPkgNw+ZASy4lqD5AatKRYTjAEcFl+ouQ8yRaR7ABcQYtsMYyNTpMCUFpE6LUhsiOo5WP01hETMfFJbctJygW0tBzDAfhar7RqnA6+jgmtQwHdfCZSOxLU7hcwEuqcDljPaMR0TgF/Pl42IevvlQAAAABJRU5ErkJggg==';
let queue=Promise.resolve();
const isFut=s=>/^NIFTY\d{2}(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)FUT$/.test(s||'');
function chartPathSymbol(s){try{const u=new URL(s);if(u.origin!=='https://kite.zerodha.com')return null;const m=u.pathname.match(/^\/markets\/ext\/chart\/web\/tvc\/NFO-FUT\/(NIFTY\d{2}(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)FUT)\//);return m?m[1]:null;}catch{return null;}}
function safeUI(s){return s&&s.id===chrome.runtime.id&&s.url&&s.url.startsWith(chrome.runtime.getURL(''));}
function validChartSender(sender){
 if(!sender||!sender.tab||!sender.tab.url)return null;
 const symbol=chartPathSymbol(sender.tab.url);if(!symbol)return null;
 const u=sender.url||'';
 // The deepest TradingView frame is an origin-bound blob iframe; no hash is read or transmitted.
 return u.startsWith('blob:https://kite.zerodha.com/')?symbol:null;
}
async function chartState(){let symbol=null;try{const tabs=await chrome.tabs.query({url:'https://kite.zerodha.com/markets/ext/chart/*'});for(const t of tabs){const s=chartPathSymbol(t.url||'');if(s){symbol=s;break;}}}catch{}return {chartOpen:!!symbol,chartSymbol:symbol};}
async function addLog(entry){const {logs=[]}=await chrome.storage.local.get('logs');await chrome.storage.local.set({logs:[entry,...logs].slice(0,150),lastResult:entry});}
async function notifyOnce(key,title,message){
 const {sentKeys=[]}=await chrome.storage.local.get('sentKeys');if(sentKeys.includes(key))return false;
 // Mark before notifying. Failure leaves an audit trail without retry-spam.
 await chrome.storage.local.set({sentKeys:[...sentKeys,key].slice(-150)});
 try{await chrome.notifications.create(key.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,120),{type:'basic',iconUrl:ICON,title,message,priority:1});return true;}catch{return false;}
}
function sanitizeSnapshot(x){const out={};for(const k of ['open','high','low','close','volume','vwap','ema9','ema21','plusDI','minusDI','adx','atr'])out[k]=x[k];out.symbol=x.symbol;out.timeframe=x.timeframe;return out;}
async function onReading(message,sender){
 const expectedSymbol=validChartSender(sender);if(!expectedSymbol)return {error:'not a verified Kite nested chart frame'};
 const sample=message.sample;
 if(!sample||typeof sample.at!=='number'||Math.abs(Date.now()-sample.at)>5000||!AutoEngine.validReading(sample.values)||expectedSymbol!==sample.values.symbol)return {error:'invalid, delayed or mismatched chart readings'};
 const {auto=null}=await chrome.storage.session.get('auto');
 let s=auto||AutoRunner.blank();
 const v=sample.values;
 const fingerprint=[v.symbol,v.close,v.volume,v.adx].join('|');
 if(s.lastTickFingerprint!==fingerprint){s.lastTickFingerprint=fingerprint;s.lastTickAt=Date.now();}
 // Price/volume still and unchanged is a feed health issue; never produce alerts from it.
 const stale=typeof s.lastTickAt==='number'&&Date.now()-s.lastTickAt>75000;
 if(stale){s=AutoRunner.blank();s.lastStatus='WAIT_DATA';s.lastReasons=['Displayed market values unchanged for more than 75 seconds'];s.lastTickAt=Date.now();s.lastTickFingerprint=fingerprint;}
 const wasEnd=s.lastCandle?.end||null;
 const transition=AutoRunner.ingest(s,{at:sample.at,values:sanitizeSnapshot(v)});
 s=transition.state;
 if(stale){s.lastStatus='WAIT_DATA';s.lastReasons=['Displayed values stale: collector reset'];}
 await chrome.storage.session.set({auto:s,autoSeenAt:Date.now()});
 const {armed=true,autoEnabled=true}=await chrome.storage.local.get({armed:true,autoEnabled:true});
 if(wasEnd!==s.lastCandle?.end&&s.lastCandle){
   const log={id:crypto.randomUUID(),at:new Date().toISOString(),candleEnd:new Date(s.lastCandle.end).toISOString(),symbol:v.symbol,status:s.lastStatus,source:'AUTO_CHART_NEAR_CLOSE',reasons:s.lastReasons||[]};
   await addLog(log);
 }
 for(const event of transition.events){
   if(!armed||!autoEnabled)continue;
   const isExit=event.status.startsWith('EXIT_');
   const label=isExit?'Virtual '+event.virtual.direction+' exit review':'Possible '+(event.status==='REVIEW_CE'?'BUY CE':'BUY PE');
   const msg=isExit?`Futures-only virtual level/reversal observed: ${event.reason}. This is NOT a broker position or a sell order.`:`Visible chart aligned near 5m close. Review ACTUAL option bid/ask and risk. No trades placed.`;
   await notifyOnce([event.bar.symbol,event.bar.end,event.status].join('_'),label,msg);
 }
 return {ok:true,accepted:true,signal:s.lastStatus,barCount:s.barCount||0};
}
function health(s,seenAt,chartOpen){
 if(!chartOpen)return {status:'WAIT_DATA',reasons:['Open the NIFTY futures Kite chart tab']};
 if(!s||!seenAt)return {status:'WAIT_DATA',reasons:['Waiting for automatic values from the nested TradingView chart frame']};
 if(Date.now()-seenAt>20000)return {status:'WAIT_DATA',reasons:['Chart reader stopped or Chrome background tab was throttled (>20 sec)']};
 if(!AutoEngine.sessionAllowed(Date.now()))return {status:'WAIT_DATA',reasons:['Outside supported intraday alert window; NSE holidays not separately verified']};
 if(Date.now()-(s.lastTickAt||0)>75000)return {status:'WAIT_DATA',reasons:['Futures price/volume updates stale']};
 return {status:s.lastStatus||'WAIT_DATA',reasons:s.lastReasons||[]};
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
 const task=async()=>{
  if(!message||typeof message.type!=='string')return {error:'bad message'};
  if(message.type==='CHART_HEARTBEAT'){
    if(!sender.tab||!chartPathSymbol(sender.tab.url||''))return {error:'not trusted Kite futures tab'};
    // Symbol is derived exclusively from chart pathname, never from URL fragment.
    await chrome.storage.session.set({chartSeenAt:Date.now(),chartSymbol:chartPathSymbol(sender.tab.url)});return {ok:true};
  }
  if(message.type==='AUTO_FRAME_READING')return await onReading(message,sender);
  if(!safeUI(sender))return {error:'extension UI only'};
  if(message.type==='GET_STATE'){
    const [chart,local,session]=await Promise.all([chartState(),chrome.storage.local.get({armed:true,autoEnabled:true,logs:[],lastResult:null}),chrome.storage.session.get({auto:null,autoSeenAt:0})]);
    const state=health(session.auto,session.autoSeenAt,chart.chartOpen);
    const s=session.auto||AutoRunner.blank();
    return {...chart,...local,...state,latest:s.latest?.values||null,lastReadAt:s.latest?.at||null,lastCandle:s.lastCandle||null,barCount:s.barCount||0,virtual:s.virtual||null,quality:s.lastCandle?.quality||null};
  }
  if(message.type==='SET_ARMED'){await chrome.storage.local.set({armed:message.armed===true});return {armed:message.armed===true};}
  if(message.type==='SET_AUTOMATIC'){await chrome.storage.local.set({autoEnabled:message.enabled===true});return {autoEnabled:message.enabled===true};}
  if(message.type==='RESET_MONITOR'){await chrome.storage.session.set({auto:AutoRunner.blank(),autoSeenAt:0});return {ok:true};}
  if(message.type==='TEST_NOTICE'){await chrome.notifications.create('test_'+Date.now(),{type:'basic',iconUrl:ICON,title:'TEST — NIFTY Paper Alerts',message:'Notification channel works. This is not a live trade signal.'});return {ok:true};}
  return {error:'unknown message'};
 };
 // Serializes rapid nested-frame observations; avoids stale writes and duplicate alerts.
 queue=queue.catch(()=>undefined).then(task);
 queue.then(sendResponse).catch(e=>sendResponse({error:String(e?.message||e)}));
 return true;
});
chrome.notifications.onClicked.addListener(()=>chrome.tabs.create({url:chrome.runtime.getURL('dashboard.html')}));
