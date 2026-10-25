import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {newReadOnlyBridge} from './readonly-paper-bridge.mjs';
import {auditObservedArchiveState,OBSERVED_ARCHIVE_KEYS,OBSERVED_RECOVERY_KEY,
  snapshotObservedState,sealObservedArchive,openObservedArchive,restoreObservedArchiveToEmpty,
  observedArchiveSummary,readObservedArchiveJSON,MAX_OBSERVED_SEALED_BYTES} from './observed-archive.mjs';
import {runObservedArchiveCLI} from './observed-archive-cli.mjs';
import worker,{MarketSession} from './worker.mjs';

import {AT,secrets,fixture} from './test-support/observed-archive-fixture.mjs';
const admin='synthetic-observed-archive-admin-0123456789-AbCd';
const seal=(state=fixture())=>sealObservedArchive({state,createdAtMs:AT+30000,...secrets});
const open=sealedArchive=>openObservedArchive({sealedArchive,...secrets});
const restore=(storage,sealedArchive)=>restoreObservedArchiveToEmpty(storage,{sealedArchive,...secrets,nowMs:AT+40000});
export function memoryStore(initial={}) {
  let rows=new Map(Object.entries(structuredClone(initial))),alarm=null;
  return {get:async k=>rows.get(k),getAlarm:async()=>alarm,
    setAlarm:async value=>{alarm=value;},dump:()=>structuredClone(Object.fromEntries(rows)),
    async transaction(callback) {
      const staged=new Map(structuredClone([...rows]));let nextAlarm=alarm;
      const txn={get:async k=>staged.get(k),list:async()=>staged,put:async(k,v)=>staged.set(k,structuredClone(v)),
        getAlarm:async()=>nextAlarm,deleteAlarm:async()=>{nextAlarm=null;}};
      const result=await callback(txn);rows=staged;alarm=nextAlarm;return result;
    }};
}
const initial=state=>Object.fromEntries(Object.entries(OBSERVED_ARCHIVE_KEYS).filter(([k])=>state[k]!==null).map(([k,key])=>[key,state[k]]));

test('observed archive round trip preserves both accounts, marks and accepted/uncertain delivery state',async()=>{
  const state=fixture(),store=memoryStore({...initial(state),'daily-token-v1':{access_token:'synthetic-must-not-export'}});
  const before=store.dump(),snapshot=await snapshotObservedState(store,AT+30000);
  assert.deepEqual(snapshot,state);assert.deepEqual(store.dump(),before);
  const a=await seal(snapshot),b=await seal(snapshot);
  assert.notEqual(a.iv,b.iv);assert.notEqual(a.ciphertext,b.ciphertext);
  const result=await open(a);assert.deepEqual(result.state,state);
  assert.equal(observedArchiveSummary(result).deliveryWatermark,1);
  for(const leak of ['observed-archive-entry-001','synthetic-must-not-export','"telegramMessageId":9001','accounts','outbox',secrets.signingSecret])
    assert.equal(JSON.stringify(a).includes(leak),false);
  assert.equal(result.state.delivery.active.status,'CLAIMED_UNCONFIRMED');
  await assert.rejects(()=>snapshotObservedState(memoryStore({...initial(state),'unknown-future-key':{}}),AT+30000),/UNKNOWN_SOURCE_RECORD/);
});

test('tampered, foreign, malformed and wrong-key envelopes cannot restore any state',async()=>{
  const good=await seal(),bad=structuredClone(good);bad.ciphertext=(bad.ciphertext[0]==='A'?'B':'A')+bad.ciphertext.slice(1);
  const store=memoryStore();
  for(const archive of [bad,{...good,format:'NIFTY_PAPER_RESEARCH_ARCHIVE'},
    {...good,schema:2},{...good,extra:'plaintext'},{...good,iv:'A'}, {...good,ciphertext:'!'}])
    await assert.rejects(()=>restore(store,archive));
  await assert.rejects(()=>openObservedArchive({sealedArchive:good,...secrets,signingSecret:secrets.signingSecret+'wrong'}));
  await assert.rejects(()=>openObservedArchive({sealedArchive:good,...secrets,encryptionKeyBase64:randomBytes(32).toString('base64')}));
  await assert.rejects(()=>sealObservedArchive({state:fixture(),createdAtMs:AT+30000,
    signingSecret:secrets.encryptionKeyBase64,encryptionKeyBase64:secrets.encryptionKeyBase64}));
  assert.deepEqual(store.dump(),{});
});

test('incomplete books, forged cash/metrics/watermarks, credential fields and bad clocks are rejected',async()=>{
  const good=fixture();
  for(const change of [s=>{delete s.metrics;},s=>{s.ledger.accounts.PAPER_50K.cashPaise++;},
    s=>{s.delivery.nextIndex=0;},s=>{s.metrics.positionCount++;},s=>{s.bridge=newReadOnlyBridge();},
    s=>{s.market.access_token='synthetic-private';},s=>{s.scheduler.lastObservedAtMs=AT+31000;},
    s=>{s.pacing.lastReservedAtMs=AT+31000;},s=>{s.options.schema=9;}]) {
    const bad=structuredClone(good);change(bad);
    assert.throws(()=>auditObservedArchiveState(bad,AT+30000));
  }
  await assert.rejects(()=>sealObservedArchive({state:good,createdAtMs:AT,...secrets}));
  const missing=structuredClone(good);missing.delivery=null;missing.metrics=null;
  const result=await open(await seal(missing));
  assert.equal(observedArchiveSummary(result).deliveryReplaySafety,'MISSING_WATERMARK_QUARANTINE_REQUIRED');
  assert.equal(observedArchiveSummary(result).metricHistory,'UNAVAILABLE_IN_SOURCE');
});

test('empty-target restore is atomic, halted, credential-free and preserves uncertainty without replay',async()=>{
  const state=fixture(),archive=await seal(state),store=memoryStore();
  const result=await restore(store,archive);
  assert.equal(result.status,'RESTORED_OBSERVED_PAPER_QUARANTINED');
  const rows=store.dump();assert.deepEqual(rows[OBSERVED_ARCHIVE_KEYS.ledger],state.ledger);
  assert.deepEqual(rows[OBSERVED_ARCHIVE_KEYS.delivery],state.delivery);
  assert.deepEqual(rows[OBSERVED_ARCHIVE_KEYS.metrics],state.metrics);
  assert.equal(rows['scheduler-v1'].halted,true);assert.equal(rows['scheduler-v1'].scheduledAtMs,null);
  assert.deepEqual(rows[OBSERVED_RECOVERY_KEY].sourceScheduler,state.scheduler);
  assert.equal(await store.getAlarm(),null);assert.equal(rows['daily-token-v1'],undefined);
  const session=new MarketSession({storage:store},{OFFLINE_SCHEDULER_ENABLED:'true'});
  await assert.rejects(()=>session.assertNotHalted(),/HALTED/);
  assert.equal((await session.alarm()).shouldPoll,false);
  await assert.rejects(()=>restore(store,archive),/TARGET_NOT_EMPTY/);
  for(const key of ['daily-token-v1','unrecognized-record','paper-delivery-v1',OBSERVED_RECOVERY_KEY])
    await assert.rejects(()=>restore(memoryStore({[key]:{}}),archive),/TARGET_NOT_EMPTY/);
  const alarmOnly=memoryStore();await alarmOnly.setAlarm(AT+60000);
  await assert.rejects(()=>restore(alarmOnly,archive),/TARGET_NOT_EMPTY/);
  assert.deepEqual(alarmOnly.dump(),{});
  const broken=memoryStore(),failing={transaction:fn=>broken.transaction(async txn=>{await fn(txn);throw Error('synthetic abort');})};
  await assert.rejects(()=>restore(failing,archive),/synthetic abort/);assert.deepEqual(broken.dump(),{});
  await assert.rejects(()=>restoreObservedArchiveToEmpty(memoryStore(),{sealedArchive:archive,...secrets,nowMs:AT}),/RESTORE_CLOCK/);
});

test('archive routes require admin, TLS, exact path/method and separate disabled flags before storage',async()=>{
  const env={OFFLINE_SCHEDULER_ENABLED:'true',OFFLINE_OBSERVED_ARCHIVE_ENABLED:'true',SCHEDULER_ADMIN_KEY:admin,
    MARKET_SESSION:{idFromName:()=>{throw Error('Must not access storage');}}};
  for(const [url,method,authorization] of [
    ['https://unit.invalid/internal/observed-archive','GET',undefined],
    ['http://unit.invalid/internal/observed-archive','GET','Bearer '+admin],
    ['https://unit.invalid/internal/observed-archive?key=bad','GET','Bearer '+admin],
    ['https://unit.invalid/internal/observed-archive','POST','Bearer '+admin],
    ['https://unit.invalid/internal/observed-archive/restore','POST','Bearer '+admin]]) {
    const r=await worker.fetch(new Request(url,{method,headers:authorization?{authorization}:{}}),env);
    assert.equal(r.status,404);
  }
  const disabled={...env,OFFLINE_OBSERVED_ARCHIVE_ENABLED:'false'};
  assert.equal((await worker.fetch(new Request('https://unit.invalid/internal/observed-archive',
    {headers:{authorization:'Bearer '+admin}}),disabled)).status,404);
});

test('bounded UTF-8 JSON reader rejects oversized, malformed and absent bodies',async()=>{
  assert.deepEqual(await readObservedArchiveJSON(new Response('{"schema":1}').body),{schema:1});
  await assert.rejects(()=>readObservedArchiveJSON(new Response('no-json').body),/INVALID_JSON/);
  await assert.rejects(()=>readObservedArchiveJSON(null),/MISSING_BODY/);
  let cancelled=false;
  const stream=new ReadableStream({pull(c){c.enqueue(new Uint8Array(MAX_OBSERVED_SEALED_BYTES+1));},cancel(){cancelled=true;}});
  await assert.rejects(()=>readObservedArchiveJSON(stream),/SIZE_LIMIT/);assert.equal(cancelled,true);
});

test('operator CLI verifies before exclusive encrypted write and before any restore request',async()=>{
  const archive=await seal(),verified=await open(archive),logs=[],writes=[];
  const env={OBSERVED_ARCHIVE_HMAC_KEY:secrets.signingSecret,OBSERVED_ARCHIVE_AES_KEY:secrets.encryptionKeyBase64,SCHEDULER_ADMIN_KEY:admin};
  let calls=0;
  const deps={env,log:s=>logs.push(s),now:()=>AT+40000,read:async()=>archive,
    write:async(...args)=>writes.push(args),fetchImpl:async(url,init)=>{
      calls++;assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');
      assert.equal(init.headers.authorization,'Bearer '+admin);
      assert.ok(url.startsWith('https://unit.invalid/internal/observed-archive'));
      return Response.json(init.method==='GET'?archive:{status:'RESTORED_OBSERVED_PAPER_QUARANTINED',archiveId:verified.archiveId,automaticResume:false});}};
  assert.equal(await runObservedArchiveCLI([],deps),0);assert.equal(calls,0);
  assert.equal(await runObservedArchiveCLI(['verify','fixture.enc'],deps),0);assert.equal(calls,0);
  assert.equal(await runObservedArchiveCLI(['export','https://unit.invalid','fixture.enc'],deps),0);
  assert.equal(writes[0][2].flag,'wx');assert.equal(writes[0][2].mode,0o600);
  assert.deepEqual(JSON.parse(writes[0][1]),archive);
  assert.equal(await runObservedArchiveCLI(['restore','https://unit.invalid','fixture.enc','--empty-quarantined'],deps),0);
  const previous=calls;
  assert.equal(await runObservedArchiveCLI(['restore','https://unit.invalid','fixture.enc'],deps),1);
  assert.equal(await runObservedArchiveCLI(['restore','https://unit.invalid','fixture.enc','--empty-quarantined'],
    {...deps,read:async()=>({...archive,schema:2})}),1);
  assert.equal(calls,previous);
  for(const url of ['http://unit.invalid','https://user:secret@unit.invalid','https://unit.invalid/a','https://unit.invalid?token=bad'])
    assert.equal(await runObservedArchiveCLI(['export',url,'fixture.enc'],deps),1);
  assert.equal(calls,previous);
  assert.equal(await runObservedArchiveCLI(['export','https://unit.invalid','existing.enc'],{...deps,write:async()=>{throw Error('EEXIST');}}),1);
  assert.equal(logs.some(s=>s.includes(secrets.signingSecret)||s.includes(secrets.encryptionKeyBase64)||s.includes('observed-archive-entry-001')),false);
});
