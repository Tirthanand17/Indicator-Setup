/** Phase22: indicative exit-at-BID valuation from OFFLINE SYNTHETIC quotes only.
 * This is not an exchange mark, an executable fill, or live account equity.
 */
import { auditPaperLedger, checkQuote, moneyScaled } from './paper-ledger.mjs';
import { auditSyntheticSession, SYNTHETIC_SOURCE } from './synthetic-session.mjs';
import { estimateLeg } from './strategy-core.mjs';

export const PORTFOLIO_MARKS_KEY = 'synthetic-portfolio-marks-v1';
const MAX_QUOTE_AGE_MS = 15_000;
const MAX_FUTURE_MS = 3_000;
const IDS = ['PAPER_50K', 'PAPER_100K'];
const isInt = value => Number.isSafeInteger(value);
const positive = value => isInt(value) && value > 0;
const fail = reason => { throw new Error(`PORTFOLIO_${reason}`); };
const sameContract = (mark, position) => mark.kind === position.kind &&
  mark.symbol === position.symbol && mark.token === position.token &&
  mark.expiry === position.expiry && mark.lotSize === position.lotSize;
const asRupees = n => n === null ? null : Number((n / 100).toFixed(2));

/** Store at most the two freshly validated option kinds in a committed tick.
 * An omitted/invalid quote erases the old mark at the next processed tick.
 */
export function captureSyntheticPortfolioMarks(ledger, session, input) {
  auditPaperLedger(ledger);
  if(ledger.schema!==1)fail('UNSUPPORTED_SYNTHETIC_LEDGER');
  auditSyntheticSession(session);
  if (input?.source !== SYNTHETIC_SOURCE ||
      input.tickId !== session.lastTickId || input.observedAtMs !== session.lastObservedAtMs ||
      !isInt(input.observedAtMs)) fail('INCONSISTENT_SYNTHETIC_TICK');
  const positions = ledger.positions.filter(p => p.status === 'OPEN');
  const marks = [];
  for (const kind of ['CE', 'PE']) {
    const requested = positions.filter(p => p.kind === kind);
    const quote = input.optionQuotes?.[kind];
    if (!requested.length || !quote) continue;
    try {
      const { c, bid, ask } = checkQuote(quote, input.observedAtMs);
      if (requested.some(p => !sameContract(c, p) ||
          quote.updatedAtMs < p.entryQuoteAtMs ||
          quote.bidQuantity < p.lots * p.lotSize)) continue;
      marks.push({ kind: c.kind, symbol: c.symbol, token: c.token,
        expiry: c.expiry, lotSize: c.lotSize, bidPaise: bid, askPaise: ask,
        bidQuantity: quote.bidQuantity, updatedAtMs: quote.updatedAtMs });
    } catch (error) {
      if (!/^PAPER_LEDGER_(INVALID_CONTRACT|STALE_QUOTE|INVALID_PREMIUM|INVALID_SPREAD|INSUFFICIENT_DEPTH)$/.test(error?.message)) throw error;
    }
  }
  const record = { schema: 1, source: SYNTHETIC_SOURCE,
    lastTickId: session.lastTickId, observedAtMs: session.lastObservedAtMs, marks };
  auditPortfolioMarks(record, session);
  return record;
}

export function auditPortfolioMarks(record, session) {
  auditSyntheticSession(session);
  if (!record || record.schema !== 1 || record.source !== SYNTHETIC_SOURCE ||
      !session.lastTickId || record.lastTickId !== session.lastTickId ||
      record.observedAtMs !== session.lastObservedAtMs ||
      !Array.isArray(record.marks) || record.marks.length > 2) fail('CORRUPT_MARKS');
  const used = new Set();
  for (const mark of record.marks) {
    if (!mark || !['CE', 'PE'].includes(mark.kind) || used.has(mark.kind) ||
        !/^NIFTY[A-Z0-9]+(?:CE|PE)$/.test(mark.symbol ?? '') ||
        !mark.symbol.endsWith(mark.kind) || !positive(mark.token) ||
        !positive(mark.lotSize) || !/^2026-\d\d-\d\d$/.test(mark.expiry ?? '') ||
        !Number.isFinite(Date.parse(`${mark.expiry}T00:00:00Z`)) ||
        new Date(`${mark.expiry}T00:00:00Z`).toISOString().slice(0, 10) !== mark.expiry ||
        !positive(mark.bidPaise) || !positive(mark.askPaise) ||
        mark.askPaise <= mark.bidPaise ||
        (mark.askPaise - mark.bidPaise) * 200 >
          (mark.askPaise + mark.bidPaise) * 2 ||
        !positive(mark.bidQuantity) || mark.bidQuantity < mark.lotSize ||
        !positive(mark.updatedAtMs) ||
        record.observedAtMs - mark.updatedAtMs > MAX_QUOTE_AGE_MS ||
        mark.updatedAtMs - record.observedAtMs > MAX_FUTURE_MS) fail('CORRUPT_MARK');
    used.add(mark.kind);
  }
  return true;
}

/** Fail closed account-by-account: never treat missing/unverifiable open
 * positions as zero-value holdings or convert cash into fabricated equity.
 */
export function portfolioValuation(ledger, session, record, nowMs,
  schedulerStatus = 'NOT_INITIALIZED') {
  auditPaperLedger(ledger);
  if(ledger.schema!==1)fail('UNSUPPORTED_SYNTHETIC_LEDGER');
  if (session !== undefined && session !== null) auditSyntheticSession(session);
  if (record !== undefined && record !== null) {
    if (!session) fail('ORPHAN_MARKS');
    auditPortfolioMarks(record, session);
  }
  if (!positive(nowMs)) fail('INVALID_CLOCK');
  if (typeof schedulerStatus !== 'string' || !/^[A-Z_]{2,60}$/.test(schedulerStatus))
    fail('INVALID_SCHEDULER_STATUS');
  const age = session?.lastObservedAtMs === null || !session ? null :
    nowMs - session.lastObservedAtMs;
  const quoteClockGood = record && age !== null && age >= -MAX_FUTURE_MS &&
    age <= MAX_QUOTE_AGE_MS;
  const day = new Date(nowMs + 330 * 60_000).toISOString().slice(0, 10);
  const active = ledger.positions.filter(p => p.status !== 'CLOSED');
  const accounts = IDS.map(accountId => {
    const own = active.filter(p => p.accountId === accountId);
    const original = ledger.accounts[accountId];
    const closed = ledger.positions.filter(p => p.accountId === accountId && p.status === 'CLOSED');
    const realized = closed.reduce((sum, p) => sum + p.netPnlPaise, 0);
    const reserved = own.reduce((sum, p) => sum + p.entryDebitPaise, 0);
    const enteredToday = ledger.positions.filter(p => p.accountId === accountId &&
      new Date(p.entryAtMs + 330 * 60_000).toISOString().slice(0, 10) === day).length;
    const lossesToday = closed.filter(p => p.netPnlPaise < 0 &&
      new Date(p.exitAtMs + 330 * 60_000).toISOString().slice(0, 10) === day)
      .reduce((sum, p) => sum + p.netPnlPaise, 0);
    const remainingDailyLossBudgetPaise = Math.max(0,
      Math.floor(original.initialPaise * 0.06) + lossesToday);
    const remainingEntriesToday = Math.max(0, 3 - enteredToday);
    const newEntryCapPaise = own.length || !remainingEntriesToday || !remainingDailyLossBudgetPaise ?
      0 : Math.min(original.cashPaise, Math.floor(original.initialPaise * 0.30));
    const flat = own.length === 0;
    let valuationStatus = flat ? 'FLAT_CASH' : 'MISSING_SYNTHETIC_MARK';
    let openExitCredit = 0;
    if (own.some(p => p.status === 'EXIT_UNVERIFIABLE')) {
      valuationStatus = 'BLOCKED_UNVERIFIABLE_EXIT';
    } else if (!flat && !quoteClockGood) {
      valuationStatus = record ? 'STALE_SYNTHETIC_TICK' : 'MISSING_SYNTHETIC_MARK';
    } else if (!flat) {
      valuationStatus = 'INDICATIVE_SYNTHETIC_BID';
      for (const position of own) {
        const mark = record.marks.find(m => m.kind === position.kind && sameContract(m, position));
        const qty = position.lots * position.lotSize;
        if (!mark || mark.bidQuantity < qty || mark.updatedAtMs < position.entryQuoteAtMs ||
            nowMs - mark.updatedAtMs > MAX_QUOTE_AGE_MS ||
            mark.updatedAtMs - nowMs > MAX_FUTURE_MS) {
          valuationStatus = 'MISSING_OR_STALE_CONTRACT_BID';
          break;
        }
        const fill = moneyScaled(mark.bidPaise / 100, 10_000 - position.slippageBps, 10_000);
        const fee = estimateLeg(fill / 100, qty, 'SELL',
          new Date(record.observedAtMs + 330 * 60_000).toISOString().slice(0, 10)).total_paise;
        if (qty * fill - fee < 0) {
          valuationStatus = 'INVALID_INDICATIVE_CREDIT';
          break;
        }
        openExitCredit += qty * fill - fee;
      }
    }
    const canValue = flat || valuationStatus === 'INDICATIVE_SYNTHETIC_BID';
    const equity = canValue ? original.cashPaise + openExitCredit : null;
    return { accountId, initialPaise: original.initialPaise, cashPaise: original.cashPaise,
      availableCashPaise: original.cashPaise, reservedEntryDebitPaise: reserved,
      maxNewEntryDebitPaise: newEntryCapPaise, remainingDailyLossBudgetPaise,
      remainingEntriesToday,
      realizedNetPnlPaise: realized, openCount: own.filter(p => p.status === 'OPEN').length,
      unverifiableCount: own.filter(p => p.status === 'EXIT_UNVERIFIABLE').length,
      valuationStatus, markedToMarket: !flat && canValue,
      indicativeEquityPaise: equity, hypotheticalOpenNetPnlPaise: !canValue ? null :
        openExitCredit - reserved,
      totalIndicativeNetPnlPaise: equity === null ? null : equity - original.initialPaise,
      availableCashRupees: asRupees(original.cashPaise),
      reservedEntryDebitRupees: asRupees(reserved),
      maxNewEntryDebitRupees: asRupees(newEntryCapPaise),
      remainingDailyLossBudgetRupees: asRupees(remainingDailyLossBudgetPaise),
      indicativeEquityRupees: asRupees(equity),
      hypotheticalOpenNetPnlRupees: asRupees(canValue ? openExitCredit - reserved : null),
      totalIndicativeNetPnlRupees: asRupees(equity === null ? null : equity - original.initialPaise) };
  });
  const healthStatus = accounts.some(a => a.unverifiableCount) ? 'BLOCKED_UNVERIFIABLE_EXIT' :
    accounts.some(a => a.openCount && !a.markedToMarket) ? 'MISSING_OR_STALE_QUOTE' :
    accounts.some(a => a.markedToMarket) ? 'SYNTHETIC_MARKS_FRESH' : 'NO_OPEN_POSITIONS';
  return { schema: 1, source: SYNTHETIC_SOURCE, paperOnly: true,
    syntheticOnly: true, liveMarketConnected: false, realOrdersEnabled: false,
    outboxDeliveryImplemented: false, valuationIsLive: false,
    valuationMethod: 'HYPOTHETICAL_BID_MINUS_SLIPPAGE_AND_SELL_FEES',
    lastSyntheticTickId: session?.lastTickId ?? null,
    lastSyntheticTickAtMs: session?.lastObservedAtMs ?? null,
    syntheticTickAgeMs: age, schedulerStatus, healthStatus, accounts };
}
