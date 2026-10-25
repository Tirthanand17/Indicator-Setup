import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rmdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {newOperationsMonitor,runOperationsCycle,auditOperationsMonitor,OPS_COOLDOWN_MS} from './operations-watchdog.mjs';
import {OPS_CODES} from './operational-health.mjs';
import {withOperationsStore} from './operations-monitor-store.mjs';
import {runOperationsCLI} from './operations-monitor-cli.mjs';

const AT=Date.parse('2026-11-02T10:00:00+05:30'),hash='a'.repeat(64);
const health=(codes,at=AT)=>({format:'OBSERVED_OPERATIONS_V1',checkedAtMs:at,issues:codes.map(code=>({code,severity:OPS_CODES[code]}))});
const accepted={httpStatus:200,botResponse:{ok:true,result:{message_id:99}}};

test('new incidents are grouped, claimed durably before sending and stable conditions stay silent across restart',async()=>{
  let persisted,notifications=0;
  const persist=async s=>{auditOperationsMonitor(s);persisted=structuredClone(s);};
  const send=async()=>{notifications++;assert.equal(persisted.recent.every(e=>e.delivery==='CLAIMED_UNCONFIRMED'),true);return accepted;};
  const first=await runOperationsCycle(newOperationsMonitor(hash),{nowMs:AT,probe:async()=>health(['TOKEN_MISSING','HEARTBEAT_STALE']),persist,notify:send,notifications:true});
  assert.equal(notifications,1);assert.equal(first.events.length,2);assert.equal(first.events.every(e=>e.delivery==='API_ACCEPTED'),true);
  const second=await runOperationsCycle(JSON.parse(JSON.stringify(persisted)),{nowMs:AT+60000,
    probe:async()=>health(['TOKEN_MISSING','HEARTBEAT_STALE'],AT+60000),persist,notify:send,notifications:true});
  assert.equal(second.events.length,0);assert.equal(notifications,1);
});

test('endpoint failure retains unobservable source incidents and fresh recovery resolves them',async()=>{
  const persist=async()=>{};
  const first=await runOperationsCycle(newOperationsMonitor(hash),{nowMs:AT,probe:async()=>health(['TOKEN_MISSING']),persist});
  const down=await runOperationsCycle(first.state,{nowMs:AT+60000,probe:async()=>{throw Error('private response');},persist});
  assert.equal(down.endpointAvailable,false);assert.equal(down.state.conditions.TOKEN_MISSING.active,true);
  assert.deepEqual(down.events.map(e=>[e.code,e.phase]),[['ENDPOINT_UNAVAILABLE','OPEN']]);
  const recovery=await runOperationsCycle(down.state,{nowMs:AT+120000,probe:async()=>health([],AT+120000),persist});
  assert.equal(recovery.events.every(e=>e.phase==='RESOLVED'),true);assert.equal(recovery.events.length,2);
});

test('uncertain sends and persisted crash claims are never automatically retried',async()=>{
  let persisted,calls=0;
  const first=await runOperationsCycle(newOperationsMonitor(hash),{nowMs:AT,probe:async()=>health(['MARKET_UNAVAILABLE']),
    persist:async s=>{persisted=structuredClone(s);},notifications:true,notify:async()=>{calls++;throw Error('timeout');}});
  assert.equal(first.events[0].delivery,'UNKNOWN_NO_RETRY');
  persisted.recent[0].delivery='CLAIMED_UNCONFIRMED';
  const next=await runOperationsCycle(persisted,{nowMs:AT+60000,probe:async()=>health(['MARKET_UNAVAILABLE'],AT+60000),
    persist:async()=>{},notifications:true,notify:async()=>{calls++;return accepted;}});
  assert.equal(calls,1);assert.equal(next.events.length,0);assert.equal(next.state.recent[0].delivery,'CLAIMED_UNCONFIRMED');
});

test('a failed durable claim prevents notification side effects',async()=>{
  let calls=0;
  await assert.rejects(()=>runOperationsCycle(newOperationsMonitor(hash),{nowMs:AT,probe:async()=>health(['TOKEN_MISSING']),
    notifications:true,persist:async s=>{if(s.recent[0]?.delivery==='CLAIMED_UNCONFIRMED')throw Error('synthetic disk fault');},
    notify:async()=>{calls++;return accepted;}}),/disk fault/);
  assert.equal(calls,0);
});

test('cooldowns suppress rapid recovery/reopening and definitive rejection does not retry',async()=>{
  let calls=0;
  const run=(s,t,codes)=>runOperationsCycle(s,{nowMs:t,probe:async()=>health(codes,t),persist:async()=>{},notifications:true,
    notify:async()=>{calls++;return {httpStatus:429,botResponse:{ok:false,error_code:429}};}});
  const a=await run(newOperationsMonitor(hash),AT,['AUTH_BLOCKED']);assert.equal(a.events[0].delivery,'DEFINITIVE_FAILURE_NO_RETRY');
  const b=await run(a.state,AT+60000,[]);assert.equal(b.events[0].delivery,'COOLDOWN');
  const c=await run(b.state,AT+120000,['AUTH_BLOCKED']);assert.equal(c.events[0].delivery,'COOLDOWN');assert.equal(calls,1);
  const d=await run(c.state,AT+OPS_COOLDOWN_MS+1000,[]);assert.equal(d.events[0].delivery,'DEFINITIVE_FAILURE_NO_RETRY');assert.equal(calls,2);
});

test('corrupt state, rollback clocks, unknown response codes and bounded history cannot reset dedupe',async()=>{
  const bad={...newOperationsMonitor(hash),schema:2};
  await assert.rejects(()=>runOperationsCycle(bad,{nowMs:AT,probe:async()=>health([]),persist:async()=>{}}));
  const malformed=await runOperationsCycle(newOperationsMonitor(hash),{nowMs:AT,probe:async()=>health(['UNTRUSTED_RAW_ERROR']),persist:async()=>{}});
  assert.equal(malformed.events[0].code,'ENDPOINT_UNAVAILABLE');
  await assert.rejects(()=>runOperationsCycle(malformed.state,{nowMs:AT-1,probe:async()=>health([]),persist:async()=>{}}));
  let s=newOperationsMonitor(hash);
  for(let i=0;i<140;i++)s=(await runOperationsCycle(s,{nowMs:AT+i*60000,
    probe:async()=>health(i%2?[]:['TOKEN_MISSING'],AT+i*60000),persist:async()=>{}})).state;
  assert.equal(s.sequence,140);assert.equal(s.recent.length,128);assert.equal(auditOperationsMonitor(s),true);
});

test('private file store recovers state, refuses concurrent locks/foreign targets and never silently repairs corruption',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'operations-store-')),file=path.join(dir,'private.ops-monitor.json');
  await withOperationsStore(file,hash,async({state,persist})=>{
    await runOperationsCycle(state,{nowMs:AT,probe:async()=>health(['TOKEN_MISSING']),persist});
  });
  await withOperationsStore(file,hash,async({state})=>{assert.equal(state.conditions.TOKEN_MISSING.active,true);});
  await assert.rejects(()=>withOperationsStore(file,'b'.repeat(64),async()=>{}),/TARGET_MISMATCH/);
  await mkdir(file+'.lock');await assert.rejects(()=>withOperationsStore(file,hash,async()=>{}));await rmdir(file+'.lock');
  const before=await readFile(file,'utf8');assert.equal(before.includes('TOKEN_MISSING'),true);
  await writeFile(file,'corrupt');await assert.rejects(()=>withOperationsStore(file,hash,async()=>{}));
  assert.equal(await readFile(file,'utf8'),'corrupt');
});

test('CLI defaults to help, probes with a read-only key and requires explicit separate notification configuration',async()=>{
  let probes=0,sends=0,storeCalls=0;const logs=[];
  const viewKey='synthetic-health-view-key-0123456789-AbCd';
  const env={OPS_HEALTH_VIEW_KEY:viewKey};
  const dependencies={env,now:()=>AT,log:x=>logs.push(x),
    store:async(_file,_hash,fn)=>{storeCalls++;return fn({state:newOperationsMonitor(_hash),persist:async()=>{}});},
    fetchImpl:async(url,init)=>{probes++;assert.equal(url,'https://unit.invalid/internal/operations');assert.equal(init.method,'GET');
      assert.equal(init.headers.authorization,'Bearer '+viewKey);assert.equal(init.redirect,'manual');return Response.json(health(['TOKEN_MISSING']));},
    send:async()=>{sends++;return accepted;}};
  assert.equal(await runOperationsCLI([],dependencies),0);assert.equal(probes,0);assert.equal(storeCalls,0);
  assert.equal(await runOperationsCLI(['check','https://unit.invalid','private.ops-monitor.json'],dependencies),2);
  assert.equal(probes,1);assert.equal(sends,0);
  assert.equal(await runOperationsCLI(['check','https://unit.invalid','private.ops-monitor.json','--notify'],dependencies),1);
  assert.equal(probes,1);
  const enabled={...env,OPS_ALERT_NOTIFICATIONS_ENABLED:'true',OPS_TELEGRAM_BOT_TOKEN:'123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrst',OPS_TELEGRAM_PRIVATE_CHAT_ID:'123456789'};
  assert.equal(await runOperationsCLI(['check','https://unit.invalid','private.ops-monitor.json','--notify'],{...dependencies,env:enabled}),2);
  assert.equal(sends,1);assert.equal(logs.some(x=>x.includes(viewKey)||x.includes(enabled.OPS_TELEGRAM_BOT_TOKEN)),false);
  assert.equal(await runOperationsCLI(['check','http://unit.invalid','private.ops-monitor.json'],dependencies),1);
});

test('watch mode checks repeatedly at the configured interval and exits on cancellation without installing a service',async()=>{
  const controller=new AbortController();let probes=0,waits=0,closed=false;
  const result=await runOperationsCLI(['watch','https://unit.invalid','private.ops-monitor.json'],{
    env:{OPS_HEALTH_VIEW_KEY:'synthetic-health-view-key-0123456789-AbCd'},signal:controller.signal,
    now:()=>AT+probes*60000,log:()=>{},fetchImpl:async()=>Response.json(health(probes++?[]:['TOKEN_MISSING'],AT+(probes-1)*60000)),
    wait:async ms=>{assert.equal(ms,60000);if(++waits===2)controller.abort();},
    store:async(_f,h,fn)=>{try{return await fn({state:newOperationsMonitor(h),persist:async()=>{}});}finally{closed=true;}}});
  assert.equal(result,0);assert.equal(probes,2);assert.equal(closed,true);
});
