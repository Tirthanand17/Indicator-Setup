import test from 'node:test';
import assert from 'node:assert/strict';
import { newPaperLedger, enterPaperBasket, exitPaperPosition,
  markPaperUnverifiable } from './paper-ledger.mjs';
import { newSyntheticSession, SYNTHETIC_SOURCE } from './synthetic-session.mjs';
import { captureSyntheticPortfolioMarks, auditPortfolioMarks,
  portfolioValuation } from './portfolio-valuation.mjs';
import { estimateLeg } from './strategy-core.mjs';

const AT = Date.parse('2026-10-23T04:30:00Z'); // 10:00 IST, valid 20s slot 135
const tick = (slot = 135) => `2026-10-23:${slot}`;
const quote = (at = AT, bid = 100, ask = 100.5) => ({
  contract: { symbol: 'NIFTY26OCT23000CE', kind: 'CE',
    expiry: '2026-10-29', token: 12345, lotSize: 65 },
  bid, ask, bidQuantity: 650, askQuantity: 650, updatedAtMs: at - 1000,
});
function sessionAt(at = AT, slot = 135) {
  const session = newSyntheticSession();
  session.lastTickId = tick(slot);
  session.lastObservedAtMs = at;
  session.totalTicks = 1;
  session.events = [{ tickId: session.lastTickId, observedAtMs: at,
    decision: 'WAIT_DATA', entered: 2, exited: 0, unverifiable: 0 }];
  return session;
}
const input = (session, optionQuotes) => ({ source: SYNTHETIC_SOURCE,
  tickId: session.lastTickId, observedAtMs: session.lastObservedAtMs, optionQuotes });
function opened(at = AT) {
  return enterPaperBasket(newPaperLedger(at),
    { signalId: 'portfolio-signal-001', nowMs: at, quote: quote(at) }).ledger;
}

test('marks are synthetic, restricted to open contracts, exactly one per kind', () => {
  const ledger = opened(), session = sessionAt();
  const marks = captureSyntheticPortfolioMarks(ledger, session, input(session, { CE: quote() }));
  assert.equal(marks.source, SYNTHETIC_SOURCE);
  assert.equal(marks.marks.length, 1);
  assert.equal(marks.marks[0].bidPaise, 10000);
  assert.equal(marks.marks[0].askPaise, 10050);
  assert.equal(JSON.stringify(marks).includes('signalId'), false);
  assert.equal(auditPortfolioMarks(marks, session), true);
});

test('equity and unrealized exit P&L subtract hypothetical slippage and sell fees', () => {
  const ledger = opened(), session = sessionAt();
  const marks = captureSyntheticPortfolioMarks(ledger, session, input(session, { CE: quote() }));
  const view = portfolioValuation(ledger, session, marks, AT + 1000, 'INITIALIZED');
  assert.equal(view.healthStatus, 'SYNTHETIC_MARKS_FRESH');
  assert.equal(view.valuationIsLive, false);
  assert.equal(view.realOrdersEnabled, false);
  for (const account of view.accounts) {
    const position = ledger.positions.find(p => p.accountId === account.accountId);
    const qty = position.lots * position.lotSize;
    const bidFill = 9992; // 100.00 BID less 8 bps, rounded to paise
    const sellFee = estimateLeg(bidFill / 100, qty, 'SELL', '2026-10-23').total_paise;
    const credit = qty * bidFill - sellFee;
    assert.equal(account.indicativeEquityPaise, account.cashPaise + credit);
    assert.equal(account.hypotheticalOpenNetPnlPaise, credit - position.entryDebitPaise);
    assert.equal(account.totalIndicativeNetPnlPaise, account.indicativeEquityPaise - account.initialPaise);
    assert.equal(account.reservedEntryDebitPaise, position.entryDebitPaise);
    assert.equal(account.availableCashPaise, ledger.accounts[account.accountId].cashPaise);
    assert.equal(account.remainingEntriesToday, 2);
    assert.equal(account.maxNewEntryDebitPaise, 0); // one active position blocks another
    assert.equal(account.remainingDailyLossBudgetPaise, account.initialPaise * 0.06);
    assert.equal(account.markedToMarket, true);
  }
});

test('missing or invalid quote clears every open equity rather than falling back to cash', () => {
  const ledger = opened(), session = sessionAt();
  const broken = quote(); broken.contract.token += 1;
  for (const q of [{}, { CE: broken }, { CE: { ...quote(), bidQuantity: 1 } },
    { CE: { ...quote(), updatedAtMs: AT - 16_000 } }]) {
    const marks = captureSyntheticPortfolioMarks(ledger, session, input(session, q));
    assert.equal(marks.marks.length, 0);
    const report = portfolioValuation(ledger, session, marks, AT);
    assert.equal(report.healthStatus, 'MISSING_OR_STALE_QUOTE');
    for (const a of report.accounts) {
      assert.equal(a.indicativeEquityPaise, null);
      assert.equal(a.totalIndicativeNetPnlPaise, null);
      assert.equal(a.markedToMarket, false);
    }
  }
});

test('a formerly valid mark automatically expires; clock rollback also fails closed', () => {
  const ledger = opened(), session = sessionAt();
  const marks = captureSyntheticPortfolioMarks(ledger, session, input(session, { CE: quote() }));
  for (const at of [AT + 16_000, AT - 4000]) {
    const report = portfolioValuation(ledger, session, marks, at);
    assert.equal(report.accounts[0].indicativeEquityPaise, null);
    assert.equal(report.accounts[0].markedToMarket, false);
  }
});

test('next tick erases stale previous mark instead of preserving an optimistic MTM', () => {
  const ledger = opened();
  const session = sessionAt(AT + 20_000, 136);
  const next = captureSyntheticPortfolioMarks(ledger, session, input(session, {}));
  assert.deepEqual(next.marks, []);
  assert.equal(portfolioValuation(ledger, session, next, AT + 20_000)
    .accounts[0].indicativeEquityPaise, null);
});

test('closed account has known flat cash equity independently of the other open account', () => {
  const now = AT + 120_000;
  const ledger = exitPaperPosition(opened(), { tradeId: 'PAPER_50K:portfolio-signal-001',
    nowMs: now, quote: quote(now, 141, 141.5) }).ledger;
  const session = sessionAt(now, 141);
  const marks = captureSyntheticPortfolioMarks(ledger, session,
    input(session, { CE: quote(now, 141, 141.5) }));
  const report = portfolioValuation(ledger, session, marks, now);
  assert.equal(report.accounts[0].valuationStatus, 'FLAT_CASH');
  assert.equal(report.accounts[0].indicativeEquityPaise, ledger.accounts.PAPER_50K.cashPaise);
  assert.equal(report.accounts[0].hypotheticalOpenNetPnlPaise, 0);
  assert.equal(report.accounts[0].remainingEntriesToday, 2);
  assert.equal(report.accounts[0].maxNewEntryDebitPaise > 0, true);
  assert.equal(report.accounts[1].markedToMarket, true);
});

test('unverifiable positions remain blocked even if a market bid is injected', () => {
  const ledger = markPaperUnverifiable(opened(),Date.parse('2026-10-23T10:00:00Z')).ledger;
  const session = sessionAt();
  const marks = { schema:1,source:SYNTHETIC_SOURCE,lastTickId:session.lastTickId,
    observedAtMs:AT,marks:[] };
  const report=portfolioValuation(ledger,session,marks,AT);
  assert.equal(report.healthStatus,'BLOCKED_UNVERIFIABLE_EXIT');
  assert.equal(report.accounts[0].indicativeEquityPaise,null);
  assert.equal(report.accounts[1].indicativeEquityPaise,null);
});

test('audits reject mismatched tick, duplicate kind, altered spreads and unsafe money', () => {
  const ledger = opened(), session = sessionAt();
  const marks = captureSyntheticPortfolioMarks(ledger, session, input(session, { CE: quote() }));
  const bad = [
    { ...marks, lastTickId: tick(136) },
    { ...marks, marks: [...marks.marks, marks.marks[0]] },
    { ...marks, marks: [{ ...marks.marks[0], askPaise: 15000 }] },
    { ...marks, marks: [{ ...marks.marks[0], bidPaise: -100 }] },
  ];
  for (const x of bad) assert.throws(() => portfolioValuation(ledger, session, x, AT));
  assert.throws(() => captureSyntheticPortfolioMarks(ledger, session,
    { ...input(session, { CE: quote() }), source: 'KITE_LIVE' }));
});
