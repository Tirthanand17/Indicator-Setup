import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decide } from './decision-core.mjs';

const fixtures = JSON.parse(readFileSync(new URL('./decision-parity-fixtures.json', import.meta.url), 'utf8'));

for (const c of fixtures.cases) {
  test(`Python decision parity: ${c.name}`, () => {
    const actual = decide(c.candles, c.nowMs, c.confirm15m,
      { adxMin: c.adxMin, atrBuffer: c.atrBuffer });
    const { expected } = c;
    assert.equal(actual.status, expected.status);
    assert.equal(actual.reason, expected.reason);
    assert.deepEqual(actual.candle, expected.candle);
    if (expected.indicators) {
      assert.ok(actual.indicators);
      for (const [name, value] of Object.entries(expected.indicators)) {
        assert.ok(Math.abs(actual.indicators[name] - value) < 1e-8,
          `${name} expected ${value}; received ${actual.indicators[name]}`);
      }
    } else assert.equal(actual.indicators, null);
    for (const k of ['stop_underlying', 'target_underlying']) {
      if (expected[k] === null) assert.equal(actual[k], null);
      else assert.ok(Math.abs(actual[k] - expected[k]) < 1e-8, `${k} differs`);
    }
    assert.ok(!('order' in actual));
  });
}

test('unknown calendar, malformed clocks and corrupt histories fail closed', () => {
  const c = fixtures.cases.find(c => c.expected.status === 'REVIEW_PE');
  assert.ok(c);
  assert.equal(decide(c.candles, NaN, c.confirm15m).status, 'WAIT_DATA');
  assert.equal(decide(c.candles, undefined, c.confirm15m).status, 'WAIT_DATA');
  assert.equal(decide(c.candles, Date.parse('2027-10-23T05:15:20Z'), c.confirm15m).status, 'WAIT_DATA');
  const malformed = structuredClone(c.candles);
  malformed[0].close = Infinity;
  assert.equal(decide(malformed, c.nowMs, c.confirm15m).status, 'WAIT_DATA');
  const invalidTime = structuredClone(c.confirm15m);
  invalidTime.at(-1).startMs = 3.4;
  assert.equal(decide(c.candles, c.nowMs, invalidTime).status, 'WAIT_DATA');
  assert.equal(decide(c.candles, c.nowMs, c.confirm15m, {adxMin:NaN}).status, 'WAIT_DATA');
});
