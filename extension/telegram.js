/* Opt-in Telegram phone alerts for read-only NIFTY paper-signal reviews.
   No broker integration. No user-entered credentials are ever logged or committed. */
(function(root, factory) {
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.PhoneTelegram=api;
})(typeof self!=='undefined'?self:globalThis,function(){
 'use strict';
 const ORIGIN='https://api.telegram.org';
 const PERMISSION='https://api.telegram.org/*';
 const TOKEN_PATTERN=/^\d{5,16}:[a-zA-Z0-9_-]{20,}$/;
 const CODE_PATTERN=/^[A-F0-9]{12}$/;
 function validToken(token){return typeof token==='string'&&TOKEN_PATTERN.test(token);}
 function validChatId(id){return /^-?\d{4,20}$/.test(String(id||''));}
 function pairingCode(randomBytes){
  const bytes=randomBytes||crypto.getRandomValues(new Uint8Array(6));
  if(bytes.length!==6)throw new Error('pairing code needs six bytes');
  return Array.from(bytes).map(x=>x.toString(16).padStart(2,'0')).join('').toUpperCase();
 }
 function findPairingChat(updates,code,minUnixSeconds){
  if(!Array.isArray(updates)||!CODE_PATTERN.test(code))return null;
  const matches=updates.filter(u=>{
   const m=u&&u.message;
   return m && m.chat && m.chat.type==='private' && validChatId(m.chat.id) &&
     typeof m.text==='string' && m.text.trim()==='/start '+code &&
     Number.isFinite(m.date)&&m.date>=minUnixSeconds;
  });
  if(!matches.length)return null;
  const ids=[...new Set(matches.map(u=>String(u.message.chat.id)))];
  if(ids.length!==1)return null; // no ambiguous multi-user binding
  return ids[0];
 }
 async function callTelegram(token,method,body,fetchImpl){
  if(!validToken(token))throw Error('Enter a valid BotFather token in the local extension dashboard.');
  if(!['getMe','getUpdates','sendMessage'].includes(method))throw Error('Unsupported Telegram method.');
  const client=fetchImpl||fetch;
  // Telegram's Bot API uses HTTPS with the bot token embedded in the request path.
  // Never log this URL, responses, credentials, or user chat text.
  let res;
  try{
   res=await client(ORIGIN+'/bot'+token+'/'+method,{
    method:'POST',credentials:'omit',cache:'no-store',redirect:'error',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body||{}),
    signal:AbortSignal.timeout(7000)
   });
  }catch{throw Error('Telegram network request failed or timed out.');}
  if(!res||!res.ok)throw Error('Telegram API request rejected (HTTP '+(res?.status||'?')+').');
  let result;
  try{result=await res.json();}catch{throw Error('Telegram returned an invalid response.');}
  if(!result||result.ok!==true)throw Error('Telegram rejected the bot request; verify token and bot setup.');
  return result.result;
 }
 function paperSignalText(event) {
  if(!event||!event.bar||!Number.isFinite(event.bar.end))throw Error('Invalid signal event');
  const v=event.bar;
  const exit=String(event.status).startsWith('EXIT_');
  const direction=exit?(event.virtual?.direction||'CE'):(event.status==='REVIEW_CE'?'CE':'PE');
  const label=exit?'EXIT REVIEW — VIRTUAL '+direction:'POTENTIAL BUY '+direction+' — REVIEW ONLY';
  const tm=new Date(v.end).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',hour12:false,day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
  const num=n=>Number.isFinite(n)?Number(n).toFixed(2):'—';
  const lines=[
   'NIFTY PAPER ALERT | '+label,
   'Chart: '+String(v.symbol||'NIFTY FUT')+' | 5-minute',
   'Observed near-close boundary: '+tm+' IST',
   'Futures: '+num(v.close)+' | VWAP: '+num(v.vwap),
   'EMA9: '+num(v.ema9)+' | EMA21: '+num(v.ema21),
   '+DI: '+num(v.plusDI)+' | -DI: '+num(v.minusDI)+' | ADX: '+num(v.adx),
   'ATR: '+num(v.atr)
  ];
  if(exit)lines.push('Reason: '+String(event.reason||'Virtual underlying-price threshold observed').slice(0,150));
  else lines.push('Check current option ASK/BID, liquidity, expiry and stop before any action.');
  lines.push('Not a confirmed completed exchange candle. No actual option holdings or fills verified. No orders placed.');
  return lines.join('\n').slice(0,1200);
 }
 return {PERMISSION,validToken,validChatId,pairingCode,findPairingChat,callTelegram,paperSignalText};
});
