import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { createHmac, randomBytes } from 'node:crypto';

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

test('native local workerd verifies HMAC, encrypts token, persists it across restart',async()=>{
  const persist=await mkdtemp(path.join(os.tmpdir(),'nifty-token-offline-do-'));
  const relay='offline-relay-hmac-secret-0123456789-never-live';
  const aes=randomBytes(32).toString('base64');
  const bindings={SCHEDULER_ADMIN_KEY:key,OFFLINE_SCHEDULER_ENABLED:'true',
    READONLY_MARKET_RUNTIME_ENABLED:'true',KITE_API_KEY:'synthetic-key',
    TOKEN_RELAY_HMAC_KEY:relay,TOKEN_VAULT_AES_KEY:aes};
  const options={modules:true,scriptPath:path.join(root,'runtime/harness.mjs'),
    modulesRoot:root,compatibilityDate:'2026-07-30',bindings,
    durableObjects:{MARKET_SESSION:{className:'TestSession',useSQLite:true}},
    durableObjectsPersist:persist,
    outboundService:()=>{throw Error('External requests forbidden by local test');}};
  let mf=new Miniflare(options);
  try {
    const ns=await mf.getDurableObjectNamespace('MARKET_SESSION');
    const stub=ns.get(ns.idFromName('nifty-paper-session-v1'));
    const {now}=await (await stub.fetch('https://unit.invalid/test/now')).json();
    const ts=String(Math.floor(now/1000));
    const nonce='fedcba9876543210abcdefghijklmnopqrst';
    const body=JSON.stringify({api_key:'synthetic-key',access_token:'SYNTHETIC-ACCESS-TOKEN-1234567890'});
    const sign=createHmac('sha256',relay).update(`${ts}\n${nonce}\n${body}`).digest('hex');
    const headers={'content-type':'application/json','x-relay-timestamp':ts,
      'x-relay-nonce':nonce,'x-relay-signature':sign};
    const post=()=>mf.dispatchFetch('https://unit.invalid/internal/token',{method:'POST',headers,body});
    assert.equal((await post()).status,200);
    assert.equal((await post()).status,409);
    assert.deepEqual(await (await stub.fetch('https://unit.invalid/test/token-sealed')).json(),
      {present:true,encrypted:true,containsPlainToken:false});
    await mf.dispose();mf=new Miniflare(options);
    const nsAfter=await mf.getDurableObjectNamespace('MARKET_SESSION');
    const stubAfter=nsAfter.get(nsAfter.idFromName('nifty-paper-session-v1'));
    assert.deepEqual(await (await stubAfter.fetch('https://unit.invalid/test/token-sealed')).json(),
      {present:true,encrypted:true,containsPlainToken:false});
  } finally {await mf.dispose();}
});

test('native local workerd commits two-account paper debits/outbox atomically and survives restart',async()=>{
  const persist=await mkdtemp(path.join(os.tmpdir(),'nifty-paper-native-do-'));
  const options={modules:true,scriptPath:path.join(root,'runtime/harness.mjs'),
    modulesRoot:root,compatibilityDate:'2026-07-30',
    bindings:{SCHEDULER_ADMIN_KEY:key,OFFLINE_SCHEDULER_ENABLED:'true',
      OFFLINE_PAPER_LEDGER_ENABLED:'true'},
    durableObjects:{MARKET_SESSION:{className:'TestSession',useSQLite:true}},
    durableObjectsPersist:persist,
    outboundService:()=>{throw new Error('External requests forbidden by local test');}};
  let mf=new Miniflare(options);
  const nowMs=Date.parse('2026-10-23T04:30:00Z');
  const makeQuote=(at,bid=100,ask=100.5)=>({
    contract:{symbol:'NIFTY26OCT23000CE',kind:'CE',expiry:'2026-10-29',
      token:12345,lotSize:65},bid,ask,bidQuantity:600,askQuantity:600,
    updatedAtMs:at-1000,
  });
  const stubFor=async()=>{
    const ns=await mf.getDurableObjectNamespace('MARKET_SESSION');
    return ns.get(ns.idFromName('nifty-paper-session-v1'));
  };
  try {
    const stub=await stubFor();
    const request=async(path,body)=>stub.fetch(`https://unit.invalid/test/paper/${path}`,
      {method:'POST',body:JSON.stringify(body)});
    assert.equal((await mf.dispatchFetch('https://unit.invalid/internal/paper-ledger')).status,404);
    assert.equal((await mf.dispatchFetch('https://unit.invalid/internal/paper-ledger',
      {headers})).status,200);
    assert.equal((await mf.dispatchFetch('https://unit.invalid/orders',{method:'POST',headers})).status,404);
    const [raceA,raceB]=await Promise.all([
      request('enter',{signalId:'cloud-signal-001',nowMs,quote:makeQuote(nowMs)}),
      request('enter',{signalId:'cloud-signal-001',nowMs,quote:makeQuote(nowMs)}),
    ]);
    const [resultA,resultB]=await Promise.all([raceA.json(),raceB.json()]);
    const statuses=[resultA.results.PAPER_50K.status,resultB.results.PAPER_50K.status].sort();
    assert.deepEqual(statuses,['DUPLICATE','OPEN']);
    const first=resultA.results.PAPER_50K.status==='OPEN'?resultA:resultB;
    assert.equal(first.results.PAPER_50K.status,'OPEN');
    assert.equal(first.results.PAPER_100K.status,'OPEN');
    const replay=await (await request('enter',
      {signalId:'cloud-signal-001',nowMs:nowMs+1000,quote:makeQuote(nowMs+1000)})).json();
    assert.equal(replay.results.PAPER_50K.status,'DUPLICATE');
    assert.equal((await (await stub.fetch('https://unit.invalid/test/paper/rollback')).json()).unchanged,true);
    const id=first.results.PAPER_50K.tradeId;
    const exited=await (await request('exit',{tradeId:id,nowMs:nowMs+120000,
      quote:makeQuote(nowMs+120000,79.8,80.2)})).json();
    assert.equal(exited.result.status,'CLOSED');
    const before=await (await stub.fetch('https://unit.invalid/test/paper/state')).json();
    assert.equal(before.outbox.length,3);
    assert.equal(before.positions.length,2);
    assert.equal(before.positions.filter(p=>p.status==='CLOSED').length,1);
    const publicSummary=await (await mf.dispatchFetch('https://unit.invalid/internal/paper-ledger',
      {headers})).json();
    assert.equal(publicSummary.status,'READY');
    assert.equal(publicSummary.pendingOutboxCount,3);
    assert.equal(JSON.stringify(publicSummary).includes('message'),false);
    await mf.dispose();mf=new Miniflare(options);
    const recovered=await (await (await stubFor()).fetch('https://unit.invalid/test/paper/state')).json();
    assert.deepEqual(recovered,before);
    assert.equal(recovered.outbox.filter(e=>e.kind==='PAPER_EXIT').length,1);
    assert.equal(recovered.accounts.PAPER_100K.initialPaise,10000000);
  } finally {await mf.dispose();}
});
