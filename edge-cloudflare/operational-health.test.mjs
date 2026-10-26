import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,AT} from './test-support/observed-archive-fixture.mjs';
import {operationalHealth} from './operational-health.mjs';
import worker from './worker.mjs';

const base=()=>{const s=fixture();return {...s,lifecycle:undefined,recovery:undefined,delivery:{...s.delivery,active:null,totalAttempts:1},
  tokenStatus:'HANDOFF_DECRYPTABLE',tokenExpiresAtMs:AT+20*3600000,alarmAtMs:AT+40000,runtimeEnabled:true,nowMs:AT+30000};};
const codes=s=>operationalHealth(s).issues.map(i=>i.code);

test('calendar coverage expiry enters the existing operational warning registry',()=>{
  const conditions=codes({...base(),runtimeEnabled:false,nowMs:Date.parse('2026-11-16T10:00:00+05:30')});
  assert.ok(conditions.includes('CALENDAR_EXPIRING'));
});
test('fresh runtime health is sanitized evidence rather than provider authentication or billing proof',()=>{
  const s=base(),v=operationalHealth(s);assert.deepEqual(v.issues,[]);
  assert.equal(v.expectedSession,true);assert.equal(v.readOnly,true);
  assert.equal(v.providerAuthenticationVerified,false);assert.equal(v.cloudUsageMeasured,false);
  assert.equal(JSON.stringify(v).includes('observed-archive-entry-001'),false);
  assert.equal(JSON.stringify(v).includes('token:'),false);
});
test('missing, expired, unusable, expiring and provider-rejected token conditions remain distinct',()=>{
  for(const [tokenStatus,code] of [['MISSING','TOKEN_MISSING'],['EXPIRED','TOKEN_EXPIRED'],['NOT_TODAY','TOKEN_EXPIRED'],['INVALID','TOKEN_INVALID']])
    assert.ok(codes({...base(),tokenStatus}).includes(code));
  assert.ok(codes({...base(),tokenExpiresAtMs:AT+15*60000}).includes('TOKEN_EXPIRING'));
  const s=base();s.pacing={...s.pacing,authBlocked:true};assert.ok(codes(s).includes('AUTH_BLOCKED'));
});
test('heartbeat and missing alarms are evaluated during expected sessions with opening grace',()=>{
  const s=base();assert.ok(codes({...s,nowMs:AT+180000,alarmAtMs:null}).includes('HEARTBEAT_STALE'));
  assert.ok(codes({...s,alarmAtMs:null}).includes('ALARM_MISSING'));
  assert.equal(codes({...s,scheduler:{...s.scheduler,scheduledAtMs:s.nowMs},alarmAtMs:null}).includes('ALARM_MISSING'),false);
  const opening=Date.parse('2026-11-02T09:15:00+05:30');
  const early={...s,scheduler:{...s.scheduler,lastObservedAtMs:opening-86400000,scheduledAtMs:opening},
    market:undefined,pacing:undefined,ledger:undefined,delivery:undefined,nowMs:opening+20000};
  assert.equal(codes(early).includes('HEARTBEAT_STALE'),false);
  assert.equal(codes(early).includes('MARKET_STALE'),false);
});
test('outages, partial observations, source quota and journal pressure use audited local evidence',()=>{
  const s=base();assert.ok(codes({...s,market:{...s.market,status:'MARKET_BATCH_BLOCKED'}}).includes('MARKET_UNAVAILABLE'));
  assert.ok(codes({...s,market:{...s.market,status:'MARKET_BATCH_PARTIAL'}}).includes('MARKET_PARTIAL'));
  assert.ok(codes({...s,nowMs:AT+180000}).includes('MARKET_STALE'));
  assert.ok(codes({...s,pacing:{...s.pacing,count:1013}}).includes('QUOTE_BUDGET_PRESSURE'));
  assert.ok(codes({...s,pacing:{...s.pacing,count:1125}}).includes('QUOTE_BUDGET_EXHAUSTED'));
  assert.ok(codes({...s,scheduler:{...s.scheduler,callbacks:3687}}).includes('CALLBACK_BUDGET_PRESSURE'));
  assert.ok(codes({...s,scheduler:{...s.scheduler,callbacks:4096}}).includes('CALLBACK_BUDGET_EXHAUSTED'));
  s.ledger.rejections=Array.from({length:1024},(_,i)=>({accountId:'PAPER_50K',signalId:'ops-risk-rejection-'+i,atMs:AT,reason:'TEST'}));
  assert.ok(codes(s).includes('JOURNAL_FULL'));
});
test('closed sessions suppress expected-activity alerts and unknown/special calendars are explicit',()=>{
  for(const day of ['2026-11-01','2026-11-10']) {
    const s={...base(),tokenStatus:'MISSING',nowMs:Date.parse(day+'T10:00:00+05:30'),scheduler:undefined,market:undefined,pacing:undefined,ledger:undefined,delivery:undefined};
    assert.deepEqual(codes(s),[]);
  }
  for(const day of ['2026-11-08','2027-01-04']) {
    const v=operationalHealth({...base(),scheduler:undefined,market:undefined,pacing:undefined,ledger:undefined,delivery:undefined,
      nowMs:Date.parse(day+'T10:00:00+05:30')});
    assert.equal(v.expectedSession,false);assert.ok(v.issues.some(i=>i.code==='CALENDAR_UNVERIFIED'));
  }
});
test('corrupt state, owner halt, disabled runtime and recovery quarantine are never called healthy',()=>{
  const s=base();assert.ok(codes({...s,lifecycle:{schema:99}}).includes('STATE_INVALID'));
  assert.ok(codes({...s,scheduler:{...s.scheduler,halted:true,scheduledAtMs:null}}).includes('SCHEDULER_HALTED'));
  assert.ok(codes({...s,runtimeEnabled:false}).includes('RUNTIME_DISABLED'));
  assert.ok(codes({...s,recovery:{}}).includes('RECOVERY_QUARANTINE'));
  assert.equal(codes({...s,delivery:fixture().delivery}).includes('DELIVERY_UNCERTAIN'),false);
  assert.ok(codes({...s,delivery:fixture().delivery,nowMs:AT+60000}).includes('DELIVERY_UNCERTAIN'));
  assert.ok(codes({...s,ledger:{}}).includes('STATE_INVALID'));
});
test('separate health credentials cannot authorize owner routes or bypass TLS/flag gates',async()=>{
  const key='synthetic-operations-read-only-key-0123456789-AbCd';
  const env={OPS_HEALTH_VIEW_KEY:key,OFFLINE_OPERATIONAL_HEALTH_ENABLED:'true',OFFLINE_SCHEDULER_ENABLED:'true',
    SCHEDULER_ADMIN_KEY:'synthetic-owner-admin-key-0123456789-AbCd',
    MARKET_SESSION:{idFromName:()=>{throw Error('Do not access namespace');}}};
  for(const [url,method,auth,changes] of [
    ['https://unit.invalid/internal/operations','GET',env.SCHEDULER_ADMIN_KEY,{}],
    ['http://unit.invalid/internal/operations','GET',key,{}],
    ['https://unit.invalid/internal/operations?key=bad','GET',key,{}],
    ['https://unit.invalid/internal/operations','POST',key,{}],
    ['https://unit.invalid/internal/operations','GET',key,{OFFLINE_OPERATIONAL_HEALTH_ENABLED:'false'}],
    ['https://unit.invalid/internal/bootstrap','POST',key,{}],
    ['https://unit.invalid/internal/operations','GET',key,{SCHEDULER_ADMIN_KEY:key}]])
    assert.equal((await worker.fetch(new Request(url,{method,headers:{authorization:'Bearer '+auth}}),{...env,...changes})).status,404);
});
