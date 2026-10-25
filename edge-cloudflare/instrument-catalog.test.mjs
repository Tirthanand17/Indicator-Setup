import test from 'node:test';
import assert from 'node:assert/strict';
import {auditCatalog,compileNiftyCatalog,selectCatalogFuture,selectCatalogPair,
  claimCatalogFetch,settleCatalogFetch,optionQuotePlan} from './instrument-catalog.mjs';
import {reselectOptionPair,claimOptionSnapshot} from './option-runtime.mjs';
import {newPaperLedger,enterPaperBasket,exitPaperPosition} from './paper-ledger.mjs';

const at=(day='2026-10-23',time='10:00:20')=>Date.parse(`${day}T${time}+05:30`);
const now=at();
const header='instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange';
const future=(token,symbol,expiry)=>[token,1,symbol,'NIFTY',0,expiry,0,0.05,65,'FUT','NFO-FUT','NFO'].join(',');
const leg=(token,kind,strike,expiry='2026-10-29')=>[token,1,`NIFTY26O29${strike}${kind}`,
  'NIFTY',99999,expiry,strike,0.05,65,kind,'NFO-OPT','NFO'].join(',');
const master=(...extras)=>[header,future(12345,'NIFTY26OCTFUT','2026-10-27'),
  future(12346,'NIFTY26NOVFUT','2026-11-24'),
  ...[22000,22500,23000].flatMap((strike,i)=>[leg(200+i*2,'CE',strike),leg(201+i*2,'PE',strike)]),...extras].join('\n');
const catalog=()=>compileNiftyCatalog(master(),now);
const quote=(c,time=now,bid=99,ask=100)=>({contract:c,updatedAtMs:time,bid,ask,bidQuantity:650,askQuantity:650});

test('daily master chooses actual front future through expiry and rolls on the next regular day',()=>{
  assert.equal(selectCatalogFuture(catalog(),now).symbol,'NIFTY26OCTFUT');
  const expiry=at('2026-10-27');
  assert.equal(selectCatalogFuture(compileNiftyCatalog(master(),expiry),expiry).token,12345);
  const after=at('2026-10-28');
  assert.equal(selectCatalogFuture(compileNiftyCatalog(master(),after),after).token,12346);
  assert.throws(()=>selectCatalogFuture(catalog(),after),/STALE_CATALOG/);
  assert.throws(()=>selectCatalogFuture(catalog(),now-1),/STALE_CATALOG/);
});

test('fresh price reselects every strike after a 500-point move; CSV last_price is ignored',()=>{
  const c=catalog();
  assert.equal(selectCatalogPair(c,now,22005).strike,22000);
  assert.equal(selectCatalogPair(c,now+20_000,22505).strike,22500);
  assert.equal(selectCatalogPair(c,now+40_000,23005).strike,23000);
  assert.equal(selectCatalogPair(c,now,22250).strike,22000);
  for(const price of [NaN,Infinity,0,'22505',24000])assert.throws(()=>selectCatalogPair(c,now,price));
});

test('bad master, duplicated identity, mismatched lot and unsupported days fail closed',()=>{
  const bad=[master().replace('NIFTY26OCTFUT','NIFTY26NOVFUT'),master(leg(200,'PE',22000)),
    master().replace('0.05,65,PE','0.05,75,PE'),master().replace('2026-10-27','2026-02-30')];
  for(const csv of bad)assert.throws(()=>compileNiftyCatalog(csv,now));
  assert.throws(()=>compileNiftyCatalog(master(),at('2026-10-24')));
  assert.throws(()=>compileNiftyCatalog(master(),at('2027-01-01')));
  assert.throws(()=>auditCatalog({...catalog(),futures:[]}));
  assert.throws(()=>auditCatalog({...catalog(),pairs:Array(1001).fill(catalog().pairs[0])}));
});

test('expiry-day options are omitted; missing futures prevents configured-symbol fallback',()=>{
  const c=compileNiftyCatalog(master(leg(500,'CE',24000,'2026-10-23'),leg(501,'PE',24000,'2026-10-23')),now);
  assert.equal(c.pairs.length,3);
  assert.throws(()=>compileNiftyCatalog([header,leg(1,'CE',22000),leg(2,'PE',22000)].join('\n'),now));
});

test('durable fetch claim caps attempts and rejects late results after retry/day rotation',()=>{
  let c=claimCatalogFetch(undefined,'2026-10-23:136',now);
  assert.equal(c.allowed,true);
  assert.equal(claimCatalogFetch(c.state,'2026-10-23:137',now+20_000).allowed,false);
  const ready=settleCatalogFetch(c.state,'2026-10-23:136',catalog());
  assert.equal(claimCatalogFetch(ready,'2026-10-23:139',now+60_000).allowed,false);
  c.state=settleCatalogFetch(c.state,'2026-10-23:136',null);
  for(let i=1;i<3;i++) {
    const ms=now+i*30*60_000,tick=`2026-10-23:${136+i*90}`;
    c=claimCatalogFetch(c.state,tick,ms);assert.equal(c.allowed,true);
    c.state=settleCatalogFetch(c.state,tick,null);
  }
  assert.equal(claimCatalogFetch(c.state,'2026-10-23:500',now+4*30*60_000).allowed,false);
  assert.throws(()=>settleCatalogFetch(c.state,'2026-10-23:136',catalog()),/STALE_FETCH_RESULT/);
  const monday=at('2026-10-26','09:15:00');
  assert.equal(claimCatalogFetch(c.state,'2026-10-26:0',monday).state.attempts,1);
  assert.throws(()=>claimCatalogFetch(c.state,'2026-10-22:0',at('2026-10-22','09:15:00')));
});

test('pair reselection preserves dedupe and cannot replace an in-flight option quote',()=>{
  const c=catalog();
  const original=reselectOptionPair(undefined,{tickId:'2026-10-23:136',observedAtMs:now,
    pair:selectCatalogPair(c,now,22005)});
  const pending=claimOptionSnapshot(original,{tickId:'2026-10-23:137',observedAtMs:now+20_000}).state;
  assert.throws(()=>reselectOptionPair(pending,{tickId:'2026-10-23:138',observedAtMs:now+40_000,
    pair:selectCatalogPair(c,now+40_000,22505)}),/IN_FLIGHT/);
  const next=reselectOptionPair(original,{tickId:'2026-10-23:139',observedAtMs:now+60_000,
    pair:selectCatalogPair(c,now+60_000,22505)});
  assert.equal(next.pair.CE.strike,22500);assert.equal(next.lastOptionTickId,null);
});

test('quote plan includes independently held old CE/PE contracts alongside the new ATM pair',()=>{
  const c=catalog(),old=selectCatalogPair(c,now,22005),middle=selectCatalogPair(c,now,22505);
  let ledger=enterPaperBasket(newPaperLedger(now),{signalId:'CATALOG:OLD:SIGNAL',nowMs:now,
    quote:quote(old.CE)}).ledger;
  ledger=exitPaperPosition(ledger,{tradeId:ledger.positions[0].tradeId,nowMs:now+20_000,
    quote:quote(old.CE,now+20_000,141,142)}).ledger;
  ledger=enterPaperBasket(ledger,{signalId:'CATALOG:NEW:SIGNAL',nowMs:now+40_000,
    quote:quote(middle.PE,now+40_000)}).ledger;
  const pair=selectCatalogPair(c,now+60_000,23005);
  const plan=optionQuotePlan(pair,ledger,c,now+60_000);
  assert.equal(plan.length,4);
  assert.deepEqual(new Set(plan.map(x=>x.symbol)),new Set([pair.CE.symbol,pair.PE.symbol,old.CE.symbol,middle.PE.symbol]));
  assert.equal(ledger.positions[1].strike,22000);
  const legacy=structuredClone(ledger);delete legacy.positions[1].strike;
  assert.equal(optionQuotePlan(pair,legacy,c,now+60_000).length,4);
  assert.throws(()=>optionQuotePlan(pair,legacy,undefined,now+60_000),/OPEN_CONTRACT_UNAVAILABLE/);
  const mismatched=structuredClone(ledger);mismatched.positions[1].token=pair.CE.token;
  mismatched.positions[1].symbol=pair.CE.symbol;
  assert.throws(()=>optionQuotePlan(pair,mismatched,c,now+60_000),/MISMATCH/);
});
