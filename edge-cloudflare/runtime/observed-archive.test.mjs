import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {Miniflare} from 'miniflare';
import {AT,fixture,secrets} from '../test-support/observed-archive-fixture.mjs';
import {openObservedArchive,sealObservedArchive} from '../observed-archive.mjs';

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
