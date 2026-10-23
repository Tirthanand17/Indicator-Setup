/** Pure offline numerical port. Not connected to Worker polling or execution. */
const day = ms => new Date(ms + 19_800_000).toISOString().slice(0, 10);

export function ema(values, length) {
  if (!Number.isInteger(length) || length < 1 || !values.length) throw new Error('invalid EMA');
  const alpha = 2 / (length + 1), out = [values[0]];
  for (const value of values.slice(1)) out.push(value * alpha + out.at(-1) * (1 - alpha));
  return out;
}

function rma(values, length) {
  const out = [], seed = [];
  let previous = null;
  for (const value of values) {
    if (value !== null) {
      if (previous === null) {
        seed.push(value);
        if (seed.length === length) previous = seed.reduce((a,b) => a+b, 0) / length;
      } else previous = ((length - 1) * previous + value) / length;
    }
    out.push(previous);
  }
  return out;
}

export function compute(candles, length = 14) {
  if (!Number.isInteger(length) || length < 1 || candles.length < Math.max(70, 3 * length)) {
    throw new Error('insufficient indicator warmup');
  }
  for (let i=0; i<candles.length; i++) {
    const b=candles[i];
    if (!Number.isSafeInteger(b.startMs) || !Number.isFinite(new Date(b.startMs).valueOf()) ||
        ![b.open,b.high,b.low,b.close].every(v=>Number.isFinite(v)&&v>0) ||
        b.high<Math.max(b.open,b.close,b.low) || b.low>Math.min(b.open,b.close,b.high) ||
        !Number.isSafeInteger(b.volume) || b.volume<0 || (i && candles[i-1].startMs>=b.startMs)) {
      throw new Error('invalid candle');
    }
  }
  const closes=candles.map(b=>b.close), tr=[null], plus=[null], minus=[null];
  for(let i=1;i<candles.length;i++) {
    const a=candles[i-1], b=candles[i], up=b.high-a.high, down=a.low-b.low;
    plus.push(up>down&&up>0?up:0); minus.push(down>up&&down>0?down:0);
    tr.push(Math.max(b.high-b.low,Math.abs(b.high-a.close),Math.abs(b.low-a.close)));
  }
  const atr=rma(tr,length), pd=rma(plus,length), md=rma(minus,length);
  const pdi=[],mdi=[],dx=[];
  for(let i=0;i<atr.length;i++) {
    if(atr[i]===null || pd[i]===null || md[i]===null || atr[i]<=0) {
      pdi.push(null);mdi.push(null);dx.push(null);continue;
    }
    const p=100*pd[i]/atr[i],m=100*md[i]/atr[i];
    pdi.push(p);mdi.push(m);dx.push(p+m>0?100*Math.abs(p-m)/(p+m):0);
  }
  const adx=rma(dx,length), daily=candles.filter(b=>day(b.startMs)===day(candles.at(-1).startMs));
  if(adx.at(-1)===null || adx.at(-2)===null || atr.at(-1)===null || daily.some(b=>b.volume<=0)) {
    throw new Error('indicators or session volume unavailable');
  }
  const volume=daily.reduce((sum,b)=>sum+b.volume,0);
  const vwap=daily.reduce((sum,b)=>sum+(b.high+b.low+b.close)/3*b.volume,0)/volume;
  return {vwap,ema9:ema(closes,9).at(-1),ema21:ema(closes,21).at(-1),
    plus_di:pdi.at(-1),minus_di:mdi.at(-1),adx:adx.at(-1),previous_adx:adx.at(-2),atr:atr.at(-1)};
}

export const COST_POLICY='ZERODHA_NSE_OPTIONS_2026_04_V1';
function halfUp(n,d) { return (2n*n+d)/(2n*d); }

export function estimateLeg(price,qty,side,onDate) {
  if (!['BUY','SELL'].includes(side) || !Number.isSafeInteger(qty) || qty<1 || qty>100000 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(onDate) || onDate<'2026-04-01' ||
      !Number.isFinite(Date.parse(onDate+'T00:00:00Z')) ||
      new Date(onDate+'T00:00:00Z').toISOString().slice(0,10)!==onDate) throw new Error('invalid fee input');
  const raw=String(price);
  if(!/^\d+(\.\d{1,8})?$/.test(raw) || !(Number(raw)>0 && Number(raw)<=10000000)) throw new Error('invalid premium');
  const parts=raw.split('.'),scale=10n**BigInt(parts[1]?.length??0);
  const value=BigInt(parts.join(''))*BigInt(qty), denominator=scale*100000000n;
  const paise=(numerator)=>Number(halfUp(numerator*100n,denominator));
  const brokerage=20n*denominator, exchange=value*35530n, sebi=value*100n;
  const bp=2000, ep=paise(exchange),sp=paise(sebi);
  const gp=Number(halfUp((brokerage+exchange+sebi)*18n,denominator));
  const stamp=side==='BUY'?paise(value*3000n):0;
  const stt=side==='SELL'?Number(halfUp(value*15n,scale*10000n))*100:0;
  return {policy:COST_POLICY,side,qty,notional_paise:Number(halfUp(value*100n,scale)),
    brokerage_paise:bp,exchange_paise:ep,sebi_paise:sp,gst_paise:gp,
    stamp_paise:stamp,stt_paise:stt,total_paise:bp+ep+sp+gp+stamp+stt,audited:false};
}
