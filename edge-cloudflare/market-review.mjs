/** Read-only futures candle review. Never opens paper positions or sends alerts. */
import { decide } from './decision-core.mjs';
import { validClaimedTickId, sessionStatus, ALARM_INTERVAL_MS } from './alarm-core.mjs';
import { parseAwareCandleTimestamp } from './market-readonly.mjs';

const IST_MS = 330 * 60_000;
const MINUTE_MS = 60_000;
export const READONLY_REVIEW_SOURCE = 'READONLY_FUTURES_REVIEW_ONLY';
const validTime = value => Number.isSafeInteger(value) && value > 0 &&
  Number.isFinite(new Date(value).valueOf());

function istDay(at) {
  return new Date(at + IST_MS).toISOString().slice(0, 10);
}

function refuse(reason) {
  return { source: READONLY_REVIEW_SOURCE, status: 'WAIT_DATA', reason,
    fiveMinuteCandleAtMs: null, fifteenMinuteCandleAtMs: null,
    paperEntryAuthorized: false, telegramAuthorized: false, realOrdersEnabled: false };
}

function boundedBars(raw, interval, nowMs) {
  if (!Array.isArray(raw) || raw.length > 400) throw Error('INVALID_HISTORY');
  const bars = [];
  let lastAt = 0, incomplete = 0;
  for (const row of raw) {
    if (!Array.isArray(row) || row.length !== 6)
      throw Error('INVALID_HISTORY');
    const startMs = parseAwareCandleTimestamp(row[0]);
    if (!validTime(startMs) || startMs <= lastAt || startMs > nowMs ||
        !row.slice(1, 5).every(v => typeof v === 'number' && Number.isFinite(v) && v > 0) ||
        !Number.isSafeInteger(row[5]) || row[5] < 0 ||
        row[2] < Math.max(row[1], row[3], row[4]) ||
        row[3] > Math.min(row[1], row[2], row[4])) throw Error('INVALID_HISTORY');
    const local = new Date(startMs + IST_MS);
    const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
    if (local.getUTCSeconds() !== 0 || local.getUTCMilliseconds() !== 0 ||
        minutes < 555 || minutes >= 930 || (minutes - 555) % interval !== 0)
      throw Error('INVALID_HISTORY');
    lastAt = startMs;
    if (startMs + interval * MINUTE_MS + 8_000 <= nowMs) {
      if (incomplete) throw Error('OUT_OF_ORDER_HISTORY');
      bars.push({ startMs, open: row[1], high: row[2], low: row[3],
        close: row[4], volume: row[5] });
    } else {
      incomplete++;
      if (incomplete > 1) throw Error('MULTIPLE_INCOMPLETE_BARS');
    }
  }
  return bars;
}

/** Deliberately only consumes already verified read-only GET data.
 * Decision is a FUTURES-only research candidate, never an option fill.
 */
export function reviewReadOnlyMarket({ tickId, observedAtMs, futures,
  candles5, candles15, strategyConfig } = {}) {
  if (!validClaimedTickId(tickId) || !validTime(observedAtMs)) return refuse('INVALID_REVIEW_CLOCK');
  const [day, slot] = tickId.split(':');
  const scheduledAt = Date.parse(`${day}T09:15:00+05:30`) + Number(slot) * ALARM_INTERVAL_MS;
  if (day !== istDay(observedAtMs) || sessionStatus(day) !== 'REGULAR' ||
      observedAtMs < scheduledAt || observedAtMs >= scheduledAt + ALARM_INTERVAL_MS)
    return refuse('INVALID_REVIEW_SLOT');
  if (!futures || !/^NFO:NIFTY[A-Z0-9]+FUT$/.test(futures.symbol ?? '') ||
      !Number.isSafeInteger(futures.instrumentToken) || futures.instrumentToken <= 0 ||
      !validTime(futures.exchangeAtMs) || futures.exchangeAtMs > observedAtMs + 3_000 ||
      observedAtMs - futures.exchangeAtMs > 60_000 ||
      istDay(futures.exchangeAtMs) !== day ||
      typeof futures.lastPrice !== 'number' || !Number.isFinite(futures.lastPrice) ||
      futures.lastPrice <= 0 || futures.lastPrice > 1_000_000)
    return refuse('STALE_OR_MISMATCHED_FUTURES');
  // Optional for labeled synthetic parity fixtures; the production Worker
  // deliberately never supplies a strategy override and uses pinned defaults.
  if (strategyConfig !== undefined && (!strategyConfig ||
      typeof strategyConfig !== 'object' || Array.isArray(strategyConfig) ||
      Object.keys(strategyConfig).sort().join(',') !== 'adxMin,atrBuffer' ||
      !Number.isFinite(strategyConfig.adxMin) || strategyConfig.adxMin < 10 ||
      strategyConfig.adxMin > 50 || !Number.isFinite(strategyConfig.atrBuffer) ||
      strategyConfig.atrBuffer < 0 || strategyConfig.atrBuffer > 1))
    return refuse('INVALID_STRATEGY_CONFIG');
  let five, fifteen;
  try {
    five = boundedBars(candles5, 5, observedAtMs);
    fifteen = boundedBars(candles15, 15, observedAtMs);
  } catch { return refuse('INVALID_CANDLE_HISTORY'); }
  const latest = five.at(-1);
  if (latest && Math.abs(futures.lastPrice - latest.close) > latest.close * 0.08)
    return refuse('FUTURES_CANDLE_PRICE_MISMATCH');
  const decision = decide(five, observedAtMs, fifteen, strategyConfig);
  return { source: READONLY_REVIEW_SOURCE,
    status: decision.status, reason: decision.reason,
    fiveMinuteCandleAtMs: latest?.startMs ?? null,
    fifteenMinuteCandleAtMs: fifteen.at(-1)?.startMs ?? null,
    paperEntryAuthorized: false, telegramAuthorized: false, realOrdersEnabled: false };
}
