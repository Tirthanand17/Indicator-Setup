import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reviewReadOnlyMarket, READONLY_REVIEW_SOURCE } from './market-review.mjs';

const cases = JSON.parse(readFileSync(new URL('./decision-parity-fixtures.json',import.meta.url),
  'utf8')).cases;
const fixture = name => cases.find(c => c.name === name);
const kiteTime = ms => new Date(ms + 330 * 60_000).toISOString().replace('.000Z','+0530');
const rows = bars => bars.map(c => [kiteTime(c.startMs),
  c.open, c.high, c.low, c.close, c.volume]);
function evidence(c) {
  return { tickId: '2026-10-23:271', observedAtMs: c.nowMs,
    strategyConfig: { adxMin:c.adxMin, atrBuffer:c.atrBuffer },
    futures: { symbol: 'NFO:NIFTY26OCTFUT', instrumentToken: 12345,
      exchangeAtMs: c.nowMs - 1000, lastPrice: c.candles.at(-1).close },
    candles5: rows(c.candles), candles15: rows(c.confirm15m) };
}

test('real broker-shaped completed candles inherit independently tested CE/PE/no-trade decisions',()=>{
  for (const [name,expected] of [
    ['downtrend_qualifying_review','REVIEW_PE'],
    ['uptrend_mirrored_qualifying_review','REVIEW_CE'],
    ['sideways','NO_TRADE'],
  ]) {
    const result=reviewReadOnlyMarket(evidence(fixture(name)));
    assert.equal(result.status,expected,name);
    assert.equal(result.source,READONLY_REVIEW_SOURCE);
    assert.equal(result.paperEntryAuthorized,false);
    assert.equal(result.telegramAuthorized,false);
    assert.equal(result.realOrdersEnabled,false);
    assert.deepEqual(Object.keys(result).sort(),[
      'fifteenMinuteCandleAtMs','fiveMinuteCandleAtMs','paperEntryAuthorized',
      'realOrdersEnabled','reason','source','status','telegramAuthorized'].sort());
    assert.ok(!JSON.stringify(result).includes('NIFTY26OCTFUT'));
  }
});

test('stale futures, wrong instrument, unsupported day and off-slot response fail closed',()=>{
  const c=fixture('downtrend_qualifying_review');
  const good=evidence(c);
  for(const change of [
    {futures:{...good.futures,exchangeAtMs:good.observedAtMs-61_000}},
    {futures:{...good.futures,symbol:'NFO:OTHERFUT'}},
    {futures:{...good.futures,exchangeAtMs:good.observedAtMs+4_000}},
    {tickId:'2026-10-24:271'},
    {tickId:'2027-10-23:271'},
    {observedAtMs:good.observedAtMs-21_000},
    {observedAtMs:good.observedAtMs+20_000},
  ]) {
    assert.equal(reviewReadOnlyMarket({...good,...change}).status,'WAIT_DATA');
  }
});

test('never use uncompleted 5m/15m bars to form a candidate',()=>{
  const good=evidence(fixture('downtrend_qualifying_review'));
  const fiveIncomplete=[...good.candles5,[kiteTime(good.observedAtMs-19_000),
    2,3,1,2,500]];
  const fifteenIncomplete=[...good.candles15,[new Date(good.observedAtMs-20_000).toISOString(),
    2,3,1,2,500]];
  // The one-second-shifted bar is rejected even when its timestamp is recent.
  assert.equal(reviewReadOnlyMarket({...good,candles5:fiveIncomplete}).status,'WAIT_DATA');
  // A properly aligned 15m current candle is ignored until 15m+8s.
  const current15Start = Date.parse('2026-10-23T10:45:00+05:30');
  const current15 = [...good.candles15,
    [kiteTime(current15Start),1,2,1,2,500]];
  assert.equal(reviewReadOnlyMarket({...good,candles15:current15}).status,'REVIEW_PE');
  const next5Start = Date.parse('2026-10-23T10:45:00+05:30');
  const current5 = [...good.candles5,
    [kiteTime(next5Start),1,2,1,2,500]];
  assert.equal(reviewReadOnlyMarket({...good,candles5:current5}).status,'REVIEW_PE');
  // Completed bar withheld until the source freshness margin has passed.
  assert.equal(reviewReadOnlyMarket({...good,tickId:'2026-10-23:270',
    observedAtMs:good.observedAtMs-20_000,
    futures:{...good.futures,exchangeAtMs:good.observedAtMs-21_000}}).status,
    'WAIT_DATA');
});

test('reject gaps, duplicates, invalid OHLC and future lookahead without outputting values',()=>{
  const good=evidence(fixture('uptrend_mirrored_qualifying_review'));
  const variants=[
    {candles5:[...good.candles5].reverse()},
    {candles5:[...good.candles5,good.candles5.at(-1)]},
    {candles5:good.candles5.map((bar,i)=>i===50?
      [bar[0],bar[1],bar[1]-1,bar[3],bar[4],bar[5]]:bar)},
    {candles15:good.candles15.map((bar,i)=>i===30?
      ['2026-10-23T10:15:30+05:30',...bar.slice(1)]:bar)},
    {candles15:good.candles15.map((bar,i)=>i===30?
      [bar[0],bar[1],bar[2],bar[3],bar[4],0]:bar)},
    {candles15:[...good.candles15,[kiteTime(good.observedAtMs+1000),1,2,1,2,1]]},
    {candles5:Array(401).fill(good.candles5[0])},
  ];
  for(const variant of variants) {
    const result=reviewReadOnlyMarket({...good,...variant});
    assert.equal(result.status,'WAIT_DATA');
    assert.equal(result.paperEntryAuthorized,false);
    assert.equal(result.telegramAuthorized,false);
  }
});

test('future price mismatch cannot use a valid review as paper entry evidence',()=>{
  const good=evidence(fixture('downtrend_qualifying_review'));
  const result=reviewReadOnlyMarket({...good,
    futures:{...good.futures,lastPrice:good.futures.lastPrice*1.09}});
  assert.equal(result.status,'WAIT_DATA');
  assert.equal(result.reason,'FUTURES_CANDLE_PRICE_MISMATCH');
});
