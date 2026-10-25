import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { MarketSession } from './worker.mjs';
import { assessAlarm, NSE_FO_CALENDAR_VERSION } from './alarm-core.mjs';
import { createHmac, randomBytes } from 'node:crypto';
import { claimMasterFetch,commitMasterPair } from './option-runtime.mjs';
import {compileNiftyCatalog,selectCatalogPair} from './instrument-catalog.mjs';
import {newPaperLedger,enterPaperBasket} from './paper-ledger.mjs';
import {newPaperDeliveryJournal} from './paper-delivery.mjs';
import {readFileSync} from 'node:fs';

const KEY = 'SYNTHETIC-ONLY-0123456789-abcdefghijklmnop';
const ist = (day, time) => Date.parse(`${day}T${time}+05:30`);
const OPEN = ist('2026-10-23', '09:15:00');
const request = (path = '/internal/bootstrap', key = KEY, method = 'POST') =>
  new Request('https://unit.invalid' + path, { method, headers: { authorization: 'Bearer ' + key } });

// Model atomic commit/rollback and serialize concurrent transactions. This is
// not Cloudflare runtime evidence; actual workerd/platform verification remains required.
class Storage {
  data = new Map(); alarmAt = null; fail = false; queue = Promise.resolve();
  async get(key) { return structuredClone(this.data.get(key)); }
  async put(key, value) { this.data.set(key,structuredClone(value)); }
  transaction(fn) {
    const run = this.queue.then(async () => {
      const data = structuredClone(this.data);
      let alarmAt = this.alarmAt;
      const txn = {
        get: async key => structuredClone(data.get(key)),
        put: async (key, value) => data.set(key, structuredClone(value)),
        setAlarm: async value => { alarmAt = value; },
        deleteAlarm: async () => { alarmAt = null; },
      };
      const result = await fn(txn);
      if (this.fail) throw new Error('synthetic storage quota/commit fault');
      this.data = data; this.alarmAt = alarmAt;
      return result;
    });
    this.queue = run.catch(() => {});
    return run;
  }
}

function setup(t, now = OPEN - 60_000, outbound = () => assert.fail('external I/O forbidden')) {
  let clock = now;
  t.mock.method(Date, 'now', () => clock);
  t.mock.method(globalThis, 'fetch', outbound);
  const storage = new Storage();
  const env = { SCHEDULER_ADMIN_KEY: KEY, OFFLINE_SCHEDULER_ENABLED: 'true' };
  const session = new MarketSession({ storage }, env);
  env.MARKET_SESSION = { idFromName: name => name, get: () => session };
  return { storage, env, session, set: value => { clock = value; },
    state: () => storage.get('scheduler-v1') };
}

const fakeToken = 'SYNTHETIC-ACCESS-TOKEN-FOR-TEST-0123456789';
function tokenRequest(env,{now=Date.now(),value=fakeToken,nonce=randomBytes(20).toString('hex'),
  apiKey=env.KITE_API_KEY,signature}={}) {
  const timestamp = String(Math.floor(now/1000));
  const body = JSON.stringify({api_key:apiKey,access_token:value});
  const digest = signature ?? createHmac('sha256',env.TOKEN_RELAY_HMAC_KEY)
    .update(timestamp+'\n'+nonce+'\n'+body).digest('hex');
  return new Request('https://unit.invalid/internal/token', {method:'POST',
    headers:{'content-type':'application/json','x-relay-timestamp':timestamp,
      'x-relay-nonce':nonce,'x-relay-signature':digest},body});
}
function configureMarket(s) {
  s.env.READONLY_MARKET_RUNTIME_ENABLED='true';
  s.env.KITE_API_KEY='synthetic-key';
  s.env.TOKEN_RELAY_HMAC_KEY='long-synthetic-relay-signature-secret-0123456789';
  s.env.TOKEN_VAULT_AES_KEY=randomBytes(32).toString('base64');
  s.env.KITE_FUTURE_SYMBOL='NIFTY26OCTFUT';
  s.env.KITE_FUTURE_INSTRUMENT_TOKEN='12345';
}

const masterCsv=()=>['instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange',
  '12345,1,NIFTY26OCTFUT,NIFTY,0,2026-10-27,0,0.05,65,FUT,NFO-FUT,NFO',
  ...[22050,22550].flatMap((strike,i)=>['CE','PE'].map((kind,j)=>
    [30000+i*2+j,1,`NIFTY26O29${strike}${kind}`,'NIFTY',0,'2026-10-29',strike,0.05,65,kind,'NFO-OPT','NFO'].join(',')))].join('\n');
function enablePaper(s) {
  Object.assign(s.env,{OFFLINE_OPTION_SNAPSHOT_ENABLED:'true',OFFLINE_READONLY_REVIEW_ENABLED:'true',
    OFFLINE_PAPER_BRIDGE_ENABLED:'true',OFFLINE_READONLY_DELIVERY_REHEARSAL_ENABLED:'true'});
}
const rawQuote=(token,bid=100,ask=100.5)=>({instrument_token:token,
  timestamp:new Date(Date.now()+330*60_000).toISOString().slice(0,19).replace('T',' '),
  depth:{buy:[{price:bid,quantity:650}],sell:[{price:ask,quantity:650}]}});

test('fresh ATM reselection keeps old-position exits when the new entry pair is unavailable',async t=>{
  let price=22046,masterCalls=0;const requests=[];
  const s=setup(t,OPEN-60_000,async url=>{
    const u=new URL(url);
    if(u.pathname==='/instruments/NFO') {masterCalls++;return new Response(masterCsv(),{headers:{'content-type':'text/csv'}});}
    const symbols=u.searchParams.getAll('i');requests.push(symbols);
    if(symbols[0].endsWith('FUT'))return Response.json({status:'success',data:{
      [symbols[0]]:{...rawQuote(12345),last_price:price}}});
    // The new ATM legs are absent, but the actual held contract has a valid exit.
    return Response.json({status:'success',data:{'NFO:NIFTY26O2922050CE':rawQuote(30000,170,171)}});
  });
  configureMarket(s);enablePaper(s);
  s.env.KITE_FUTURE_SYMBOL='WRONG_CONFIGURED_FUTURE';s.env.KITE_FUTURE_INSTRUMENT_TOKEN='999';
  await s.session.fetch(request());await s.session.fetch(tokenRequest(s.env));
  const entryAt=ist('2026-10-23','09:30:40');
  const old=selectCatalogPair(compileNiftyCatalog(masterCsv(),OPEN),entryAt,22046);
  const ledger=enterPaperBasket(newPaperLedger(entryAt),{signalId:'CATALOG:OLD:POSITIONS',nowMs:entryAt,
    quote:{contract:old.CE,updatedAtMs:entryAt,bid:100,ask:100.5,bidQuantity:650,askQuantity:650}}).ledger;
  await s.storage.put('readonly-paper-ledger-v1',ledger);
  await s.storage.put('readonly-paper-delivery-v1',newPaperDeliveryJournal(entryAt));
  s.set(ist('2026-10-23','10:00:00'));
  assert.equal((await s.session.pollReadOnlyMarket('2026-10-23:135',Date.now())).status,'QUOTE_OBSERVED');
  price=22546;s.set(ist('2026-10-23','10:01:00'));
  assert.equal((await s.session.pollReadOnlyMarket('2026-10-23:138',Date.now())).status,'QUOTE_OBSERVED');
  assert.equal((await s.storage.get('readonly-option-state-v1')).pair.CE.strike,22550);
  assert.equal(masterCalls,1);
  s.set(ist('2026-10-23','10:01:40'));
  assert.equal((await s.session.pollReadOnlyOptions('2026-10-23:140',Date.now())).status,'OPTION_ENTRY_UNAVAILABLE');
  assert.deepEqual(requests.at(-1),['NFO:NIFTY26O2922550CE','NFO:NIFTY26O2922550PE','NFO:NIFTY26O2922050CE']);
  const closed=await s.storage.get('readonly-paper-ledger-v1');
  assert.equal(closed.positions.length,2);
  assert.equal(closed.positions.every(p=>p.status==='CLOSED'&&p.strike===22050&&p.token===30000),true);
  assert.equal(closed.outbox.length,4);
  assert.equal((await s.storage.get('readonly-paper-delivery-v1')).nextIndex,0);
  await s.session.pollReadOnlyOptions('2026-10-23:140',Date.now());
  assert.deepEqual(await s.storage.get('readonly-paper-ledger-v1'),closed);
});

test('actual reviewed market pipeline enters the freshly selected strike after a large move',async t=>{
  const fixture=JSON.parse(readFileSync(new URL('./decision-parity-fixtures.json',import.meta.url),'utf8'))
    .cases.find(c=>c.name==='uptrend_mirrored_qualifying_review');
  // Strengthen the last ten synthetic bars so the actual pinned ADX>=25
  // production configuration qualifies; do not inject parity-only overrides.
  fixture.candles=fixture.candles.map((c,i)=>{
    const shift=Math.max(0,i-(fixture.candles.length-10)+1)*2;
    return {...c,open:c.open+shift,high:c.high+shift,low:c.low+shift,close:c.close+shift};
  });
  let price=22046,masterCalls=0;
  const asKite=c=>[new Date(c.startMs+330*60_000).toISOString().replace('.000Z','+0530'),
    c.open,c.high,c.low,c.close,c.volume];
  const s=setup(t,OPEN-60_000,async url=>{
    const u=new URL(url);
    if(u.pathname==='/instruments/NFO'){masterCalls++;return new Response(masterCsv(),{headers:{'content-type':'text/csv'}});}
    if(u.pathname.includes('/historical/'))return Response.json({status:'success',data:{
      candles:(u.pathname.endsWith('15minute')?fixture.confirm15m:fixture.candles).map(asKite)}});
    const symbols=u.searchParams.getAll('i');
    return Response.json({status:'success',data:Object.fromEntries(symbols.map(symbol=>[symbol,
      symbol.endsWith('FUT')?{...rawQuote(12345),last_price:price}:
      rawQuote(symbol.endsWith('CE')?30002:30003)]))});
  });
  configureMarket(s);enablePaper(s);
  await s.session.fetch(request());await s.session.fetch(tokenRequest(s.env));
  s.set(OPEN);
  await s.session.pollReadOnlyMarket('2026-10-23:0',OPEN);
  assert.equal((await s.storage.get('readonly-option-state-v1')).pair.CE.strike,22050);
  price=22546;s.set(fixture.nowMs);
  const review=await s.session.pollReadOnlyMarket('2026-10-23:271',Date.now());
  assert.equal(review.review.status,'REVIEW_CE');
  assert.equal((await s.storage.get('readonly-option-state-v1')).pair.CE.strike,22550);
  s.set(fixture.nowMs+20_000);
  assert.equal((await s.session.pollReadOnlyOptions('2026-10-23:272',Date.now())).status,'OPTION_OBSERVED');
  const ledger=await s.storage.get('readonly-paper-ledger-v1');
  assert.equal(ledger.positions.length,2);
  assert.equal(ledger.positions.every(p=>p.status==='OPEN'&&p.strike===22550&&p.token===30002),true);
  assert.equal(masterCalls,1);
});

test('post-expiry runtime uses the master-selected future for quote and both history requests',async t=>{
  const calls=[];
  const nextOpen=ist('2026-10-28','09:15:00');
  const s=setup(t,nextOpen-60_000,async url=>{
    calls.push(url);const u=new URL(url);
    if(u.pathname==='/instruments/NFO')return new Response(masterCsv()+
      '\n12346,1,NIFTY26NOVFUT,NIFTY,0,2026-11-24,0,0.05,65,FUT,NFO-FUT,NFO',
      {headers:{'content-type':'text/csv'}});
    if(u.pathname==='/quote')return Response.json({status:'success',data:{
      'NFO:NIFTY26NOVFUT':{...rawQuote(12346),last_price:22546}}});
    return Response.json({status:'success',data:{candles:[]}});
  });
  configureMarket(s); // Old October hints must not control an October 28 sample.
  await s.session.fetch(request());await s.session.fetch(tokenRequest(s.env));s.set(nextOpen);
  const report=await s.session.pollReadOnlyMarket('2026-10-28:0',Date.now());
  assert.equal(report.status,'HISTORY_OBSERVED');assert.equal(report.instrumentToken,12346);
  assert.equal(report.symbol,'NIFTY26NOVFUT');
  assert.equal(calls.filter(url=>url.includes('/historical/12346/')).length,2);
  assert.equal(calls.some(url=>url.includes('/historical/12345/')||url.includes('NIFTY26OCTFUT')),false);
});

test('network latency cannot make an old futures quote fresh using the alarm start clock',async t=>{
  let s;
  s=setup(t,OPEN-60_000,async url=>{
    if(new URL(url).pathname==='/instruments/NFO')return new Response(masterCsv(),{headers:{'content-type':'text/csv'}});
    s.set(OPEN+70_000);
    return Response.json({status:'success',data:{'NFO:NIFTY26OCTFUT':{
      instrument_token:12345,last_price:22046,timestamp:'2026-10-23 09:15:00'}}});
  });
  configureMarket(s);await s.session.fetch(request());await s.session.fetch(tokenRequest(s.env));s.set(OPEN);
  const result=await s.session.pollReadOnlyMarket('2026-10-23:0',OPEN);
  assert.equal(result.status,'BLOCKED_MARKET_DATA');
  assert.equal(await s.storage.get('readonly-paper-bridge-v1'),undefined);
});

test('full regular session observes options every tick with one quote request per alarm and no replay',async t=>{
  let quotes=0,histories=0,masters=0;const quoteTimes=[];
  const s=setup(t,OPEN-60_000,async url=>{
    const u=new URL(url);
    if(u.pathname==='/instruments/NFO'){masters++;return new Response(masterCsv(),{headers:{'content-type':'text/csv'}});}
    if(u.pathname.includes('/historical/')){histories++;return Response.json({status:'success',data:{candles:[]}});}
    assert.equal(u.pathname,'/quote');quotes++;quoteTimes.push(Date.now());
    const symbols=u.searchParams.getAll('i');assert.ok(symbols.length<=5);
    return Response.json({status:'success',data:Object.fromEntries(symbols.map(symbol=>[symbol,
      symbol.endsWith('FUT')?{...rawQuote(12345),last_price:22046}:rawQuote(symbol.endsWith('CE')?30000:30001)]))});
  });
  configureMarket(s);enablePaper(s);
  await s.session.fetch(request());await s.session.fetch(tokenRequest(s.env));
  for(let slot=0;slot<1125;slot++) {
    s.set(OPEN+slot*20_000);
    const result=await s.session.alarm();
    assert.equal(result.shouldPoll,true);
    assert.equal(result.marketStatus,slot===0?'MARKET_BATCH_PARTIAL':'MARKET_BATCH_OBSERVED');
  }
  assert.equal(quotes,1125);assert.equal(histories,150);assert.equal(masters,1);
  assert.equal(quoteTimes.every((time,i)=>i===0||time-quoteTimes[i-1]===20_000),true);
  assert.equal((await s.storage.get('readonly-quote-pace-v1')).count,1125);
  const bridge=await s.storage.get('readonly-paper-bridge-v1');
  assert.equal(bridge.totalOptionTicks,1125);assert.equal(bridge.events.length,128);
  assert.equal((await s.storage.get('readonly-paper-ledger-v1')).positions.length,0);
  assert.equal((await s.session.alarm()).shouldPoll,false);assert.equal(quotes,1125);
  const status=await (await s.session.fetch(request('/internal/scheduler',KEY,'GET'))).json();
  assert.equal(status.market.status,'MARKET_BATCH_OBSERVED');
  assert.equal(status.market.requestedOptionIntervalMs,20_000);
});

test('missing or insufficiently fresh futures block entries without hiding held option exits',async t=>{
  let includeFuture=false;
  const s=setup(t,OPEN-60_000,async url=>{
    const symbols=new URL(url).searchParams.getAll('i');
    return Response.json({status:'success',data:Object.fromEntries(symbols.filter(x=>includeFuture||!x.endsWith('FUT')).map(symbol=>[
      symbol,symbol.endsWith('FUT')?{...rawQuote(12345),last_price:22046,
        timestamp:new Date(Date.now()+330*60_000-45_000).toISOString().slice(0,19).replace('T',' ')}:
        rawQuote(symbol.endsWith('CE')?30000:30001,170,171)]))});
  });
  configureMarket(s);enablePaper(s);
  await s.session.fetch(request());await s.session.fetch(tokenRequest(s.env));
  // A consistent already-running state: master and held-entry journal exist.
  const catalog=compileNiftyCatalog(masterCsv(),OPEN);
  await s.storage.put('readonly-instrument-catalog-v1',{schema:1,day:'2026-10-23',attempts:1,
    tickId:'2026-10-23:0',retryAtMs:OPEN+30*60_000,status:'READY',catalog});
  s.set(ist('2026-10-23','10:00:00'));
  await s.session.refreshOptionMaster('2026-10-23:135',Date.now(),22046,{instrumentsNfoCsv:()=>assert.fail('cached master')});
  const entryAt=Date.now(),pair=selectCatalogPair(catalog,entryAt,22046);
  const ledger=enterPaperBasket(newPaperLedger(entryAt),{signalId:'CADENCE:EXISTING:ENTRY',nowMs:entryAt,
    quote:{contract:pair.CE,updatedAtMs:entryAt,bid:100,ask:100.5,bidQuantity:650,askQuantity:650}}).ledger;
  for(const [slot,withFuture] of [[136,false],[137,true]]) {
    includeFuture=withFuture;await s.storage.put('readonly-paper-ledger-v1',ledger);
    await s.storage.put('readonly-paper-delivery-v1',newPaperDeliveryJournal(entryAt));
    s.set(OPEN+slot*20_000);
    const report=await s.session.pollReadOnlySession(`2026-10-23:${slot}`,Date.now());
    assert.equal(report.optionStatus,'OPTION_ENTRY_UNAVAILABLE');
    assert.equal((await s.storage.get('readonly-paper-ledger-v1')).positions.every(p=>p.status==='CLOSED'),true);
  }
});

test('late catalogue completion skips the old quote slot without backfill',async t=>{
  let s,quotes=0;
  s=setup(t,OPEN-60_000,async url=>{
    const u=new URL(url);
    if(u.pathname==='/instruments/NFO'){
      s.set(OPEN+20_000);
      return new Response(masterCsv(),{headers:{'content-type':'text/csv'}});
    }
    if(u.pathname.includes('/historical/'))return Response.json({status:'success',data:{candles:[]}});
    quotes++;
    return Response.json({status:'success',data:{'NFO:NIFTY26OCTFUT':{...rawQuote(12345),last_price:22046}}});
  });
  configureMarket(s);enablePaper(s);await s.session.fetch(request());await s.session.fetch(tokenRequest(s.env));s.set(OPEN);
  assert.equal((await s.session.pollReadOnlySession('2026-10-23:0',OPEN)).status,'MARKET_BATCH_BLOCKED');
  assert.equal(quotes,0);assert.equal(await s.storage.get('readonly-quote-pace-v1'),undefined);
  assert.equal((await s.session.pollReadOnlySession('2026-10-23:1',Date.now())).status,'MARKET_BATCH_PARTIAL');
  assert.equal(quotes,1);
});

test('batched 429 is not retried inside the callback or during the next cooldown slots',async t=>{
  let quotes=0;
  const s=setup(t,OPEN-60_000,async url=>{
    if(new URL(url).pathname==='/instruments/NFO')return new Response(masterCsv(),{headers:{'content-type':'text/csv'}});
    quotes++;return Response.json({status:'error'},{status:429});
  });
  configureMarket(s);enablePaper(s);await s.session.fetch(request());await s.session.fetch(tokenRequest(s.env));
  for(let slot=0;slot<4;slot++){
    s.set(OPEN+slot*20_000);
    assert.equal((await s.session.pollReadOnlySession(`2026-10-23:${slot}`,Date.now())).status,'MARKET_BATCH_BLOCKED');
    assert.equal(quotes,slot<3?1:2);
  }
  assert.equal((await s.storage.get('readonly-quote-pace-v1')).count,2);
  assert.equal(await s.storage.get('readonly-paper-ledger-v1'),undefined);
});

test('halt during the shared network request prevents all subsequent paper mutations',async t=>{
  let release,started;
  const gate=new Promise(resolve=>{release=resolve;});const entered=new Promise(resolve=>{started=resolve;});
  const s=setup(t,OPEN-60_000,async url=>{
    const u=new URL(url);
    if(u.pathname==='/instruments/NFO')return new Response(masterCsv(),{headers:{'content-type':'text/csv'}});
    started();await gate;
    return Response.json({status:'success',data:{'NFO:NIFTY26OCTFUT':{...rawQuote(12345),last_price:22046}}});
  });
  configureMarket(s);enablePaper(s);await s.session.fetch(request());await s.session.fetch(tokenRequest(s.env));s.set(OPEN);
  const pending=s.session.alarm();await entered;
  await s.session.fetch(request('/internal/emergency-halt'));release();
  assert.equal((await pending).telegramStatus,'HALTED');
  for(const key of ['readonly-paper-ledger-v1','readonly-paper-bridge-v1','readonly-paper-delivery-v1'])
    assert.equal(await s.storage.get(key),undefined);
});

test('halt during an in-flight market poll prevents later dispatch and new claims after restart',async t=>{
  const s=setup(t);configureMarket(s);
  Object.assign(s.env,{OFFLINE_OPTION_SNAPSHOT_ENABLED:'true',
    OFFLINE_READONLY_REVIEW_ENABLED:'true',OFFLINE_PAPER_BRIDGE_ENABLED:'true',
    OFFLINE_READONLY_DELIVERY_REHEARSAL_ENABLED:'true',OFFLINE_TELEGRAM_SENDER_ENABLED:'true'});
  await s.session.fetch(request());s.set(OPEN);
  let release,started;
  const blocked=new Promise(resolve=>{release=resolve;});
  const entered=new Promise(resolve=>{started=resolve;});
  s.session.pollReadOnlySession=async()=>{started();await blocked;return {status:'SYNTHETIC'};};
  s.session.dispatchReadOnlyTelegram=()=>assert.fail('dispatch after owner halt');
  const callback=s.session.alarm();await entered;
  assert.equal((await (await s.session.fetch(request('/internal/emergency-halt'))).json()).status,
    'OWNER_EMERGENCY_HALT');
  release();assert.equal((await callback).telegramStatus,'HALTED');
  const restarted=new MarketSession({storage:s.storage},s.env);
  await assert.rejects(restarted.reserveReadOnlyQuote('2026-10-23:1',OPEN+20_000,'FUTURE'),/SCHEDULER_HALTED/);
  await assert.rejects(restarted.finalizeReadOnlyPaperDay(OPEN),/SCHEDULER_HALTED/);
  await assert.rejects(restarted.claimReadOnlyPaperDeliveryRehearsal(OPEN),/SCHEDULER_HALTED/);
  assert.equal((await restarted.alarm()).shouldPoll,false);
});

test('halt after delivery claim prevents send; an already-started send still settles',async t=>{
  const s=setup(t);configureMarket(s);
  Object.assign(s.env,{OFFLINE_OPTION_SNAPSHOT_ENABLED:'true',OFFLINE_READONLY_REVIEW_ENABLED:'true',
    OFFLINE_PAPER_BRIDGE_ENABLED:'true',OFFLINE_READONLY_DELIVERY_REHEARSAL_ENABLED:'true',
    OFFLINE_TELEGRAM_SENDER_ENABLED:'true',TELEGRAM_BOT_TOKEN:'123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrst',
    TELEGRAM_PRIVATE_CHAT_ID:'123456789'});
  await s.session.fetch(request());
  s.session.claimReadOnlyPaperDeliveryRehearsal=async()=>{
    await s.session.fetch(request('/internal/emergency-halt'));
    return {status:'SIMULATED_ATTEMPT_CLAIM',eventId:'synthetic',attempt:1,message:'paper only'};
  };
  assert.equal((await s.session.dispatchReadOnlyTelegram(()=>assert.fail('send after halt'))).status,
    'HALTED_BEFORE_SEND');
  // A separate initialized scheduler models a request already sent before halt.
  const second=setup(t);configureMarket(second);Object.assign(second.env,s.env);
  await second.session.fetch(request());
  second.session.claimReadOnlyPaperDeliveryRehearsal=async()=>({status:'SIMULATED_ATTEMPT_CLAIM',
    eventId:'synthetic',attempt:1,message:'paper only'});
  let settled=false;
  second.session.settleReadOnlyPaperDeliveryRehearsal=async input=>{
    assert.equal(input.httpStatus,200);settled=true;return {status:'ACCEPTED_API_ONLY'};
  };
  const result=await second.session.dispatchReadOnlyTelegram(async()=>{
    await second.session.fetch(request('/internal/emergency-halt'));
    return {httpStatus:200,botResponse:{ok:true,result:{message_id:1}}};
  });
  assert.equal(result.status,'ACCEPTED_API_ONLY');assert.equal(settled,true);
});

test('option response arriving after halt cannot commit observed paper state',async t=>{
  let release,started;
  const gate=new Promise(resolve=>{release=resolve;});
  const entered=new Promise(resolve=>{started=resolve;});
  const pair={masterFetchedAtMs:OPEN,...Object.fromEntries(['CE','PE'].map((kind,i)=>[kind,{
    symbol:`NIFTY26O2925100${kind}`,kind,expiry:'2026-10-29',strike:25100,
    token:12101+i,lotSize:65,tickSize:0.05}]))};
  const s=setup(t,OPEN-60_000,async()=>{
    started();await gate;
    return Response.json({status:'success',data:Object.fromEntries(['CE','PE'].map(kind=>[
      'NFO:'+pair[kind].symbol,{timestamp:'2026-10-23 09:15:40',instrument_token:pair[kind].token,
        depth:{buy:[{price:100,quantity:195}],sell:[{price:100.5,quantity:195}]}}]))});
  });
  configureMarket(s);Object.assign(s.env,{OFFLINE_OPTION_SNAPSHOT_ENABLED:'true',
    OFFLINE_READONLY_REVIEW_ENABLED:'true',OFFLINE_PAPER_BRIDGE_ENABLED:'true'});
  await s.session.fetch(request());
  assert.equal((await s.session.fetch(tokenRequest(s.env))).status,200);
  const claim=claimMasterFetch(undefined,{tickId:'2026-10-23:0',observedAtMs:OPEN});
  await s.storage.put('readonly-option-state-v1',commitMasterPair(claim.state,{
    tickId:'2026-10-23:0',pair}));
  s.set(OPEN+40_000);
  const poll=s.session.pollReadOnlyOptions('2026-10-23:2',OPEN+40_000);
  await entered;
  await s.session.fetch(request('/internal/emergency-halt'));
  release();await poll;
  assert.equal(await s.storage.get('readonly-paper-ledger-v1'),undefined);
  assert.equal(await s.storage.get('readonly-paper-bridge-v1'),undefined);
  assert.equal(await s.storage.get('readonly-paper-delivery-v1'),undefined);
});

test('unauthenticated, wrong methods and disabled requests never touch a DO', async t => {
  const s = setup(t);
  s.env.MARKET_SESSION.get = () => assert.fail('unauthorized DO access');
  for (const req of [request('/internal/bootstrap','wrong'), request('/orders'),
    request('/internal/bootstrap',KEY,'GET')]) assert.equal((await worker.fetch(req,s.env)).status,404);
  s.env.OFFLINE_SCHEDULER_ENABLED='false';
  assert.equal((await worker.fetch(request(),s.env)).status,503);
});

test('authenticated bootstrap is idempotent and rejects token/upload bodies', async t => {
  const s = setup(t);
  assert.equal((await worker.fetch(request(),s.env)).status,200);
  assert.equal(s.storage.alarmAt,OPEN);
  const original = await s.state();
  s.set(OPEN);
  await worker.fetch(request(),s.env);
  assert.deepEqual(await s.state(),original);
  const body = new Request('https://unit.invalid/internal/bootstrap',{
    method:'POST',headers:{authorization:'Bearer '+KEY},body:'synthetic'});
  assert.equal((await s.session.fetch(body)).status,400);
});

test('atomic claims survive restart, duplicates and concurrent callbacks', async t => {
  const s = setup(t);
  await s.session.fetch(request()); s.set(OPEN);
  const answers = await Promise.all([s.session.alarm(),s.session.alarm()]);
  assert.equal(answers.filter(a=>a.shouldPoll).length,1);
  assert.equal((await s.state()).totalClaims,1);
  const restarted = new MarketSession({storage:s.storage},s.env);
  assert.equal((await restarted.alarm()).shouldPoll,false);
  s.set(OPEN+20_000);
  assert.equal((await restarted.alarm()).shouldPoll,true);
  const saved=await s.state();
  assert.equal(saved.totalClaims,2);
  assert.equal(saved.lastClaimedTickId,'2026-10-23:1');
  assert.equal(saved.events.at(-1).observedAtMs,OPEN+20_000);
});

test('failed commit changes neither claim nor alarm; retry commits once', async t => {
  const s=setup(t); await s.session.fetch(request()); s.set(OPEN);
  const before=await s.state(); s.storage.fail=true;
  await assert.rejects(s.session.alarm());
  assert.deepEqual(await s.state(),before); assert.equal(s.storage.alarmAt,OPEN);
  s.storage.fail=false;
  await s.session.alarm(); await s.session.alarm();
  assert.equal((await s.state()).totalClaims,1);
});

test('delayed callback skips stale tick and does not catch up history', async t => {
  const s=setup(t); await s.session.fetch(request()); s.set(OPEN+120_000);
  assert.equal((await s.session.alarm()).status,'SKIP_LATE_ALARM');
  assert.equal((await s.state()).totalClaims,0);
  assert.equal(s.storage.alarmAt,OPEN+140_000);
});

test('clock rollback and corrupt storage stop scheduling without reset', async t => {
  const s=setup(t); await s.session.fetch(request()); s.set(OPEN); await s.session.alarm();
  s.set(OPEN-1);
  assert.equal((await s.session.alarm()).status,'BLOCKED_CLOCK_ROLLBACK');
  assert.equal(s.storage.alarmAt,null);
  await s.session.fetch(request()); assert.equal(s.storage.alarmAt,null);
  s.storage.data.set('scheduler-v1',{secret:'synthetic-corruption'});
  assert.equal((await s.session.alarm()).status,'BLOCKED_CORRUPT_STATE');
  const response=await s.session.fetch(request('/internal/scheduler',KEY,'GET'));
  assert.equal(response.status,503); assert.ok(!(await response.text()).includes('synthetic-corruption'));
});

test('close, weekend, holiday and unsupported year never claim trades', async t => {
  const s=setup(t,ist('2026-10-19','15:30:00'));
  await s.session.fetch(request());
  assert.equal(s.storage.alarmAt,ist('2026-10-21','09:15:00'));
  s.set(ist('2026-10-20','10:00:00')); await s.session.alarm();
  assert.equal((await s.state()).totalClaims,0);
  s.set(ist('2026-10-24','10:00:00')); await s.session.alarm();
  assert.equal(s.storage.alarmAt,ist('2026-10-26','09:15:00'));
  s.set(ist('2027-01-01','10:00:00'));
  assert.equal((await s.session.alarm()).status,'BLOCKED_UNSUPPORTED_YEAR');
  assert.equal(s.storage.alarmAt,null);
});

test('full synthetic session has 1125 unique claims and bounded retained evidence', async t => {
  const s=setup(t); await s.session.fetch(request());
  for(let slot=0;slot<1125;slot++) { s.set(OPEN+slot*20_000); await s.session.alarm(); }
  const saved=await s.state();
  assert.equal(saved.totalClaims,1125); assert.equal(saved.events.length,128);
  assert.equal(s.storage.alarmAt,ist('2026-10-26','09:15:00'));
});

test('local callback budget halts; storage exhaustion cannot advance state', async t => {
  const s=setup(t); await s.session.fetch(request());
  const state=await s.state();state.callbacks=4096;s.storage.data.set('scheduler-v1',state);
  s.set(OPEN);
  assert.equal((await s.session.alarm()).status,'BLOCKED_LOCAL_QUOTA');
  assert.equal(s.storage.alarmAt,null);
  assert.equal((await s.state()).totalClaims,0);
});

test('corrupt dedupe and reverse tick history fail closed', () => {
  for(const id of ['', 'garbage', '2026-02-30:1','2026-10-23:1125','2026-10-24:1']) {
    assert.equal(assessAlarm({observedAtMs:OPEN,scheduledAtMs:OPEN,
      lastClaimedTickId:id,calendarVersion:NSE_FO_CALENDAR_VERSION}).status,'BLOCKED_INVALID_DEDUPE_STATE');
  }
  assert.equal(assessAlarm({observedAtMs:OPEN,scheduledAtMs:OPEN,
    lastClaimedTickId:'2026-10-23:1',calendarVersion:NSE_FO_CALENDAR_VERSION}).status,'BLOCKED_CLOCK_ROLLBACK');
});

test('token route is hard-disabled by default; no signed body accepted or forwarded',async t=>{
  const s=setup(t);configureMarket(s);s.env.READONLY_MARKET_RUNTIME_ENABLED='false';
  assert.equal((await worker.fetch(tokenRequest(s.env),s.env)).status,404);
  assert.equal(await s.storage.get('daily-token-v1'),undefined);
});

test('authenticated daily handoff seals token; replay, rollback, equal-time conflict are rejected',async t=>{
  const s=setup(t); configureMarket(s);
  const nonce='unique-and-very-long-01234567890';
  const req=()=>tokenRequest(s.env,{nonce});
  assert.equal((await worker.fetch(req(),s.env)).status,200);
  const stored=await s.storage.get('daily-token-v1');
  assert.ok(!JSON.stringify(stored).includes(fakeToken));
  assert.equal(stored.schema,1);
  assert.equal((await worker.fetch(req(),s.env)).status,409);
  assert.equal((await worker.fetch(tokenRequest(s.env,{value:fakeToken+'x'}),s.env)).status,409);
  assert.equal((await worker.fetch(tokenRequest(s.env,{now:Date.now()-1000}),s.env)).status,409);
  assert.equal((await worker.fetch(tokenRequest(s.env,{signature:'0'.repeat(64)}),s.env)).status,401);
  assert.equal((await worker.fetch(tokenRequest(s.env,{apiKey:'wrong-key'}),s.env)).status,401);
  assert.equal((await worker.fetch(tokenRequest(s.env,{now:Date.now()-91_000}),s.env)).status,401);
  assert.deepEqual(await s.storage.get('daily-token-v1'),stored);
});

test('synthetic market alarm samples exact allowlisted GET paths; no orders and no secret in status',async t=>{
  const calls=[];
  const mockFetch=async(url,init)=>{
    calls.push({url,init});
    assert.equal(init.method,'GET');
    assert.equal(new URL(url).origin,'https://api.kite.trade');
    assert.equal(init.redirect,'manual');
    if(url.endsWith('/instruments/NFO'))return new Response(
      'instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange\n'+
      '12345,1,NIFTY26OCTFUT,NIFTY,0,2026-10-27,0,0.05,65,FUT,NFO-FUT,NFO\n',
      {headers:{'content-type':'text/csv'}});
    if(url.includes('/quote'))return Response.json({status:'success',data:{
      'NFO:NIFTY26OCTFUT':{instrument_token:12345,last_price:123.4,timestamp:'2026-10-23 09:15:00'}}});
    return Response.json({status:'success',data:{candles:[
      ['2026-10-23T09:15:00+05:30',100,105,97,103,900]]}});
  };
  const s=setup(t, OPEN-60_000,mockFetch);configureMarket(s);
  assert.equal((await worker.fetch(tokenRequest(s.env),s.env)).status,200);
  assert.equal((await s.session.fetch(request())).status,200);
  s.set(OPEN);
  const first=await s.session.alarm();
  assert.equal(first.marketStatus,'HISTORY_OBSERVED');
  assert.equal(calls.length,4);
  assert.ok(calls.every(c=>!c.url.includes('/orders') && c.init.headers.Authorization.includes(fakeToken)));
  const status=await (await s.session.fetch(request('/internal/scheduler',KEY,'GET'))).json();
  assert.equal(status.marketRuntimeEnabled,true);
  assert.equal(status.market.status,'HISTORY_OBSERVED');
  assert.equal(status.market.fiveMinuteCount,1);
  assert.ok(!JSON.stringify(status).includes(fakeToken));
  assert.equal(status.realOrdersEnabled,false);
  assert.equal((await s.session.alarm()).shouldPoll,false);
  assert.equal(calls.length,4);
  s.set(OPEN+20_000);
  assert.equal((await s.session.alarm()).marketStatus,'QUOTE_OBSERVED');
  assert.equal(calls.length,5); // Daily master cached; no repeated history in this window.
});

test('market sampler fails closed for missing/invalid token and HTTP faults without leaking secrets',async t=>{
  const s=setup(t, OPEN-60_000,async()=>{throw new Error('leaked '+fakeToken);});
  configureMarket(s);
  await s.session.fetch(request());s.set(OPEN);
  const missing=await s.session.alarm();
  assert.equal(missing.marketStatus,'BLOCKED_MARKET_DATA');
  assert.equal((await worker.fetch(tokenRequest(s.env),s.env)).status,200);
  s.set(OPEN+20_000);
  const failed=await s.session.alarm();
  assert.equal(failed.marketStatus,'BLOCKED_MARKET_DATA');
  const status=await (await worker.fetch(request('/internal/scheduler',KEY,'GET'),s.env)).text();
  assert.ok(!status.includes(fakeToken));
  assert.ok(!status.includes('leaked'));
  assert.equal((await s.storage.get('scheduler-v1')).totalClaims,2);
});

test('corrupt vault never overwritten and stale exchange quote never becomes observed',async t=>{
  const s=setup(t, OPEN-60_000,async()=>Response.json({status:'success',data:{
    'NFO:NIFTY26OCTFUT':{last_price:123,timestamp:'2026-10-23 09:12:00'}}}));
  configureMarket(s);
  s.storage.data.set('daily-token-v1',{bad:'corrupt'});
  assert.equal((await worker.fetch(tokenRequest(s.env),s.env)).status,409);
  assert.deepEqual(await s.storage.get('daily-token-v1'),{bad:'corrupt'});
  s.storage.data.delete('daily-token-v1');
  assert.equal((await worker.fetch(tokenRequest(s.env),s.env)).status,200);
  await s.session.fetch(request());s.set(OPEN);
  assert.equal((await s.session.alarm()).marketStatus,'BLOCKED_MARKET_DATA');
  const status=await (await s.session.fetch(request('/internal/scheduler',KEY,'GET'))).json();
  assert.equal(status.market.status,'BLOCKED_MARKET_DATA');
  assert.equal(status.market.lastPrice,undefined);
});
