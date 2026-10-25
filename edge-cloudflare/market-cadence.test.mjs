import test from 'node:test';
import assert from 'node:assert/strict';
import {currentMarketTick,marketTrafficPlan} from './market-cadence.mjs';
import {reserveQuoteRequest,recordQuoteCompletion,recordQuoteFailure} from './option-runtime.mjs';
import {createReadOnlyKite,permittedMarketUrl} from './market-readonly.mjs';

const open=Date.parse('2026-10-23T09:15:00+05:30');
test('twenty-second windows skip delayed ticks and the traffic plan includes all instruments',()=>{
  assert.equal(currentMarketTick('2026-10-23:0',open),true);
  assert.equal(currentMarketTick('2026-10-23:0',open+19_999),true);
  for(const time of [open-1,open+20_000,NaN])assert.equal(currentMarketTick('2026-10-23:0',time),false);
  assert.equal(currentMarketTick('2026-10-24:0',open),false);
  const p=marketTrafficPlan('2026-10-23');
  assert.equal(p.maximumQuoteRequests,1125);assert.equal(p.maximumInstrumentObservations,5625);
  assert.equal(p.maximumHistoryRequests,150);assert.equal(p.cloudTimingVerified,false);
  assert.equal(marketTrafficPlan('2026-10-24').maximumQuoteRequests,0);
  assert.throws(()=>marketTrafficPlan('2027-01-04'));
});

test('completion pacing refuses a next-slot burst after a slow quote and preserves 429 cooldown',()=>{
  const claim=reserveQuoteRequest(undefined,{tickId:'2026-10-23:0',observedAtMs:open,kind:'MARKET_BATCH'});
  const done=recordQuoteCompletion(claim.state,{tickId:'2026-10-23:0',observedAtMs:open+19_500});
  assert.equal(reserveQuoteRequest(done,{tickId:'2026-10-23:1',observedAtMs:open+20_000,kind:'MARKET_BATCH'}).allowed,false);
  assert.equal(reserveQuoteRequest(done,{tickId:'2026-10-23:2',observedAtMs:open+40_000,kind:'MARKET_BATCH'}).allowed,true);
  const rate=recordQuoteFailure(claim.state,{tickId:'2026-10-23:0',observedAtMs:open+200,errorCode:'RATE_LIMITED'});
  const completed=recordQuoteCompletion(rate,{tickId:'2026-10-23:0',observedAtMs:open+300});
  assert.equal(completed.blockedUntilMs,rate.blockedUntilMs);
  assert.throws(()=>recordQuoteCompletion(done,{tickId:'2026-10-23:1',observedAtMs:open+2000}));
});

test('one quote request admits only a single NIFTY future and up to four option legs',async()=>{
  const symbols=['NIFTY26OCTFUT','NIFTY26O2922050CE','NIFTY26O2922050PE','NIFTY26O2922550CE','NIFTY26O2922550PE'];
  const url=values=>'https://api.kite.trade/quote?'+values.map(s=>'i='+encodeURIComponent('NFO:'+s)).join('&');
  assert.equal(permittedMarketUrl(url(symbols)),true);
  for(const invalid of [[...symbols,'NIFTY26O2922600CE'],['NIFTY26OCTFUT','NIFTY26NOVFUT',...symbols.slice(1,3)],
    ['NIFTY26OCTFUT',symbols[1]],['NIFTY26OCTFUT','OTHER',symbols[2]],symbols.concat(symbols[1])])
    assert.equal(permittedMarketUrl(url(invalid)),false);
  let calls=0;
  const client=createReadOnlyKite({apiKey:'SYNTHETIC-KEY',accessToken:'SYNTHETIC-TOKEN',fetchImpl:async(u,options)=>{
    calls++;assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');
    assert.deepEqual(new URL(u).searchParams.getAll('i'),symbols.map(s=>'NFO:'+s));
    return Response.json({status:'success',data:{}});
  }});
  await client.marketSnapshot(symbols[0],symbols.slice(1));assert.equal(calls,1);
  await assert.rejects(client.marketSnapshot(symbols[0],symbols.slice(1)),/RATE_GUARD/);
  await assert.rejects(client.marketSnapshot('NIFTY/../orders',[]));
  await assert.rejects(client.marketSnapshot(symbols[0],[...symbols.slice(1),symbols[1]]));
});
