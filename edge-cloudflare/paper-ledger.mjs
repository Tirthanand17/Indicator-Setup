/** Pure, offline-only NIFTY option paper ledger. No imports with network/order effects.
 * One state document is committed with both accounts, positions and alert outbox
 * inside a single Durable Object transaction by worker.mjs. This is NOT a fill.
 */
import { sessionStatus } from './alarm-core.mjs';
import { estimateLeg, COST_POLICY } from './strategy-core.mjs';

export const PAPER_LEDGER_KEY = 'paper-ledger-v1';
export const PAPER_ACCOUNT_CAPITALS = Object.freeze({ PAPER_50K: 5_000_000, PAPER_100K: 10_000_000 });
const ACCOUNT_IDS = Object.keys(PAPER_ACCOUNT_CAPITALS);
const MAX_TRADES = 512, MAX_REJECTIONS = 1024, MAX_OUTBOX = 1024;
const IST_OFFSET_MS = 330 * 60_000;

const integer = n => Number.isSafeInteger(n);
const positive = n => integer(n) && n > 0;
const validDate = d => typeof d === 'string' && /^2026-\d\d-\d\d$/.test(d) &&
  Number.isFinite(Date.parse(`${d}T00:00:00Z`)) &&
  new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
const fail = msg => { throw new Error(`PAPER_LEDGER_${msg}`); };
const paiseRupees = n => Number((n / 100).toFixed(2));

function ist(nowMs) {
  if (!integer(nowMs) || nowMs <= 0) fail('INVALID_CLOCK');
  const date = new Date(nowMs + IST_OFFSET_MS);
  if (!Number.isFinite(date.valueOf())) fail('INVALID_CLOCK');
  const day = date.toISOString().slice(0, 10);
  if (!validDate(day)) fail('UNSUPPORTED_YEAR');
  return { day, minute: date.getUTCHours() * 60 + date.getUTCMinutes(),
    second: date.getUTCSeconds(), ms: nowMs };
}

function permitted(nowMs, entry) {
  const local = ist(nowMs);
  const start = 9 * 60 + 30;
  const end = entry ? 15 * 60 : 15 * 60 + 26;
  if (sessionStatus(local.day) !== 'REGULAR' || local.minute < start || local.minute >= end) {
    fail('OUTSIDE_SESSION');
  }
  return local;
}

/** Round positive exact decimal rupees times rational multiplier to paise. */
function moneyScaled(price, numerator = 1, denominator = 1) {
  if (!positive(numerator) || !positive(denominator)) fail('INVALID_MONEY_SCALE');
  const raw = String(price);
  if (!/^\d+(?:\.\d{1,8})?$/.test(raw) || !(Number(raw) > 0 && Number(raw) <= 10_000_000)) {
    fail('INVALID_PREMIUM');
  }
  const parts = raw.split('.');
  const scale = 10n ** BigInt(parts[1]?.length ?? 0);
  const n = BigInt(parts.join('')) * BigInt(numerator) * 100n;
  const d = scale * BigInt(denominator);
  const cents = (2n * n + d) / (2n * d);
  if (cents <= 0n || cents > BigInt(Number.MAX_SAFE_INTEGER)) fail('INVALID_PREMIUM');
  return Number(cents);
}

function checkQuote(quote, nowMs) {
  const c = quote?.contract;
  const current = ist(nowMs);
  if (!c || !['CE', 'PE'].includes(c.kind) ||
    typeof c.symbol !== 'string' || !/^NIFTY[A-Z0-9]+(?:CE|PE)$/.test(c.symbol) ||
    !c.symbol.endsWith(c.kind) || !positive(c.lotSize) || !positive(c.token) ||
    !validDate(c.expiry) || c.expiry < current.day) fail('INVALID_CONTRACT');
  if (!integer(quote.updatedAtMs) || nowMs - quote.updatedAtMs > 15_000 ||
    quote.updatedAtMs - nowMs > 3000 || ist(quote.updatedAtMs).day !== current.day) {
    fail('STALE_QUOTE');
  }
  const bid = moneyScaled(quote.bid), ask = moneyScaled(quote.ask);
  // Also reject sub-paise / hidden float spread: <=2% of bid/ask midpoint.
  if (!(Number(quote.ask) > Number(quote.bid)) || ask <= bid ||
    (Number(quote.ask) - Number(quote.bid)) * 200 >
       (Number(quote.ask) + Number(quote.bid)) * 2) fail('INVALID_SPREAD');
  if (!integer(quote.bidQuantity) || !integer(quote.askQuantity) ||
      Math.min(quote.bidQuantity, quote.askQuantity) < c.lotSize) fail('INSUFFICIENT_DEPTH');
  return { c, bid, ask };
}

export function newPaperLedger(nowMs) {
  ist(nowMs);
  return { schema: 1, lastMutationAtMs: nowMs,
    accounts: Object.fromEntries(ACCOUNT_IDS.map(id => [id,
      { initialPaise: PAPER_ACCOUNT_CAPITALS[id], cashPaise: PAPER_ACCOUNT_CAPITALS[id] }])),
    positions: [], rejections: [], outbox: [] };
}

/** Reconstruct every balance; any failed invariant blocks subsequent writes. */
export function auditPaperLedger(state) {
  if (!state || state.schema !== 1 || !integer(state.lastMutationAtMs) ||
    !state.accounts || typeof state.accounts !== 'object' ||
    Object.keys(state.accounts).sort().join(',') !== ACCOUNT_IDS.slice().sort().join(',') ||
    !Array.isArray(state.positions) || state.positions.length > MAX_TRADES ||
    !Array.isArray(state.rejections) || state.rejections.length > MAX_REJECTIONS ||
    !Array.isArray(state.outbox) || state.outbox.length > MAX_OUTBOX) fail('CORRUPT_STATE');
  ist(state.lastMutationAtMs);
  const balance = Object.fromEntries(ACCOUNT_IDS.map(id => [id, PAPER_ACCOUNT_CAPITALS[id]]));
  const active = new Set(), signals = new Set(), tradeIds = new Set();
  const eventIds = new Set();
  for (const p of state.positions) {
    if (!p || !ACCOUNT_IDS.includes(p.accountId) ||
      typeof p.signalId !== 'string' || !/^[A-Za-z0-9:._+\-]{8,220}$/.test(p.signalId) ||
      p.tradeId !== `${p.accountId}:${p.signalId}` ||
      tradeIds.has(p.tradeId) || signals.has(`${p.accountId}:${p.signalId}`) ||
      !['OPEN', 'CLOSED', 'EXIT_UNVERIFIABLE'].includes(p.status) ||
      !positive(p.lotSize) || !positive(p.lots) || p.lots > 3 ||
      !positive(p.entryFillPaise) || !positive(p.entryAskPaise) ||
      p.entryFillPaise < p.entryAskPaise ||
      !integer(p.entryFeePaise) || p.entryFeePaise < 0 ||
      !positive(p.entryDebitPaise) ||
      p.entryDebitPaise !== p.lots * p.lotSize * p.entryFillPaise + p.entryFeePaise ||
      !positive(p.entryAtMs) || p.entryAtMs > state.lastMutationAtMs ||
      !positive(p.entryQuoteAtMs) || p.entryQuoteAtMs - p.entryAtMs > 3000 ||
      p.entryAtMs - p.entryQuoteAtMs > 15000 ||
      !positive(p.token) || !validDate(p.expiry) ||
      !['CE', 'PE'].includes(p.kind) || typeof p.symbol !== 'string' ||
      !/^NIFTY[A-Z0-9]+(?:CE|PE)$/.test(p.symbol) || !p.symbol.endsWith(p.kind) ||
      !positive(p.stopBidPaise) || p.stopBidPaise >= p.entryAskPaise ||
      !positive(p.targetBidPaise) || p.targetBidPaise <= p.entryAskPaise ||
      !integer(p.exitFeeAssumedPaise) || p.exitFeeAssumedPaise < 0 ||
      !integer(p.slippageBps) || p.slippageBps < 0 || p.slippageBps > 100 ||
      p.feePolicy !== COST_POLICY) fail('CORRUPT_POSITION');
    tradeIds.add(p.tradeId); signals.add(`${p.accountId}:${p.signalId}`);
    balance[p.accountId] -= p.entryDebitPaise;
    if (p.status !== 'CLOSED') {
      if (active.has(p.accountId)) fail('MULTIPLE_ACTIVE_POSITIONS');
      active.add(p.accountId);
      if (p.exitAtMs !== null || p.exitCreditPaise !== null || p.netPnlPaise !== null ||
          p.exitFeePaise !== null) fail('CORRUPT_OPEN_POSITION');
    } else {
      const qty = p.lots * p.lotSize;
      if (!positive(p.exitAtMs) || p.exitAtMs <= p.entryAtMs ||
        p.exitAtMs > state.lastMutationAtMs || !positive(p.exitBidPaise) ||
        !positive(p.exitQuoteAtMs) || p.exitQuoteAtMs < p.entryQuoteAtMs ||
        !positive(p.exitFillPaise) || !integer(p.exitFeePaise) || p.exitFeePaise < 0 ||
        !integer(p.exitCreditPaise) || p.exitCreditPaise < 0 ||
        p.exitCreditPaise !== qty * p.exitFillPaise - p.exitFeePaise ||
        p.netPnlPaise !== p.exitCreditPaise - p.entryDebitPaise ||
        !['STOP', 'TARGET', 'TIME'].includes(p.exitReason)) fail('CORRUPT_CLOSED_POSITION');
      balance[p.accountId] += p.exitCreditPaise;
    }
  }
  for (const r of state.rejections) {
    const key = `${r?.accountId}:${r?.signalId}`;
    if (!r || !ACCOUNT_IDS.includes(r.accountId) || typeof r.signalId !== 'string' ||
      !positive(r.atMs) || typeof r.reason !== 'string' || signals.has(key)) fail('CORRUPT_REJECTION');
    if (signals.has(`REJECTED:${key}`)) fail('DUPLICATE_REJECTION');
    signals.add(`REJECTED:${key}`);
  }
  for (const e of state.outbox) {
    if (!e || typeof e.eventId !== 'string' || eventIds.has(e.eventId) ||
      !['PAPER_ENTRY', 'PAPER_EXIT', 'PAPER_UNVERIFIABLE'].includes(e.kind) ||
      e.status !== 'PENDING' || !positive(e.atMs) ||
      typeof e.message !== 'string' || e.message.length > 1200 ||
      !tradeIds.has(e.tradeId) || e.eventId !== `${e.kind}:${e.tradeId}`) fail('CORRUPT_OUTBOX');
    eventIds.add(e.eventId);
  }
  for (const p of state.positions) {
    if (!eventIds.has(`PAPER_ENTRY:${p.tradeId}`) ||
      (p.status === 'CLOSED') !== eventIds.has(`PAPER_EXIT:${p.tradeId}`) ||
      (p.status === 'EXIT_UNVERIFIABLE') !== eventIds.has(`PAPER_UNVERIFIABLE:${p.tradeId}`)) {
      fail('MISSING_OUTBOX_EVENT');
    }
  }
  for (const id of ACCOUNT_IDS) {
    const a = state.accounts[id];
    if (!a || a.initialPaise !== PAPER_ACCOUNT_CAPITALS[id] ||
      !integer(a.cashPaise) || a.cashPaise < 0 || a.cashPaise !== balance[id]) {
      fail('CASH_CONSERVATION');
    }
  }
  return true;
}

function requireRoom(ledger, name, max) {
  if (ledger[name].length >= max) fail('RECORD_CAPACITY');
}

function outbox(ledger, kind, tradeId, atMs, message) {
  requireRoom(ledger, 'outbox', MAX_OUTBOX);
  ledger.outbox.push({ eventId: `${kind}:${tradeId}`, kind, tradeId, atMs,
    status: 'PENDING', message: `${message}\nSIMULATED ONLY. No real order placed.` });
}

function reviewClock(state, nowMs) {
  if (nowMs < state.lastMutationAtMs) fail('CLOCK_ROLLBACK');
}

export function enterPaperBasket(state, { signalId, quote, nowMs, slippageBps = 8 } = {}) {
  auditPaperLedger(state);
  const { day } = permitted(nowMs, true);
  reviewClock(state, nowMs);
  if (typeof signalId !== 'string' || !/^[A-Za-z0-9:._+\-]{8,220}$/.test(signalId)) fail('INVALID_SIGNAL');
  if (!integer(slippageBps) || slippageBps < 0 || slippageBps > 100) fail('INVALID_SLIPPAGE');
  const { c, ask } = checkQuote(quote, nowMs);
  const next = structuredClone(state), results = {};
  const fill = moneyScaled(quote.ask, 10_000 + slippageBps, 10_000);
  const stop = moneyScaled(quote.ask, 80, 100);
  const target = moneyScaled(quote.ask, 140, 100);
  const worstStopFill = moneyScaled(stop / 100, 10_000 - slippageBps, 10_000);
  const quoteLotLimit = Math.floor(quote.askQuantity / c.lotSize);
  for (const accountId of ACCOUNT_IDS) {
    const old = next.positions.find(p => p.accountId === accountId && p.signalId === signalId);
    const reject = next.rejections.find(r => r.accountId === accountId && r.signalId === signalId);
    if (old) { results[accountId] = { status: 'DUPLICATE', tradeId: old.tradeId }; continue; }
    if (reject) { results[accountId] = { status: 'REJECTED', reason: reject.reason }; continue; }
    const { initialPaise, cashPaise } = next.accounts[accountId];
    const active = next.positions.some(p => p.accountId === accountId && p.status !== 'CLOSED');
    const todayEntries = next.positions.filter(p => p.accountId === accountId &&
      ist(p.entryAtMs).day === day).length;
    const dailyLoss = next.positions.filter(p => p.accountId === accountId &&
      p.status === 'CLOSED' && ist(p.exitAtMs).day === day && p.netPnlPaise < 0)
      .reduce((sum, p) => sum + p.netPnlPaise, 0);
    const remainingDaily = Math.max(0, Math.floor(initialPaise * 0.06) + dailyLoss);
    let selected = null;
    for (let lots = Math.min(3, quoteLotLimit); lots > 0; lots--) {
      const qty = lots * c.lotSize;
      const entryFee = estimateLeg(fill / 100, qty, 'BUY', day).total_paise;
      const exitFee = estimateLeg(worstStopFill / 100, qty, 'SELL', day).total_paise;
      const debit = qty * fill + entryFee;
      const modeledLoss = qty * (fill - worstStopFill) + entryFee + exitFee;
      if (debit <= cashPaise && debit <= Math.floor(initialPaise * 0.30) &&
        modeledLoss <= Math.floor(initialPaise * 0.03) && modeledLoss <= remainingDaily) {
        selected = { lots, debit, entryFee, exitFee }; break;
      }
    }
    const reason = active ? 'POSITION_ALREADY_OPEN' :
      todayEntries >= 3 ? 'MAX_TRADES_PER_DAY' :
      remainingDaily <= 0 ? 'DAILY_LOSS_LIMIT' :
      selected === null ? 'RISK_OR_CAPITAL_OR_LIQUIDITY' : null;
    if (reason) {
      requireRoom(next, 'rejections', MAX_REJECTIONS);
      next.rejections.push({ accountId, signalId, atMs: nowMs, reason });
      results[accountId] = { status: 'REJECTED', reason }; continue;
    }
    requireRoom(next, 'positions', MAX_TRADES);
    const tradeId = `${accountId}:${signalId}`;
    next.accounts[accountId].cashPaise -= selected.debit;
    next.positions.push({ tradeId, accountId, signalId, symbol: c.symbol, kind: c.kind,
      expiry: c.expiry, token: c.token, lotSize: c.lotSize, lots: selected.lots,
      entryAtMs: nowMs, entryQuoteAtMs: quote.updatedAtMs, entryAskPaise: ask,
      entryFillPaise: fill, entryDebitPaise: selected.debit, entryFeePaise: selected.entryFee,
      exitFeeAssumedPaise: selected.exitFee, slippageBps, feePolicy: COST_POLICY,
      stopBidPaise: stop, targetBidPaise: target, status: 'OPEN', exitAtMs: null,
      exitQuoteAtMs: null, exitFillPaise: null, exitFeePaise: null, exitCreditPaise: null,
      exitReason: null, netPnlPaise: null });
    outbox(next, 'PAPER_ENTRY', tradeId, nowMs,
      `${accountId} BUY ${c.symbol} | ${selected.lots} lots | ASK Rs ${paiseRupees(ask)} | ` +
      `modeled fill Rs ${paiseRupees(fill)} | debit incl fees Rs ${paiseRupees(selected.debit)}`);
    results[accountId] = { status: 'OPEN', tradeId, lots: selected.lots,
      quantity: selected.lots * c.lotSize, entryAskPaise: ask, entryFillPaise: fill,
      entryDebitPaise: selected.debit, stopBidPaise: stop, targetBidPaise: target,
      cashPaise: next.accounts[accountId].cashPaise };
  }
  next.lastMutationAtMs = nowMs;
  auditPaperLedger(next);
  return { ledger: next, results, paperOnly: true };
}

export function exitPaperPosition(state, { tradeId, quote, nowMs } = {}) {
  auditPaperLedger(state);
  const { day, minute } = permitted(nowMs, false);
  reviewClock(state, nowMs);
  const old = state.positions.find(p => p.tradeId === tradeId);
  if (!old) fail('UNKNOWN_POSITION');
  if (old.status !== 'OPEN') return { ledger: state, result: {
    status: old.status === 'CLOSED' ? 'DUPLICATE' : 'UNVERIFIABLE', tradeId }, paperOnly: true };
  const { c, bid } = checkQuote(quote, nowMs);
  if (old.symbol !== c.symbol || old.kind !== c.kind || old.expiry !== c.expiry ||
    old.token !== c.token || old.lotSize !== c.lotSize) fail('CONTRACT_MISMATCH');
  if (nowMs <= old.entryAtMs || quote.updatedAtMs < old.entryQuoteAtMs) fail('NONCAUSAL_EXIT');
  const qty = old.lots * old.lotSize;
  if (quote.bidQuantity < qty) return { ledger: state, result: { status: 'WAIT_DEPTH', tradeId }, paperOnly: true };
  const reason = minute >= 15 * 60 + 15 ? 'TIME' : bid <= old.stopBidPaise ? 'STOP' :
    bid >= old.targetBidPaise ? 'TARGET' : 'HOLD';
  if (reason === 'HOLD') return { ledger: state, result: { status: 'HOLD', tradeId }, paperOnly: true };
  const fill = moneyScaled(quote.bid, 10_000 - old.slippageBps, 10_000);
  const fee = estimateLeg(fill / 100, qty, 'SELL', day).total_paise;
  const credit = qty * fill - fee;
  if (credit < 0) return { ledger: state, result: { status: 'WAIT_VALUE', tradeId }, paperOnly: true };
  const next = structuredClone(state);
  const p = next.positions.find(pos => pos.tradeId === tradeId);
  const pnl = credit - p.entryDebitPaise;
  Object.assign(p, { status: 'CLOSED', exitAtMs: nowMs, exitQuoteAtMs: quote.updatedAtMs,
    exitBidPaise: bid, exitFillPaise: fill, exitFeePaise: fee, exitCreditPaise: credit,
    exitReason: reason, netPnlPaise: pnl });
  next.accounts[p.accountId].cashPaise += credit;
  outbox(next, 'PAPER_EXIT', tradeId, nowMs,
    `${p.accountId} EXIT ${p.symbol} ${reason} | BID Rs ${paiseRupees(bid)} | ` +
    `net modeled P&L Rs ${paiseRupees(pnl)}`);
  next.lastMutationAtMs = nowMs;
  auditPaperLedger(next);
  return { ledger: next, result: { status: 'CLOSED', tradeId, reason,
    exitBidPaise: bid, exitFillPaise: fill, exitCreditPaise: credit,
    netPnlPaise: pnl }, paperOnly: true };
}

/** After 15:26 IST, mark missed exits unresolved: never manufacture a fill. */
export function markPaperUnverifiable(state, nowMs) {
  auditPaperLedger(state);
  const local = ist(nowMs);
  reviewClock(state, nowMs);
  if (sessionStatus(local.day) !== 'REGULAR') fail('OUTSIDE_SESSION');
  const next = structuredClone(state), marked = [];
  for (const p of next.positions) {
    if (p.status !== 'OPEN') continue;
    const today = ist(p.entryAtMs).day;
    if (local.day < today || (local.day === today && local.minute < 15 * 60 + 26)) continue;
    p.status = 'EXIT_UNVERIFIABLE';
    outbox(next, 'PAPER_UNVERIFIABLE', p.tradeId, nowMs,
      `${p.accountId} ${p.symbol} EXIT UNVERIFIABLE; cash not credited; account blocked`);
    marked.push(p.tradeId);
  }
  next.lastMutationAtMs = nowMs;
  auditPaperLedger(next);
  return { ledger: next, marked, paperOnly: true };
}

export function paperLedgerSummary(state) {
  auditPaperLedger(state);
  const accounts = ACCOUNT_IDS.map(accountId => {
    const rows = state.positions.filter(p => p.accountId === accountId);
    const account = state.accounts[accountId];
    return { accountId, initialPaise: account.initialPaise, cashPaise: account.cashPaise,
      openCount: rows.filter(p => p.status === 'OPEN').length,
      unverifiableCount: rows.filter(p => p.status === 'EXIT_UNVERIFIABLE').length,
      closedCount: rows.filter(p => p.status === 'CLOSED').length,
      realizedNetPnlPaise: rows.filter(p => p.status === 'CLOSED')
        .reduce((sum, p) => sum + p.netPnlPaise, 0),
      markedToMarket: false };
  });
  return { schema: 1, paperOnly: true, realOrdersEnabled: false, accounts,
    positionCount: state.positions.length, rejectionCount: state.rejections.length,
    pendingOutboxCount: state.outbox.length, lastMutationAtMs: state.lastMutationAtMs,
    outboxDeliveryImplemented: false, liveMarketConnected: false };
}
