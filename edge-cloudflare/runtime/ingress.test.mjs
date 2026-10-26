import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {Miniflare} from 'miniflare';

const root=fileURLToPath(new URL('..',import.meta.url));
test('native public admission preserves SQLite state and cannot block an authenticated emergency halt',async()=>{
  const admin='synthetic-ingress-admin-0123456789-AbCd';
  const mf=new Miniflare({modules:true,scriptPath:path.join(root,'runtime/harness.mjs'),modulesRoot:root,
    compatibilityDate:'2026-07-30',durableObjects:{MARKET_SESSION:{className:'TestSession',useSQLite:true}},
    durableObjectsPersist:await mkdtemp(path.join(os.tmpdir(),'ingress-native-')),
    bindings:{OFFLINE_SCHEDULER_ENABLED:'true',OFFLINE_PRIVATE_DASHBOARD_ENABLED:'true',
      OFFLINE_PAPER_LEDGER_ENABLED:'true',READONLY_MARKET_RUNTIME_ENABLED:'true',SCHEDULER_ADMIN_KEY:admin,
      PAPER_DASHBOARD_VIEW_KEY:'synthetic-ingress-dashboard-0123456789-AbCd'},
    outboundService:()=>assert.fail('No outbound request is permitted')});
  try {
    const ns=await mf.getDurableObjectNamespace('MARKET_SESSION'),s=ns.get(ns.idFromName('nifty-paper-session-v1'));
    const snapshot=()=>s.fetch('https://unit.invalid/test/archive/state').then(r=>r.json());
    const before=await snapshot();
    for(let i=0;i<30;i++)assert.equal((await mf.dispatchFetch('https://unit.invalid/paper/login',
      {method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'key=wrong'})).status,401);
    assert.equal((await mf.dispatchFetch('https://unit.invalid/paper/login',{method:'POST'})).status,429);
    assert.deepEqual(await snapshot(),before);
    const halt=await mf.dispatchFetch('https://unit.invalid/internal/emergency-halt',
      {method:'POST',headers:{authorization:'Bearer '+admin}});
    assert.equal(halt.status,200);assert.equal((await halt.json()).status,'OWNER_EMERGENCY_HALT');
    assert.equal((await mf.dispatchFetch('https://unit.invalid/internal/scheduler?key=synthetic',
      {headers:{authorization:'Bearer '+admin}})).status,404);
  }finally{await mf.dispose();}
});
