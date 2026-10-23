/** Phase19: complete OFFLINE-SYNTHETIC decision → paper entry/exit → pending outbox.
 * The actual read-only Kite sampler does not supply option quotes or full
 * validated historical candles yet. This module MUST NOT accept live data.
 */
import { validClaimedTickId, sessionStatus, ALARM_INTERVAL_MS } from './alarm-core.mjs';
import { decide } from './decision-core.mjs';
import { auditPaperLedger, enterPaperBasket, exitPaperPosition,
  markPaperUnverifiable, paperLedgerSummary } from './paper-ledger.mjs';

export const SYNTHETIC_SESSION_KEY = 'synthetic-session-v1';
export const SYNTHETIC_SOURCE = 'OFFLINE_SYNTHETIC_TEST_ONLY';
const IST_OFFSET_MS = 330 * 60_000;
const RETAINED_RESULTS = 128;
const fail = reason => { throw new Error(`SYNTHETIC_SESSION_${reason}`); };

const timeInfo = ms => {
  if (!Number.isSafeInteger(ms) || ms <= 0) fail('INVALID_CLOCK');
  const date = new Date(ms + IST_OFFSET_MS);
  if (!Number.isFinite(date.valueOf())) fail('INVALID_CLOCK');
  return { day: date.toISOString().slice(0, 10),
    minute: date.getUTCHours() * 60 + date.getUTCMinutes() };
};

function strictTick(input) {
  if (!input || Object.keys(input).length > 12 || input.source !== SYNTHETIC_SOURCE ||
    !Number.isSafeInteger(input.observedAtMs) || !validClaimedTickId(input.tickId)) {
    fail('INVALID_SYNTHETIC_ENVELOPE');
  }
  if ((Array.isArray(input.candles5) && input.candles5.length > 1600) ||
      (Array.isArray(input.candles15) && input.candles15.length > 600) ||
      (input.optionQuotes && (typeof input.optionQuotes !== 'object' ||
        Object.keys(input.optionQuotes).length > 2 ||
        Object.keys(input.optionQuotes).some(k => !['CE','PE'].includes(k))))) {
    fail('OVERSIZED_OR_UNEXPECTED_MARKET_INPUT');
  }
  const { day } = timeInfo(input.observedAtMs);
  const [tickDate, slot] = input.tickId.split(':');
  if (day !== tickDate || sessionStatus(day) !== 'REGULAR') fail('CLOSED_SESSION');
  const dueAtMs = Date.parse(`${day}T09:15:00+05:30`) + Number(slot) * ALARM_INTERVAL_MS;
  if (input.observedAtMs < dueAtMs || input.observedAtMs >= dueAtMs + ALARM_INTERVAL_MS) {
    fail('LATE_OR_UNSCHEDULED_TICK');
  }
  return { day, dueAtMs };
}

/** Exactly one Futures identity and recent exchange timestamp, even in tests. */
function syntheticFuturesStatus(futures, nowMs) {
  if (!futures || typeof futures !== 'object' ||
    !/^NFO:NIFTY[A-Z0-9]+FUT$/.test(futures.symbol ?? '') ||
    !Number.isSafeInteger(futures.instrumentToken) || futures.instrumentToken <= 0 ||
    !Number.isSafeInteger(futures.exchangeAtMs) ||
    futures.exchangeAtMs > nowMs + 3000 || nowMs - futures.exchangeAtMs > 60_000 ||
    timeInfo(futures.exchangeAtMs).day !== timeInfo(nowMs).day ||
    typeof futures.lastPrice !== 'number' || !Number.isFinite(futures.lastPrice) ||
    futures.lastPrice <= 0 || futures.lastPrice > 1_000_000) {
    return 'WAIT_FRESH_FUTURES';
  }
  return 'FUTURES_SYNTHETIC_VALID';
}

function nextTickIsNew(previous, current) {
  if (previous === null) return true;
  const [beforeDay, beforeSlot] = previous.split(':');
  const [day, slot] = current.split(':');
  if (beforeDay > day || (beforeDay === day && Number(beforeSlot) > Number(slot))) {
    fail('TICK_ROLLBACK');
  }
  return previous !== current;
}

export function newSyntheticSession() {
  return { schema: 1, lastTickId: null, lastObservedAtMs: null,
    totalTicks: 0, reviewTicks: 0, events: [] };
}

export function auditSyntheticSession(s) {
  if (!s || s.schema !== 1 ||
    (s.lastTickId !== null && !validClaimedTickId(s.lastTickId)) ||
    (s.lastObservedAtMs !== null && (!Number.isSafeInteger(s.lastObservedAtMs) ||
      s.lastObservedAtMs <= 0)) ||
    ((s.lastTickId === null) !== (s.lastObservedAtMs === null)) ||
    !Number.isSafeInteger(s.totalTicks) || s.totalTicks < 0 || s.totalTicks > 500_000 ||
    !Number.isSafeInteger(s.reviewTicks) || s.reviewTicks < 0 ||
    s.reviewTicks > s.totalTicks ||
    ((s.totalTicks === 0) !== (s.lastTickId === null)) ||
    !Array.isArray(s.events) || s.events.length > RETAINED_RESULTS ||
    s.events.length > s.totalTicks) fail('CORRUPT_STATE');
  let previous = null;
  for (const e of s.events) {
    if (!e || !validClaimedTickId(e.tickId) ||
      typeof e.decision !== 'string' ||
      !Number.isSafeInteger(e.observedAtMs) || e.observedAtMs <= 0 ||
      !Number.isSafeInteger(e.entered) || e.entered < 0 || e.entered > 2 ||
      !Number.isSafeInteger(e.exited) || e.exited < 0 || e.exited > 2 ||
      !Number.isSafeInteger(e.unverifiable) || e.unverifiable < 0 || e.unverifiable > 2 ||
      (previous !== null && !nextTickIsNew(previous, e.tickId))) fail('CORRUPT_EVENT');
    const [eventDate, slot] = e.tickId.split(':');
    const dueAt = Date.parse(`${eventDate}T09:15:00+05:30`) + Number(slot) * ALARM_INTERVAL_MS;
    if (timeInfo(e.observedAtMs).day !== eventDate ||
        e.observedAtMs < dueAt || e.observedAtMs >= dueAt + ALARM_INTERVAL_MS) {
      fail('CORRUPT_EVENT_TIME');
    }
    previous = e.tickId;
  }
  if (s.events.length && (s.events.at(-1).tickId !== s.lastTickId ||
      s.events.at(-1).observedAtMs !== s.lastObservedAtMs)) fail('CORRUPT_LAST_TICK');
  return true;
}

function safeOptionQuotes(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return { CE: raw.CE ?? null, PE: raw.PE ?? null };
}

function syntheticStrategyConfig(raw) {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
    Object.keys(raw).some(k => !['adxMin', 'atrBuffer'].includes(k)) ||
    typeof raw.adxMin !== 'number' || !Number.isFinite(raw.adxMin) ||
    raw.adxMin < 10 || raw.adxMin > 50 ||
    typeof raw.atrBuffer !== 'number' || !Number.isFinite(raw.atrBuffer) ||
    raw.atrBuffer < 0 || raw.atrBuffer > 1) fail('INVALID_SYNTHETIC_STRATEGY');
  return { adxMin: raw.adxMin, atrBuffer: raw.atrBuffer };
}

const quoteOrCausalityIssue = error => typeof error?.message === 'string' &&
  /^PAPER_LEDGER_(INVALID_CONTRACT|STALE_QUOTE|INVALID_PREMIUM|INVALID_SPREAD|INSUFFICIENT_DEPTH|CONTRACT_MISMATCH|NONCAUSAL_EXIT)$/.test(error.message);

/** Pure all-or-nothing transition; caller commits ledger and session in ONE DO
 * SQLite transaction. Missing/invalid external evidence never yields a fill.
 */
export function advanceSyntheticMarketTurn(session, ledger, input) {
  auditSyntheticSession(session);
  auditPaperLedger(ledger);
  const { day } = strictTick(input);
  const nowMs = input.observedAtMs;
  if (session.lastObservedAtMs !== null && nowMs < session.lastObservedAtMs) {
    fail('CLOCK_ROLLBACK');
  }
  if (!nextTickIsNew(session.lastTickId, input.tickId)) {
    return { session, ledger, result: { status: 'DUPLICATE_TICK', tickId: input.tickId,
      paperOnly: true } };
  }
  if (nowMs < ledger.lastMutationAtMs) fail('LEDGER_CLOCK_ROLLBACK');

  const quotes = safeOptionQuotes(input.optionQuotes);
  // Explicit per-fixture values are permitted only for labeled synthetic
  // parity runs. Live strategy configuration must remain independently pinned.
  const strategyConfig = syntheticStrategyConfig(input.strategyConfig);
  const exits = [], entries = {};
  let nextLedger = ledger;
  const { minute } = timeInfo(nowMs);
  if (minute >= 15 * 60 + 26) {
    const result = markPaperUnverifiable(nextLedger, nowMs);
    nextLedger = result.ledger;
    exits.push(...result.marked.map(tradeId => ({ tradeId, status: 'EXIT_UNVERIFIABLE' })));
  } else if (minute >= 9 * 60 + 30) {
    for (const p of nextLedger.positions.filter(p => p.status === 'OPEN')) {
      const q = quotes[p.kind];
      if (!q) {
        exits.push({ tradeId: p.tradeId, status: 'WAIT_OPTION_QUOTE' }); continue;
      }
      try {
        const r = exitPaperPosition(nextLedger, { tradeId: p.tradeId, quote: q, nowMs });
        nextLedger = r.ledger;
        exits.push({ tradeId: p.tradeId, status: r.result.status,
          reason: r.result.reason ?? null });
      } catch (error) {
        if (!quoteOrCausalityIssue(error)) throw error;
        // Quote and contract faults are not an executable fill. Do not disclose
        // raw prices, broker contents, keys or validation exception details.
        exits.push({ tradeId: p.tradeId, status: 'WAIT_VALID_OPTION_QUOTE' });
      }
    }
  }

  const futuresStatus = syntheticFuturesStatus(input.futures, nowMs);
  const lastCompleteCandle = Array.isArray(input.candles5) ? input.candles5.at(-1) : null;
  const futureCandleConsistent = !lastCompleteCandle ||
    (typeof lastCompleteCandle.close === 'number' && Number.isFinite(lastCompleteCandle.close) &&
      lastCompleteCandle.close > 0 &&
      Math.abs(input.futures?.lastPrice - lastCompleteCandle.close) <= lastCompleteCandle.close * 0.08);
  const marketStatus = futuresStatus === 'FUTURES_SYNTHETIC_VALID' && !futureCandleConsistent ?
    'WAIT_FUTURES_CANDLE_MISMATCH' : futuresStatus;
  const decision = marketStatus === 'FUTURES_SYNTHETIC_VALID' ?
    decide(input.candles5, nowMs, input.candles15, strategyConfig) :
    { status: 'WAIT_DATA', reason: marketStatus, candle: null };
  if (['REVIEW_CE', 'REVIEW_PE'].includes(decision.status)) {
    const kind = decision.status.slice(-2);
    const signalId = `SYNTH:${day}:${decision.candle.startMs}:${kind}`;
    const q = quotes[kind];
    if (!q) {
      entries.status = 'WAIT_OPTION_QUOTE';
    } else if (q.contract?.kind !== kind) {
      entries.status = 'WAIT_VALID_OPTION_QUOTE';
    } else {
      try {
        const r = enterPaperBasket(nextLedger, { signalId, quote: q, nowMs });
        nextLedger = r.ledger;
        Object.assign(entries, r.results);
      } catch (error) {
        if (!quoteOrCausalityIssue(error)) throw error;
        entries.status = 'WAIT_VALID_OPTION_QUOTE';
      }
    }
  }
  const entered = Object.values(entries).filter(x => x?.status === 'OPEN').length;
  const exited = exits.filter(x => x.status === 'CLOSED').length;
  const unverifiable = exits.filter(x => x.status === 'EXIT_UNVERIFIABLE').length;
  const nextSession = structuredClone(session);
  nextSession.lastTickId = input.tickId;
  nextSession.lastObservedAtMs = nowMs;
  nextSession.totalTicks++;
  if (decision.status === 'REVIEW_CE' || decision.status === 'REVIEW_PE') nextSession.reviewTicks++;
  nextSession.events.push({ tickId: input.tickId, observedAtMs: nowMs,
    decision: decision.status, entered, exited, unverifiable });
  nextSession.events = nextSession.events.slice(-RETAINED_RESULTS);
  auditSyntheticSession(nextSession);
  auditPaperLedger(nextLedger);
  return { session: nextSession, ledger: nextLedger,
    result: { status: 'SYNTHETIC_TICK_PROCESSED', tickId: input.tickId,
      syntheticOnly: true, decision: decision.status, reason: decision.reason,
      entered, exited, unverifiable, entryResults: entries, exitResults: exits,
      pendingOutboxCount: nextLedger.outbox.length, paperOnly: true } };
}

export function syntheticSessionSummary(session, ledger) {
  auditSyntheticSession(session);
  return { schema: 1, syntheticOnly: true, source: SYNTHETIC_SOURCE,
    totalTicks: session.totalTicks, reviewTicks: session.reviewTicks,
    lastTickId: session.lastTickId, lastObservedAtMs: session.lastObservedAtMs,
    lastEvents: session.events.slice(-8), ledger: paperLedgerSummary(ledger),
    liveMarketConnected: false, realOrdersEnabled: false };
}
