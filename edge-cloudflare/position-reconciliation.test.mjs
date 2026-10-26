import test from 'node:test';
import assert from 'node:assert/strict';
import {unresolvedFixture,EOD,AT,secrets} from './test-support/position-reconciliation-fixture.mjs';
import {auditPaperLedger,writeOffUnknownPaperExits,enterPaperBasket,exitPaperPosition,UNKNOWN_EXIT_WRITE_OFF_ACK} from './paper-ledger.mjs';
import {OBSERVED_ARCHIVE_KEYS,sealObservedArchive,openObservedArchive,restoreObservedArchiveToEmpty} from './observed-archive.mjs';
import {positionReconciliationView,reconcileUnknownPositions} from './position-reconciliation.mjs';
import {observedPortfolioMetrics,captureObservedPortfolio} from './observed-portfolio.mjs';
import {runPositionReconciliationCLI} from './position-reconciliation-cli.mjs';
import {makePaperArchive} from './paper-archive.mjs';
import worker from './worker.mjs';

function storeFor(state={}) {
  let rows=new Map(Object.entries(OBSERVED_ARCHIVE_KEYS).filter(([k])=>state[k]!==null&&state[k]!==undefined).map(([k,key])=>[key,structuredClone(state[k])]));
  return {get:async k=>rows.get(k),dump:()=>structuredClone(Object.fromEntries(rows)),transaction:async callback=>{
    const staged=new Map(structuredClone([...rows]));
    const result=await callback({get:async k=>staged.get(k),list:async()=>staged,put:async(k,v)=>staged.set(k,structuredClone(v)),
      getAlarm:async()=>null,deleteAlarm:async()=>{}});rows=staged;return result;}};
}
const now=EOD+60000;
const setup=async options=>{const state=unresolvedFixture(options),store=storeFor(state);
  const sealedArchive=await sealObservedArchive({state,createdAtMs:EOD+30000,...secrets});
  const view=positionReconciliationView(state,{nowMs:now,alarmAtMs:null});return {state,store,sealedArchive,view};};
const apply=s=>reconcileUnknownPositions(s.store,{request:s.view.request,sealedArchive:s.sealedArchive,nowMs:now,...secrets});

test('inspection exposes private accounting proof without inventing prices, refunds or delivery',async()=>{
  const s=await setup(),v=s.view;assert.equal(v.canWriteOff,true);assert.equal(v.positions.length,1);
  assert.equal(v.cashCreditPaise,0);assert.equal(v.strategyExitFillKnown,false);
  assert.equal(v.request.decision,UNKNOWN_EXIT_WRITE_OFF_ACK);
  assert.equal(JSON.stringify(v).includes('"token"'),false);assert.equal(JSON.stringify(v).includes('message'),false);
  assert.deepEqual(s.store.dump()['readonly-paper-ledger-v1'],s.state.ledger);
});

test('write-off preserves every debit and delivery prefix and reports the adjustment outside strategy statistics',async()=>{
  const s=await setup(),cash=structuredClone(s.state.ledger.accounts),delivery=structuredClone(s.state.delivery);
  const result=await apply(s),rows=s.store.dump(),ledger=rows[OBSERVED_ARCHIVE_KEYS.ledger];
  assert.equal(result.status,'POSITIONS_WRITTEN_OFF_UNKNOWN_EXIT');assert.equal(result.cashCreditPaise,0);
  assert.equal(ledger.schema,2);assert.equal(rows[OBSERVED_ARCHIVE_KEYS.lifecycle].writerVersion,2);
  assert.deepEqual(ledger.accounts,cash);assert.deepEqual(rows[OBSERVED_ARCHIVE_KEYS.delivery],delivery);
  const p=ledger.positions.find(p=>p.status==='EXIT_WRITTEN_OFF');
  assert.equal(p.exitAtMs,null);assert.equal(p.exitFillPaise,null);assert.equal(p.netPnlPaise,null);
  assert.equal(ledger.outbox.some(e=>e.kind==='PAPER_EXIT'&&e.tradeId===p.tradeId),false);
  const report=observedPortfolioMetrics(ledger,s.state.bridge,rows[OBSERVED_ARCHIVE_KEYS.metrics],now),a=report.accounts[1];
  assert.equal(a.closedTrades,0);assert.equal(a.realizedNetPnlRupees,0);assert.equal(a.ownerWriteOffCount,1);
  assert.equal(a.ownerAdjustmentPnlRupees,-p.entryDebitPaise/100);
  assert.equal(a.markedEquityRupees,cash.PAPER_100K.cashPaise/100);assert.equal(a.unrealizedPnlRupees,0);
  assert.equal(a.totalNetPnlRupees,a.realizedNetPnlRupees+a.ownerAdjustmentPnlRupees);
  assert.equal(a.drawdownBasis,'SAMPLED_PAPER_EQUITY_INCLUDING_OWNER_WRITE_OFFS');
  assert.equal(report.daily[1].ownerWriteOffCount,1);assert.equal(report.monthly[1].ownerWriteOffCount,1);
  const before=s.store.dump();assert.equal((await apply(s)).status,'POSITIONS_ALREADY_RECONCILED_NO_ACTION');
  assert.deepEqual(s.store.dump(),before);
});

test('both accounts and missed OPEN exits can be resolved atomically without manufacturing an exchange exit',async()=>{
  const s=await setup({both:true,carried:true}),before=structuredClone(s.state.ledger.accounts);
  assert.equal(s.view.positions.length,2);await apply(s);
  const l=s.store.dump()[OBSERVED_ARCHIVE_KEYS.ledger];assert.equal(auditPaperLedger(l),true);
  assert.equal(l.positions.every(p=>p.status==='EXIT_WRITTEN_OFF'),true);assert.deepEqual(l.accounts,before);
  assert.equal(l.outbox.filter(e=>e.kind==='PAPER_UNVERIFIABLE').length,2);assert.equal(l.outbox.filter(e=>e.kind==='PAPER_EXIT').length,0);
  assert.equal(l.positions.every(p=>p.exitFeePaise===null&&p.exitCreditPaise===null&&p.netPnlPaise===null),true);
});

test('active sources, early positions, stale archives, forged decisions and failed transactions remain unchanged',async()=>{
  const s=await setup(),before=s.store.dump();
  await assert.rejects(()=>reconcileUnknownPositions(s.store,{request:{...s.view.request,exitPrice:100},sealedArchive:s.sealedArchive,...secrets,nowMs:now}));
  await assert.rejects(()=>reconcileUnknownPositions(s.store,{request:{...s.view.request,decision:'MARK_PROFITABLE'},sealedArchive:s.sealedArchive,...secrets,nowMs:now}));
  const active=structuredClone(s.state);active.scheduler.halted=false;
  await assert.rejects(()=>reconcileUnknownPositions(storeFor(active),{request:s.view.request,sealedArchive:s.sealedArchive,...secrets,nowMs:now}),/HALT_REQUIRED/);
  const changed=structuredClone(s.state);changed.market.status='MARKET_BATCH_PARTIAL';
  await assert.rejects(()=>reconcileUnknownPositions(storeFor(changed),{request:s.view.request,sealedArchive:s.sealedArchive,...secrets,nowMs:now}),/BASELINE_NOT_CURRENT/);
  const failing={transaction:fn=>s.store.transaction(async txn=>{await fn(txn);throw Error('synthetic abort');})};
  await assert.rejects(()=>reconcileUnknownPositions(failing,{request:s.view.request,sealedArchive:s.sealedArchive,...secrets,nowMs:now}),/synthetic abort/);
  assert.deepEqual(s.store.dump(),before);
  const early=unresolvedFixture({both:true,carried:true});
  assert.throws(()=>writeOffUnknownPaperExits(early.ledger,{tradeIds:early.ledger.positions.map(p=>p.tradeId),nowMs:AT+60000,
    acknowledgement:UNKNOWN_EXIT_WRITE_OFF_ACK,baselineArchiveId:'a'.repeat(64)}),/INELIGIBLE/);
});

test('schema-2 owner decisions are audited and cannot be mislabeled as profitable closed trades',async()=>{
  const s=await setup();await apply(s);const l=s.store.dump()[OBSERVED_ARCHIVE_KEYS.ledger];
  for(const change of [x=>{x.schema=1;},x=>{x.positions[1].ownerResolution.atMs=AT;},
    x=>{x.positions[1].exitFillPaise=10000;},x=>{x.positions[1].netPnlPaise=1000;},
    x=>{x.positions[1].ownerResolution.baselineArchiveId='fake';},x=>{x.accounts.PAPER_100K.cashPaise++;}]) {
    const bad=structuredClone(l);change(bad);assert.throws(()=>auditPaperLedger(bad));
  }
  await assert.rejects(()=>makePaperArchive({ledger:l,createdAtMs:now,secret:secrets.signingSecret}),/UNSUPPORTED_SYNTHETIC_LEDGER/);
});

test('new archives carry protocol 2 and payload 3; baseline rollback preserves the original unresolved book',async()=>{
  const s=await setup();await apply(s);const rows=s.store.dump();
  const state=Object.fromEntries(Object.entries(OBSERVED_ARCHIVE_KEYS).map(([k,key])=>[k,rows[key]??null]));
  const sealed=await sealObservedArchive({state,createdAtMs:now,...secrets});
  const verified=await openObservedArchive({sealedArchive:sealed,...secrets});assert.equal(verified.sourcePayloadSchema,3);
  const restored=storeFor();await restoreObservedArchiveToEmpty(restored,{sealedArchive:sealed,...secrets,nowMs:now+1000});
  assert.deepEqual(restored.dump()[OBSERVED_ARCHIVE_KEYS.ledger],state.ledger);
  const rollback=storeFor();await restoreObservedArchiveToEmpty(rollback,{sealedArchive:s.sealedArchive,...secrets,nowMs:now+1000});
  assert.deepEqual(rollback.dump()[OBSERVED_ARCHIVE_KEYS.ledger],s.state.ledger);
  assert.equal(rollback.dump()[OBSERVED_ARCHIVE_KEYS.scheduler].halted,true);
});

test('write-off debits count toward the resolution day risk budget and never reset signal dedupe or capital',async()=>{
  const s=await setup({both:true,carried:true});await apply(s);const l=s.store.dump()[OBSERVED_ARCHIVE_KEYS.ledger];
  const next=Date.parse('2026-11-03T10:00:00+05:30');
  const q={contract:s.state.options.pair.CE,bid:100,ask:100.5,bidQuantity:650,askQuantity:650,updatedAtMs:next-1000};
  const entered=enterPaperBasket(l,{signalId:'following-day-owner-writeoff-001',nowMs:next,quote:q});
  assert.equal(entered.results.PAPER_50K.status,'OPEN');assert.equal(entered.results.PAPER_100K.status,'OPEN');
  assert.equal(entered.ledger.accounts.PAPER_50K.cashPaise,l.accounts.PAPER_50K.cashPaise-entered.ledger.positions[2].entryDebitPaise);
  const duplicate=enterPaperBasket(l,{signalId:l.positions[0].signalId,nowMs:next,quote:q});
  assert.equal(duplicate.results.PAPER_50K.status,'DUPLICATE');assert.deepEqual(duplicate.ledger.accounts,l.accounts);
  const late=await setup({both:true,carried:true});
  await reconcileUnknownPositions(late.store,{request:late.view.request,sealedArchive:late.sealedArchive,nowMs:next,...secrets});
  const lateBook=late.store.dump()[OBSERVED_ARCHIVE_KEYS.ledger];
  const blocked=enterPaperBasket(lateBook,{signalId:'same-day-owner-risk-001',nowMs:next+60000,quote:{...q,updatedAtMs:next+59000}});
  assert.equal(blocked.results.PAPER_50K.reason,'DAILY_LOSS_LIMIT');assert.equal(blocked.results.PAPER_100K.reason,'DAILY_LOSS_LIMIT');
  assert.deepEqual(blocked.ledger.accounts,lateBook.accounts);
});

test('operator client requires explicit zero-credit acknowledgement and a verified baseline before any POST',async()=>{
  const s=await setup(),logs=[],writes=[];let calls=0;
  const admin='synthetic-position-owner-admin-0123456789-AbCd';
  const deps={env:{SCHEDULER_ADMIN_KEY:admin,OBSERVED_ARCHIVE_HMAC_KEY:secrets.signingSecret,OBSERVED_ARCHIVE_AES_KEY:secrets.encryptionKeyBase64},
    readFile:async file=>file.endsWith('.enc')?s.sealedArchive:s.view,write:async(...args)=>writes.push(args),log:x=>logs.push(x),
    fetchImpl:async(url,init)=>{calls++;assert.equal(url,'https://unit.invalid/internal/readonly-paper/reconcile');
      assert.equal(init.redirect,'manual');return Response.json(init.method==='GET'?s.view:await apply(s));}};
  assert.equal(await runPositionReconciliationCLI([],deps),0);assert.equal(calls,0);
  assert.equal(await runPositionReconciliationCLI(['inspect','https://unit.invalid','position.reconciliation.json'],deps),0);
  assert.equal(writes[0][2].flag,'wx');
  assert.equal(await runPositionReconciliationCLI(['writeoff','https://unit.invalid','position.reconciliation.json','baseline.enc'],deps),1);assert.equal(calls,1);
  assert.equal(await runPositionReconciliationCLI(['writeoff','https://unit.invalid','position.reconciliation.json','baseline.enc','--acknowledge-unknown-exit-zero-credit'],deps),0);
  assert.equal(logs.some(x=>x.includes(admin)||x.includes(secrets.signingSecret)||x.includes(secrets.encryptionKeyBase64)),false);
});

test('later profitable strategy exits do not reconstruct a fictitious equity peak above owner-adjusted capital',async()=>{
  const s=await setup({both:true});await apply(s);const rows=s.store.dump(),old=rows[OBSERVED_ARCHIVE_KEYS.ledger];
  const at=Date.parse('2026-11-03T10:00:00+05:30');
  const q=(t,bid=100)=>({contract:s.state.options.pair.CE,bid,ask:bid+.5,bidQuantity:650,askQuantity:650,updatedAtMs:t-1000});
  let ledger=enterPaperBasket(old,{signalId:'after-writeoff-positive-exit-001',nowMs:at,quote:q(at)}).ledger;
  for(const p of ledger.positions.filter(p=>p.status==='OPEN'))ledger=exitPaperPosition(ledger,{tradeId:p.tradeId,nowMs:at+20000,quote:q(at+20000,141)}).ledger;
  const bridge={...s.state.bridge,lastOptionTickId:'2026-11-03:136',lastOptionAtMs:at+20000,totalOptionTicks:3};
  const metrics=captureObservedPortfolio(rows[OBSERVED_ARCHIVE_KEYS.metrics],s.state.bridge,old,bridge,ledger,[],at+20000);
  const report=observedPortfolioMetrics(ledger,bridge,metrics,at+20000),a=report.accounts[0];
  assert.equal(a.wins,1);assert.ok(a.realizedNetPnlRupees>0);assert.ok(a.totalNetPnlRupees<0);
  assert.equal(a.totalNetPnlRupees,Number((a.realizedNetPnlRupees+a.ownerAdjustmentPnlRupees).toFixed(2)));
  assert.equal(a.peakEquityRupees,50000);assert.equal(a.markedEquityRupees,ledger.accounts.PAPER_50K.cashPaise/100);
});

test('position reconciliation is separately gated and inaccessible with viewing credentials',async()=>{
  const key='synthetic-position-admin-0123456789-AbCd',env={SCHEDULER_ADMIN_KEY:key,OFFLINE_SCHEDULER_ENABLED:'true',OFFLINE_POSITION_RECONCILIATION_ENABLED:'true',
    MARKET_SESSION:{idFromName:()=>{throw Error('Do not touch namespace');}}};
  for(const [url,method,authorization,enabled] of [
    ['https://unit.invalid/internal/readonly-paper/reconcile','GET','Bearer wrong','true'],
    ['http://unit.invalid/internal/readonly-paper/reconcile','GET','Bearer '+key,'true'],
    ['https://unit.invalid/internal/readonly-paper/reconcile?key=bad','GET','Bearer '+key,'true'],
    ['https://unit.invalid/internal/readonly-paper/reconcile','PUT','Bearer '+key,'true'],
    ['https://unit.invalid/internal/readonly-paper/reconcile','GET','Bearer '+key,'false']])
    assert.equal((await worker.fetch(new Request(url,{method,headers:{authorization}}),{...env,OFFLINE_POSITION_RECONCILIATION_ENABLED:enabled})).status,404);
});
