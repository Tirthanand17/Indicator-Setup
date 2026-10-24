import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reviewReadOnlyMarket } from './market-review.mjs';
import { newPaperLedger, auditPaperLedger } from './paper-ledger.mjs';
import { newReadOnlyBridge, auditReadOnlyBridge, stageReadOnlyReview,
  advanceReadOnlyPaperTurn, readOnlyBridgeSummary } from './readonly-paper-bridge.mjs';

const cases=JSON.parse(readFileSync(new URL('./decision-parity-fixtures.json',import.meta.url),'utf8')).cases;
const fixture=name=>cases.find(c=>c.name===name);
const kiteTime=ms=>new Date(ms+330*60_000).toISOString().replace('.000Z','+0530');
const rows=bars=>bars.map(c=>[kiteTime(c.startMs),c.open,c.high,c.low,c.close,c.volume]);
const tick=n=>'2026-10-23:'+n;
const nowMs=fixture('uptrend_mirrored_qualifying_review').nowMs;
const contract=(kind,strike=22050)=>({symbol:`NIFTY26O29${strike}${kind}`,kind,
  expiry:'2026-10-29',strike,token:kind==='CE'?20101:20102,lotSize:65});
const quote=(kind,at,bid=100,ask=100.5,strike=22050)=>({contract:contract(kind,strike),
  bid,ask,bidQuantity:195,askQuantity:195,updatedAtMs:at-2_000});
const evidence=(at,bid=100,ask=100.5,strike=22050)=>({
  source:'READONLY_OPTION_EVIDENCE_ONLY',paperEntryAuthorized:false,
  telegramAuthorized:false,realOrdersEnabled:false,
  CE:quote('CE',at,bid,ask,strike),PE:quote('PE',at,bid,ask,strike)});
function reviewFrom(name) {
  const c=fixture(name), futures={symbol:'NFO:NIFTY26OCTFUT',instrumentToken:12345,
    exchangeAtMs:c.nowMs-1000,lastPrice:c.candles.at(-1).close};
  const review=reviewReadOnlyMarket({tickId:tick(271),observedAtMs:c.nowMs,
    futures,candles5:rows(c.candles),candles15:rows(c.confirm15m),
    strategyConfig:{adxMin:c.adxMin,atrBuffer:c.atrBuffer}});
  return {review,futures};
}

test('real parity-derived five-indicator CE review opens two independent paper accounts',()=>{
  const {review,futures}=reviewFrom('uptrend_mirrored_qualifying_review');
  assert.equal(review.status,'REVIEW_CE');
  const staged=stageReadOnlyReview(newReadOnlyBridge(),{tickId:tick(271),
    observedAtMs:nowMs,review,futures});
  const ledger=newPaperLedger(nowMs);
  const result=advanceReadOnlyPaperTurn(staged,ledger,{tickId:tick(272),
    observedAtMs:nowMs+20_000,evidence:evidence(nowMs+20_000)});
  assert.equal(result.result.status,'READONLY_PAPER_TICK');
  assert.equal(result.result.entryStatus,'PAPER_ENTRY');
  assert.equal(result.result.entered,2);
  assert.equal(result.ledger.positions.length,2);
  assert.equal(result.ledger.positions.every(p=>p.kind==='CE'&&
    p.signalId.startsWith('READONLY:2026-10-23:')),true);
  assert.equal(result.ledger.outbox.length,2);
  assert.equal(result.ledger.outbox.every(e=>e.status==='PENDING'),true);
  assert.equal(result.result.realOrdersEnabled,false);
  assert.equal(result.state.pending,null);
  assert.equal(auditReadOnlyBridge(result.state),true);
  assert.equal(auditPaperLedger(result.ledger),true);
  const summary=readOnlyBridgeSummary(result.state,result.ledger);
  assert.equal(summary.accountBalances.length,2);
  assert.equal(summary.liveOrdersEnabled,false);
  assert.equal(summary.totalPaperPositions,2);
});

test('fresh BID exit closes two paper accounts once; replay cannot double credit',()=>{
  const {review,futures}=reviewFrom('uptrend_mirrored_qualifying_review');
  const staged=stageReadOnlyReview(newReadOnlyBridge(),{tickId:tick(271),
    observedAtMs:nowMs,review,futures});
  const entered=advanceReadOnlyPaperTurn(staged,newPaperLedger(nowMs),{
    tickId:tick(272),observedAtMs:nowMs+20_000,evidence:evidence(nowMs+20_000)});
  const closed=advanceReadOnlyPaperTurn(entered.state,entered.ledger,{
    tickId:tick(275),observedAtMs:nowMs+80_000,evidence:evidence(nowMs+80_000,170,171)});
  assert.equal(closed.result.entered,0);
  assert.equal(closed.result.exited,2);
  assert.equal(closed.ledger.positions.every(p=>p.status==='CLOSED'),true);
  assert.equal(closed.ledger.outbox.length,4);
  const duplicate=advanceReadOnlyPaperTurn(closed.state,closed.ledger,{
    tickId:tick(275),observedAtMs:nowMs+80_000,evidence:evidence(nowMs+80_000,170,171)});
  assert.equal(duplicate.result.status,'DUPLICATE_OPTION_TICK');
  assert.strictEqual(duplicate.ledger,closed.ledger);
});

test('PE strategy case is independent of CE and no-trade cannot open positions',()=>{
  const p=reviewFrom('downtrend_qualifying_review');
  assert.equal(p.review.status,'REVIEW_PE');
  const peStage=stageReadOnlyReview(newReadOnlyBridge(),{
    tickId:tick(271),observedAtMs:nowMs,...p});
  const peQuote=evidence(nowMs+20_000,100,100.5,21950);
  const pe=advanceReadOnlyPaperTurn(peStage,newPaperLedger(nowMs),{
    tickId:tick(272),observedAtMs:nowMs+20_000,evidence:peQuote});
  assert.equal(pe.result.entered,2);
  assert.ok(pe.ledger.positions.every(pos=>pos.kind==='PE'));
  const sideways=reviewFrom('sideways');
  assert.equal(sideways.review.status,'NO_TRADE');
  const noStage=stageReadOnlyReview(newReadOnlyBridge(),{
    tickId:tick(271),observedAtMs:nowMs,...sideways});
  const no=advanceReadOnlyPaperTurn(noStage,newPaperLedger(nowMs),{
    tickId:tick(272),observedAtMs:nowMs+20_000,evidence:evidence(nowMs+20_000)});
  assert.equal(no.result.entered,0);
  assert.equal(no.ledger.positions.length,0);
});

test('stale/missing/wrong-side or mismatched data cannot create a paper fill',()=>{
  const p=reviewFrom('uptrend_mirrored_qualifying_review');
  const staged=stageReadOnlyReview(newReadOnlyBridge(),{
    tickId:tick(271),observedAtMs:nowMs,...p});
  const ledger=newPaperLedger(nowMs);
  const oldQuote=evidence(nowMs+20_000);
  oldQuote.CE.updatedAtMs=nowMs-30_000;
  assert.throws(()=>advanceReadOnlyPaperTurn(staged,ledger,{
    tickId:tick(272),observedAtMs:nowMs+20_000,evidence:oldQuote}));
  const mixed=evidence(nowMs+20_000);
  mixed.PE.contract.token=mixed.CE.contract.token;
  assert.throws(()=>advanceReadOnlyPaperTurn(staged,ledger,{
    tickId:tick(272),observedAtMs:nowMs+20_000,evidence:mixed}));
  const changed=evidence(nowMs+20_000,100,100.5,20000);
  const blocked=advanceReadOnlyPaperTurn(staged,ledger,{
    tickId:tick(272),observedAtMs:nowMs+20_000,evidence:changed});
  assert.equal(blocked.result.entered,0);
  assert.equal(blocked.ledger.positions.length,0);
  assert.throws(()=>advanceReadOnlyPaperTurn(staged,ledger,{
    tickId:tick(273),observedAtMs:nowMs+40_000,evidence:evidence(nowMs+40_000)}));
  assert.throws(()=>advanceReadOnlyPaperTurn(staged,ledger,{
    tickId:tick(272),observedAtMs:nowMs+45_000,evidence:evidence(nowMs+45_000)}));
  assert.equal(ledger.outbox.length,0);
});

test('review alone cannot mutate cash and forged/late review is refused',()=>{
  const p=reviewFrom('uptrend_mirrored_qualifying_review');
  const initial=newReadOnlyBridge();
  const staged=stageReadOnlyReview(initial,{tickId:tick(271),observedAtMs:nowMs,...p});
  assert.equal(initial.pending,null);
  assert.throws(()=>stageReadOnlyReview(staged,{tickId:tick(271),observedAtMs:nowMs,...p}));
  assert.throws(()=>stageReadOnlyReview(initial,{tickId:tick(270),observedAtMs:nowMs-20_000,...p}));
  assert.throws(()=>stageReadOnlyReview(initial,{tickId:tick(271),observedAtMs:nowMs,
    review:{...p.review,source:'OFFLINE_SYNTHETIC_TEST_ONLY'},futures:p.futures}));
  assert.throws(()=>stageReadOnlyReview(initial,{tickId:tick(271),observedAtMs:nowMs,
    review:{...p.review,paperEntryAuthorized:true},futures:p.futures}));
});

test('15:26 close records unresolved paper exits without inventing sale proceeds',()=>{
  const p=reviewFrom('uptrend_mirrored_qualifying_review');
  const staged=stageReadOnlyReview(newReadOnlyBridge(),{
    tickId:tick(271),observedAtMs:nowMs,...p});
  const entered=advanceReadOnlyPaperTurn(staged,newPaperLedger(nowMs),{
    tickId:tick(272),observedAtMs:nowMs+20_000,evidence:evidence(nowMs+20_000)});
  const closingAt=Date.parse('2026-10-23T15:26:40+05:30');
  const eod=advanceReadOnlyPaperTurn(entered.state,entered.ledger,{
    tickId:tick(1115),observedAtMs:closingAt,evidence:evidence(closingAt)});
  assert.equal(eod.result.exited,0);
  assert.equal(eod.ledger.positions.every(x=>x.status==='EXIT_UNVERIFIABLE'),true);
  assert.equal(eod.ledger.outbox.filter(x=>x.kind==='PAPER_UNVERIFIABLE').length,2);
  assert.equal(eod.ledger.positions.every(x=>x.exitCreditPaise===null),true);
});
