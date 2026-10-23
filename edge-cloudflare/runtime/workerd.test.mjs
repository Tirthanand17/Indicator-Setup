import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';

const root=fileURLToPath(new URL('..',import.meta.url));
const key='SYNTHETIC-ONLY-0123456789-abcdefghijklmnop';
const headers={authorization:'Bearer '+key};

test('real local workerd SQLite transactions, duplicate alarms and persisted restart',async()=>{
  const persist=await mkdtemp(path.join(os.tmpdir(),'nifty-offline-do-'));
  const options={modules:true,scriptPath:path.join(root,'runtime/harness.mjs'),
    modulesRoot:root,compatibilityDate:'2026-07-30',
    bindings:{SCHEDULER_ADMIN_KEY:key,OFFLINE_SCHEDULER_ENABLED:'true'},
    durableObjects:{MARKET_SESSION:{className:'TestSession',useSQLite:true}},
    durableObjectsPersist:persist,
    outboundService:()=>{throw new Error('External requests forbidden by local test');}};
  let mf=new Miniflare(options);
  try {
    assert.equal((await mf.dispatchFetch('https://unit.invalid/internal/bootstrap',{method:'POST'})).status,404);
    assert.equal((await mf.dispatchFetch('https://unit.invalid/internal/bootstrap',{method:'POST',headers})).status,200);
    const ns=await mf.getDurableObjectNamespace('MARKET_SESSION');
    const stub=ns.get(ns.idFromName('nifty-paper-session-v1'));
    const first=await (await stub.fetch('https://unit.invalid/test/tick')).json();
    assert.equal(first.shouldPoll,true);
    assert.equal((await (await stub.fetch('https://unit.invalid/test/tick')).json()).shouldPoll,false);
    const rollback=await (await stub.fetch('https://unit.invalid/test/rollback')).json();
    assert.equal(rollback.value,null);
    assert.equal(rollback.alarm,rollback.before);
    const before=await (await mf.dispatchFetch('https://unit.invalid/internal/scheduler',{headers})).json();
    assert.equal(before.totalClaims,1);
    await mf.dispose(); mf=new Miniflare(options);
    const after=await (await mf.dispatchFetch('https://unit.invalid/internal/scheduler',{headers})).json();
    assert.equal(after.totalClaims,1);
    assert.equal(after.lastClaimedTickId,before.lastClaimedTickId);
  } finally { await mf.dispose(); }
});
