'use strict';
const $ = id => document.getElementById(id);
const req = m => new Promise(resolve => chrome.runtime.sendMessage(m, reply => resolve(chrome.runtime.lastError ? {error:chrome.runtime.lastError.message} : (reply||{error:'No response'}))));
const fmt = value => Number.isFinite(value)?value.toLocaleString('en-IN',{maximumFractionDigits:4}):'—';
const tm = ms => ms?new Date(ms).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',hour12:true,day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
async function refresh(){
  const x=await req({type:'GET_STATE'});
  if(x.error){$('chart').textContent=x.error;return;}
  $('armed').checked=!!x.armed;
  $('autoEnabled').checked=!!x.autoEnabled;
  $('chart').textContent=x.chartOpen?'Kite NIFTY futures chart: '+x.chartSymbol+' | Reader: '+(x.lastReadAt&&Date.now()-x.lastReadAt<15000?'RUNNING':'WAIT_DATA'):'WAIT_DATA — open your 5-minute NIFTY futures Kite chart';
  $('updated').textContent=x.lastReadAt?'Last visible chart reading: '+tm(x.lastReadAt)+' IST':'Waiting for automatic readings from nested TradingView frame.';
  const v=x.latest, root=$('values');root.replaceChildren();
  if(v){
    for(const [key,value] of [['Symbol',v.symbol],['Futures last (forming)',fmt(v.close)],['Volume',fmt(v.volume)],['VWAP yellow',fmt(v.vwap)],['EMA 9 blue',fmt(v.ema9)],['EMA 21 purple',fmt(v.ema21)],['DMI +DI green',fmt(v.plusDI)],['DMI −DI red',fmt(v.minusDI)],['DMI ADX pink',fmt(v.adx)],['ATR 14 orange',fmt(v.atr)]]){
      const el=document.createElement('div'),label=document.createElement('small'),number=document.createElement('strong');
      el.className='metric';label.textContent=key;number.textContent=value;el.append(label,number);root.append(el);
    }
  }else root.textContent='No valid indicator snapshot yet.';
  const result=$('result');result.textContent=x.status||'WAIT_DATA';
  result.className='result '+(x.status==='REVIEW_CE'?'good':x.status==='REVIEW_PE'?'bad':'muted');
  $('reasons').textContent=(x.reasons||[]).join(' · ');
  $('closedBar').textContent=x.lastCandle?'Last near-close observed candle ended '+tm(x.lastCandle.end)+' IST; sample taken '+tm(x.lastCandle.observedAt)+' IST. Collected '+x.barCount+' bars. NOT an exchange-confirmed close.':'No near-close candle collected yet. Initial warm-up normally takes at least 20–25 minutes.';
  $('virtual').textContent=x.virtual?'VIRTUAL PAPER '+x.virtual.direction+' (NOT Kite holdings): futures reference '+fmt(x.virtual.entry)+'; invalidation '+fmt(x.virtual.stop)+'; illustrative target '+fmt(x.virtual.target)+'. Exit alerts are futures-based only.':'No virtual candidate active; no broker holdings are read.';
  const logs=$('logs');logs.replaceChildren();(x.logs||[]).slice(0,20).forEach(z=>{const li=document.createElement('li');li.textContent=tm(z.at)+' · '+z.status+' · '+(z.reasons||[]).join('; ');logs.append(li);});
}
$('autoEnabled').addEventListener('change',async e=>{await req({type:'SET_AUTOMATIC',enabled:e.target.checked});refresh();});
$('armed').addEventListener('change',async e=>{await req({type:'SET_ARMED',armed:e.target.checked});refresh();});
$('test').addEventListener('click',async()=>{const x=await req({type:'TEST_NOTICE'});if(x.error)alert(x.error);});
$('reset').addEventListener('click',async()=>{await req({type:'RESET_MONITOR'});refresh();});
refresh();setInterval(refresh,3000);
