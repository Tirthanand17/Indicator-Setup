import test from 'node:test';
import assert from 'node:assert/strict';
import { newPaperLedger, enterPaperBasket, exitPaperPosition,
  auditPaperLedger } from './paper-ledger.mjs';
import { newSyntheticSession } from './synthetic-session.mjs';
import { makePaperArchive, verifyPaperArchive, paperArchiveCapacity,
  restorePaperArchiveToEmpty, MAX_ARCHIVE_BYTES } from './paper-archive.mjs';
import { sessionStatus } from './alarm-core.mjs';
import worker from './worker.mjs';
import {observedRetentionReport} from './observed-lifecycle.mjs';

const SECRET = 'offline-paper-archive-signing-Key-0123456789-ABCDEF';
const AT = Date.parse('2026-10-23T04:30:00Z');
const quote = (nowMs, bid = 100, ask = 100.5) => ({
  contract: { symbol: 'NIFTY26OCT23000CE', kind: 'CE',
    expiry: '2026-10-29', token: 12345, lotSize: 65 },
  bid, ask, bidQuantity: 650, askQuantity: 650, updatedAtMs: nowMs - 1000,
});
const opened = () => enterPaperBasket(newPaperLedger(AT), {
  signalId: 'archive-signal-001', quote: quote(AT), nowMs: AT,
}).ledger;
const make = (ledger = opened(), session = null) => makePaperArchive({ ledger, session,
  createdAtMs: ledger.lastMutationAtMs + 1000, secret: SECRET });

test('even a valid admin key cannot remotely export or restore a private paper journal',async()=>{
  const env={SCHEDULER_ADMIN_KEY:SECRET,OFFLINE_SCHEDULER_ENABLED:'true',
    OFFLINE_PAPER_LEDGER_ENABLED:'true',OFFLINE_PAPER_ARCHIVE_ENABLED:'true',
    MARKET_SESSION:{idFromName:()=>{throw Error('must not reach DO');}}};
  for(const [method,path] of [['GET','/internal/paper-archive'],
    ['GET','/internal/paper-capacity'],['POST','/internal/paper-restore']]) {
    const result=await worker.fetch(new Request('https://unit.invalid'+path,
      {method,headers:{authorization:'Bearer '+SECRET}}),env);
    assert.equal(result.status,404);
  }
});

/** Implements transaction copy-on-write in memory, not a network mock. */
function emptyStore() {
  const rows = new Map();
  return { rows, async transaction(callback) {
    const next = new Map(structuredClone([...rows.entries()]));
    const txn = { get: async k => next.get(k), put: async (k,v) => next.set(k,structuredClone(v)) };
    const result = await callback(txn);
    rows.clear();
    for (const [k,v] of next) rows.set(k,v);
    return result;
  } };
}

test('signed portable bundle round-trips exact ledger, pending outbox, optional synthetic session', async () => {
  const ledger = opened(), session = newSyntheticSession();
  const bundle = await make(ledger, session);
  assert.equal(bundle.payload.format, 'NIFTY_PAPER_RESEARCH_ARCHIVE');
  assert.equal(bundle.auth.algorithm, 'HMAC-SHA256');
  assert.match(bundle.auth.tag, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(JSON.stringify(bundle).includes(SECRET), false);
  assert.equal(JSON.stringify(bundle).includes('access_token'), false);
  assert.equal(JSON.stringify(bundle).includes('daily-token-v1'), false);
  const recovered = await verifyPaperArchive(JSON.parse(JSON.stringify(bundle)),SECRET);
  assert.deepEqual(recovered.ledger,ledger);
  assert.deepEqual(recovered.session,session);
  assert.equal(recovered.ledger.outbox.length,2);
  assert.equal(recovered.ledger.outbox.every(x=>x.status==='PENDING'),true);
});

test('wrong signing key, altered cash, changed entries and fabricated HMAC all fail before restore',async()=>{
  const bundle=await make();
  await assert.rejects(()=>verifyPaperArchive(bundle,SECRET+'X'));
  const variants=[structuredClone(bundle),structuredClone(bundle),structuredClone(bundle)];
  variants[0].payload.ledger.accounts.PAPER_50K.cashPaise+=1;
  variants[1].payload.ledger.outbox[0].message='FORGED EXIT AND NOTIFICATION';
  variants[2].auth.tag='A'.repeat(43);
  for(const damaged of variants) {
    await assert.rejects(()=>verifyPaperArchive(damaged,SECRET));
    const target=emptyStore();
    await assert.rejects(()=>restorePaperArchiveToEmpty(target,damaged,SECRET));
    assert.equal(target.rows.size,0);
  }
});

test('restore to empty transactional storage is one-time, no broker vault or scheduler side effects',async()=>{
  const ledger=opened();
  const bundle=await make(ledger,newSyntheticSession());
  const target=emptyStore();
  const result=await restorePaperArchiveToEmpty(target,bundle,SECRET);
  assert.equal(result.status,'OFFLINE_RESTORED_TO_EMPTY_STORAGE');
  assert.equal(result.alarmRestored,false);
  assert.equal(result.vaultRestored,false);
  assert.deepEqual(target.rows.get('paper-ledger-v1'),ledger);
  assert.deepEqual(target.rows.get('synthetic-session-v1'),newSyntheticSession());
  assert.equal(target.rows.has('daily-token-v1'),false);
  assert.equal(target.rows.has('scheduler-v1'),false);
  const before=structuredClone([...target.rows]);
  await assert.rejects(()=>restorePaperArchiveToEmpty(target,bundle,SECRET),/TARGET_NOT_EMPTY/);
  assert.deepEqual([...target.rows],before);
});

test('empty ledger backup does not overwrite a scheduler-only, token-only or market-only target',async()=>{
  const bundle=await make(newPaperLedger(AT));
  for(const key of ['scheduler-v1','daily-token-v1','market-observation-v1',
    'paper-ledger-v1','synthetic-session-v1','synthetic-portfolio-marks-v1',
    'paper-delivery-v1']) {
    const store=emptyStore();store.rows.set(key,{existing:true});
    await assert.rejects(()=>restorePaperArchiveToEmpty(store,bundle,SECRET),/TARGET_NOT_EMPTY/);
    assert.deepEqual(store.rows.get(key),{existing:true});
  }
});

test('capacity distinguishes safe, warning, critical, full and rolling decision history',()=>{
  const ledger=newPaperLedger(AT);
  const append=n=>{
    for(let i=ledger.rejections.length;i<n;i++) ledger.rejections.push({
      accountId:i%2?'PAPER_100K':'PAPER_50K',signalId:`cap-rejection-${i}`,
      reason:'SYNTHETIC_CAPACITY_TEST',atMs:AT,
    });
    return paperArchiveCapacity(ledger);
  };
  assert.equal(append(0).capacityStatus,'OK');
  assert.equal(append(768).capacityStatus,'WARNING');
  assert.equal(append(922).capacityStatus,'CRITICAL');
  assert.equal(append(1024).capacityStatus,'AT_LIMIT');
  assert.equal(append(1024).journalRows.find(r=>r.kind==='rejections').remaining,0);
  const session=newSyntheticSession();
  const day='2026-10-23';
  for(let slot=0;slot<128;slot++) {
    const at=Date.parse(`${day}T09:15:00+05:30`)+slot*20000;
    session.events.push({tickId:`${day}:${slot}`,observedAtMs:at,decision:'WAIT_DATA',
      entered:0,exited:0,unverifiable:0});
  }
  session.totalTicks=128;session.lastTickId=`${day}:127`;
  session.lastObservedAtMs=session.events.at(-1).observedAtMs;
  assert.equal(paperArchiveCapacity(newPaperLedger(AT),session).journalRows
    .find(r=>r.kind==='recentSyntheticEvents').status,'ROLLING');
  assert.equal(paperArchiveCapacity(newPaperLedger(AT),session).capacityStatus,'OK');
});

test('real entry/exit transitions reach 512 preserved positions and 1024 pending alerts without pruning', {
  timeout: 90_000,
},async()=>{
  let ledger=null,signals=0;
  for(let offset=0;offset<300&&signals<256;offset++) {
    const day=new Date(Date.parse('2026-04-02T00:00:00Z')+offset*86_400_000)
      .toISOString().slice(0,10);
    if(sessionStatus(day)!=='REGULAR')continue;
    for(let slot=0;slot<3&&signals<256;slot++) {
      const at=Date.parse(`${day}T09:30:00+05:30`)+slot*240000;
      if(!ledger)ledger=newPaperLedger(at);
      const signalId=`capacity-signal-${String(signals).padStart(4,'0')}`;
      ledger=enterPaperBasket(ledger,{signalId,nowMs:at,quote:quote(at)}).ledger;
      if(signals===255) {
        const r=observedRetentionReport({ledger,lifecycle:null});
        assert.equal(r.reservedTerminalEvents,2);assert.equal(r.exitEventRoomAvailable,true);
        assert.equal(r.rows.find(r=>r.kind==='outbox').remaining,2);
        assert.equal(r.entryEventRoom,0);
      }
      for(const accountId of ['PAPER_50K','PAPER_100K']) {
        const id=`${accountId}:${signalId}`;
        ledger=exitPaperPosition(ledger,{tradeId:id,nowMs:at+120000,
          quote:quote(at+120000,141,141.5)}).ledger;
      }
      signals++;
    }
  }
  assert.equal(signals,256);
  assert.equal(auditPaperLedger(ledger),true);
  assert.equal(ledger.positions.length,512);
  assert.equal(ledger.outbox.length,1024);
  assert.equal(ledger.positions.every(p=>p.status==='CLOSED'),true);
  const stats=paperArchiveCapacity(ledger);
  assert.equal(stats.capacityStatus,'AT_LIMIT');
  assert.equal(stats.archiveTooLarge,false);
  assert.ok(stats.serializedStateBytes>100_000);
  assert.ok(stats.serializedStateBytes<MAX_ARCHIVE_BYTES);
  const bundle=await make(ledger);
  const longestMessages=structuredClone(ledger);
  for(const record of longestMessages.outbox)record.message='X'.repeat(1200);
  assert.equal(auditPaperLedger(longestMessages),true);
  assert.ok(paperArchiveCapacity(longestMessages).serializedStateBytes < MAX_ARCHIVE_BYTES);
  assert.equal((await verifyPaperArchive(await make(longestMessages),SECRET))
    .ledger.outbox.length,1024);
  // Offline bytes, not measured hosted storage or Cloudflare billed usage.
  console.log('OFFLINE_CAPACITY_PROFILE '+JSON.stringify({
    positions:ledger.positions.length,pendingAlerts:ledger.outbox.length,
    jsonStateBytes:stats.serializedStateBytes,
    signedArchiveBytes:new TextEncoder().encode(JSON.stringify(bundle)).byteLength,
  }));
  assert.equal((await verifyPaperArchive(bundle,SECRET)).ledger.positions.length,512);
  const target=emptyStore();
  await restorePaperArchiveToEmpty(target,bundle,SECRET);
  assert.equal(target.rows.get('paper-ledger-v1').outbox.length,1024);
  const nextAt=ledger.lastMutationAtMs+240000;
  assert.throws(()=>enterPaperBasket(ledger,{signalId:'capacity-overflow-0001',
    nowMs:nextAt,quote:quote(nextAt)}),/PAPER_LEDGER_RECORD_CAPACITY/);
});
