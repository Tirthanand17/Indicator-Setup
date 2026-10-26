import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {Miniflare} from 'miniflare';
import {unresolvedFixture,EOD,secrets} from '../test-support/position-reconciliation-fixture.mjs';
import {sealObservedArchive,openObservedArchive} from '../observed-archive.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const admin='synthetic-position-native-admin-0123456789-AbCd',viewKey='synthetic-position-native-view-0123456789-AbCd';
const healthKey='synthetic-position-health-only-0123456789-AbCd';
const headers={authorization:'Bearer '+admin},route='https://unit.invalid/internal/readonly-paper/reconcile';
const options=persist=>({modules:true,scriptPath:path.join(root,'runtime/harness.mjs'),modulesRoot:root,compatibilityDate:'2026-07-30',
  durableObjects:{MARKET_SESSION:{className:'TestSession',useSQLite:true}},durableObjectsPersist:persist,
  bindings:{SCHEDULER_ADMIN_KEY:admin,OFFLINE_SCHEDULER_ENABLED:'true',OFFLINE_POSITION_RECONCILIATION_ENABLED:'true',
    OFFLINE_OPERATIONAL_HEALTH_ENABLED:'true',OPS_HEALTH_VIEW_KEY:healthKey,
    OBSERVED_ARCHIVE_HMAC_KEY:secrets.signingSecret,OBSERVED_ARCHIVE_AES_KEY:secrets.encryptionKeyBase64,
    OFFLINE_OBSERVED_ARCHIVE_ENABLED:'true',OFFLINE_OBSERVED_RESTORE_ENABLED:'true',
    READONLY_MARKET_RUNTIME_ENABLED:'true',OFFLINE_READONLY_REVIEW_ENABLED:'true',OFFLINE_OPTION_SNAPSHOT_ENABLED:'true',
    OFFLINE_PAPER_BRIDGE_ENABLED:'true',OFFLINE_PRIVATE_DASHBOARD_ENABLED:'true',PAPER_DASHBOARD_VIEW_KEY:viewKey},
  outboundService:()=>{throw Error('No provider contact permitted by position reconciliation');}});
const stub=async mf=>{const ns=await mf.getDurableObjectNamespace('MARKET_SESSION');return ns.get(ns.idFromName('nifty-paper-session-v1'));};
const post=(s,p,data)=>s.fetch('https://unit.invalid'+p,{method:'POST',body:JSON.stringify(data)});
const state=s=>s.fetch('https://unit.invalid/test/archive/state').then(r=>r.json());
const apply=(mf,body)=>mf.dispatchFetch(route,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(body)});

test('native unknown-position write-off is atomic, idempotent, durable and recoverable without inventing strategy fills',async()=>{
  const persist=await mkdtemp(path.join(os.tmpdir(),'position-writeoff-'));let mf=new Miniflare(options(persist)),target;
  try {
    let s=await stub(mf);const source=unresolvedFixture({both:true});
    await post(s,'/test/archive/seed',{state:source,nowMs:EOD+60000});const before=await state(s);
    assert.equal((await mf.dispatchFetch(route)).status,404);
    const v=await (await mf.dispatchFetch(route,{headers})).json();assert.equal(v.canWriteOff,true);assert.equal(v.positions.length,2);
    const sealedArchive=await (await mf.dispatchFetch('https://unit.invalid/internal/observed-archive',{headers})).json();
    const body={request:v.request,sealedArchive};
    assert.equal((await (await post(s,'/test/position-reconciliation/rollback',body)).json()).rolledBack,true);
    assert.deepEqual(await state(s),before);
    const responses=await Promise.all([apply(mf,body),apply(mf,body)]);
    const results=await Promise.all(responses.map(async r=>{assert.equal(r.status,200);return r.json();}));
    assert.deepEqual(results.map(r=>r.status).sort(),['POSITIONS_ALREADY_RECONCILED_NO_ACTION','POSITIONS_WRITTEN_OFF_UNKNOWN_EXIT']);
    const after=await state(s);
    assert.deepEqual(after.state.ledger.accounts,before.state.ledger.accounts);assert.deepEqual(after.state.delivery,before.state.delivery);
    assert.deepEqual(after.state.ledger.outbox,before.state.ledger.outbox);
    assert.equal(after.state.ledger.schema,2);assert.equal(after.state.lifecycle.writerVersion,2);
    assert.equal(after.state.ledger.positions.every(p=>p.status==='EXIT_WRITTEN_OFF'&&p.exitFillPaise===null&&p.netPnlPaise===null),true);
    assert.equal(after.alarm,null);assert.equal(after.state.scheduler.halted,true);
    await mf.dispose();mf=new Miniflare(options(persist));s=await stub(mf);await post(s,'/test/pipeline/clock',{nowMs:EOD+120000});
    assert.deepEqual(await state(s),after);
    const login=await mf.dispatchFetch('https://unit.invalid/paper/login',{method:'POST',redirect:'manual',
      headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({key:viewKey}).toString()});
    assert.equal(login.status,303);const cookie=login.headers.get('set-cookie').split(';')[0];
    const dashboard=await (await mf.dispatchFetch('https://unit.invalid/paper/api/readonly?date=2026-11-02',{headers:{cookie}})).json();
    assert.equal(dashboard.status,'READY');assert.equal(dashboard.accounts.every(a=>a.ownerWriteOffCount===1&&a.closedTrades===0),true);
    assert.equal(dashboard.trades.every(t=>t.netPnlRupees===null&&t.ownerWriteOffRupees>0),true);
    const health=await (await mf.dispatchFetch('https://unit.invalid/internal/operations',{headers:{authorization:'Bearer '+healthKey}})).json();
    assert.equal(health.issues.some(i=>i.code==='STATE_INVALID'||i.code==='EXIT_UNVERIFIABLE'),false);
    assert.equal(health.issues.some(i=>i.code==='DELIVERY_UNCERTAIN'),true);
    const exported=await (await mf.dispatchFetch('https://unit.invalid/internal/observed-archive',{headers})).json();
    assert.equal((await openObservedArchive({sealedArchive:exported,...secrets})).sourcePayloadSchema,3);
    target=new Miniflare(options(await mkdtemp(path.join(os.tmpdir(),'position-restored-'))));const t=await stub(target);
    await post(t,'/test/pipeline/clock',{nowMs:EOD+180000});
    assert.equal((await target.dispatchFetch('https://unit.invalid/internal/observed-archive/restore',{method:'POST',
      headers:{...headers,'content-type':'application/json'},body:JSON.stringify(exported)})).status,200);
    assert.deepEqual((await state(t)).state.ledger,after.state.ledger);
    assert.equal((await (await t.fetch('https://unit.invalid/test/archive/alarm')).json()).shouldPoll,false);
  }finally{await mf.dispose();if(target)await target.dispose();}
});

test('native position decisions reject unsafe sources, stale archives and forged fill/credit inputs without mutation',async()=>{
  for(const kind of ['active','alarm','quiet','stale','quarantine','forged']) {
    const mf=new Miniflare(options(await mkdtemp(path.join(os.tmpdir(),'position-refusal-'))));
    try {
      const s=await stub(mf),source=unresolvedFixture();
      if(kind==='active')source.scheduler={...source.scheduler,halted:false,scheduledAtMs:EOD+90000};
      if(kind==='quarantine')source.recovery={schema:1,archiveId:'a'.repeat(64),archiveCreatedAtMs:EOD-1000,restoredAtMs:EOD,sourceScheduler:source.scheduler};
      const sealedArchive=await sealObservedArchive({state:source,createdAtMs:EOD+10000,...secrets});
      if(kind==='stale')source.market.status='MARKET_BATCH_PARTIAL';
      await post(s,'/test/archive/seed',{state:source,nowMs:kind==='quiet'?EOD+29999:EOD+60000,...(kind==='alarm'?{alarm:EOD+90000}:{})});
      const before=await state(s),v=await (await mf.dispatchFetch(route,{headers})).json();
      const request=kind==='forged'?{...v.request,exitPrice:100,creditPaise:100000}:v.request;
      const response=await apply(mf,{request,sealedArchive});assert.equal(response.status,kind==='quarantine'?503:409,kind);
      assert.deepEqual(await state(s),before,kind);
    }finally{await mf.dispose();}
  }
});
