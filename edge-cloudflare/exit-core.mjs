/** Offline-only paper exit decisions. Never performs cash writes or sends orders. */
import { estimateLeg, COST_POLICY } from './strategy-core.mjs';
import { sessionStatus } from './alarm-core.mjs';

const IST = 19_800_000;
const local = ms => {
  if (!Number.isSafeInteger(ms) || !Number.isFinite(new Date(ms).valueOf())) throw new Error('aware IST clock required');
  const d = new Date(ms + IST);
  return { date: d.toISOString().slice(0, 10), seconds: d.getUTCHours() * 3600 +
    d.getUTCMinutes() * 60 + d.getUTCSeconds() + d.getUTCMilliseconds() / 1000 };
};
const parseAware = iso => {
  if (typeof iso !== 'string' || !/[+-]\d\d:\d\d$|Z$/.test(iso)) throw new Error('timezone required');
  const value = Date.parse(iso);
  if (!Number.isSafeInteger(value)) throw new Error('invalid timestamp');
  return value;
};
const finitePositive = x => typeof x === 'number' && Number.isFinite(x) && x > 0;

/** Premium.reference_from_quote (standalone hypothetical entry ASK, not a fill). */
export function referenceFromQuote(quote, { futuresSymbol, signalCandleMs, createdAtMs,
  stopFraction = 0.20, targetFraction = 0.40 } = {}) {
  const c = quote?.contract;
  if (!c || !['CE','PE'].includes(c.kind) || typeof c.symbol !== 'string' ||
      !c.symbol.startsWith('NIFTY') || !c.expiry) throw new Error('invalid NIFTY virtual contract');
  local(signalCandleMs);local(createdAtMs);local(quote.updatedMs);
  if (!Number.isFinite(stopFraction) || !Number.isFinite(targetFraction) ||
      stopFraction < 0.05 || stopFraction > 0.5 ||
      targetFraction < 0.1 || targetFraction > 1) throw new Error('invalid research threshold');
  if (!finitePositive(quote.bid) || !finitePositive(quote.ask) || quote.bid >= quote.ask ||
      quote.updatedMs > createdAtMs || createdAtMs - quote.updatedMs > 15_000) {
    throw new Error('invalid entry reference quote');
  }
  const isoIST = ms => {
    const d = new Date(ms + IST), two = n => String(n).padStart(2,'0');
    const micros = d.getUTCMilliseconds() ? `.${String(d.getUTCMilliseconds()).padStart(3,'0')}000` : '';
    return `${d.toISOString().slice(0,10)}T${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:`+
      `${two(d.getUTCSeconds())}${micros}+05:30`;
  };
  return {version:2,paper_only:true,option_symbol:c.symbol,option_token:c.token,
    option_kind:c.kind,option_expiry:c.expiry,option_lot_size:c.lot_size,
    futures_symbol:futuresSymbol,signal_candle:isoIST(signalCandleMs),
    created_at:isoIST(createdAtMs),reference_ask:quote.ask,
    stop_bid:Math.round(quote.ask*(1-stopFraction)*100)/100,
    target_bid:Math.round(quote.ask*(1+targetFraction)*100)/100};
}

/** Validate the v2 hypothetical candidate before any option-BID review. */
export function parsePremiumReference(raw, nowMs) {
  try {
    const clock=local(nowMs);
    if (!raw) return null;
    const r=typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!r || typeof r !== 'object' || r.version !== 2 || r.paper_only !== true ||
        !['CE','PE'].includes(r.option_kind) ||
        !/^NIFTY[A-Z0-9]{3,50}$/.test(r.option_symbol) ||
        !/^NIFTY[A-Z0-9]{3,50}$/.test(r.futures_symbol) ||
        !Number.isSafeInteger(r.option_token) || r.option_token < 1 ||
        !Number.isSafeInteger(r.option_lot_size) || r.option_lot_size < 1 ||
        typeof r.option_expiry !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.option_expiry) ||
        !Number.isFinite(Date.parse(r.option_expiry+'T00:00:00Z')) ||
        new Date(r.option_expiry+'T00:00:00Z').toISOString().slice(0,10)!==r.option_expiry) return null;
    const created=parseAware(r.created_at);
    parseAware(r.signal_candle);
    if (local(created).date !== clock.date || created>nowMs || r.option_expiry < clock.date) return null;
    const a=Number(r.reference_ask),s=Number(r.stop_bid),t=Number(r.target_bid);
    if (![a,s,t].every(finitePositive) || !(s<a && a<t) ||
        s/a<0.5 || s/a>0.95 || t/a<1.1 || t/a>2) return null;
    return r;
  } catch { return null; }
}

function quoted(quote, nowMs) {
  if (!quote || typeof quote !== 'object' || !quote.contract) throw new Error('quote missing');
  const c = quote.contract, clock = local(nowMs), stamp = local(quote.updatedMs);
  if (!['CE','PE'].includes(c.kind) || typeof c.symbol !== 'string' ||
      !c.symbol.startsWith('NIFTY') || !c.symbol.endsWith(c.kind) ||
      !Number.isSafeInteger(c.lot_size) || c.lot_size < 1 ||
      !Number.isSafeInteger(c.token) || c.token < 1 ||
      typeof c.expiry !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(c.expiry) ||
      !Number.isFinite(Date.parse(c.expiry+'T00:00:00Z')) ||
      new Date(c.expiry+'T00:00:00Z').toISOString().slice(0, 10) !== c.expiry ||
      c.expiry < clock.date) throw new Error('invalid listed NIFTY option contract');
  const age = nowMs - quote.updatedMs;
  if (age < -3_000 || age > 15_000 || stamp.date !== clock.date) throw new Error('stale option quote');
  if (!finitePositive(quote.bid) || !finitePositive(quote.ask) || quote.ask <= quote.bid ||
      (quote.ask - quote.bid) / (quote.ask + quote.bid) * 200 > 2) {
    throw new Error('invalid option spread or price');
  }
  if (!Number.isSafeInteger(quote.bid_quantity) || !Number.isSafeInteger(quote.ask_quantity) ||
      quote.bid_quantity < c.lot_size || quote.ask_quantity < c.lot_size) {
    throw new Error('insufficient option top-of-book');
  }
}

function moneyScaled(price, numerator = 1, denominator = 1) {
  // All amounts are nonnegative. Decimal(str(price)) * (numerator/denominator)
  // with ROUND_HALF_UP to integer paise, equivalent to Python money().
  if (!finitePositive(price) || !Number.isSafeInteger(numerator) || numerator < 0 ||
      !Number.isSafeInteger(denominator) || denominator <= 0) throw new Error('invalid money');
  const raw = String(price), pieces = raw.split('.');
  if (!/^\d+(\.\d{1,8})?$/.test(raw)) throw new Error('invalid decimal price');
  const scale = 10n ** BigInt(pieces[1]?.length ?? 0);
  const cents = BigInt(pieces.join('')) * BigInt(numerator) * 100n;
  const divisor = scale * BigInt(denominator);
  const rounded = (cents * 2n + divisor) / (2n * divisor);
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('invalid money scale');
  return Number(rounded);
}

/** Mirrors Python Premium.evaluate_bid. Caller must first validate quote freshness. */
export function evaluatePremiumBid(reference, quote, nowMs) {
  if (!reference || !quote || !quote.contract ||
      quote.contract.symbol !== reference.option_symbol ||
      quote.contract.kind !== reference.option_kind) throw new Error('option mismatch');
  local(nowMs);
  local(quote.updatedMs);
  if (quote.updatedMs < parseAware(reference.created_at)) {
    throw new Error('quote predates signal reference');
  }
  if (!finitePositive(quote.bid) || !finitePositive(Number(reference.stop_bid)) ||
      !finitePositive(Number(reference.target_bid))) throw new Error('invalid bid or threshold');
  if (quote.bid <= Number(reference.stop_bid)) return 'STOP';
  if (quote.bid >= Number(reference.target_bid)) return 'TARGET';
  return 'HOLD';
}

/** Python Engine's optional premium watcher, excluding network/delivery state. */
export function virtualPremiumExit(reference, quote, nowMs) {
  const stamp = local(nowMs);
  if (sessionStatus(stamp.date) !== 'REGULAR' ||
      stamp.seconds < 9*3600+30*60 || stamp.seconds >= 15*3600+26*60) return 'WAIT_SESSION';
  if (!parsePremiumReference(reference,nowMs)) return 'INVALID_PREMIUM_REFERENCE';
  if (stamp.seconds >= 15*3600+15*60) return 'TIME';
  if (!quote) return 'WAIT_FRESH_PREMIUM_QUOTE';
  quoted(quote, nowMs);
  return evaluatePremiumBid(reference, quote, nowMs);
}

/** Underlying futures virtual exit review; ambiguous stop+target is risk-first. */
export function underlyingExit(position, candle, nowMs) {
  const clock = local(nowMs);
  if (!position || !candle || !['CE','PE'].includes(position.direction) ||
      !Number.isFinite(position.stop) || !Number.isFinite(position.target) ||
      !Number.isSafeInteger(candle.startMs) || !finitePositive(candle.high) ||
      !finitePositive(candle.low) || candle.low > candle.high ||
      !Number.isSafeInteger(parseAware(position.signal_candle)) ||
      candle.startMs <= parseAware(position.signal_candle) ||
      sessionStatus(clock.date) !== 'REGULAR') return null;
  const stopped = position.direction === 'CE' ? candle.low <= position.stop : candle.high >= position.stop;
  const target = position.direction === 'CE' ? candle.high >= position.target : candle.low <= position.target;
  if (stopped && target) return 'INTRABAR_STOP_TARGET_AMBIGUOUS_RISK_FIRST';
  if (stopped) return 'STOP';
  if (target) return 'TARGET';
  return clock.seconds > 15*3600+15*60 ? 'TIME' : null;
}

/** Pure Python PaperBook.exit math/reason parity. Never mutates a ledger. */
export function decidePaperExit(position, quote, nowMs) {
  const clock = local(nowMs);
  if (sessionStatus(clock.date) !== 'REGULAR' ||
      clock.seconds < 9*3600+30*60 || clock.seconds >= 15*3600+26*60) {
    throw new Error('outside permitted paper-trading time');
  }
  quoted(quote, nowMs);
  if (!position || typeof position.trade_id !== 'string') throw new Error('unknown paper position');
  const trade_id = position.trade_id;
  if (position.status === 'CLOSED') return { status:'DUPLICATE', trade_id };
  if (position.status === 'EXIT_UNVERIFIABLE') return { status:'UNVERIFIABLE', trade_id };
  const c = quote.contract;
  if (position.option_symbol !== c.symbol || position.option_kind !== c.kind) throw new Error('option mismatch');
  if (position.option_expiry !== c.expiry || position.option_token !== c.token ||
      position.lot_size !== c.lot_size) throw new Error('lot/expiry mismatch');
  if (nowMs <= parseAware(position.entry_at) || quote.updatedMs < parseAware(position.entry_quote_at)) {
    throw new Error('noncausal option exit');
  }
  const qty = position.lots * position.lot_size;
  if (!Number.isSafeInteger(qty) || qty < 1) throw new Error('invalid paper quantity');
  if (quote.bid_quantity < qty) return { status:'WAIT_DEPTH', trade_id };
  const bid = moneyScaled(quote.bid);
  const reason = clock.seconds >= 15*3600+15*60 ? 'TIME' :
    bid <= position.stop_bid_paise ? 'STOP' : bid >= position.target_bid_paise ? 'TARGET' : 'HOLD';
  if (reason === 'HOLD') return { status:'HOLD', trade_id };
  if (!Number.isSafeInteger(position.slippage_bps) || position.slippage_bps < 0 ||
      position.slippage_bps > 10000) throw new Error('invalid slippage');
  const fill = moneyScaled(quote.bid, 10000-position.slippage_bps, 10000);
  const fee = position.fee_model_version === COST_POLICY ?
    estimateLeg((fill/100).toFixed(2), qty, 'SELL', clock.date).total_paise :
    position.exit_fee_assumed_paise;
  if (!Number.isSafeInteger(fee) || fee < 0 || !Number.isSafeInteger(position.entry_debit_paise)) {
    throw new Error('invalid ledger input');
  }
  const credit = qty*fill-fee;
  if (credit < 0) return {status:'WAIT_VALUE', trade_id};
  const pnl = credit-position.entry_debit_paise;
  return {status:'CLOSED', trade_id, reason, exit_reference_rs:bid/100,
    simulated_exit_fill_rs:fill/100, net_pnl_rs:pnl/100, paper_only:true};
}
