import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluatePremiumBid, virtualPremiumExit, underlyingExit, decidePaperExit,
  referenceFromQuote, parsePremiumReference } from './exit-core.mjs';

const fixtures = JSON.parse(readFileSync(new URL('./exit-parity-fixtures.json', import.meta.url), 'utf8'));

for (const r of fixtures.references) {
  test(`Python hypothetical reference parity: ASK ${r.quote.ask}`, () => {
    const actual=referenceFromQuote(r.quote,{futuresSymbol:r.futuresSymbol,
      signalCandleMs:r.signalCandleMs,createdAtMs:r.createdAtMs});
    assert.deepEqual(actual,r.expected);
    assert.deepEqual(parsePremiumReference(JSON.stringify(actual),r.createdAtMs),r.expected);
  });
}

test('corrupt or overnight premium references are refused', () => {
  const c=fixtures.references[0], original=c.expected;
  assert.equal(parsePremiumReference({...original,paper_only:false},c.createdAtMs),null);
  assert.equal(parsePremiumReference({...original,stop_bid:original.reference_ask},c.createdAtMs),null);
  assert.equal(parsePremiumReference({...original,option_expiry:'2026-02-30'},c.createdAtMs),null);
  assert.equal(parsePremiumReference(original,c.createdAtMs+24*3600000),null);
  assert.throws(() => referenceFromQuote(null,{createdAtMs:c.createdAtMs}));
});

for (const item of fixtures.premium) {
  test(`Python option premium BID rule: ${item.name}`, () => {
    assert.equal(evaluatePremiumBid(item.reference, item.quote, item.nowMs), item.expected);
    assert.equal(virtualPremiumExit(item.reference, item.quote, item.nowMs), item.expected);
  });
}

for (const item of fixtures.paper) {
  test(`Python paper position exit: ${item.name}`, () => {
    assert.deepEqual(decidePaperExit(item.position, item.quote, item.nowMs), item.expected);
  });
}

test('no quote means no imaginary BID, credit, or trade outcome', () => {
  const p=fixtures.premium[0];
  assert.equal(virtualPremiumExit(p.reference, null, p.nowMs), 'WAIT_FRESH_PREMIUM_QUOTE');
  assert.equal(virtualPremiumExit(p.reference, null, Date.parse('2026-10-23T09:45:00Z')), 'TIME');
  assert.equal(virtualPremiumExit(p.reference, null, Date.parse('2026-10-24T05:00:00Z')), 'WAIT_SESSION');
  const sample=fixtures.paper[0];
  assert.throws(() => decidePaperExit(sample.position, null, sample.nowMs));
  const stale=structuredClone(sample.quote);
  stale.updatedMs-=60_000;
  assert.throws(() => decidePaperExit(sample.position, stale, sample.nowMs), /stale option quote/);
  const mismatched=structuredClone(sample.quote);
  mismatched.contract.symbol='NIFTYWRONGCE';
  assert.throws(() => decidePaperExit(sample.position, mismatched, sample.nowMs), /option mismatch/);
  const quoteBeforeEntry=structuredClone(sample.quote);
  quoteBeforeEntry.updatedMs=Date.parse(sample.position.entry_quote_at)-1000;
  assert.throws(() => evaluatePremiumBid(p.reference, quoteBeforeEntry, p.nowMs), /option mismatch|quote predates/);
});

test('underlying futures exit is risk-first with overlapping intrabar levels', () => {
  const stamp='2026-10-23T10:00:00+05:30';
  const base={signal_candle:stamp, direction:'CE', stop:100, target:110};
  const candle={startMs:Date.parse('2026-10-23T10:05:00+05:30'), high:111, low:99};
  const clock=Date.parse('2026-10-23T10:10:00+05:30');
  assert.equal(underlyingExit(base,candle,clock),'INTRABAR_STOP_TARGET_AMBIGUOUS_RISK_FIRST');
  assert.equal(underlyingExit({...base,direction:'PE',stop:110,target:100},candle,clock),
    'INTRABAR_STOP_TARGET_AMBIGUOUS_RISK_FIRST');
  assert.equal(underlyingExit(base,{...candle,low:101},clock),'TARGET');
  assert.equal(underlyingExit(base,{...candle,high:109},clock),'STOP');
  assert.equal(underlyingExit(base,{...candle,high:109,low:101},clock),null);
  assert.equal(underlyingExit(base,{...candle,high:109,low:101},Date.parse('2026-10-23T15:16:00+05:30')),'TIME');
});
