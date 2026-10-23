import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compute,estimateLeg } from './strategy-core.mjs';
const fixtures=JSON.parse(readFileSync(new URL('./parity-fixtures.json',import.meta.url),'utf8'));

for(const fixture of fixtures.indicators) test('Python indicator parity direction '+fixture.name,()=>{
  const actual=compute(fixture.candles);
  for(const [key,value] of Object.entries(fixture.expected)) {
    assert.ok(Math.abs(actual[key]-value)<1e-8,`${key}: ${actual[key]} != ${value}`);
  }
});
test('36 Python fee cases agree exactly in integer paise',()=>{
  for(const c of fixtures.fees) assert.deepEqual(estimateLeg(c.price,c.qty,c.side,c.onDate),c.expected);
});
test('malformed indicators and fee inputs fail closed',()=>{
  assert.throws(()=>compute([]));
  const bars=structuredClone(fixtures.indicators[0].candles);bars.at(-1).volume=NaN;
  assert.throws(()=>compute(bars));
  assert.throws(()=>estimateLeg('NaN',65,'BUY','2026-10-23'));
  assert.throws(()=>estimateLeg('100',true,'BUY','2026-10-23'));
  assert.throws(()=>estimateLeg('100',65,'BUY','2026-02-30'));
});
