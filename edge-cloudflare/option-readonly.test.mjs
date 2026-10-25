import test from 'node:test';
import assert from 'node:assert/strict';
import { checkQuote } from './paper-ledger.mjs';
import { discoverAtmNiftyOptionPair, normalizeKiteOptionQuote,
  parseKiteQuoteTimestamp, validatePairEvidence } from './option-readonly.mjs';
import { createReadOnlyKite, permittedMarketUrl } from './market-readonly.mjs';

const observedAtMs=Date.parse('2026-10-23T10:30:08+05:30');
const fetchedAtMs=Date.parse('2026-10-23T08:45:00+05:30');
const header='instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange';
const row=(token,symbol,kind,{strike=25100,expiry='2026-10-29',lot=65,name='NIFTY'}={})=>
  [token,token+1,symbol,name,0,expiry,strike,0.05,lot,kind,'NFO-OPT','NFO'].join(',');
const ce='NIFTY26O2925100CE', pe='NIFTY26O2925100PE';
const csv=(...rows)=>[header,...rows,''].join('\n');
const complete=()=>csv(
  row(1001,'NIFTY26O2325100CE','CE',{expiry:'2026-10-23'}),
  row(1002,'NIFTY26O2325100PE','PE',{expiry:'2026-10-23'}),
  row(11_001,ce,'CE',{name:''}),row(11_002,pe,'PE',{name:''}),
  row(11_003,'NIFTY26O2925050CE','CE',{strike:25050}),
  row(11_004,'NIFTY26O2925050PE','PE',{strike:25050}),
  row(12_001,'NIFTY26N0525100CE','CE',{expiry:'2026-11-05'}),
  row(12_002,'NIFTY26N0525100PE','PE',{expiry:'2026-11-05'}));
const pair=()=>discoverAtmNiftyOptionPair(complete(),{
  observedAtMs,masterFetchedAtMs:fetchedAtMs,futuresLastPrice:25105});
const quote=(contract,override={})=>({instrument_token:contract.token,
  timestamp:'2026-10-23 10:30:05',depth:{
    buy:[{price:120,quantity:130,orders:2}],
    sell:[{price:121,quantity:130,orders:2}]},...override});

test('same-day official NFO master chooses nearest complete non-expiry-day ATM pair',()=>{
  const result=pair();
  assert.equal(result.expiry,'2026-10-29');
  assert.equal(result.strike,25100);
  assert.equal(result.CE.token,11_001);
  assert.equal(result.PE.token,11_002);
  assert.equal(result.CE.lotSize,65);
  assert.equal(result.PE.symbol,pe);
  assert.equal(result.CE.kind,'CE');
  assert.ok(Object.isFrozen(result.CE));
});

test('master date or clock drift, malformed schema, closed session and incomplete pairs fail closed',()=>{
  const args={observedAtMs,masterFetchedAtMs:fetchedAtMs,futuresLastPrice:25105};
  const rejects=(value,options=args)=>assert.throws(()=>discoverAtmNiftyOptionPair(value,options),
    /NIFTY_OPTION_READONLY_/);
  rejects(complete(),{...args,masterFetchedAtMs:observedAtMs+1000});
  rejects(complete(),{...args,masterFetchedAtMs:observedAtMs-86_400_000});
  rejects(complete(),{...args,observedAtMs:Date.parse('2026-10-24T10:30:08+05:30')});
  rejects('hello');
  rejects(csv(row(11_001,ce,'CE')));
  rejects(csv(row(11_001,ce,'CE'),row(11_002,pe,'PE')),{...args,futuresLastPrice:22000});
  rejects(csv(row(11_001,ce,'CE'),row(11_002,pe,'PE',{lot:75})));
  rejects(csv(row(11_001,ce,'CE'),row(11_001,pe,'PE')));
  rejects(csv(row(11_001,ce,'CE'),row(11_002,pe,'PE'),row(11_003,ce,'CE')));
  rejects(csv(row(11_001,ce,'CE',{expiry:'2026-10-23'}),
    row(11_002,pe,'PE',{expiry:'2026-10-23'})));
  rejects(csv(row(11_001,ce,'CE',{expiry:'2026-13-29'}),row(11_002,pe,'PE')));
  rejects(csv(row(11_001,ce,'CE',{lot:-1}),row(11_002,pe,'PE')));
  rejects(csv(row(11_001,ce,'CE'),row(11_002,pe,'PE')).replace('NFO-OPT','NFO,OPT'));
});

test('IST quote timestamp is explicit; nonsense calendar times are rejected',()=>{
  assert.equal(parseKiteQuoteTimestamp('2026-10-23 10:30:05'),
    Date.parse('2026-10-23T10:30:05+05:30'));
  assert.equal(parseKiteQuoteTimestamp('2026-10-23T10:30:05+0530'),
    Date.parse('2026-10-23T10:30:05+05:30'));
  assert.ok(Number.isNaN(parseKiteQuoteTimestamp('2026-02-30 10:30:05')));
  assert.ok(Number.isNaN(parseKiteQuoteTimestamp('2026-10-23 25:30:05')));
  assert.ok(Number.isNaN(parseKiteQuoteTimestamp('2026-10-23T10:30:05')));
});

test('valid paired executable bid/ask has checkQuote compatibility but authorizes nothing',()=>{
  const selected=pair();
  const evidence=validatePairEvidence({pair:selected,observedAtMs,
    quotes:{CE:quote(selected.CE),PE:quote(selected.PE)}});
  assert.equal(evidence.source,'READONLY_OPTION_EVIDENCE_ONLY');
  assert.equal(evidence.paperEntryAuthorized,false);
  assert.equal(evidence.telegramAuthorized,false);
  assert.equal(evidence.realOrdersEnabled,false);
  assert.equal(evidence.CE.ask,121);
  assert.equal(evidence.PE.bid,120);
  assert.equal(evidence.CE.contract.strike,25100);
  assert.equal(checkQuote(evidence.CE,observedAtMs).ask,12_100);
  assert.equal(checkQuote(evidence.PE,observedAtMs).bid,12_000);
});

test('reject stale/future/wrong token, bad spread, missing bid/ask and shallow depth',()=>{
  const selected=pair(), c=selected.CE;
  const invalid=[
    quote(c,{instrument_token:123}),
    quote(c,{timestamp:'2026-10-23 10:29:30'}),
    quote(c,{timestamp:'2026-10-23 10:30:12'}),
    quote(c,{timestamp:'2026-10-22 10:30:05'}),
    quote(c,{depth:{buy:[],sell:[{price:121,quantity:130}]}}),
    quote(c,{depth:{buy:[{price:120,quantity:130}],sell:[]}}),
    quote(c,{depth:{buy:[{price:120,quantity:130}],sell:[{price:150,quantity:130}]}}),
    quote(c,{depth:{buy:[{price:120,quantity:1}],sell:[{price:121,quantity:130}]}}),
    quote(c,{depth:{buy:[{price:120,quantity:130}],sell:[{price:121,quantity:0}]}}),
    quote(c,{depth:{buy:[{price:120,quantity:130}],sell:[{price:120,quantity:130}]}}),
  ];
  for(const suspect of invalid) {
    assert.throws(()=>normalizeKiteOptionQuote(suspect,c,observedAtMs),
      /NIFTY_OPTION_READONLY_/);
    assert.throws(()=>validatePairEvidence({pair:selected,observedAtMs,
      quotes:{CE:suspect,PE:quote(selected.PE)}}),/NIFTY_OPTION_READONLY_/);
  }
});

test('allowlist accepts CE+PE pair and blocks bulk, malformed pair and trading routes',()=>{
  const root='https://api.kite.trade/quote?i=';
  const ceKey='NFO:'+ce, peKey='NFO:'+pe;
  assert.equal(permittedMarketUrl(root+encodeURIComponent(ceKey)+
    '&i='+encodeURIComponent(peKey)),true);
  const basket=root+[ceKey,peKey,'NFO:NIFTY26O2925150CE','NFO:NIFTY26O2925200PE']
    .map(encodeURIComponent).join('&i=');
  assert.equal(permittedMarketUrl(basket),true);
  assert.equal(permittedMarketUrl(basket+'&i=NFO%3ANIFTY26O2925250CE'),false);
  for(const url of [root+encodeURIComponent(ceKey)+'&i='+encodeURIComponent(ceKey),
    root+encodeURIComponent(ceKey)+'&i=NFO%3AOTHER',
    root+encodeURIComponent(ceKey)+'&i='+encodeURIComponent(peKey)+'&a=1',
    'https://api.kite.trade/orders',
    'https://api.kite.trade/quote?i=NSE%3AINFY'])
    assert.equal(permittedMarketUrl(url),false,url);
});

test('pair GET uses precisely two option instruments and a single quote call per client',async()=>{
  const calls=[];
  const client=createReadOnlyKite({apiKey:'SYNTHETIC-KEY',accessToken:'SYNTHETIC-ACCESS',
    fetchImpl:async(url,init)=>{
      calls.push({url,init});
      return new Response(JSON.stringify({status:'success',data:{
        ['NFO:'+ce]:quote(pair().CE),['NFO:'+pe]:quote(pair().PE)}}),
      {headers:{'content-type':'application/json'}});
    }});
  const result=await client.optionPair(ce,pe);
  assert.equal(result.CE.instrument_token,11_001);
  assert.equal(result.PE.instrument_token,11_002);
  assert.equal(calls.length,1);
  assert.equal(calls[0].init.method,'GET');
  assert.equal(calls[0].init.redirect,'manual');
  assert.equal(calls[0].init.credentials,'omit');
  await assert.rejects(client.optionPair(ce,pe),/QUOTE_RATE_GUARD/);
  assert.equal(calls.length,1);
  await assert.rejects(client.optionPair(ce,'INFY26O2925100PE'));
});

test('bounded entry/held-option batch preserves missing legs and rejects unsafe plans before network',async()=>{
  const symbols=[ce,pe,'NIFTY26O2925150CE','NIFTY26O2925200PE'];
  let calls=0;
  const client=createReadOnlyKite({apiKey:'SYNTHETIC-KEY',accessToken:'SYNTHETIC-ACCESS',
    fetchImpl:async(url,init)=>{
      calls++;assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');
      assert.deepEqual(new URL(url).searchParams.getAll('i'),symbols.map(s=>'NFO:'+s));
      return Response.json({status:'success',data:{['NFO:'+ce]:{instrument_token:123}}});
    }});
  for(const invalid of [[ce],[ce,ce],['NIFTY26OCTFUT',pe],symbols.concat('NIFTY26O2925250CE'),
    [ce,'NIFTY26O2925150CE'],['https://evil.invalid/orders',pe]])
    await assert.rejects(client.optionContracts(invalid));
  assert.equal(calls,0);
  const result=await client.optionContracts(symbols);
  assert.equal(result['NFO:'+pe],undefined);assert.equal(result['NFO:'+ce].instrument_token,123);
  assert.equal(calls,1);
});

test('auth expiry, rate limit, missing leg and injected credentials are not leaked',async()=>{
  const token='SYNTHETIC-SECRET-67890';
  for(const [status,expected] of [[403,'AUTH_EXPIRED'],[429,'RATE_LIMITED']]) {
    const client=createReadOnlyKite({apiKey:'SYNTHETIC-KEY',accessToken:token,
      fetchImpl:async()=>new Response(token,{status})});
    await assert.rejects(client.optionPair(ce,pe),err=>
      err.message.includes(expected) && !err.message.includes(token));
  }
  const client=createReadOnlyKite({apiKey:'SYNTHETIC-KEY',accessToken:token,
    fetchImpl:async()=>new Response(JSON.stringify({status:'success',data:{
      ['NFO:'+ce]:quote(pair().CE)}}),
      {headers:{'content-type':'application/json'}})});
  await assert.rejects(client.optionPair(ce,pe),err=>
    err.message.includes('OPTION_PAIR_MISSING') && !err.message.includes(token));
});
