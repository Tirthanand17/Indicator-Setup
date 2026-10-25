/* Deterministic research-only 5-minute chart-snapshot engine, no order actions. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.AutoEngine=api;})(typeof self!=='undefined'?self:globalThis,function(){
'use strict';
const FIVE=300000;
function istDate(ts){const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ts)).map(x=>[x.type,x.value]));return {date:p.year+'-'+p.month+'-'+p.day,minutes:Number(p.hour)*60+Number(p.minute),weekday:p.weekday};}
function sessionAllowed(ts){const p=istDate(ts);return !['Sat','Sun'].includes(p.weekday) && p.minutes>=560 && p.minutes<=925;} // 09:20 to 15:25, holiday feed unavailable
function closeTime(ts){return Math.ceil(ts/FIVE)*FIVE;}
function validReading(x){if(!x||!/^NIFTY\d{2}(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)FUT$/.test(x.symbol||'')||x.timeframe!=='5m')return false;const positive=['close','open','high','low','volume','vwap','ema9','ema21','atr'];const di=['plusDI','minusDI','adx'];return positive.every(k=>Number.isFinite(x[k])&&x[k]>0)&&di.every(k=>Number.isFinite(x[k])&&x[k]>=0&&x[k]<=100)&&x.low<=x.close&&x.close<=x.high&&x.low<=x.high;}
function confirmNearClosed(prev,now){
 // This reads a live chart sample just before the clock boundary; it is NOT an exchange-confirmed candle.
 if(!prev||!now||!validReading(prev.values)||!validReading(now.values))return {ok:false,reason:'missing readings'};
 const end=closeTime(prev.at);
 if(now.at<end||now.at>end+15000)return {ok:false,reason:'new-bar observation missing'};
 if(end-prev.at>3500||end<=prev.at)return {ok:false,reason:'no snapshot within 3.5 seconds of candle end'};
 if(closeTime(now.at)<=end)return {ok:false,reason:'new candle not observed'};
 if(prev.values.symbol!==now.values.symbol)return {ok:false,reason:'symbol changed'};
 if(!sessionAllowed(end-1000))return {ok:false,reason:'outside trading session'};
 return {ok:true,bar:{...prev.values,end,observedAt:prev.at,quality:'NEAR_CLOSE_NOT_EXCHANGE_CONFIRMED'}};
}
function assess(bar,history){
 if(!validReading(bar))return {status:'WAIT_DATA',reasons:['Missing valid NIFTY 5m chart reading'],notify:false};
 if(!sessionAllowed(bar.end-1000))return {status:'WAIT_DATA',reasons:['Not a regular session'],notify:false};
 const recent=(history||[]).filter(x=>x.symbol===bar.symbol&&validReading(x)&&x.end<bar.end).slice(-4);
 if(recent.length<4||recent.some((x,i)=> x.end!==bar.end-(recent.length-i)*FIVE))return {status:'WAIT_DATA',reasons:['Wait for four consecutive near-close 5m observations after starting'],notify:false};
 if(bar.adx<25||bar.adx<=recent[recent.length-1].adx)return {status:'NO_TRADE',reasons:['ADX below 25 or not rising'],notify:false};
 if(Math.abs(bar.close-bar.vwap)<0.1*bar.atr)return {status:'NO_TRADE',reasons:['Futures close too close to session VWAP'],notify:false};
 const highs=recent.slice(-3).map(x=>x.high),lows=recent.slice(-3).map(x=>x.low);
 const ce=bar.close>bar.vwap&&bar.ema9>bar.ema21&&bar.plusDI>bar.minusDI&&bar.close>Math.max(...highs)&&bar.close>recent[0].close;
 const pe=bar.close<bar.vwap&&bar.ema9<bar.ema21&&bar.minusDI>bar.plusDI&&bar.close<Math.min(...lows)&&bar.close<recent[0].close;
 if(ce)return {status:'REVIEW_CE',reasons:['Five-indicator bullish alignment with 3-bar high breakout','Near-close chart readings; not independently confirmed by exchange candle','Option premium, expiry, spread and position are NOT verified'],notify:true};
 if(pe)return {status:'REVIEW_PE',reasons:['Five-indicator bearish alignment with 3-bar low breakdown','Near-close chart readings; not independently confirmed by exchange candle','Option premium, expiry, spread and position are NOT verified'],notify:true};
 return {status:'NO_TRADE',reasons:['Directional alignment, three-bar breakout or recent trend not confirmed'],notify:false};
}
function virtualPosition(bar,direction){const atr=bar.atr;if(direction==='CE') {const stop=Math.min(bar.low,bar.vwap)-0.25*atr;return {direction,entry:bar.close,stop,target:bar.close+1.5*(bar.close-stop),at:bar.end,symbol:bar.symbol};}const stop=Math.max(bar.high,bar.vwap)+0.25*atr;return {direction,entry:bar.close,stop,target:bar.close-1.5*(stop-bar.close),at:bar.end,symbol:bar.symbol};}
function exitVirtual(p,b){if(!p||!validReading(b)||p.symbol!==b.symbol||b.end<=p.at)return {status:'WAIT_POSITION',notify:false};
 if(p.direction==='CE'){
   if(b.close<=p.stop)return {status:'EXIT_CE',reason:'Futures close crossed illustrative underlying invalidation',notify:true};
   if(b.close>=p.target)return {status:'EXIT_CE',reason:'Illustrative underlying target touched',notify:true};
   if(b.close<b.vwap&&b.ema9<b.ema21)return {status:'EXIT_CE',reason:'Five-minute bearish reversal confirmation',notify:true};
 }else{
   if(b.close>=p.stop)return {status:'EXIT_PE',reason:'Futures close crossed illustrative underlying invalidation',notify:true};
   if(b.close<=p.target)return {status:'EXIT_PE',reason:'Illustrative underlying target touched',notify:true};
   if(b.close>b.vwap&&b.ema9>b.ema21)return {status:'EXIT_PE',reason:'Five-minute bullish reversal confirmation',notify:true};
 }
 if(istDate(b.end).minutes>=915)return {status:'EXIT_'+p.direction,reason:'Intraday virtual-signal cutoff',notify:true};
 return {status:'HOLD_VIRTUAL',notify:false};}
return {FIVE,istDate,sessionAllowed,closeTime,validReading,confirmNearClosed,assess,virtualPosition,exitVirtual};
});
