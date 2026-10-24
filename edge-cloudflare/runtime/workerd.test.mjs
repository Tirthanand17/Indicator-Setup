import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
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

test('owner emergency halt cancels alarm, is idempotent and survives restart/bootstrap',async()=>{
  const persist=await mkdtemp(path.join(os.tmpdir(),'nifty-halt-native-do-'));
  const options={modules:true,scriptPath:path.join(root,'runtime/harness.mjs'),
    modulesRoot:root,compatibilityDate:'2026-07-30',
    bindings:{SCHEDULER_ADMIN_KEY:key,OFFLINE_SCHEDULER_ENABLED:'true'},
    durableObjects:{MARKET_SESSION:{className:'TestSession',useSQLite:true}},
    durableObjectsPersist:persist,
    outboundService:()=>{throw Error('No network allowed in halt test');}};
  let mf=new Miniflare(options);
  const halt=options=>mf.dispatchFetch('https://unit.invalid/internal/emergency-halt',
    {method:'POST',...options});
  const state=async()=> (await mf.dispatchFetch('https://unit.invalid/internal/scheduler',
    {headers})).json();
  try {
    assert.equal((await halt()).status,404);
    assert.equal((await mf.dispatchFetch('https://unit.invalid/internal/release-readiness')).status,404);
    assert.equal((await halt({headers,body:'surprise'})).status,400);
    const preHalt=await halt({headers});
    assert.equal(preHalt.status,200);
    assert.equal((await preHalt.json()).status,'OWNER_EMERGENCY_HALT');
    assert.equal((await state()).events.length,1);
    assert.equal((await halt({headers})).status,200);
    assert.equal((await state()).events.length,1);
    const boot=await mf.dispatchFetch('https://unit.invalid/internal/bootstrap',
      {method:'POST',headers});
    assert.equal((await boot.json()).status,'OWNER_EMERGENCY_HALT');
    const before=await state();
    assert.equal(before.halted,true);
    assert.equal(before.scheduledAtMs,null);
    assert.equal(before.totalClaims,0);
    assert.equal(before.realOrdersEnabled,false);
    const readiness=await (await mf.dispatchFetch('https://unit.invalid/internal/release-readiness',
      {headers})).json();
    assert.equal(readiness.status,'BLOCKED_PRE_RELEASE');
    assert.ok(readiness.blockers.includes('SCHEDULER_HALTED'));
    assert.equal(readiness.automatedReleaseAuthorized,false);
    await mf.dispose();mf=new Miniflare(options);
    const after=await state();
    assert.deepEqual(after.events,before.events);
    assert.equal(after.status,'OWNER_EMERGENCY_HALT');
    assert.equal(after.scheduledAtMs,null);
    assert.equal((await (await mf.dispatchFetch('https://unit.invalid/internal/bootstrap',
      {method:'POST',headers})).json()).status,'OWNER_EMERGENCY_HALT');
  } finally {await mf.dispose();}
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
    const status=await (await mf.dispatchFetch('https://unit.invalid/internal/release-readiness',
      {headers:{authorization:'Bearer '+key}})).json();
    assert.equal(status.dailyTokenHandoffAcknowledged,true);
    assert.ok(status.blockers.includes('OWNER_CLOUD_APPROVAL_REQUIRED'));
    assert.equal(JSON.stringify(status).includes('SYNTHETIC-ACCESS-TOKEN'),false);
    assert.equal(JSON.stringify(status).includes('ciphertext'),false);
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

test('native SQLite delivery journal blocks crash-replay, honors 429 and retains verified tombstones',async()=>{
  const persist=await mkdtemp(path.join(os.tmpdir(),'nifty-delivery-native-do-'));
  const options={modules:true,scriptPath:path.join(root,'runtime/harness.mjs'),
    modulesRoot:root,compatibilityDate:'2026-07-30',
    bindings:{SCHEDULER_ADMIN_KEY:key,OFFLINE_SCHEDULER_ENABLED:'true',
      OFFLINE_PAPER_LEDGER_ENABLED:'true',OFFLINE_DELIVERY_REHEARSAL_ENABLED:'true'},
    durableObjects:{MARKET_SESSION:{className:'TestSession',useSQLite:true}},
    durableObjectsPersist:persist,
    outboundService:()=>{throw Error('Real Telegram traffic forbidden by local test');}};
  const at=Date.parse('2026-10-23T04:30:00Z');
  const quote={contract:{symbol:'NIFTY26OCT23000CE',kind:'CE',expiry:'2026-10-29',
    token:12345,lotSize:65},bid:100,ask:100.5,
    bidQuantity:600,askQuantity:600,updatedAtMs:at-1000};
  let mf=new Miniflare(options);
  const stubFor=async()=>{
    const ns=await mf.getDurableObjectNamespace('MARKET_SESSION');
    return ns.get(ns.idFromName('nifty-paper-session-v1'));
  };
  const post=async(stub,endpoint,payload)=> {
    const response=await stub.fetch('https://unit.invalid/test/delivery/'+endpoint,
      {method:'POST',body:JSON.stringify(payload)});
    assert.equal(response.status,200);
    return response.json();
  };
  try {
    let stub=await stubFor();
    assert.equal((await post(stub,'init',{nowMs:at})).status,'NO_ELIGIBLE_ALERT');
    const entered=await stub.fetch('https://unit.invalid/test/paper/enter',
      {method:'POST',body:JSON.stringify({
        signalId:'telegram-rehearsal-001',nowMs:at,quote})});
    assert.equal((await entered.json()).results.PAPER_50K.status,'OPEN');
    const first=await post(stub,'claim',{nowMs:at+1000});
    assert.equal(first.status,'SIMULATED_ATTEMPT_CLAIM');
    assert.equal(first.sent,false);
    assert.equal((await post(stub,'claim',{nowMs:at+1500})).status,
      'AMBIGUOUS_ACK_REQUIRED');
    await mf.dispose();mf=new Miniflare(options);stub=await stubFor();
    assert.equal((await post(stub,'claim',{nowMs:at+2000})).status,
      'AMBIGUOUS_ACK_REQUIRED');
    const suppressed=await post(stub,'suppress',{eventId:first.eventId,
      nowMs:at+3000,
      decision:'OWNER_SUPPRESS_RESEND_ACKNOWLEDGING_UNKNOWN_DELIVERY'});
    assert.equal(suppressed.status,'SUPPRESSED_UNCERTAIN');
    const second=await post(stub,'claim',{nowMs:at+4000});
    assert.equal(second.attempt,1);
    const wait=await post(stub,'settle',{eventId:second.eventId,
      attempt:second.attempt,nowMs:at+5000,httpStatus:429,
      botResponse:{ok:false,error_code:429,parameters:{retry_after:3}}});
    assert.equal(wait.status,'RATE_LIMIT_WAIT');
    assert.equal((await post(stub,'claim',{nowMs:at+7999})).status,'RATE_LIMIT_WAIT');
    const retried=await post(stub,'claim',{nowMs:at+8000});
    assert.equal(retried.attempt,2);
    assert.equal((await post(stub,'settle',{eventId:retried.eventId,
      attempt:retried.attempt,nowMs:at+9000,httpStatus:200,
      botResponse:{ok:true,result:{message_id:271}}})).status,'ACCEPTED_API_ONLY');
    const summary=await (await stub.fetch('https://unit.invalid/test/delivery/summary')).json();
    assert.equal(summary.cursor,2);
    assert.equal(summary.attempted,3);
    assert.equal(summary.acceptedByBotApi,1);
    assert.equal(summary.suppressedUnknown,1);
    assert.equal(summary.phoneDeliveredVerified,false);
    assert.equal(JSON.stringify(summary).includes('SIMULATED ONLY'),false);
    assert.equal((await post(stub,'claim',{nowMs:at+10000})).status,'NO_ELIGIBLE_ALERT');
    const persisted=await (await stub.fetch('https://unit.invalid/test/delivery/state')).json();
    assert.equal(persisted.recent.length,2);
    assert.equal(persisted.recent[0].status,'SUPPRESSED_UNCERTAIN');
    assert.equal(persisted.recent[1].status,'ACCEPTED_API_ONLY');
    assert.equal(JSON.stringify(persisted).includes('SIMULATED ONLY'),false);
  } finally {await mf.dispose();}
});

test('native synthetic pipeline commits 5m/15m signal, two accounts, exits and journal across restart',async()=>{
  const persist=await mkdtemp(path.join(os.tmpdir(),'nifty-session-native-do-'));
  const options={modules:true,scriptPath:path.join(root,'runtime/harness.mjs'),
    modulesRoot:root,compatibilityDate:'2026-07-30',
    bindings:{SCHEDULER_ADMIN_KEY:key,OFFLINE_SCHEDULER_ENABLED:'true',
      OFFLINE_PAPER_LEDGER_ENABLED:'true',OFFLINE_SYNTHETIC_SESSION_ENABLED:'true'},
    durableObjects:{MARKET_SESSION:{className:'TestSession',useSQLite:true}},
    durableObjectsPersist:persist,
    outboundService:()=>{throw new Error('External requests forbidden by local test');}};
  const fixtures=JSON.parse(readFileSync(path.join(root,'decision-parity-fixtures.json'),'utf8'));
  const fixture=fixtures.cases.find(c=>c.expected.status==='REVIEW_PE');
  const origin=Date.parse('2026-10-23T09:15:00+05:30');
  const stamp=slot=>origin+slot*20000;
  const q=(slot,bid=100,ask=100.5)=>({contract:{symbol:'NIFTY26OCT23000PE',kind:'PE',
    expiry:'2026-10-29',token:23456,lotSize:65},bid,ask,bidQuantity:650,
    askQuantity:650,updatedAtMs:stamp(slot)-1000});
  const turn=(slot,signal=false)=>({source:'OFFLINE_SYNTHETIC_TEST_ONLY',
    tickId:`2026-10-23:${slot}`,observedAtMs:stamp(slot),
    futures:{symbol:'NFO:NIFTY26OCTFUT',instrumentToken:777,
      exchangeAtMs:stamp(slot)-1000,lastPrice:22000},
    candles5:signal?fixture.candles:null,
    candles15:signal?fixture.confirm15m:null,
    ...(signal?{strategyConfig:{adxMin:fixture.adxMin,atrBuffer:fixture.atrBuffer}}:{}),
    optionQuotes:{PE:q(slot)},
  });
  let mf=new Miniflare(options);
  const getStub=async()=>{
    const ns=await mf.getDurableObjectNamespace('MARKET_SESSION');
    return ns.get(ns.idFromName('nifty-paper-session-v1'));
  };
  try {
    const stub=await getStub();
    const send=body=>stub.fetch('https://unit.invalid/test/pipeline/turn',{
      method:'POST',body:JSON.stringify(body)});
    assert.equal((await mf.dispatchFetch('https://unit.invalid/internal/synthetic-session')).status,404);
    assert.equal((await mf.dispatchFetch('https://unit.invalid/internal/synthetic-session',
      {method:'POST',headers})).status,404);
    const one=turn(271,true);
    one.futures.lastPrice=fixture.candles.at(-1).close;
    const [a,b]=await Promise.all([send(one),send(one)]);
    const [x,y]=await Promise.all([a.json(),b.json()]);
    assert.deepEqual([x.status,y.status].sort(),['DUPLICATE_TICK','SYNTHETIC_TICK_PROCESSED']);
    assert.equal((x.entered??0)+(y.entered??0),2);
    const rolled=await (await stub.fetch('https://unit.invalid/test/pipeline/rollback')).json();
    assert.equal(rolled.unchanged,true);
    const exit=await (await send({...turn(273),optionQuotes:{PE:q(273,141,141.5)}})).json();
    assert.equal(exit.exited,2);
    assert.equal(exit.pendingOutboxCount,4);
    const before=await (await stub.fetch('https://unit.invalid/test/pipeline/state')).json();
    assert.equal(before.session.totalTicks,2);
    assert.equal(before.ledger.positions.filter(p=>p.status==='CLOSED').length,2);
    assert.equal(before.marks.source,'OFFLINE_SYNTHETIC_TEST_ONLY');
    assert.equal(before.marks.marks.length,0); // last exit tick clears marks
    const aggregate=await (await mf.dispatchFetch('https://unit.invalid/internal/synthetic-session',
      {headers})).json();
    assert.equal(aggregate.status,'READY');
    assert.equal(aggregate.syntheticOnly,true);
    assert.equal(aggregate.liveMarketConnected,false);
    assert.equal(aggregate.ledger.pendingOutboxCount,4);
    await mf.dispose();mf=new Miniflare(options);
    const after=await (await (await getStub()).fetch('https://unit.invalid/test/pipeline/state')).json();
    assert.deepEqual(after,before);
    assert.equal(after.ledger.accounts.PAPER_50K.initialPaise,5000000);
    assert.equal(after.ledger.accounts.PAPER_100K.initialPaise,10000000);
  } finally {await mf.dispose();}
});

test('native synthetic marks, private indicative equity, stale state and restart fail closed',async()=>{
  const persist=await mkdtemp(path.join(os.tmpdir(),'nifty-portfolio-native-do-'));
  const viewKey='portfolio-private-view-AaBb-0123456789-AbCdEfGh';
  const options={modules:true,scriptPath:path.join(root,'runtime/harness.mjs'),
    modulesRoot:root,compatibilityDate:'2026-07-30',
    bindings:{SCHEDULER_ADMIN_KEY:key,OFFLINE_SCHEDULER_ENABLED:'true',
      OFFLINE_PAPER_LEDGER_ENABLED:'true',OFFLINE_SYNTHETIC_SESSION_ENABLED:'true',
      OFFLINE_PRIVATE_DASHBOARD_ENABLED:'true',PAPER_DASHBOARD_VIEW_KEY:viewKey},
    durableObjects:{MARKET_SESSION:{className:'TestSession',useSQLite:true}},
    durableObjectsPersist:persist,
    outboundService:()=>{throw Error('External requests forbidden by local test');}};
  const fixtures=JSON.parse(readFileSync(path.join(root,'decision-parity-fixtures.json'),'utf8'));
  const fixture=fixtures.cases.find(c=>c.expected.status==='REVIEW_PE');
  const origin=Date.parse('2026-10-23T09:15:00+05:30');
  const stamp=slot=>origin+slot*20000;
  const q=slot=>({contract:{symbol:'NIFTY26OCT23000PE',kind:'PE',
    expiry:'2026-10-29',token:23456,lotSize:65},bid:100,ask:100.5,
    bidQuantity:650,askQuantity:650,updatedAtMs:stamp(slot)-1000});
  let mf=new Miniflare(options);
  const stubFor=async()=>{
    const ns=await mf.getDurableObjectNamespace('MARKET_SESSION');
    return ns.get(ns.idFromName('nifty-paper-session-v1'));
  };
  try {
    let stub=await stubFor();
    const setTime=at=>stub.fetch('https://unit.invalid/test/pipeline/clock',
      {method:'POST',body:JSON.stringify({nowMs:at})});
    const at=stamp(271);
    const event={source:'OFFLINE_SYNTHETIC_TEST_ONLY',tickId:'2026-10-23:271',
      observedAtMs:at,futures:{symbol:'NFO:NIFTY26OCTFUT',instrumentToken:777,
        exchangeAtMs:at-1000,lastPrice:fixture.candles.at(-1).close},
      candles5:fixture.candles,candles15:fixture.confirm15m,
      strategyConfig:{adxMin:fixture.adxMin,atrBuffer:fixture.atrBuffer},
      optionQuotes:{PE:q(271)}};
    const traded=await (await stub.fetch('https://unit.invalid/test/pipeline/turn',
      {method:'POST',body:JSON.stringify(event)})).json();
    assert.equal(traded.entered,2);
    const marked=await (await stub.fetch('https://unit.invalid/test/pipeline/state')).json();
    assert.equal(marked.marks.marks.length,1);
    await setTime(at+1000);
    const login=await mf.dispatchFetch('https://unit.invalid/paper/login',{
      method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({key:viewKey}).toString(),redirect:'manual'});
    assert.equal(login.status,303);
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const get=()=>mf.dispatchFetch('https://unit.invalid/paper/api/portfolio',{headers:{cookie}});
    const fresh=await (await get()).json();
    assert.equal(fresh.healthStatus,'SYNTHETIC_MARKS_FRESH');
    assert.equal(fresh.accounts[0].markedToMarket,true);
    assert.equal(fresh.accounts[1].markedToMarket,true);
    assert.equal(fresh.accounts[0].indicativeEquityPaise > 0,true);
    assert.equal(fresh.valuationIsLive,false);
    assert.equal((await mf.dispatchFetch('https://unit.invalid/paper/api/portfolio')).status,404);
    await setTime(at+17_000);
    const stale=await (await get()).json();
    assert.equal(stale.healthStatus,'MISSING_OR_STALE_QUOTE');
    assert.equal(stale.accounts[0].indicativeEquityPaise,null);
    const unchanged=await (await stub.fetch('https://unit.invalid/test/pipeline/rollback')).json();
    assert.equal(unchanged.unchanged,true);
    await mf.dispose();mf=new Miniflare(options);stub=await stubFor();
    const restored=await (await stub.fetch('https://unit.invalid/test/pipeline/state')).json();
    assert.deepEqual(restored,marked);
    const liveClock=await stub.fetch('https://unit.invalid/test/pipeline/clock',
      {method:'POST',body:JSON.stringify({nowMs:at+1000})});
    assert.equal(liveClock.status,200);
    const after=await (await get()).json();
    assert.equal(after.accounts[0].markedToMarket,true);
    assert.equal(after.accounts[1].markedToMarket,true);
    assert.equal(after.liveMarketConnected,false);
  } finally {await mf.dispose();}
});

test('native private mobile dashboard login, read-only API, fail closed and SQLite restart',async()=>{
  const persist=await mkdtemp(path.join(os.tmpdir(),'nifty-private-view-native-'));
  const viewKey='private-view-synthetic-0123456789-AbCdEfGh';
  const options={modules:true,scriptPath:path.join(root,'runtime/harness.mjs'),
    modulesRoot:root,compatibilityDate:'2026-07-30',
    bindings:{SCHEDULER_ADMIN_KEY:key,OFFLINE_SCHEDULER_ENABLED:'true',
      OFFLINE_PAPER_LEDGER_ENABLED:'true',OFFLINE_PRIVATE_DASHBOARD_ENABLED:'true',
      PAPER_DASHBOARD_VIEW_KEY:viewKey},
    durableObjects:{MARKET_SESSION:{className:'TestSession',useSQLite:true}},
    durableObjectsPersist:persist,
    outboundService:()=>{throw Error('External requests forbidden by local test');}};
  let mf=new Miniflare(options);
  const request=(route,init)=>mf.dispatchFetch(`https://unit.invalid${route}`,init);
  try {
    assert.equal((await request('/paper/api/summary')).status,404);
    const loginPage=await request('/paper/dashboard');
    assert.equal(loginPage.status,200);
    assert.match(await loginPage.text(),/Private paper dashboard/);
    assert.equal((await request('/paper/login',{method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded'},body:'key=wrong'})).status,401);
    const login=await request('/paper/login',{method:'POST',
      redirect:'manual',
      headers:{'content-type':'application/x-www-form-urlencoded',origin:'https://unit.invalid'},
      body:new URLSearchParams({key:viewKey}).toString()});
    assert.equal(login.status,303);
    const rawCookie=login.headers.get('set-cookie');
    assert.match(rawCookie,/HttpOnly; SameSite=Strict/);
    assert.equal(rawCookie.includes(viewKey),false);
    const cookie=rawCookie.split(';')[0];
    assert.equal((await request('/paper/api/summary',{headers:{cookie}})).status,503);
    const ns=await mf.getDurableObjectNamespace('MARKET_SESSION');
    const stub=ns.get(ns.idFromName('nifty-paper-session-v1'));
    const entryAt=Date.parse('2026-10-23T04:30:00Z');
    const q={contract:{symbol:'NIFTY26OCT23000CE',kind:'CE',expiry:'2026-10-29',
      token:12345,lotSize:65},bid:100,ask:100.5,bidQuantity:650,
      askQuantity:650,updatedAtMs:entryAt-1000};
    const entered=await stub.fetch('https://unit.invalid/test/paper/enter',{
      method:'POST',body:JSON.stringify({signalId:'native-private-dashboard-001',
        nowMs:entryAt,quote:q})});
    assert.equal((await entered.json()).results.PAPER_50K.status,'OPEN');
    const summary=await (await request('/paper/api/summary',{headers:{cookie}})).json();
    assert.equal(summary.status,'READY');
    assert.equal(summary.accounts[0].openCount,1);
    assert.equal(summary.accounts[0].valuationNote,'CASH_ONLY_NOT_EQUITY_NO_VERIFIED_MTM');
    assert.equal(summary.realOrdersEnabled,false);
    const trades=await (await request('/paper/api/trades?limit=2',{headers:{cookie}})).json();
    assert.equal(trades.trades.length,2);
    assert.equal(trades.trades[0].netPnlRupees,null);
    const daily=await (await request('/paper/api/daily?date=2026-10-23',{headers:{cookie}})).json();
    assert.equal(daily.accounts[0].entries,1);
    assert.equal(daily.accounts[0].winRate,null);
    assert.equal((await request('/paper/api/trades',{method:'POST',headers:{cookie},body:'x'})).status,404);
    assert.equal((await request('/orders',{method:'POST',headers:{cookie},body:'x'})).status,404);
    await mf.dispose();mf=new Miniflare(options);
    const after=await (await request('/paper/api/summary',{headers:{cookie}})).json();
    assert.equal(after.status,'READY');
    assert.equal(after.accounts[0].openCount,1);
    assert.equal(after.accounts[1].openCount,1);
  } finally {await mf.dispose();}
});
