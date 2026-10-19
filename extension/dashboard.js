'use strict';
const $ = id => document.getElementById(id);
const request = obj => new Promise(resolve => chrome.runtime.sendMessage(obj, reply => {
  if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
  else resolve(reply || { error: 'No response from background' });
}));
function escapeText(value){ return String(value == null ? '' : value); }
function show(id, text, cls=''){ $(id).textContent = escapeText(text); $(id).className = id === 'result' || id === 'exitResult' ? 'result ' + cls : cls; }
function putLog(logs){const e=$('logs');e.replaceChildren();(logs||[]).slice(0,15).forEach(log=>{const li=document.createElement('li');li.textContent=`${log.at || ''} — ${log.status}: ${(log.reasons||[]).join(' | ')}`;e.append(li);});}
function formatState(x){show('chart',x.chartOpen?`Kite chart DETECTED (${x.chartSymbol||'symbol unknown'}). Closed-candle data still requires manual verification.`:'WAIT_DATA: Kite chart not detected in this browser. Open the correct NIFTY futures Kite chart.');$('armed').checked=!!x.armed;putLog(x.logs); if(x.position)show('positionStatus',`Tracking hypothetical ${x.position.direction}: entry ${x.position.entry}, stop ${x.position.stop}, target ${x.position.target}. Values are per option unit.`);}
async function refresh(){const x=await request({type:'GET_STATE'});if(x.error){show('chart',x.error);return;}formatState(x);}
function numberOf(id){return $(''+id).value.trim() === '' ? '' : Number($(id).value);}
function setDefaultTime(){const d=new Date();d.setMinutes(Math.floor(d.getMinutes()/5)*5,0,0);const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);$('candleEnd').value=local.toISOString().slice(0,16);}
$('armed').addEventListener('change',async e=>{const r=await request({type:'SET_ARMED',armed:e.target.checked});if(r.error)alert(r.error);});
$('test').addEventListener('click',async()=>{const r=await request({type:'TEST_NOTICE'});if(r.error)alert('Notification failed: '+r.error);});
$('signalForm').addEventListener('submit',async e=>{
 e.preventDefault();const local=$('candleEnd').value;
 const end=new Date(local); if(!local || !Number.isFinite(end.getTime())) {show('result','Invalid candle time','bad');return;}
 const observation={symbol:$('symbol').value.trim().toUpperCase(),candleEnd:end.toISOString(),closed:$('closed').checked,optionChecks:$('optionChecks').checked,
 structure:$('structure').value,higherTimeframe:$('higherTimeframe').value};
 for(const k of ['close','vwap','ema9','ema21','plusDI','minusDI','adx','priorAdx','atr','volume']) observation[k]=numberOf(k);
 const r=await request({type:'SUBMIT_CANDLE',observation}); if(r.error) {show('result','Error: '+r.error,'bad');return;}
 const reasons=(r.result.reasons||[]).join('\n• ');
 show('result',`${r.result.status}\n• ${reasons}\nDesktop notification: ${r.notification?.delivered?'sent':r.notification?.reason||'not sent'}`,r.result.status==='REVIEW_CE'?'good':r.result.status==='REVIEW_PE'?'bad':'');
 refresh();
});
$('positionForm').addEventListener('submit',async e=>{e.preventDefault();const position={direction:$('direction').value,entry:numberOf('entry'),stop:numberOf('stop'),target:numberOf('target')};const r=await request({type:'SET_POSITION',position});show('positionStatus',r.error||`Paper ${r.position.direction} saved. It will NOT update without manually entered option BID.`);});
$('clearPos').addEventListener('click',async()=>{const r=await request({type:'CLEAR_POSITION'});show('positionStatus',r.error||'No position tracked.');});
$('checkExit').addEventListener('click',async()=>{const bid=numberOf('bid');const r=await request({type:'CHECK_EXIT',bid});if(r.error){show('exitResult',r.error,'bad');return;}show('exitResult',`${r.result.status}\n${r.result.reason || ''}\nDesktop alert: ${r.notification?.delivered?'sent':r.notification?.reason||'not sent'}`,r.result.notify?'bad':'');refresh();});
setDefaultTime();refresh();setInterval(refresh,15000);
