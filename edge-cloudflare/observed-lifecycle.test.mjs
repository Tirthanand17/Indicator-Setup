import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture,AT,secrets} from './test-support/observed-archive-fixture.mjs';
import {sealObservedArchive,openObservedArchive,OBSERVED_ARCHIVE_KEYS,restoreObservedArchiveToEmpty} from './observed-archive.mjs';
import {migrateObservedLifecycle} from './observed-lifecycle-ops.mjs';
import {auditObservedLifecycle,assertObservedWriter,observedRetentionReport,OBSERVED_LIFECYCLE_KEY} from './observed-lifecycle.mjs';
import {MarketSession} from './worker.mjs';

function storeFor(state) {
  let rows=new Map(Object.entries(OBSERVED_ARCHIVE_KEYS).filter(([k])=>state[k]!==null).map(([k,key])=>[key,structuredClone(state[k])]));
  return {get:async key=>rows.get(key),dump:()=>structuredClone(Object.fromEntries(rows)),
    transaction:async callback=>{const copy=new Map(structuredClone([...rows]));
      const result=await callback({get:async key=>copy.get(key),list:async()=>copy,put:async(k,v)=>copy.set(k,structuredClone(v)),
        getAlarm:async()=>null,deleteAlarm:async()=>{}});rows=copy;return result;}};
}
const halted=()=>{const s=fixture();s.scheduler={...s.scheduler,halted:true,scheduledAtMs:null,status:'OWNER_EMERGENCY_HALT'};return s;};
const seal=state=>sealObservedArchive({state,createdAtMs:Math.max(AT+30000,state.lifecycle?.migratedAtMs??0),...secrets});
const migrate=(storage,sealedArchive)=>migrateObservedLifecycle(storage,{sealedArchive,...secrets,nowMs:AT+40000});

test('golden pre-migration archive from f1d40e4 still authenticates with its original identity',async()=>{
  const golden=JSON.parse(await readFile(new URL('./test-support/observed-archive-v1.json',import.meta.url),'utf8'));
  // Deliberately public/predictable test bytes; these protect no operational data.
  const testKeys={signingSecret:secrets.signingSecret,
    encryptionKeyBase64:Buffer.from('0123456789abcdef0123456789abcdef','ascii').toString('base64')};
  const verified=await openObservedArchive({sealedArchive:golden.sealedArchive,...testKeys});
  assert.equal(Object.hasOwn(golden,'secrets'),false);
  assert.equal(verified.archiveId,golden.archiveId);assert.equal(verified.sourcePayloadSchema,1);
  assert.equal(verified.state.lifecycle,null);assert.equal(verified.state.ledger.positions.length,2);
  assert.equal(verified.state.delivery.nextIndex,1);assert.equal(verified.state.delivery.active.status,'CLAIMED_UNCONFIRMED');
});

test('metadata migration requires a matching halted rollback snapshot and preserves business records',async()=>{
  const s=halted(),store=storeFor(s),before=store.dump(),sealed=await seal(s);
  const result=await migrate(store,sealed);assert.equal(result.status,'LIFECYCLE_MIGRATED_HALTED');
  const after=store.dump(),manifest=after[OBSERVED_LIFECYCLE_KEY];assert.equal(auditObservedLifecycle(manifest),true);
  delete after[OBSERVED_LIFECYCLE_KEY];assert.deepEqual(after,before);
  assert.equal((await migrate(store,sealed)).status,'LIFECYCLE_ALREADY_MIGRATED');
  assert.equal((await openObservedArchive({sealedArchive:await seal({...s,lifecycle:manifest}),...secrets})).sourcePayloadSchema,2);
});

test('active sources, stale snapshots and failed migration transactions leave no manifest',async()=>{
  const active=fixture(),a=storeFor(active);await assert.rejects(async()=>migrate(a,await seal(active)),/REQUIRES_HALTED_SOURCE/);
  const s=halted(),archive=await seal(s),changed=structuredClone(s);changed.market.status='MARKET_BATCH_PARTIAL';
  const store=storeFor(changed),before=store.dump();
  await assert.rejects(()=>migrate(store,archive),/ARCHIVE_NOT_CURRENT/);assert.deepEqual(store.dump(),before);
  const target=storeFor(s),original=target.dump();
  await assert.rejects(()=>migrate({transaction:fn=>target.transaction(async txn=>{await fn(txn);throw Error('synthetic abort');})},archive),/synthetic abort/);
  assert.deepEqual(target.dump(),original);
});

test('unknown manifest versions block writer checks and alarms without changing accounting',async()=>{
  await assert.rejects(()=>assertObservedWriter({get:async()=>null}),/INCOMPATIBLE_SCHEMA/);
  const s=halted(),store=storeFor(s),archive=await seal(s);await migrate(store,archive);
  const data=store.dump();data[OBSERVED_LIFECYCLE_KEY].writerVersion=2;
  const blocked={get:async key=>data[key],transaction:async fn=>fn({get:async key=>data[key],deleteAlarm:async()=>{}})};
  const session=new MarketSession({storage:blocked},{OFFLINE_SCHEDULER_ENABLED:'true'});
  await assert.rejects(()=>session.assertNotHalted(),/INCOMPATIBLE_SCHEMA/);
  assert.equal((await session.alarm()).status,'BLOCKED_INCOMPATIBLE_SCHEMA');
  assert.deepEqual(data[OBSERVED_ARCHIVE_KEYS.ledger],s.ledger);
});

test('retention reports real headroom without deleting cash, dedupe or delivery history',()=>{
  const s=fixture(),before=structuredClone(s),r=observedRetentionReport(s);
  assert.equal(r.status,'SUPPORTED_LEGACY_SCHEMA');assert.equal(r.automaticDeletion,false);
  assert.equal(r.rows[0].used,2);assert.equal(r.reservedTerminalEvents,1);assert.equal(r.exitEventRoomAvailable,true);
  assert.equal(r.diagnosticRings.deliveryReceipts,128);assert.deepEqual(s,before);
});

test('rollback uses the verified baseline on a separate empty quarantined target',async()=>{
  const s=halted(),source=storeFor(s),archive=await seal(s);await migrate(source,archive);
  const empty=storeFor(Object.fromEntries(Object.keys(OBSERVED_ARCHIVE_KEYS).map(k=>[k,null])));
  const result=await restoreObservedArchiveToEmpty(empty,{sealedArchive:archive,...secrets,nowMs:AT+50000});
  assert.equal(result.automaticResume,false);assert.equal(empty.dump()[OBSERVED_LIFECYCLE_KEY],undefined);
  assert.deepEqual(empty.dump()[OBSERVED_ARCHIVE_KEYS.ledger],s.ledger);
  await assert.rejects(()=>restoreObservedArchiveToEmpty(source,{sealedArchive:archive,...secrets,nowMs:AT+50000}),/TARGET_NOT_EMPTY/);
});
