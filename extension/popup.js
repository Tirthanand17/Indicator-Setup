'use strict';
const badge=document.getElementById('badge'),desc=document.getElementById('description');
chrome.runtime.sendMessage({type:'GET_STATE'},r=>{
 if(chrome.runtime.lastError||!r||r.error){badge.textContent='WAIT_DATA';desc.textContent='The extension service worker is unavailable.';return;}
 badge.textContent=r.status||'WAIT_DATA';
 if(!r.chartOpen)desc.textContent='Open your current-month NIFTY futures 5m Kite chart.';
 else if(!r.lastReadAt||Date.now()-r.lastReadAt>15000)desc.textContent='Chart detected, but automatic values are not arriving. Reload the Kite chart and check the five studies.';
 else desc.textContent=`Auto-reading ${r.chartSymbol}. Futures ${r.latest?.close??'—'} · VWAP ${r.latest?.vwap??'—'} · EMA9 ${r.latest?.ema9??'—'} · EMA21 ${r.latest?.ema21??'—'}. Status is ${r.status}.`;
});
document.getElementById('open').addEventListener('click',()=>chrome.tabs.create({url:chrome.runtime.getURL('dashboard.html')}));
