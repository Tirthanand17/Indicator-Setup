/* Read ONLY visible chart legend text. No cookies, hashes, broker tokens, network, or orders. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SignalReader = api;
})(typeof self !== 'undefined' ? self : globalThis, function() {
  'use strict';
  const numeric = s => {
    if (typeof s !== 'string') return NaN;
    const x = s.replace(/[\u2212\u2013\u2014]/g,'-').replace(/,/g,'').replace(/\s+/g,'');
    return /^[-+]?\d+(?:\.\d+)?$/.test(x) ? Number(x) : NaN;
  };
  function volumeValue(raw) {
    if (typeof raw !== 'string') return NaN;
    const x = raw.replace(/,/g,'').replace(/\s+/g,'').toUpperCase();
    const m = x.match(/^(\d+(?:\.\d+)?)([KMB])?$/);
    if (!m) return NaN;
    return Number(m[1]) * ({'K':1e3,'M':1e6,'B':1e9}[m[2]] || 1);
  }
  function parse(text) {
    const rows = String(text || '').split(/[\r\n]+/).map(s=>s.trim()).filter(Boolean);
    const errors = [];
    const symbol = rows.find(s => /^NIFTY\d{2}(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)FUT$/.test(s));
    if (!symbol) errors.push('NIFTY futures symbol not found');
    const timeframe = rows.find(s => /^\d+[mhd]$/i.test(s));
    if (timeframe !== '5m') errors.push('Chart must display 5m candles');
    if (!rows.includes('NFO-FUT')) errors.push('This is not a NIFTY futures chart');
    function index(label, start=0) { return rows.indexOf(label, start); }
    function pair(key) {
      const i = index(key);
      return i < 0 ? NaN : numeric(rows[i+1]);
    }
    const result = { symbol:symbol || null, timeframe:timeframe || null, open:pair('O'),high:pair('H'),low:pair('L'),close:pair('C'),volume:NaN,vwap:NaN,ema9:NaN,ema21:NaN,plusDI:NaN,minusDI:NaN,adx:NaN,atr:NaN };
    const vol=index('Volume'); if(vol>=0) result.volume=volumeValue(rows[vol+1]);
    const vw=index('VWAP');
    if (vw>=0 && /^hlc3\s+Session$/i.test(rows[vw+1]||'')) result.vwap=numeric(rows[vw+2]);
    const emaIndices=rows.map((s,i)=>s==='EMA'?i:-1).filter(i=>i>=0);
    for(const i of emaIndices){
      const inputs=rows[i+1]||'';
      if (/^9\s+close\s+0$/i.test(inputs)) result.ema9=numeric(rows[i+2]);
      if (/^21\s+close\s+0$/i.test(inputs)) result.ema21=numeric(rows[i+2]);
    }
    const dmi=index('DMI');
    if(dmi>=0 && /^14\s+14$/.test(rows[dmi+1]||'')) {
      result.plusDI=numeric(rows[dmi+2]);result.minusDI=numeric(rows[dmi+3]);result.adx=numeric(rows[dmi+4]);
    }
    const atr=index('ATR'); if (atr>=0 && rows[atr+1] === '14') result.atr=numeric(rows[atr+2]);
    for(const key of ['open','high','low','close','volume','vwap','ema9','ema21','plusDI','minusDI','adx','atr']) {
      if(!Number.isFinite(result[key])) errors.push('Invalid or absent chart '+key);
    }
    for(const key of ['open','high','low','close','vwap','ema9','ema21','atr','volume']){
      if(Number.isFinite(result[key]) && !(result[key]>0)) errors.push('Nonpositive '+key);
    }
    if(Number.isFinite(result.high)&&Number.isFinite(result.low)&&result.high<result.low)errors.push('Invalid OHLC high/low');
    if(Number.isFinite(result.close)&&Number.isFinite(result.high)&&Number.isFinite(result.low)&&(result.close>result.high+0.01||result.close<result.low-0.01))errors.push('Close outside candle range');
    for(const key of ['plusDI','minusDI','adx']) if(Number.isFinite(result[key])&&(result[key]<0||result[key]>100))errors.push('Invalid DMI '+key);
    // Keep this parser restricted to the five exact configured indicators.
    return {ok:errors.length===0, errors, values:errors.length===0?result:null};
  }
  return {parse, volumeValue, numeric};
});
