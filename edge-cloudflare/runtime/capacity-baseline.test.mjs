import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeOfflineCapacity } from './capacity-baseline.mjs';
import { runNativeCapacityBaseline } from './offline-capacity-benchmark.mjs';

const sample=()=>Array.from({length:64},(_,i)=>i+0.123456);
const input=()=>({latenciesMs:sample(),expectedCallbacks:64,
  verifiedClaims:64,claimsAfterRestart:64,localSQLiteBytes:123456,
  outboundAttempts:0});

test('native baseline percentiles are correct and never presented as cloud CPU',()=>{
  const result=summarizeOfflineCapacity(input());
  assert.equal(result.status,'OFFLINE_NATIVE_BASELINE_ONLY');
  assert.equal(result.local.callbackWallMs.min,0.123);
  assert.equal(result.local.callbackWallMs.p50,31.123);
  assert.equal(result.local.callbackWallMs.p95,60.123);
  assert.equal(result.local.callbackWallMs.p99,63.123);
  assert.equal(result.local.callbackWallMs.max,63.123);
  assert.equal(result.local.workload,'SCHEDULER_ONLY_NO_KITE_NO_TELEGRAM');
  assert.equal(result.production.measuredCloudWorkerCpuMs,null);
  assert.equal(result.production.liveAcceptancePassed,false);
  assert.equal(result.releaseAuthorized,false);
  assert.equal(result.realOrdersEnabled,false);
});

test('32 real local workerd callbacks are unique and recover from SQLite restart',async()=>{
  const result=await runNativeCapacityBaseline(32);
  assert.equal(result.status,'OFFLINE_NATIVE_BASELINE_ONLY');
  assert.equal(result.callbacks,32);
  assert.equal(result.uniqueClaims,32);
  assert.equal(result.recoveredClaims,32);
  assert.equal(result.unapprovedNetworkAttempts,0);
  assert.ok(result.local.sqliteDiskBytes>0);
  assert.equal(result.production.measuredCloudWorkerCpuMs,null);
});

test('restart mismatch, missed claims or unexpected network attempts fail audit',()=>{
  for(const broken of [
    {claimsAfterRestart:63},
    {verifiedClaims:63},
    {outboundAttempts:1},
  ]) {
    const result=summarizeOfflineCapacity({...input(),...broken});
    assert.equal(result.status,'BLOCKED_OFFLINE_INTEGRITY_FAILURE');
    assert.equal(result.releaseAuthorized,false);
  }
});

test('invalid wall timing, overlong samples and invented disk counts are rejected',()=>{
  for(const broken of [
    {latenciesMs:[1]},
    {latenciesMs:[...sample(),NaN]},
    {latenciesMs:[...sample(),Infinity]},
    {latenciesMs:[...sample(),-1]},
    {latenciesMs:[...sample(),60_001]},
    {expectedCallbacks:1126},
    {localSQLiteBytes:-1},
    {outboundAttempts:1.5},
    {verifiedClaims:2000},
  ]) assert.throws(()=>summarizeOfflineCapacity({...input(),...broken}),
    /INVALID_OFFLINE_CAPACITY_INPUT/);
});
