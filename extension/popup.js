'use strict';
const badge=document.getElementById('badge'),desc=document.getElementById('description');
chrome.runtime.sendMessage({type:'GET_STATE'},r=>{
 if(chrome.runtime.lastError||!r||r.error){badge.textContent='WAIT_DATA';desc.textContent='Extension service worker unavailable.';return;}
 badge.textContent=r.status||'WAIT_DATA';
 if(!r.chartOpen)desc.textContent='Open the current-month NIFTY futures 5-minute Kite chart.';
 else if(!r.lastReadAt||Date.now()-r.lastReadAt>15000)desc.textContent='Kite chart open, but automatic values are not arriving. Refresh the Kite tab and verify five indicators.';
 else desc.textContent='Auto-reading '+r.chartSymbol+'. Futures '+r.latest?.close+'; VWAP '+r.latest?.vwap+'; EMA9 '+r.latest?.ema9+'; EMA21 '+r.latest?.ema21+'. Status: '+r.status+'.';
});
document.getElementById('open').addEventListener('click',()=>chrome.tabs.create({url:chrome.runtime.getURL('dashboard.html')}));
