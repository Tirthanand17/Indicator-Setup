import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newPaperLedger, auditPaperLedger } from './paper-ledger.mjs';
import { SYNTHETIC_SOURCE, newSyntheticSession, auditSyntheticSession,
  advanceSyntheticMarketTurn, syntheticSessionSummary } from './synthetic-session.mjs';

const fixtures=JSON.parse(readFileSync(new URL('./decision-parity-fixtures.json',import.meta.url),'utf8'));
const up=fixtures.cases.find(c=>c.expected.status==='REVIEW_CE');
const down=fixtures.cases.find(c=>c.expected.status==='REVIEW_PE');
const open=Date.parse('2026-10-23T09:15:00+05:30');
const observed=(slot)=>open+slot*20000;
const quote=(nowMs,kind='CE',bid=100,ask=100.5)=>({
  contract:{symbol:`NIFTY26OCT23000${kind}`,kind,expiry:'2026-10-29',
    token:kind==='CE'?12345:12346,lotSize:65},
  bid,ask,bidQuantity:650,askQuantity:650,updatedAtMs:nowMs-1000,
});
const turn=(slot,extra={})=>{
  const observedAtMs=observed(slot);
  return {source:SYNTHETIC_SOURCE,tickId:`2026-10-23:${slot}`,observedAtMs,
    futures:{symbol:'NFO:NIFTY26OCTFUT',instrumentToken:900,
      exchangeAtMs:observedAtMs-1000,lastPrice:22000},
    candles5:null,candles15:null,optionQuotes:{},...extra};
};
const positive=(caseRef, slot=271)=>turn(slot,{
  candles5:caseRef.candles,candles15:caseRef.confirm15m,
  strategyConfig:{adxMin:caseRef.adxMin,atrBuffer:caseRef.atrBuffer},
  futures:{symbol:'NFO:NIFTY26OCTFUT',instrumentToken:900,
    exchangeAtMs:observed(slot)-1000,lastPrice:caseRef.candles.at(-1).close},
  optionQuotes:{[caseRef.expected.status.slice(-2)]:
    quote(observed(slot),caseRef.expected.status.slice(-2))},
});
const init=()=>({session:newSyntheticSession(),ledger:newPaperLedger(open)});
const next=(state,input)=>advanceSyntheticMarketTurn(state.session,state.ledger,input);

test('Python five-indicator 5m/15m CE fixture flows into 2 paper accounts and pending events',()=>{
  const r=next(init(),positive(up));
  assert.equal(r.result.status,'SYNTHETIC_TICK_PROCESSED');
  assert.equal(r.result.decision,'REVIEW_CE');
  assert.equal(r.result.entered,2);
  assert.equal(r.result.exited,0);
  assert.equal(r.ledger.positions.length,2);
  assert.equal(r.ledger.outbox.length,2);
  assert.equal(r.session.totalTicks,1);
  assert.equal(r.session.reviewTicks,1);
  assert.ok(r.ledger.outbox.every(e=>e.status==='PENDING'));
  assert.equal(auditPaperLedger(r.ledger),true);
  assert.equal(auditSyntheticSession(r.session),true);
  assert.equal(syntheticSessionSummary(r.session,r.ledger).liveMarketConnected,false);
});

test('independent PE fixture selects PE option and never trades CE',()=>{
  const r=next(init(),positive(down));
  assert.equal(r.result.decision,'REVIEW_PE');
  assert.equal(r.result.entered,2);
  assert.ok(r.ledger.positions.every(p=>p.kind==='PE'));
});

test('exact same tick replay does not mutate balances, events or outbox',()=>{
  const first=next(init(),positive(up));
  const duplicate=next(first,positive(up));
  assert.equal(duplicate.result.status,'DUPLICATE_TICK');
  assert.equal(duplicate.session,first.session);
  assert.equal(duplicate.ledger,first.ledger);
  assert.equal(duplicate.ledger.outbox.length,2);
});

test('fresh same-kind BID at a later 20s slot closes both accounts exactly once',()=>{
  const first=next(init(),positive(up));
  const at=273;
  const closed=next(first,turn(at,{optionQuotes:{CE:quote(observed(at),'CE',141,141.5)}}));
  assert.equal(closed.result.decision,'WAIT_DATA');
  assert.equal(closed.result.exited,2);
  assert.equal(closed.result.entered,0);
  assert.ok(closed.ledger.positions.every(p=>p.status==='CLOSED'));
  assert.equal(closed.ledger.outbox.length,4);
  assert.equal(closed.ledger.outbox.filter(e=>e.kind==='PAPER_EXIT').length,2);
  assert.equal(auditPaperLedger(closed.ledger),true);
  const again=next(closed,turn(274,{optionQuotes:{CE:quote(observed(274),'CE',141,141.5)}}));
  assert.equal(again.result.exited,0);
  assert.equal(again.ledger.outbox.length,4);
});

test('missing CE quote during a qualifying signal waits; next fresh quote may enter',()=>{
  const requested=positive(up);
  requested.optionQuotes={};
  const first=next(init(),requested);
  assert.equal(first.result.decision,'REVIEW_CE');
  assert.equal(first.result.entryResults.status,'WAIT_OPTION_QUOTE');
  assert.equal(first.ledger.positions.length,0);
  const later=positive(up,272);
  const second=next(first,later);
  assert.equal(second.result.entered,2);
  assert.equal(second.ledger.positions.length,2);
});

test('stale futures prevents new entry even when 5m/15m candles look strong',()=>{
  const input=positive(up);
  input.futures.exchangeAtMs-=60001;
  const r=next(init(),input);
  assert.equal(r.result.decision,'WAIT_DATA');
  assert.equal(r.result.reason,'WAIT_FRESH_FUTURES');
  assert.equal(r.ledger.positions.length,0);
  assert.equal(r.ledger.outbox.length,0);
});

test('synthetic futures quote inconsistent with its candle blocks a false signal',()=>{
  const input=positive(up);
  input.futures.lastPrice=100000;
  const r=next(init(),input);
  assert.equal(r.result.decision,'WAIT_DATA');
  assert.equal(r.result.reason,'WAIT_FUTURES_CANDLE_MISMATCH');
  assert.equal(r.result.entered,0);
  assert.equal(r.ledger.outbox.length,0);
});

test('15:15 IST exits both open positions at a fresh ordinary BID, even without candle warmup',()=>{
  const first=next(init(),positive(up));
  const final=next(first,turn(1080,{optionQuotes:{CE:quote(observed(1080))}}));
  assert.equal(final.result.exited,2);
  assert.ok(final.result.exitResults.every(x=>x.reason==='TIME'));
  assert.equal(final.ledger.positions.filter(x=>x.status==='CLOSED').length,2);
  assert.equal(final.ledger.outbox.length,4);
});

test('bad/missing option BID cannot fabricate exits; EOD explicitly marks unresolved',()=>{
  const first=next(init(),positive(up));
  const stale=turn(273,{optionQuotes:{CE:quote(observed(273)-30000)}});
  const mid=next(first,stale);
  assert.equal(mid.result.exited,0);
  assert.ok(mid.result.exitResults.every(x=>x.status==='WAIT_VALID_OPTION_QUOTE'));
  assert.equal(mid.ledger.outbox.length,2);
  const finishSlot=1113; // 15:26 IST, no same-day executable exit evidence.
  const end=next(mid,turn(finishSlot));
  assert.equal(end.result.unverifiable,2);
  assert.ok(end.ledger.positions.every(p=>p.status==='EXIT_UNVERIFIABLE' && p.exitCreditPaise===null));
  assert.deepEqual(end.ledger.accounts,first.ledger.accounts);
  assert.equal(end.ledger.outbox.length,4);
});

test('invalid synthetic source, calendar, late slot, strategy override and rollback fail closed',()=>{
  const state=init();
  for(const input of [
    turn(271,{source:'LIVE_KITE'}),
    turn(271,{tickId:'2026-10-20:271'}),
    turn(271,{observedAtMs:observed(271)+20000}),
    turn(271,{strategyConfig:{adxMin:1,atrBuffer:0}}),
    turn(271,{strategyConfig:{adxMin:10,atrBuffer:0,executeLive:true}}),
    turn(271,{candles5:new Array(1601).fill(null)}),
    turn(271,{optionQuotes:{CE:{},PE:{},LIVE:{}}}),
  ]) assert.throws(()=>next(state,input),/SYNTHETIC_SESSION_/);
  const first=next(state,turn(275));
  assert.throws(()=>next(first,turn(274)),/SYNTHETIC_SESSION_/);
  assert.deepEqual(state.ledger.positions,[]);
});

test('corrupt ledger or session halts processing rather than resetting accounts',()=>{
  const r=next(init(),positive(up));
  const broken=structuredClone(r);
  broken.session.events[0].entered=3;
  assert.throws(()=>next(broken,turn(272)),/CORRUPT_EVENT/);
  const altered=structuredClone(r);
  altered.ledger.accounts.PAPER_50K.cashPaise++;
  assert.throws(()=>next(altered,turn(272)),/CASH_CONSERVATION/);
  const impossible=structuredClone(r);
  impossible.session.events[0].observedAtMs+=40000;
  impossible.session.lastObservedAtMs+=40000;
  assert.throws(()=>next(impossible,turn(274)),/CORRUPT_EVENT_TIME/);
});

test('entire 1125-tick simulated IST session is monotonic, bounded and never backfilled',()=>{
  let state=init();
  let accepted=0,closed=0;
  for(let slot=0;slot<1125;slot++) {
    const data=slot===271?positive(up):slot===273?
      turn(slot,{optionQuotes:{CE:quote(observed(slot),'CE',141,141.5)}}):turn(slot);
    state=next(state,data);
    accepted+=state.result.entered;
    closed+=state.result.exited;
  }
  assert.equal(accepted,2);
  assert.equal(closed,2);
  assert.equal(state.session.totalTicks,1125);
  assert.equal(state.session.events.length,128);
  assert.equal(state.session.lastTickId,'2026-10-23:1124');
  assert.equal(state.ledger.positions.length,2);
  assert.equal(state.ledger.outbox.length,4);
  assert.ok(state.ledger.positions.every(p=>p.status==='CLOSED'));
  assert.equal(auditPaperLedger(state.ledger),true);
  assert.equal(auditSyntheticSession(state.session),true);
});
