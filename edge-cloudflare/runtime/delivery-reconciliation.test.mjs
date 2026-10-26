import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {Miniflare} from 'miniflare';
import {fixture,AT} from '../test-support/observed-archive-fixture.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const admin='synthetic-native-reconciliation-admin-0123456789-AbCd',headers={authorization:'Bearer '+admin};
const route='https://unit.invalid/internal/readonly-delivery/reconcile';
const options=(persist,extra={})=>({modules:true,scriptPath:path.join(root,'runtime/harness.mjs'),modulesRoot:root,
  compatibilityDate:'2026-07-30',durableObjects:{MARKET_SESSION:{className:'TestSession',useSQLite:true}},durableObjectsPersist:persist,
  bindings:{SCHEDULER_ADMIN_KEY:admin,OFFLINE_SCHEDULER_ENABLED:'true',OFFLINE_DELIVERY_RECONCILIATION_ENABLED:'true',...extra},
  outboundService:()=>{throw Error('No network requests permitted in owner reconciliation test');}});
const stub=async mf=>{const ns=await mf.getDurableObjectNamespace('MARKET_SESSION');return ns.get(ns.idFromName('nifty-paper-session-v1'));};
const post=(s,path,body)=>s.fetch('https://unit.invalid'+path,{method:'POST',body:JSON.stringify(body)});
const state=s=>s.fetch('https://unit.invalid/test/archive/state').then(r=>r.json());
const halt=()=>{const b=fixture();b.scheduler={...b.scheduler,halted:true,scheduledAtMs:null,status:'OWNER_EMERGENCY_HALT'};return b;};
const inspect=mf=>mf.dispatchFetch(route,{headers});
const suppress=(mf,input,overrides={})=>mf.dispatchFetch(route,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(input),...overrides});

test('native owner reconciliation serializes duplicate submissions and preserves ledger/halt through restart',async()=>{
  const persist=await mkdtemp(path.join(os.tmpdir(),'owner-reconciliation-'));
  let mf=new Miniflare(options(persist));
  try {
    let s=await stub(mf);await post(s,'/test/archive/seed',{state:halt(),nowMs:AT+60000});
    const before=await state(s);
    assert.equal((await mf.dispatchFetch(route)).status,404);
    const read=await inspect(mf);assert.equal(read.status,200);assert.equal(read.headers.get('cache-control'),'no-store');
    const view=await read.json();assert.equal(view.canSuppress,true);assert.deepEqual(await state(s),before);
    assert.equal((await suppress(mf,{...view.request,journalChangedAtMs:AT+1})).status,409);
    assert.equal((await suppress(mf,view.request,{headers:{...headers,'content-type':'text/plain'}})).status,400);
    assert.equal((await suppress(mf,view.request,{body:'X'.repeat(4097)})).status,413);
    assert.deepEqual(await state(s),before);
    const concurrent=await Promise.all([suppress(mf,view.request),suppress(mf,view.request)]);
    const outcomes=await Promise.all(concurrent.map(async r=>{assert.equal(r.status,200);return r.json();}));
    assert.deepEqual(outcomes.map(x=>x.status).sort(),['ALREADY_TERMINAL_NO_ACTION','SUPPRESSED_UNCERTAIN']);
    assert.equal(outcomes.every(x=>x.deliveryAttempted===false&&x.schedulerResumed===false&&x.phoneDeliveredVerified===false),true);
    const after=await state(s);
    for(const name of Object.keys(before.state).filter(n=>n!=='delivery'))assert.deepEqual(after.state[name],before.state[name],name);
    assert.equal(after.state.delivery.nextIndex,2);assert.equal(after.state.delivery.suppressed,1);
    assert.equal(after.state.delivery.accepted,1);assert.equal(after.alarm,null);
    await mf.dispose();mf=new Miniflare(options(persist));s=await stub(mf);
    await post(s,'/test/pipeline/clock',{nowMs:AT+70000});
    assert.deepEqual(await state(s),after);
    assert.equal((await (await suppress(mf,view.request)).json()).status,'ALREADY_TERMINAL_NO_ACTION');
    const recovered=await (await inspect(mf)).json();
    assert.equal(recovered.status,'NO_UNCERTAIN_DELIVERY');assert.equal(recovered.summary.suppressedUnknown,1);
    assert.equal(recovered.summary.acceptedByBotApi,1);assert.equal(recovered.summary.queued,1);
    assert.equal((await (await s.fetch('https://unit.invalid/test/archive/alarm')).json()).shouldPoll,false);
  } finally {await mf.dispose();}
});

test('native live, alarmed, too-recent, quarantined and incompatible sources cannot be reconciled',async()=>{
  for(const kind of ['running','alarm','recent','quarantine','schema']) {
    const mf=new Miniflare(options(await mkdtemp(path.join(os.tmpdir(),'reconciliation-guard-'))));
    try {
      const s=await stub(mf),b=halt();
      if(kind==='running')b.scheduler={...b.scheduler,halted:false,scheduledAtMs:AT+90000};
      if(kind==='quarantine')b.recovery={schema:1,archiveId:'a'.repeat(64),archiveCreatedAtMs:AT+30000,
        restoredAtMs:AT+40000,sourceScheduler:b.scheduler};
      if(kind==='schema')b.lifecycle={schema:99};
      await post(s,'/test/archive/seed',{state:b,nowMs:kind==='recent'?AT+49999:AT+60000,
        ...(kind==='alarm'?{alarm:AT+90000}:{})});
      const before=await state(s),get=await inspect(mf);
      if(kind==='schema'){assert.equal(get.status,503);assert.deepEqual(await state(s),before);continue;}
      const view=await get.json();assert.equal(view.canSuppress,false,kind);
      const response=await suppress(mf,view.request);
      assert.equal(response.status,kind==='quarantine'?503:409,kind);
      assert.deepEqual(await state(s),before,kind);
    } finally {await mf.dispose();}
  }
});

test('native late definitive acknowledgement survives a stale owner suppression request',async()=>{
  const mf=new Miniflare(options(await mkdtemp(path.join(os.tmpdir(),'reconciliation-late-ack-')),
    {READONLY_MARKET_RUNTIME_ENABLED:'true',OFFLINE_READONLY_REVIEW_ENABLED:'true',OFFLINE_OPTION_SNAPSHOT_ENABLED:'true',
      OFFLINE_PAPER_BRIDGE_ENABLED:'true',OFFLINE_READONLY_DELIVERY_REHEARSAL_ENABLED:'true'}));
  try {
    const s=await stub(mf),b=halt();await post(s,'/test/archive/seed',{state:b,nowMs:AT+60000});
    const view=await (await inspect(mf)).json(),active=b.delivery.active;
    await post(s,'/test/read-only-delivery/settle',{eventId:active.eventId,attempt:active.attempt,nowMs:AT+61000,
      httpStatus:200,botResponse:{ok:true,result:{message_id:9999}}});
    await post(s,'/test/pipeline/clock',{nowMs:AT+62000});
    const result=await (await suppress(mf,view.request)).json();
    assert.equal(result.status,'ALREADY_TERMINAL_NO_ACTION');assert.equal(result.terminalStatus,'ACCEPTED_API_ONLY');
    const after=(await state(s)).state;
    assert.equal(after.delivery.accepted,2);assert.equal(after.delivery.suppressed,0);
    assert.deepEqual(after.ledger,b.ledger);assert.equal(after.scheduler.halted,true);
  } finally {await mf.dispose();}
});
