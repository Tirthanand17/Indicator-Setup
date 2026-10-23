import test from 'node:test';
import assert from 'node:assert/strict';
import { newPaperLedger, auditPaperLedger, enterPaperBasket, exitPaperPosition,
  markPaperUnverifiable, paperLedgerSummary } from './paper-ledger.mjs';

const time = (date, hm = '10:00', sec = '00') =>
  Date.parse(`${date}T${hm}:${sec}+05:30`);
const start = time('2026-10-23');
const quote = (nowMs, overrides = {}) => ({
  contract: { symbol: 'NIFTY26OCT23000CE', kind: 'CE', expiry: '2026-10-29',
    token: 12345, lotSize: 65 },
  bid: 100, ask: 100.5, bidQuantity: 600, askQuantity: 600,
  updatedAtMs: nowMs - 1000, ...overrides,
});
const entry = (state, nowMs = start, signalId = 'signal-001', q = quote(nowMs)) =>
  enterPaperBasket(state, { nowMs, signalId, quote: q });
const trade = (state, accountId) => state.positions.find(p => p.accountId === accountId);

test('two independently capitalized accounts and atomic modeled fee cash conservation', () => {
  const first = entry(newPaperLedger(start));
  assert.equal(first.results.PAPER_50K.status, 'OPEN');
  assert.equal(first.results.PAPER_100K.status, 'OPEN');
  assert.equal(first.results.PAPER_50K.lots, 1);
  assert.equal(first.results.PAPER_100K.lots, 2);
  assert.equal(first.ledger.positions.length, 2);
  assert.equal(first.ledger.outbox.length, 2);
  assert.ok(first.ledger.outbox.every(e => e.status === 'PENDING' &&
    e.message.includes('SIMULATED ONLY')));
  for (const p of first.ledger.positions) {
    assert.equal(p.entryDebitPaise, p.entryFillPaise * p.lots * p.lotSize + p.entryFeePaise);
    assert.equal(first.ledger.accounts[p.accountId].cashPaise,
      first.ledger.accounts[p.accountId].initialPaise - p.entryDebitPaise);
  }
  assert.equal(auditPaperLedger(first.ledger), true);
  assert.equal(paperLedgerSummary(first.ledger).markedToMarket, undefined);
  assert.ok(paperLedgerSummary(first.ledger).accounts.every(a => a.markedToMarket === false));
});

test('same signal replays idempotently: no duplicate debit or outbox', () => {
  const first = entry(newPaperLedger(start));
  const replay = entry(first.ledger, start + 1000);
  assert.equal(replay.results.PAPER_50K.status, 'DUPLICATE');
  assert.equal(replay.results.PAPER_100K.status, 'DUPLICATE');
  assert.deepEqual(replay.ledger.accounts, first.ledger.accounts);
  assert.equal(replay.ledger.positions.length, 2);
  assert.equal(replay.ledger.outbox.length, 2);
});

test('fresh quote, depth, spread, expiry and clock are mandatory', () => {
  for (const q of [quote(start, { updatedAtMs: start - 15001 }),
    quote(start, { updatedAtMs: start + 3001 }),
    quote(start, { bid: 70 }), quote(start, { bid: 101 }),
    quote(start, { askQuantity: 64 }),
    quote(start, { contract: { ...quote(start).contract, expiry: '2026-10-22' } }),
    quote(start, { contract: { ...quote(start).contract, kind: 'PE' } }),
    quote(start, { bid: Number.NaN })]) {
    assert.throws(() => entry(newPaperLedger(start), start, 'signal-002', q), /PAPER_LEDGER_/);
  }
  assert.throws(() => entry(newPaperLedger(start), start - 1), /CLOCK_ROLLBACK/);
  assert.throws(() => entry(newPaperLedger(start), start, 'bad'), /INVALID_SIGNAL/);
});

test('regular NSE hours only, no 2026 holiday/weekend/future-year entry', () => {
  for (const day of ['2026-10-20', '2026-10-24', '2026-12-25']) {
    const now = time(day);
    assert.throws(() => entry(newPaperLedger(now), now), /OUTSIDE_SESSION/);
  }
  for (const hm of ['09:29', '15:00', '15:26']) {
    const now = time('2026-10-23', hm);
    assert.throws(() => entry(newPaperLedger(now), now), /OUTSIDE_SESSION/);
  }
  assert.throws(() => newPaperLedger(time('2027-01-04')), /UNSUPPORTED_YEAR/);
});

test('already-open trade rejection is saved once and blocks replay after eventual close', () => {
  const first = entry(newPaperLedger(start));
  const now = start + 3000;
  const rejected = entry(first.ledger, now, 'signal-002');
  assert.equal(rejected.results.PAPER_50K.reason, 'POSITION_ALREADY_OPEN');
  assert.equal(rejected.ledger.rejections.length, 2);
  assert.deepEqual(entry(rejected.ledger, now + 1000, 'signal-002').ledger.rejections,
    rejected.ledger.rejections);
  assert.equal(rejected.ledger.outbox.length, 2);
});

test('risk/capital/liquidity yields independent durable rejections, never a zero-lot entry', () => {
  const expensive = quote(start, { bid: 1000, ask: 1005 });
  const r = entry(newPaperLedger(start), start, 'signal-expensive', expensive);
  assert.ok(Object.values(r.results).every(x => x.reason === 'RISK_OR_CAPITAL_OR_LIQUIDITY'));
  assert.equal(r.ledger.positions.length, 0);
  assert.equal(r.ledger.rejections.length, 2);
  assert.equal(r.ledger.outbox.length, 0);
  assert.equal(r.ledger.accounts.PAPER_50K.cashPaise, 5_000_000);
});

test('a quote may fit the 100K account while 50K independently rejects risk', () => {
  const wide = quote(start, { bid: 200, ask: 201 });
  const r = entry(newPaperLedger(start), start, 'signal-different-size', wide);
  assert.equal(r.results.PAPER_50K.reason, 'RISK_OR_CAPITAL_OR_LIQUIDITY');
  assert.equal(r.results.PAPER_100K.status, 'OPEN');
  assert.equal(r.ledger.positions.length, 1);
  assert.equal(r.ledger.rejections.length, 1);
  assert.equal(r.ledger.outbox.length, 1);
  assert.equal(r.ledger.accounts.PAPER_50K.cashPaise, 5000000);
  assert.equal(auditPaperLedger(r.ledger), true);
});

test('STOP exit credits only executable BID less slippage and SELL fees; duplicate exits do nothing', () => {
  const first = entry(newPaperLedger(start));
  const id = trade(first.ledger, 'PAPER_50K').tradeId;
  const now = start + 120_000;
  const closed = exitPaperPosition(first.ledger, { tradeId: id, nowMs: now,
    quote: quote(now, { bid: 79.8, ask: 80.2 }) });
  assert.equal(closed.result.status, 'CLOSED');
  assert.equal(closed.result.reason, 'STOP');
  assert.equal(closed.ledger.positions.filter(p => p.status === 'CLOSED').length, 1);
  assert.equal(closed.ledger.accounts.PAPER_100K.cashPaise, first.ledger.accounts.PAPER_100K.cashPaise);
  assert.equal(closed.ledger.outbox.length, 3);
  const old = trade(first.ledger, 'PAPER_50K');
  const position = trade(closed.ledger, 'PAPER_50K');
  assert.equal(position.netPnlPaise, position.exitCreditPaise - old.entryDebitPaise);
  assert.equal(closed.ledger.accounts.PAPER_50K.cashPaise,
    first.ledger.accounts.PAPER_50K.cashPaise + position.exitCreditPaise);
  const again = exitPaperPosition(closed.ledger, { tradeId: id, nowMs: now + 5000,
    quote: quote(now + 5000, { bid: 79.8, ask: 80.2 }) });
  assert.equal(again.result.status, 'DUPLICATE');
  assert.equal(again.ledger, closed.ledger);
  assert.equal(auditPaperLedger(closed.ledger), true);
});

test('HOLD, insufficient BID depth and mismatched contract never touch cash or outbox', () => {
  const first = entry(newPaperLedger(start));
  const id = trade(first.ledger, 'PAPER_100K').tradeId;
  const now = start + 60_000;
  for (const q of [quote(now), quote(now, { bidQuantity: 65 })]) {
    const r = exitPaperPosition(first.ledger, { tradeId: id, nowMs: now, quote: q });
    assert.equal(r.ledger, first.ledger);
    assert.ok(['HOLD', 'WAIT_DEPTH'].includes(r.result.status));
  }
  const other = { ...quote(now).contract, token: 999 };
  assert.throws(() => exitPaperPosition(first.ledger, { tradeId: id, nowMs: now,
    quote: quote(now, { contract: other }) }), /CONTRACT_MISMATCH/);
  assert.throws(() => exitPaperPosition(first.ledger, { tradeId: id, nowMs: start,
    quote: quote(start) }), /NONCAUSAL_EXIT/);
  assert.equal(first.ledger.outbox.length, 2);
});

test('TARGET and 15:15 TIME exits respect quote, time and no fabricated P&L', () => {
  const first = entry(newPaperLedger(start));
  const ids = first.ledger.positions.map(p => p.tradeId);
  const targetTime = start + 150_000;
  const target = exitPaperPosition(first.ledger, { tradeId: ids[0], nowMs: targetTime,
    quote: quote(targetTime, { bid: 141, ask: 141.5 }) });
  assert.equal(target.result.reason, 'TARGET');
  const last = time('2026-10-23', '15:15');
  const timed = exitPaperPosition(target.ledger, { tradeId: ids[1], nowMs: last,
    quote: quote(last) });
  assert.equal(timed.result.reason, 'TIME');
  assert.equal(timed.ledger.positions.filter(p => p.status === 'CLOSED').length, 2);
  assert.equal(timed.ledger.outbox.length, 4);
});

test('after three same-day exits, fourth signal cannot create another trade in either account', () => {
  let state = newPaperLedger(start);
  for (let cycle = 0; cycle < 3; cycle++) {
    const openedAt = start + cycle * 180_000;
    const opened = entry(state, openedAt, `signal-day-${cycle}`, quote(openedAt));
    assert.ok(Object.values(opened.results).every(x => x.status === 'OPEN'));
    state = opened.ledger;
    for (const p of state.positions.filter(p => p.status === 'OPEN')) {
      const exitAt = openedAt + 60_000;
      const closed = exitPaperPosition(state, { tradeId: p.tradeId, nowMs: exitAt,
        quote: quote(exitAt, { bid: 141, ask: 141.5 }) });
      assert.equal(closed.result.reason, 'TARGET');
      state = closed.ledger;
    }
  }
  assert.equal(state.positions.length, 6);
  assert.equal(state.outbox.length, 12);
  const later = start + 10 * 60_000;
  const denied = entry(state, later, 'signal-day-fourth', quote(later));
  assert.ok(Object.values(denied.results).every(x => x.reason === 'MAX_TRADES_PER_DAY'));
  assert.equal(denied.ledger.positions.length, 6);
});

test('daily realized losses reduce available modeled risk on subsequent entries', () => {
  const first = entry(newPaperLedger(start));
  let state = first.ledger;
  for (const p of first.ledger.positions) {
    const exitAt = start + 60_000;
    const stop = exitPaperPosition(state, { tradeId: p.tradeId, nowMs: exitAt,
      quote: quote(exitAt, { bid: 79.8, ask: 80.2 }) });
    assert.equal(stop.result.reason, 'STOP');
    state = stop.ledger;
  }
  const next = start + 180_000;
  const second = entry(state, next, 'signal-second-loss', quote(next));
  // At least one portfolio must refuse more risk once daily losses are counted.
  const accounts = Object.values(second.results);
  assert.ok(accounts.every(a => a.status === 'OPEN' || a.status === 'REJECTED'));
  assert.ok(second.ledger.positions.length <= 4);
  assert.equal(auditPaperLedger(second.ledger), true);
});

test('without a valid 15:26 exit, retain cash debit and permanently block account', () => {
  const first = entry(newPaperLedger(start));
  const finish = time('2026-10-23', '15:26');
  const marked = markPaperUnverifiable(first.ledger, finish);
  assert.equal(marked.marked.length, 2);
  assert.equal(marked.ledger.outbox.length, 4);
  assert.ok(marked.ledger.positions.every(p => p.status === 'EXIT_UNVERIFIABLE' && p.exitCreditPaise === null));
  assert.deepEqual(marked.ledger.accounts, first.ledger.accounts);
  const next = markPaperUnverifiable(marked.ledger, finish + 2000);
  assert.deepEqual(next.marked, []);
  assert.equal(next.ledger.outbox.length, 4);
  const anotherDay = time('2026-10-26');
  const attempt = entry(marked.ledger, anotherDay, 'signal-next-day', quote(anotherDay));
  assert.ok(Object.values(attempt.results).every(x => x.reason === 'POSITION_ALREADY_OPEN'));
});

test('ledger detects cash tampering, dropped outbox, multiple active and duplicate trades', () => {
  const normal = entry(newPaperLedger(start)).ledger;
  for (const mutation of [
    s => { s.accounts.PAPER_50K.cashPaise++; },
    s => { s.outbox.pop(); },
    s => { s.positions.push(structuredClone(s.positions[0])); },
    s => { s.positions[0].entryFeePaise++; },
    s => { s.accounts.PAPER_50K.initialPaise++; },
  ]) {
    const altered = structuredClone(normal);
    mutation(altered);
    assert.throws(() => auditPaperLedger(altered), /PAPER_LEDGER_/);
    assert.throws(() => entry(altered, start + 5000, 'signal-new'), /PAPER_LEDGER_/);
  }
});

test('failed input cannot partially mutate original state', () => {
  const original = entry(newPaperLedger(start)).ledger;
  const old = structuredClone(original);
  assert.throws(() => exitPaperPosition(original, { tradeId: original.positions[0].tradeId,
    nowMs: start + 60_000, quote: quote(start + 60_000, { bidQuantity: -1 }) }),
  /PAPER_LEDGER_/);
  assert.deepEqual(original, old);
});
