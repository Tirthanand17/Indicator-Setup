/** Reproducible, local-only Miniflare/SQLite scheduler stress profile.
 * No Cloudflare account, market API, Telegram API, deploy or charge possible.
 * Use `npm run bench:offline` to get a local wall-time baseline only.
 */
import { Miniflare } from 'miniflare';
import { mkdtemp, readdir, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { summarizeOfflineCapacity } from './capacity-baseline.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const syntheticAdmin='SYNTHETIC-CAPACITY-0123456789-abcdefghijklmnop';
const auth={authorization:`Bearer ${syntheticAdmin}`};

const readSampleCount=()=>{
  if(process.argv.length===2) return 64;
  if(process.argv.length!==3||!/^--samples=(?:[1-9]\d{0,3})$/.test(process.argv[2]))
    throw Error('INVALID_LOCAL_SAMPLE_COUNT');
  const count=Number(process.argv[2].split('=')[1]);
  if(!Number.isSafeInteger(count)||count<32||count>256)
    throw Error('INVALID_LOCAL_SAMPLE_COUNT');
  return count;
};

async function localDiskBytes(folder){
  let bytes=0;
  for(const entry of await readdir(folder,{withFileTypes:true})){
    const target=path.join(folder,entry.name);
    if(entry.isDirectory()) bytes+=await localDiskBytes(target);
    else if(entry.isFile()) bytes+=(await stat(target)).size;
    else throw Error('UNEXPECTED_LOCAL_DISK_ENTRY');
  }
  return bytes;
}

export async function runNativeCapacityBaseline(samples=64){
  if(!Number.isSafeInteger(samples)||samples<32||samples>256)
    throw Error('INVALID_LOCAL_SAMPLE_COUNT');
  const persist=await mkdtemp(path.join(os.tmpdir(),'nifty-phase35-offline-'));
  const options={modules:true,scriptPath:path.join(root,'runtime/harness.mjs'),
    modulesRoot:root,compatibilityDate:'2026-07-30',
    bindings:{SCHEDULER_ADMIN_KEY:syntheticAdmin,
      OFFLINE_SCHEDULER_ENABLED:'true'},
    durableObjects:{MARKET_SESSION:{className:'TestSession',useSQLite:true}},
    durableObjectsPersist:persist,
    outboundService:()=>{outboundAttempts++;throw Error('NO_EXTERNAL_IO_ALLOWED');}};
  let outboundAttempts=0;
  let mf;
  try{
    mf=new Miniflare(options);
    const ns=await mf.getDurableObjectNamespace('MARKET_SESSION');
    let stub=ns.get(ns.idFromName('nifty-paper-session-v1'));
    const pinnedClock=Date.parse('2026-10-26T09:14:59+05:30');
    const update=await stub.fetch('https://offline.invalid/test/pipeline/clock',{
      method:'POST',body:JSON.stringify({nowMs:pinnedClock})});
    if(!update.ok) throw Error('CLOCK_SETUP_FAILED');
    const started=await mf.dispatchFetch('https://offline.invalid/internal/bootstrap',{
      method:'POST',headers:auth});
    const init=await started.json();
    if(!started.ok||!Number.isSafeInteger(init.scheduledAtMs))
      throw Error('OFFLINE_BOOTSTRAP_FAILED');
    let next=init.scheduledAtMs;
    const durations=[];
    const seen=new Set();
    for(let i=0;i<samples;i++){
      const clock=await stub.fetch('https://offline.invalid/test/pipeline/clock',{
        method:'POST',body:JSON.stringify({nowMs:next})});
      if(!clock.ok) throw Error('CLOCK_ADVANCE_FAILED');
      const start=performance.now();
      const response=await stub.fetch('https://offline.invalid/test/tick');
      if(!response.ok) throw Error('NATIVE_CALLBACK_FAILED');
      const result=await response.json();
      const elapsed=performance.now()-start;
      if(result.shouldPoll!==true||typeof result.tickId!=='string'||
          seen.has(result.tickId)||!Number.isSafeInteger(result.nextAlarmAtMs)||
          result.nextAlarmAtMs<=next) throw Error('CALLBACK_INTEGRITY_FAILED');
      seen.add(result.tickId);
      durations.push(elapsed);
      next=result.nextAlarmAtMs;
    }
    const getStatus=async()=>{
      const response=await mf.dispatchFetch('https://offline.invalid/internal/scheduler',{
        method:'GET',headers:auth});
      if(!response.ok) throw Error('OFFLINE_OWNER_STATUS_FAILED');
      return response.json();
    };
    const before=await getStatus();
    if(before.totalClaims!==samples||before.realOrdersEnabled!==false)
      throw Error('NATIVE_LEDGER_COUNT_MISMATCH');
    await mf.dispose();mf=new Miniflare(options);
    const after=await getStatus();
    const bytes=await localDiskBytes(persist);
    return summarizeOfflineCapacity({latenciesMs:durations,
      expectedCallbacks:samples,verifiedClaims:before.totalClaims,
      claimsAfterRestart:after.totalClaims,localSQLiteBytes:bytes,
      outboundAttempts});
  } finally{
    if(mf) await mf.dispose();
    await rm(persist,{recursive:true,force:true});
  }
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const report=await runNativeCapacityBaseline(readSampleCount());
    console.log('OFFLINE_NATIVE_CAPACITY_BASELINE '+JSON.stringify(report));
    if(report.status!=='OFFLINE_NATIVE_BASELINE_ONLY') process.exitCode=1;
  } catch {
    console.error('OFFLINE_NATIVE_CAPACITY_BENCHMARK_FAILED');
    process.exitCode=1;
  }
}
