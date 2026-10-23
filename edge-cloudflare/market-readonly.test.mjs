import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadOnlyKite,permittedMarketUrl} from './market-readonly.mjs';

const apiKey='SYNTHETIC-KEY', accessToken='SYNTHETIC-ACCESS-NEVER-LIVE-0123456789';
const candles=[['2026-10-23T09:15:00+05:30',100,104,98,103,900]];
const json = data => new Response(JSON.stringify({status:'success',data}),
  {status:200,headers:{'content-type':'application/json'}});
const future='NIFTY26OCTFUT';
const historyUrl = 'https://api.kite.trade/instruments/historical/123/5minute?from=2026-10-23+09%3A15%3A00&to=2026-10-23+09%3A30%3A00&continuous=0&oi=0';

test('final boundary approves only official exact market-data URLs', () => {
  for(const url of ['https://api.kite.trade/instruments/NFO',
    'https://api.kite.trade/quote?i=NFO%3ANIFTY26OCTFUT',historyUrl])
    assert.equal(permittedMarketUrl(url),true,url);
  for(const url of ['http://api.kite.trade/quote?i=NFO:NIFTY26OCTFUT',
    'https://evil.invalid/quote?i=NFO:NIFTY26OCTFUT',
    'https://api.kite.trade.evil.invalid/quote?i=NFO:NIFTY26OCTFUT',
    'https://api.kite.trade/orders', 'https://api.kite.trade/positions',
    'https://api.kite.trade/quote?i=NFO:NIFTY26OCTFUT&i=NFO:NIFTY26OCTFUT',
    'https://api.kite.trade/quote?i=NSE:INFY',
    'https://api.kite.trade@evil.invalid/instruments/NFO',
    'https://api.kite.trade/instruments/NFO#fragment',
    'https://api.kite.trade/instruments/NFO?foo=bar',
    'https://api.kite.trade/instruments/historical/abc/5minute'])
    assert.equal(permittedMarketUrl(url),false,url);
});

test('synthetic read-only quote and both candle intervals use GET, no redirects, no cookies', async () => {
  const calls=[];
  const client=createReadOnlyKite({apiKey,accessToken,fetchImpl:async (url,init) => {
    calls.push({url,init});
    assert.equal(init.method,'GET'); assert.equal(init.redirect,'error');
    assert.equal(init.credentials,'omit'); assert.equal(init.cache,'no-store');
    assert.equal(init.headers.Authorization,`token ${apiKey}:${accessToken}`);
    if(url.includes('/quote?')) return json({['NFO:'+future]:{last_price:123.4,depth:{buy:[]}}});
    return json({candles});
  }});
  assert.equal((await client.quote(future)).last_price,123.4);
  for(const interval of ['5minute','15minute'])
    assert.deepEqual(await client.history(123,interval,'2026-10-23 09:15:00','2026-10-23 09:30:00'),candles);
  assert.equal(calls.length,3);
  assert.ok(calls.every(c=>permittedMarketUrl(c.url)));
});

test('CSV endpoint remains bounded and never executes non-GET transaction routes', async () => {
  const client=createReadOnlyKite({apiKey,accessToken,fetchImpl:async()=>
    new Response('instrument_token,tradingsymbol\n123,NIFTY26OCTFUT\n',
      {headers:{'content-type':'text/csv'}})});
  assert.ok((await client.instrumentsNfoCsv()).includes('NIFTY26OCTFUT'));
  await assert.rejects(client.quote('NIFTY/../orders'),/Invalid NIFTY/);
  await assert.rejects(client.history(0,'5minute','2026-10-23 09:15:00','2026-10-23 09:30:00'));
  await assert.rejects(client.history(123,'1minute','2026-10-23 09:15:00','2026-10-23 09:30:00'));
});

test('read-only transport redacts thrown credentials; rejects redirect, oversized and malformed responses', async () => {
  const scenarios=[
    async()=>{throw Error('synthetic secret '+accessToken);},
    async()=>new Response('moved',{status:302,headers:{location:'https://api.kite.trade/orders'}}),
    async()=>new Response('x'.repeat(512*1024+1),{headers:{'content-type':'application/json'}}),
    async()=>json({['NFO:'+future]:{last_price:-1}}),
    async()=>new Response('{"status":"error","message":"'+accessToken+'"}',{headers:{'content-type':'application/json'}}),
  ];
  for(const fetchImpl of scenarios) {
    const client=createReadOnlyKite({apiKey,accessToken,fetchImpl});
    await assert.rejects(client.quote(future),err => !String(err).includes(accessToken));
  }
});

test('reject malformed OHLC, no timestamps, impossible ranges and unusual credentials',async()=>{
  const client=createReadOnlyKite({apiKey,accessToken,fetchImpl:async()=>json({candles:[
    ['2026-10-23T09:15:00+05:30',100,95,98,101,1]]})});
  await assert.rejects(client.history(123,'5minute','2026-10-23 09:15:00','2026-10-23 09:30:00'));
  await assert.rejects(client.history(123,'5minute','2026-10-23 10:00:00','2026-10-23 09:30:00'));
  assert.throws(()=>createReadOnlyKite({apiKey:'key\r\nORDER',accessToken}));
});
