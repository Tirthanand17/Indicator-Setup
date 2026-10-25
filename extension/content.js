/* Automatic, chart-visible read-only text extraction. No URL hashes, auth data, fetch, OCR or orders. */
(() => {
'use strict';
if (!location || !/^https:\/\/kite\.zerodha\.com$/.test(location.origin)) return;
const outer=/^\/markets\/ext\/chart\//.test(location.pathname);
const inner=/^\/static\/chart\/tradingview\//.test(location.pathname);
function send(payload){try {chrome.runtime.sendMessage(payload,()=>void chrome.runtime.lastError);} catch { /* A closed extension context cannot receive this heartbeat. */ } }
if(outer||inner){
  const symbol=(location.pathname.match(/\/NFO-FUT\/(NIFTY\d{2}(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)FUT)(?:\/|$)/)||[])[1]||null;
  const heartbeat=()=>send({type:'CHART_HEARTBEAT',symbol,chartFrame:inner});
  heartbeat();setInterval(heartbeat,12000);
}
// TradingView draws the actual chart in a blob-origin nested frame. In that frame,
// visible legend values are DOM text; top-level chart.html has no indicator values.
// No chart-private API calls, credentials, cookies, URLs or broker network access.
if(location.protocol!=='blob:'||!self.SignalReader)return;
let lastSent=0,lastCompact='',recentPointerMove=0;
document.addEventListener('pointermove',()=>{recentPointerMove=Date.now();},{passive:true});
function read(){
  if(!document.body) return;
  // Crosshair hovering over old candles changes legend values: refuse while interacting.
  if(Date.now()-recentPointerMove<5000)return;
  const parsed=self.SignalReader.parse(document.body.innerText);
  if(!parsed.ok)return;
  const at=Date.now();
  const compact=JSON.stringify(parsed.values);
  if(compact===lastCompact && at-lastSent<900)return;
  lastCompact=compact;lastSent=at;
  send({type:'AUTO_FRAME_READING',sample:{at,values:parsed.values}});
}
read();setInterval(read,850);
})();
