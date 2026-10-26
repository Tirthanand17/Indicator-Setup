import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {Miniflare} from 'miniflare';
import {AT,fixture,secrets} from '../test-support/observed-archive-fixture.mjs';
import {openObservedArchive,sealObservedArchive} from '../observed-archive.mjs';
import {stageReadOnlyReview} from '../readonly-paper-bridge.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const admin='synthetic-native-archive-admin-0123456789-AbCd',headers={authorization:'Bearer '+admin};
const options=persist=>({modules:true,scriptPath:path.join(root,'runtime/harness.mjs'),modulesRoot:root,
  compatibilityDate:'2026-07-30',durableObjects:{MARKET_SESSION:{className:'TestSession',useSQLite:true}},durableObjectsPersist:persist,
  bindings:{SCHEDULER_ADMIN_KEY:admin,OBSERVED_ARCHIVE_HMAC_KEY:secrets.signingSecret,OBSERVED_ARCHIVE_AES_KEY:secrets.encryptionKeyBase64,
    OFFLINE_SCHEDULER_ENABLED:'true',OFFLINE_OBSERVED_ARCHIVE_ENABLED:'true',OFFLINE_OBSERVED_RESTORE_ENABLED:'true',
    READONLY_MARKET_RUNTIME_ENABLED:'true',OFFLINE_READONLY_REVIEW_ENABLED:'true',OFFLINE_OPTION_SNAPSHOT_ENABLED:'true',
    OFFLINE_PAPER_BRIDGE_ENABLED:'true',OFFLINE_READONLY_DELIVERY_REHEARSAL_ENABLED:'true',OFFLINE_TELEGRAM_SENDER_ENABLED:'true',
    TELEGRAM_BOT_TOKEN:'123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrst',TELEGRAM_PRIVATE_CHAT_ID:'123456789'},
  outboundService:()=>{throw Error('Unexpected external request in local archive drill');}});
const stub=async mf=>{const ns=await mf.getDurableObjectNamespace('MARKET_SESSION');return ns.get(ns.idFromName('nifty-paper-session-v1'));};
const post=(s,route,data)=>s.fetch('https://unit.invalid'+route,{method:'POST',body:JSON.stringify(data)});
const state=s=>s.fetch('https://unit.invalid/test/archive/state').then(r=>r.json());
const restore=(mf,bundle)=>mf.dispatchFetch('https://unit.invalid/internal/observed-archive/restore',{
  method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(bundle)});

test('native observed encrypted export and empty-target restore preserve accounting, replay boundaries and quarantine across restart',{timeout:30000},async()=>{
  const sourcePath=await mkdtemp(path.join(os.tmpdir(),'observed-archive-source-'));
  const targetPath=await mkdtemp(path.join(os.tmpdir(),'observed-archive-target-'));
  const source=new Miniflare(options(sourcePath));let target=new Miniflare(options(targetPath));
  try {
    const s=await stub(source),book=fixture();
    await post(s,'/test/archive/seed',{state:book,nowMs:AT+30000,alarm:AT+60000,
      extra:{key:'daily-token-v1',value:{access_token:'synthetic-vault-not-in-archive'}}});
    const before=await state(s);
    const exported=await source.dispatchFetch('https://unit.invalid/internal/observed-archive',{headers});
    assert.equal(exported.status,200,JSON.stringify(before.tables));assert.equal(exported.headers.get('cache-control'),'no-store');
    assert.match(exported.headers.get('content-disposition'),/attachment/);
    const sealedArchive=await exported.json(),opened=await openObservedArchive({sealedArchive,...secrets});
    assert.deepEqual(opened.state,book);assert.deepEqual(await state(s),before);
    assert.equal(JSON.stringify(sealedArchive).includes('synthetic-vault-not-in-archive'),false);
    let t=await stub(target);await post(t,'/test/pipeline/clock',{nowMs:AT+40000});
    const rolled=await (await post(t,'/test/archive/rollback',sealedArchive)).json();
    assert.equal(rolled.rolledBack,true);assert.equal((await state(t)).state.ledger,null);
    const response=await restore(target,sealedArchive);assert.equal(response.status,200);
    const result=await response.json();assert.equal(result.status,'RESTORED_OBSERVED_PAPER_QUARANTINED');
    assert.equal(result.deliveryWatermark,1);assert.equal(result.automaticResume,false);
    const restored=await state(t);
    for(const name of ['ledger','bridge','delivery','metrics','market','options','pacing','catalogue'])
      assert.deepEqual(restored.state[name],book[name],name);
    assert.equal(restored.state.delivery.active.status,'CLAIMED_UNCONFIRMED');
    assert.equal(restored.state.scheduler.halted,true);assert.equal(restored.alarm,null);assert.equal(restored.vaultPresent,false);
    const reexport=await target.dispatchFetch('https://unit.invalid/internal/observed-archive',{headers});
    assert.equal(reexport.status,200);
    assert.deepEqual((await openObservedArchive({sealedArchive:await reexport.json(),...secrets})).state,restored.state);
    assert.deepEqual(await state(t),restored);
    const bootstrap=await target.dispatchFetch('https://unit.invalid/internal/bootstrap',{method:'POST',headers});
    assert.equal(bootstrap.status,503);assert.equal((await bootstrap.json()).status,'ARCHIVE_RESTORED_QUARANTINED');
    assert.equal((await (await t.fetch('https://unit.invalid/test/archive/alarm')).json()).shouldPoll,false);
    assert.equal((await restore(target,sealedArchive)).status,503);
    await target.dispose();target=new Miniflare(options(targetPath));t=await stub(target);
    assert.deepEqual(await state(t),restored);
    assert.equal((await (await t.fetch('https://unit.invalid/test/archive/alarm')).json()).shouldPoll,false);
    const delivery=await (await target.dispatchFetch('https://unit.invalid/internal/readonly-delivery',{headers})).json();
    assert.equal(delivery.acceptedByBotApi,1);assert.equal(delivery.cursor,1);
    assert.equal(delivery.blockingState,'AMBIGUOUS_ACK_REQUIRED');
    assert.equal((await (await post(t,'/test/read-only-telegram/dispatch',{scenario:'accepted'})).json()).status,'BLOCKED_DELIVERY_CLAIM');
    assert.deepEqual(await state(t),restored);
  } finally {await source.dispose();await target.dispose();}
});

test('native restore refuses credential-only, unknown-key and alarm-only targets without altering them',async()=>{
  const sealed=await sealObservedArchive({state:fixture(),createdAtMs:AT+30000,...secrets});
  for(const input of [{extra:{key:'unknown-future-schema-key',value:{retained:true}}},
    {extra:{key:'daily-token-v1',value:{retained:true}}},{alarm:AT+60000},{sqlTable:true}]) {
    const mf=new Miniflare(options(await mkdtemp(path.join(os.tmpdir(),'observed-archive-nonempty-'))));
    try {
      const s=await stub(mf);await post(s,'/test/archive/seed',{nowMs:AT+40000,...input});
      const before=await state(s);assert.equal((await restore(mf,sealed)).status,503);
      assert.deepEqual(await state(s),before);
    } finally {await mf.dispose();}
  }
});

test('native lifecycle migration is atomic, idempotent, restart-safe and rejects incompatible writers',async()=>{
  const persist=await mkdtemp(path.join(os.tmpdir(),'observed-lifecycle-'));
  let mf=new Miniflare(options(persist));
  try {
    let s=await stub(mf);const book=fixture();
    book.scheduler={...book.scheduler,halted:true,scheduledAtMs:null,status:'OWNER_EMERGENCY_HALT'};
    await post(s,'/test/archive/seed',{state:book,nowMs:AT+30000});
    const baseline=await (await mf.dispatchFetch('https://unit.invalid/internal/observed-archive',{headers})).json();
    const before=await state(s);
    const migrate=()=>mf.dispatchFetch('https://unit.invalid/internal/observed-lifecycle',{
      method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(baseline)});
    const result=await migrate();assert.equal(result.status,200);
    assert.equal((await result.json()).status,'LIFECYCLE_MIGRATED_HALTED');
    const after=await state(s);
    for(const name of Object.keys(before.state).filter(k=>k!=='lifecycle'))assert.deepEqual(after.state[name],before.state[name],name);
    assert.equal((await (await migrate()).json()).status,'LIFECYCLE_ALREADY_MIGRATED');
    const report=await (await mf.dispatchFetch('https://unit.invalid/internal/observed-lifecycle',{headers})).json();
    assert.equal(report.status,'CURRENT_SCHEMA');assert.equal(report.automaticDeletion,false);
    await mf.dispose();mf=new Miniflare(options(persist));s=await stub(mf);
    assert.deepEqual((await state(s)).state.lifecycle,after.state.lifecycle);
    const future={...after.state,lifecycle:{...after.state.lifecycle,writerVersion:3}};
    await post(s,'/test/archive/seed',{state:future,nowMs:AT+40000});
    assert.equal((await (await s.fetch('https://unit.invalid/test/archive/alarm')).json()).status,'BLOCKED_INCOMPATIBLE_SCHEMA');
    assert.equal((await mf.dispatchFetch('https://unit.invalid/internal/bootstrap',{method:'POST',headers})).status,503);
    assert.deepEqual((await state(s)).state.ledger,book.ledger);
    assert.equal((await state(s)).state.lifecycle.writerVersion,3);
    await post(s,'/test/archive/seed',{nowMs:AT+40000,extra:{key:'readonly-lifecycle-v1',value:null}});
    assert.equal((await (await s.fetch('https://unit.invalid/test/archive/alarm')).json()).status,'BLOCKED_INCOMPATIBLE_SCHEMA');
    assert.equal((await mf.dispatchFetch('https://unit.invalid/internal/observed-archive',{headers})).status,503);
  } finally {await mf.dispose();}
});

test('native full-journal re-entry refusal preserves the same-tick protective exit and delivery watermark',async()=>{
  const mf=new Miniflare(options(await mkdtemp(path.join(os.tmpdir(),'observed-capacity-exit-'))));
  try {
    const s=await stub(mf),book=fixture(),reviewAt=AT+320000,exitAt=AT+340000;
    book.metrics=null;
    book.ledger.rejections=Array.from({length:1024},(_,i)=>({accountId:i%2?'PAPER_50K':'PAPER_100K',
      signalId:'native-capacity-rejection-'+i,atMs:AT+20000,reason:'TEST_RISK_REJECTION'}));
    book.bridge=stageReadOnlyReview(book.bridge,{tickId:'2026-11-02:151',observedAtMs:reviewAt,
      review:{source:'READONLY_FUTURES_REVIEW_ONLY',status:'REVIEW_CE',paperEntryAuthorized:false,
        telegramAuthorized:false,realOrdersEnabled:false,fiveMinuteCandleAtMs:AT},
      futures:{symbol:'NFO:NIFTY26NOVFUT',instrumentToken:55555,exchangeAtMs:reviewAt-1000,lastPrice:23000}});
    await post(s,'/test/archive/seed',{state:book,nowMs:exitAt});
    const leg=kind=>({contract:book.options.pair[kind],bid:170,ask:170.5,
      bidQuantity:650,askQuantity:650,updatedAtMs:exitAt-1000});
    const turn=await (await post(s,'/test/read-only-paper/turn',{tickId:'2026-11-02:152',observedAtMs:exitAt,
      evidence:{source:'READONLY_OPTION_EVIDENCE_ONLY',paperEntryAuthorized:false,telegramAuthorized:false,
        realOrdersEnabled:false,CE:leg('CE'),PE:leg('PE')}})).json();
    assert.equal(turn.exited,1);assert.equal(turn.entered,0);assert.equal(turn.entryStatus,'PAPER_ENTRY_CAPACITY_BLOCKED');
    const after=(await state(s)).state;
    assert.equal(after.ledger.positions.every(p=>p.status==='CLOSED'),true);
    assert.equal(after.ledger.outbox.length,4);assert.equal(after.ledger.rejections.length,1024);
    assert.deepEqual(after.delivery,book.delivery);assert.equal(after.bridge.pending,null);
  } finally {await mf.dispose();}
});
