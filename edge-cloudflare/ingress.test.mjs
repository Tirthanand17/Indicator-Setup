import test from 'node:test';
import assert from 'node:assert/strict';
import {createIngressAdmission, INGRESS_POLICY, readBoundedBody} from './ingress.mjs';
import worker, {MarketSession} from './worker.mjs';
import {boundedRelayBody} from './daily-token.mjs';
import {readObservedArchiveJSON} from './observed-archive.mjs';
import {readReconciliationJSON} from './delivery-reconciliation.mjs';
import {handlePrivateDashboard} from './private-dashboard.mjs';

test('attempt budgets include failures, stay independent and reset only after a full minute', () => {
  let now = 1_000_000; const admit = createIngressAdmission(() => now);
  for (const category of Object.keys(INGRESS_POLICY)) {
    for (let i = 0; i < INGRESS_POLICY[category].attempts; i++) {
      const lease = admit(category); assert.equal(lease.accepted, true); lease.release(); lease.release();
    }
    assert.equal(admit(category).accepted, false);
  }
  now -= 1; assert.equal(admit('relay').accepted, false);
  now += 60_001; const lease = admit('relay'); assert.equal(lease.accepted, true); lease.release();
});
test('concurrency survives rollover and is released after success or failure', () => {
  let now = 1_000_000; const admit = createIngressAdmission(() => now);
  const leases = Array.from({length: 4}, () => admit('relay'));
  now += 60_000; assert.equal(admit('relay').accepted, false);
  leases[0].release(); const next = admit('relay'); assert.equal(next.accepted, true); next.release();
  leases.slice(1).forEach(lease => lease.release());
});
test('outer boundary budgets invalid login and relay traffic before any DO lookup', async () => {
  let forwards = 0;
  const env = {OFFLINE_SCHEDULER_ENABLED:'true', OFFLINE_PRIVATE_DASHBOARD_ENABLED:'true',
    OFFLINE_PAPER_LEDGER_ENABLED:'true', READONLY_MARKET_RUNTIME_ENABLED:'true',
    MARKET_SESSION:{idFromName:()=>{forwards++;return 'test';},get:()=>({fetch:async()=>new Response(null,{status:401})})}};
  for (const [path, category] of [['/paper/login','login'],['/internal/token','relay']]) {
    const before = forwards;
    for (let i = 0; i < INGRESS_POLICY[category].attempts; i++)
      assert.equal((await worker.fetch(new Request('https://unit.invalid'+path,{method:'POST'}),env)).status,401);
    const denied = await worker.fetch(new Request('https://unit.invalid'+path,{method:'POST'}),env);
    assert.equal(denied.status,429); assert.equal(denied.headers.get('Cache-Control'),'no-store');
    assert.ok(Number(denied.headers.get('Retry-After')) > 0);
    assert.equal(forwards-before,INGRESS_POLICY[category].attempts);
  }
  // Valid administrator halt remains available even if public budgets are exhausted.
  const key='SYNTHETIC-ONLY-admin-0123456789-abcdefghijklmnop'; env.SCHEDULER_ADMIN_KEY=key;
  assert.equal((await worker.fetch(new Request('https://unit.invalid/internal/emergency-halt',
    {method:'POST',headers:{authorization:'Bearer '+key}}),env)).status,401);
});
test('HTTP and internal query credentials never reach storage or a DO', async () => {
  const env = {MARKET_SESSION:{idFromName:()=>assert.fail('DO access forbidden')}};
  for (const url of ['http://unit.invalid/internal/token','https://unit.invalid/internal/token?key=synthetic',
    'http://unit.invalid/internal/emergency-halt']) {
    const request = new Request(url,{method:'POST'});
    assert.equal((await worker.fetch(request,env)).status,404);
    const session = new MarketSession({storage:{get:()=>assert.fail('storage access forbidden')}},env);
    assert.equal((await session.fetch(new Request(url,{method:'POST'}))).status,404);
  }
});
test('outer forwarding exceptions always release their public concurrency lease', async () => {
  const {default: isolated} = await import('./worker.mjs?ingress-exception-regression');
  const env = {OFFLINE_SCHEDULER_ENABLED:'true',OFFLINE_PRIVATE_DASHBOARD_ENABLED:'true',
    OFFLINE_PAPER_LEDGER_ENABLED:'true',MARKET_SESSION:{idFromName:()=> 'test',
      get:()=>({fetch:async()=>{throw Error('SYNTHETIC_FORWARD_FAILURE');}})}};
  for(let i=0;i<8;i++)await assert.rejects(isolated.fetch(new Request('https://unit.invalid/paper/login',
    {method:'POST'}),env),/SYNTHETIC_FORWARD_FAILURE/);
});
test('whole-body deadline cancels stalled, drip-fed and nonsettling cancellation streams', async () => {
  let cancelled = false;
  const stalled = new ReadableStream({cancel(){cancelled=true;return new Promise(()=>{});}});
  await assert.rejects(readBoundedBody(stalled,2048,15), /BODY_DEADLINE/);
  assert.equal(cancelled,true);
  let interval;
  const drip = new ReadableStream({start(c){interval=setInterval(()=>c.enqueue(new Uint8Array([1])),3);},
    cancel(){clearInterval(interval);}});
  await assert.rejects(readBoundedBody(drip,2048,25), /BODY_DEADLINE/);
  assert.deepEqual([...await readBoundedBody(new Response('ok').body,2)], [111,107]);
  await assert.rejects(readBoundedBody(new Response('oversized').body,2), /BODY_TOO_LARGE/);
});
test('all public and authenticated JSON readers reject stalled bodies using the shared deadline', async () => {
  const start = performance.now();
  await Promise.all([
    assert.rejects(boundedRelayBody(new Request('https://unit.invalid/internal/token', {method:'POST',
      headers:{'content-type':'application/json'},body:new ReadableStream(),duplex:'half'})), /rejected/),
    assert.rejects(readObservedArchiveJSON(new ReadableStream()), /BODY_UNAVAILABLE/),
    assert.rejects(readReconciliationJSON(new ReadableStream()), /UNAVAILABLE/),
    (async()=>{
      const response=await handlePrivateDashboard(new Request('https://unit.invalid/paper/login',
        {method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
          body:new ReadableStream(),duplex:'half'}),
        {OFFLINE_SCHEDULER_ENABLED:'true',OFFLINE_PRIVATE_DASHBOARD_ENABLED:'true',OFFLINE_PAPER_LEDGER_ENABLED:'true',
          PAPER_DASHBOARD_VIEW_KEY:'synthetic-dashboard-view-0123456789-AbCd'},
        {get:()=>assert.fail('No storage read permitted')});
      assert.equal(response.status,401);assert.equal(response.headers.get('Set-Cookie'),null);
    })(),
  ]);
  assert.ok(performance.now()-start < 6000);
});
