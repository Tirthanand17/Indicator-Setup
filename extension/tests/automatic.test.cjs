const test=require('node:test');
const assert=require('node:assert/strict');
const R=require('../reader.js');
const E=require('../auto-engine.js');
const M=require('../auto-runner.js');
const displayed=`NIFTY26OCTFUT
5m
Continuous
NIFTY 5 Indicator Setup
NIFTY OCT FUT
5
NFO-FUT
O
23,013.60
H
23,019.00
L
23,001.00
C
23,009.00
-4.60 (-0.02%)
23,001.50
SELL
7.50
23,009.00
BUY
Volume
4.09K
VWAP
hlc3 Session
23,073.90
EMA
9 close 0
23,034.55
EMA
21 close 0
23,055.87
DMI
14 14
11.3955
29.1841
24.8401
ATR
14
35.06
1d
5d
11:45:46 UTC+5:30`;
test('parses chart only visible legend and OHLC',()=>{
 const p=R.parse(displayed);assert.equal(p.ok,true, p.errors.join(','));assert.equal(p.values.symbol,'NIFTY26OCTFUT');assert.equal(p.values.close,23009);assert.equal(p.values.volume,4090);assert.equal(p.values.adx,24.8401);assert.equal(p.values.plusDI,11.3955);assert.equal(p.values.minusDI,29.1841);assert.equal(p.values.atr,35.06);
});
test('rejects missing or incompatible indicators',()=>{assert.equal(R.parse(displayed.replace('21 close 0','20 close 0')).ok,false);assert.equal(R.parse(displayed.replace('hlc3 Session','close Day')).ok,false);assert.equal(R.parse(displayed.replace('5m','15m')).ok,false);assert.equal(R.parse(displayed.replace('4.09K','0')).ok,false);});
test('numeric sanitization is strict',()=>{assert.equal(R.numeric('23,005.50'),23005.5);assert.ok(Number.isNaN(R.numeric('23,000px')));assert.equal(R.volumeValue('1.5M'),1500000);assert.ok(Number.isNaN(R.volumeValue('1.5−K')));});
const now=Date.parse('2026-10-19T11:35:00+05:30');
const base={symbol:'NIFTY26OCTFUT',timeframe:'5m',open:23100,high:23136,low:23098,close:23133,volume:3000,vwap:23090,ema9:23115,ema21:23095,plusDI:36,minusDI:12,adx:32,atr:40};
function bar(end,overrides={}){return {...base,...overrides,end};}
test('rejects tampered data',()=>{assert.equal(E.validReading({...base,volume:0}),false);assert.equal(E.validReading({...base,close:99999}),false);assert.equal(E.validReading({...base,symbol:'NIFTY50'}),false);});
test('near-close bar observed then next bar confirmation',()=>{
 const x=E.confirmNearClosed({at:now-900,values:base},{at:now+1800,values:{...base,volume:100}});
 assert.equal(x.ok,true);assert.equal(x.bar.end,now);assert.equal(x.bar.quality,'NEAR_CLOSE_NOT_EXCHANGE_CONFIRMED');
});
test('no near-close reading => fails closed',()=>{assert.equal(E.confirmNearClosed({at:now-9000,values:base},{at:now+1800,values:base}).ok,false);});
test('no new bar observation => fails closed',()=>{assert.equal(E.confirmNearClosed({at:now-1000,values:base},{at:now-400,values:base}).ok,false);});
const h=[bar(now-1200000,{adx:22,open:23050,low:23040,high:23070,close:23060}),bar(now-900000,{adx:23,open:23060,low:23050,high:23080,close:23065}),bar(now-600000,{adx:25,open:23070,low:23060,high:23090,close:23075}),bar(now-300000,{adx:28,open:23080,low:23075,high:23100,close:23087})];
test('paper CE review only on breakout and strength',()=>assert.equal(E.assess(bar(now),h).status,'REVIEW_CE'));
test('paper PE review on breakdown',()=>{const ph=h.map(x=>({...x,low:23090,high:23200,close:23100}));const x=bar(now,{open:23050,high:23060,low:23009,close:23010,vwap:23100,ema9:23020,ema21:23040,plusDI:10,minusDI:30,adx:35});assert.equal(E.assess(x,ph).status,'REVIEW_PE');});
test('missing consecutive history WAIT_DATA',()=>assert.equal(E.assess(bar(now),h.slice(1)).status,'WAIT_DATA'));
test('ADX fall rejects',()=>assert.equal(E.assess(bar(now,{adx:24}),h).status,'NO_TRADE'));
test('VWAP proximity rejects',()=>assert.equal(E.assess(bar(now,{close:23091,low:23085}),h).status,'NO_TRADE'));
test('virtual exit when futures invalidated',()=>{const p=E.virtualPosition(bar(now),'CE');const next=bar(now+300000,{open:23000,high:23025,low:22980,close:23001,ema9:23025,ema21:23045});assert.equal(E.exitVirtual(p,next).status,'EXIT_CE');});
test('runner needs chart boundary then accumulates',()=>{
 let s=M.blank();let result=M.ingest(s,{at:now-2000,values:base});assert.equal(result.events.length,0);result=M.ingest(result.state,{at:now+1000,values:{...base,volume:30}});assert.equal(result.state.history.length,1);assert.equal(result.state.lastStatus,'WAIT_DATA');
});
test('runner misses a whole bar and clears history',()=>{
 let s=M.blank();s.last={at:now-1000,values:base};s.history=h;const r=M.ingest(s,{at:now+9*60000,values:base});assert.equal(r.state.history.length,0);assert.equal(r.state.lastStatus,'WAIT_DATA');
});
test('two readings in same bar create no signal',()=>{
 let s=M.blank();s.last={at:now-90000,values:base};s.history=h;let r=M.ingest(s,{at:now-87000,values:{...base,volume:3100}});assert.equal(r.events.length,0);assert.equal(r.state.barCount,0);
});
