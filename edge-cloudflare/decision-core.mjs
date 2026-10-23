/** Python cloud_alerts.signals.decide offline parity. No network, alerts, or orders. */
import { compute, ema } from './strategy-core.mjs';
import { sessionStatus } from './alarm-core.mjs';

const IST_MS = 330 * 60_000;
const MINUTE = 60_000;
const validMs = ms => Number.isSafeInteger(ms) && Number.isFinite(new Date(ms).valueOf());

function local(ms) {
  if (!validMs(ms)) return null;
  const value = new Date(ms + IST_MS);
  if (!Number.isFinite(value.valueOf())) return null;
  return { date: value.toISOString().slice(0, 10),
    minutes: value.getUTCHours() * 60 + value.getUTCMinutes(),
    seconds: value.getUTCSeconds(), millis: value.getUTCMilliseconds() };
}

function validCandle(c) {
  return c && validMs(c.startMs) &&
    [c.open, c.high, c.low, c.close].every(v => typeof v === 'number' && Number.isFinite(v) && v > 0) &&
    c.high >= Math.max(c.open, c.close, c.low) && c.low <= Math.min(c.open, c.close, c.high) &&
    Number.isSafeInteger(c.volume) && c.volume >= 0;
}

const decision = (status, reason, candle = null, indicators = null,
  stop_underlying = null, target_underlying = null) =>
  ({ status, reason, candle, indicators, stop_underlying, target_underlying });

/**
 * Deliberately returns Python-compatible statuses and reasons for valid
 * 5-minute / independent 15-minute histories. Input timestamps are UTC epoch
 * milliseconds (the JS equivalent of Python aware datetime); all sessions IST.
 * Not wired to the market Worker or an actual trading venue.
 */
export function decide(candles, nowMs, confirm15m, { adxMin = 25, atrBuffer = 0.5 } = {}) {
  const clock = local(nowMs);
  if (!clock) return decision('WAIT_DATA', 'clock lacks timezone');
  const market = sessionStatus(clock.date);
  if (market === null) return decision('WAIT_DATA', 'official NSE F&O holiday calendar unavailable');
  if (market !== 'REGULAR') return decision('NO_TRADE', 'NSE F&O market closed for normal session');
  if (clock.minutes < 9 * 60 + 30 || clock.minutes > 15 * 60 ||
      (clock.minutes === 15 * 60 && (clock.seconds || clock.millis))) {
    return decision('NO_TRADE', 'outside configured entry session');
  }
  if (!Array.isArray(candles) || !Array.isArray(confirm15m) ||
      candles.length < 75 || confirm15m.length < 30) {
    return decision('WAIT_DATA', 'not enough complete candle history');
  }

  for (const [bars, minutes, label] of [
    [candles, 5, '5-minute'], [confirm15m, 15, '15-minute'],
  ]) {
    if (bars.some(bar => !validCandle(bar) || !local(bar.startMs) ||
          local(bar.startMs).seconds || local(bar.startMs).millis ||
          (local(bar.startMs).minutes - 555) % minutes !== 0 ||
          local(bar.startMs).minutes < 555 || local(bar.startMs).minutes >= 930)) {
      return decision('WAIT_DATA', `invalid ${label} session history`);
    }
    const today = bars.filter(b => local(b.startMs).date === clock.date);
    if (!today.length || local(today[0].startMs).minutes !== 555 ||
        today.some((b, i) => b.volume <= 0 ||
          (i > 0 && b.startMs - today[i - 1].startMs !== minutes * MINUTE))) {
      return decision('WAIT_DATA', `invalid ${label} session history`);
    }
  }

  const last = candles.at(-1);
  if (local(last.startMs).date !== clock.date) return decision('WAIT_DATA', 'no same-day complete bar');
  if (nowMs < last.startMs || nowMs - last.startMs > 7 * MINUTE) {
    return decision('WAIT_DATA', '5-minute futures candle stale or timestamp invalid');
  }
  if (last.startMs + 5 * MINUTE + 8_000 > nowMs) {
    return decision('WAIT_DATA', 'latest 5-minute candle not yet confirmed complete');
  }
  if (candles.slice(-4).some((b, i, recent) => i > 0 &&
      b.startMs - recent[i - 1].startMs !== 5 * MINUTE)) {
    return decision('WAIT_DATA', 'recent five-minute candle gaps');
  }
  if (candles.slice(-4).some(b => b.volume <= 0)) {
    return decision('WAIT_DATA', 'missing recent futures traded volume');
  }
  if (confirm15m.some((b, i) => !validCandle(b) ||
      (i > 0 && b.startMs <= confirm15m[i - 1].startMs))) {
    return decision('WAIT_DATA', 'invalid 15-minute history: 15-minute candles not strictly ordered');
  }
  const today15 = confirm15m.filter(b => local(b.startMs).date === clock.date);
  if (!today15.length || today15.at(-1) !== confirm15m.at(-1)) {
    return decision('WAIT_DATA', '15-minute confirmation not from current session');
  }
  if (today15.some(b => local(b.startMs).minutes < 555 || local(b.startMs).minutes > 915 ||
      (local(b.startMs).minutes - 555) % 15 !== 0)) {
    return decision('WAIT_DATA', 'invalid 15-minute session candle boundary');
  }
  if (today15.slice(-3).some((b, i, recent) => i > 0 &&
      b.startMs - recent[i - 1].startMs !== 15 * MINUTE)) {
    return decision('WAIT_DATA', 'recent 15-minute confirmation candle gaps');
  }
  let indicators, higherFast, higherSlow;
  try {
    indicators = compute(candles);
    const closes = confirm15m.map(b => b.close);
    higherFast = ema(closes, 9).at(-1);
    higherSlow = ema(closes, 21).at(-1);
  } catch {
    return decision('WAIT_DATA', 'invalid indicator history');
  }
  if (confirm15m.at(-1).startMs + 15 * MINUTE > nowMs ||
      nowMs - confirm15m.at(-1).startMs > 32 * MINUTE) {
    return decision('WAIT_DATA', '15-minute confirmation stale or incomplete');
  }
  if (!Number.isFinite(adxMin) || !Number.isFinite(atrBuffer) || atrBuffer < 0) {
    return decision('WAIT_DATA', 'invalid strategy configuration');
  }
  if (indicators.adx < adxMin || indicators.adx <= indicators.previous_adx) {
    return decision('NO_TRADE', 'ADX not strong and rising', last, indicators);
  }
  const prev = candles.slice(-4, -1);
  const higherHi = Math.max(...prev.map(b => b.high));
  const lowerLo = Math.min(...prev.map(b => b.low));
  const bullish = last.close > indicators.vwap && indicators.ema9 > indicators.ema21 &&
    indicators.plus_di > indicators.minus_di && higherFast > higherSlow && last.close > higherHi;
  const bearish = last.close < indicators.vwap && indicators.ema9 < indicators.ema21 &&
    indicators.minus_di > indicators.plus_di && higherFast < higherSlow && last.close < lowerLo;
  if (!bullish && !bearish) return decision('NO_TRADE',
    'VWAP EMA DMI 15m context or breakout mismatch', last, indicators);
  const stop = bullish ? Math.min(...candles.slice(-4).map(b => b.low)) - atrBuffer * indicators.atr :
    Math.max(...candles.slice(-4).map(b => b.high)) + atrBuffer * indicators.atr;
  const risk = bullish ? last.close - stop : stop - last.close;
  if (risk <= 0 || risk > 2.5 * indicators.atr) return decision('NO_TRADE',
    'underlying stop too wide or invalid', last, indicators);
  const target = last.close + (bullish ? 1.8 * risk : -1.8 * risk);
  return decision(bullish ? 'REVIEW_CE' : 'REVIEW_PE',
    '5m breakout with aligned VWAP EMA DMI and independent 15m EMA',
    last, indicators, stop, target);
}
