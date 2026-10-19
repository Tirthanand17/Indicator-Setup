/* Pure, testable decision rules; no brokerage, network or order access. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SignalEngine = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  const SAFE = Object.freeze({ WAIT_DATA: 'WAIT_DATA', NO_TRADE: 'NO_TRADE', CE: 'REVIEW_CE', PE: 'REVIEW_PE' });
  function num(v) { return v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : NaN; }
  function istParts(date) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
    return Object.fromEntries(parts.map(p => [p.type, p.value]));
  }
  function analyse(input, nowMs = Date.now()) {
    const x = input || {}; const reasons = [];
    const prices = ['close','vwap','ema9','ema21','plusDI','minusDI','adx','priorAdx','atr','volume'];
    const v = Object.fromEntries(prices.map(k => [k, num(x[k])]));
    if (!/^NIFTY\d{2}[A-Z]{3}FUT$/.test(String(x.symbol || '').trim().toUpperCase())) reasons.push('Select the correct active NIFTY futures contract');
    if (x.closed !== true) reasons.push('Five-minute candle has not been confirmed closed');
    if (!prices.every(k => Number.isFinite(v[k]))) reasons.push('Missing or invalid numerical inputs');
    if (['close','vwap','ema9','ema21','atr','volume'].some(k => !(v[k] > 0))) reasons.push('Missing/nonpositive futures price, ATR or volume');
    if (['plusDI','minusDI','adx','priorAdx'].some(k => !(v[k] >= 0 && v[k] <= 100))) reasons.push('DMI values outside 0–100');
    const t = new Date(x.candleEnd);
    if (!Number.isFinite(t.getTime())) reasons.push('Missing or invalid five-minute candle end timestamp');
    else {
      const delta = nowMs - t.getTime();
      if (delta < 0 || delta > 12 * 60000) reasons.push('Candle timestamp is future-dated or stale (>12 min)');
      const z = istParts(t); const minutes = Number(z.hour) * 60 + Number(z.minute);
      if (Number(z.minute) % 5 !== 0 || t.getUTCSeconds() !== 0) reasons.push('Candle end must align with a five-minute boundary');
      if (['Sat','Sun'].includes(z.weekday) || minutes < 9 * 60 + 20 || minutes > 15 * 60 + 30) reasons.push('Outside regular NSE session; exchange holidays require separate check');
    }
    if (x.chartOpen !== true) reasons.push('Kite chart not currently detected in this browser');
    if (reasons.length) return { status: SAFE.WAIT_DATA, reasons, notify: false };
    if (x.optionChecks !== true) return { status: SAFE.NO_TRADE, reasons: ['Confirm option bid/ask, expiry, lot size, IV and stop/target before a candidate alert'], notify: false };
    if (v.adx < 25 || v.adx <= v.priorAdx) return { status: SAFE.NO_TRADE, reasons: ['ADX below 25 or not rising on completed candles'], notify: false };
    // Reject borderline VWAP crosses; heuristic buffer = 0.1 x ATR on underlying.
    if (Math.abs(v.close - v.vwap) < 0.1 * v.atr) return { status: SAFE.NO_TRADE, reasons: ['Price too close to session VWAP (within 0.1 ATR)'], notify: false };
    const bullish = v.close > v.vwap && v.ema9 > v.ema21 && v.plusDI > v.minusDI && x.structure === 'bull' && ['bull','neutral'].includes(x.higherTimeframe);
    const bearish = v.close < v.vwap && v.ema9 < v.ema21 && v.minusDI > v.plusDI && x.structure === 'bear' && ['bear','neutral'].includes(x.higherTimeframe);
    if (bullish) return { status: SAFE.CE, reasons: ['Aligned bullish conditions; manual CE premium and entry review still required'], notify: true };
    if (bearish) return { status: SAFE.PE, reasons: ['Aligned bearish conditions; manual PE premium and entry review still required'], notify: true };
    return { status: SAFE.NO_TRADE, reasons: ['VWAP, EMAs, DI direction, price structure or 15-minute context conflict'], notify: false };
  }
  function checkExit(position, bid) {
    if (!position || !['CE','PE'].includes(position.direction)) return { status: 'WAIT_POSITION', notify: false };
    const stop = num(position.stop), target = num(position.target), current = num(bid);
    if (![stop,target,current].every(Number.isFinite) || !(stop > 0) || !(target > stop) || !(current > 0)) return { status: 'WAIT_QUOTE', notify: false };
    if (current <= stop) return { status: 'EXIT_STOP', notify: true, reason: 'Manually entered option BID at/below stop' };
    if (current >= target) return { status: 'EXIT_TARGET', notify: true, reason: 'Manually entered option BID at/above target' };
    return { status: 'HOLD', notify: false };
  }
  return { analyse, checkExit, SAFE, istParts };
});
