/** Allowlisted, credential-redacting Kite REST transport. No trading methods. */
const ROOT = 'https://api.kite.trade';
const MAX_JSON_BYTES = 512 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });
const MARKET_ERROR = 'KITE_READONLY_UNAVAILABLE';
const OPTION_SYMBOL = /^NIFTY[A-Z0-9]+(?:CE|PE)$/;

/** Kite's documented history timestamps use +0530 (without a colon).
 * Canonicalize the explicit offset before Date.parse; never infer host time.
 */
export function parseAwareCandleTimestamp(value) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:Z|[+-]\d\d:?\d\d)$/.test(value))
    return NaN;
  return Date.parse(value.replace(/([+-]\d\d)(\d\d)$/, '$1:$2'));
}

export function permittedMarketUrl(value) {
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.origin !== ROOT || url.username || url.password || url.hash) return false;
  if (url.pathname === '/quote') {
    const keys = [...url.searchParams.keys()];
    const values = url.searchParams.getAll('i');
    if (!keys.length || keys.length > 4 || keys.some(k => k !== 'i') ||
        values.length !== keys.length ||
        values.some(k => !/^NFO:NIFTY[A-Z0-9]+$/.test(k))) return false;
    if (keys.length === 1) return true;
    // Entry pair plus at most two distinct open-position option contracts.
    // Futures remain single-instrument only; no arbitrary bulk quote surface.
    return new Set(values).size===values.length &&
      values.every(k=>OPTION_SYMBOL.test(k.slice(4))) &&
      values.some(k => OPTION_SYMBOL.test(k.slice(4)) && k.endsWith('CE')) &&
      values.some(k => OPTION_SYMBOL.test(k.slice(4)) && k.endsWith('PE'));
  }
  if (/^\/instruments\/historical\/[1-9]\d*\/(5minute|15minute)$/.test(url.pathname)) {
    return [...url.searchParams.keys()].sort().join(',') === 'continuous,from,oi,to' &&
      url.searchParams.get('continuous') === '0' && url.searchParams.get('oi') === '0' &&
      /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(url.searchParams.get('from') ?? '') &&
      /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(url.searchParams.get('to') ?? '');
  }
  return url.pathname === '/instruments/NFO' && !url.search;
}

function credential(value) {
  return typeof value === 'string' && value.length >= 3 && value.length <= 1024 &&
    /^[\x21-\x7e]+$/.test(value) && !value.includes(':');
}

function recentCandle(row) {
  return Array.isArray(row) && row.length === 6 &&
    Number.isFinite(parseAwareCandleTimestamp(row[0])) &&
    row.slice(1, 5).every(v => typeof v === 'number' && Number.isFinite(v) && v > 0) &&
    Number.isSafeInteger(row[5]) && row[5] >= 0 &&
    row[2] >= Math.max(row[1], row[4], row[3]) && row[3] <= Math.min(row[1], row[4]);
}

async function readBounded(response, limit) {
  if (!response.body) throw new Error('invalid response');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('oversized response');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return decoder.decode(bytes);
}

export function createReadOnlyKite({ apiKey, accessToken, fetchImpl = globalThis.fetch, timeoutMs = 8000 }) {
  if (!credential(apiKey) || !credential(accessToken) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 8000 ||
      typeof fetchImpl !== 'function') throw new Error('Read-only market configuration invalid');

  let lastQuoteRequestMs = -Infinity;
  async function get(path, { asCsv = false } = {}) {
    const url = ROOT + path;
    if (!permittedMarketUrl(url)) throw new Error('Read-only market URL blocked');
    if (path.startsWith('/quote?')) {
      const at = Date.now();
      // Kite's documented 1 quote request / second: no automatic retry,
      // delay or over-quota burst inside this single client instance.
      if (at - lastQuoteRequestMs < 1100)
        throw new Error('KITE_READONLY_QUOTE_RATE_GUARD');
      lastQuoteRequestMs = at;
    }
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      // workerd rejects redirect:'error' before I/O. Manual never follows a
      // Location; the strict status check below rejects all redirect responses.
      const result = await fetchImpl(url, { method: 'GET', redirect: 'manual',
        credentials: 'omit', cache: 'no-store', signal: abort.signal,
        headers: { 'X-Kite-Version': '3', Authorization: `token ${apiKey}:${accessToken}` } });
      if (result.status === 401 || result.status === 403)
        throw new Error('KITE_READONLY_AUTH_EXPIRED');
      if (result.status === 429) throw new Error('KITE_READONLY_RATE_LIMITED');
      if (result.status !== 200 || result.redirected || result.url && !permittedMarketUrl(result.url))
        throw new Error('HTTP failure');
      const contentType = result.headers.get('content-type')?.toLowerCase() ?? '';
      if (asCsv) {
        if (!contentType.includes('text/csv')) throw new Error('invalid CSV');
        // NFO's daily instrument master may be larger than the JSON quote cap.
        // Keep an explicit 16 MiB ceiling; an oversized master fails closed.
        return await readBounded(result, 16 * 1024 * 1024);
      }
      if (!contentType.includes('application/json')) throw new Error('invalid JSON');
      const parsed = JSON.parse(await readBounded(result, MAX_JSON_BYTES));
      if (!parsed || parsed.status !== 'success' || !parsed.data ||
          Array.isArray(parsed.data) || typeof parsed.data !== 'object') throw new Error('invalid envelope');
      return parsed.data;
    } catch (error) {
      const code = error?.message;
      if (['KITE_READONLY_AUTH_EXPIRED', 'KITE_READONLY_RATE_LIMITED'].includes(code))
        throw new Error(code);
      throw new Error(MARKET_ERROR);
    }
    finally { clearTimeout(timer); }
  }
  return Object.freeze({
    async instrumentsNfoCsv() { return get('/instruments/NFO', { asCsv: true }); },
    async quote(symbol) {
      if (typeof symbol !== 'string' || !/^NIFTY[A-Z0-9]+FUT$/.test(symbol))
        throw new Error('Invalid NIFTY symbol');
      const key = `NFO:${symbol}`;
      const data = await get('/quote?i=' + encodeURIComponent(key));
      const quote = data[key];
      if (!quote || typeof quote !== 'object' || Array.isArray(quote) ||
          typeof quote.last_price !== 'number' || !Number.isFinite(quote.last_price) || quote.last_price <= 0)
        throw new Error('Invalid NIFTY quote');
      return quote;
    },
    /** Exactly one CE + one PE option snapshot per GET, no transaction API. */
    async optionPair(ceSymbol, peSymbol) {
      if (typeof ceSymbol !== 'string' || typeof peSymbol !== 'string' ||
          !OPTION_SYMBOL.test(ceSymbol) || !ceSymbol.endsWith('CE') ||
          !OPTION_SYMBOL.test(peSymbol) || !peSymbol.endsWith('PE') ||
          ceSymbol === peSymbol) throw new Error('Invalid NIFTY option pair');
      const ceKey = `NFO:${ceSymbol}`, peKey = `NFO:${peSymbol}`;
      const data = await get('/quote?i=' + encodeURIComponent(ceKey) +
        '&i=' + encodeURIComponent(peKey));
      if (!data[ceKey] || !data[peKey] ||
          typeof data[ceKey] !== 'object' || Array.isArray(data[ceKey]) ||
          typeof data[peKey] !== 'object' || Array.isArray(data[peKey]))
        throw new Error('KITE_READONLY_OPTION_PAIR_MISSING');
      return { CE: data[ceKey], PE: data[peKey] };
    },
    async optionContracts(symbols) {
      if(!Array.isArray(symbols)||symbols.length<2||symbols.length>4||
        new Set(symbols).size!==symbols.length||symbols.some(s=>typeof s!=='string'||!OPTION_SYMBOL.test(s))||
        !symbols.some(s=>s.endsWith('CE'))||!symbols.some(s=>s.endsWith('PE')))
        throw Error('Invalid bounded NIFTY quote plan');
      // Missing instruments are returned as missing evidence, never invented.
      return get('/quote?'+symbols.map(s=>'i='+encodeURIComponent('NFO:'+s)).join('&'));
    },
    async history(token, interval, from, to) {
      if (!Number.isSafeInteger(token) || token <= 0 ||
          !['5minute', '15minute'].includes(interval) ||
          !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(from ?? '') ||
          !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(to ?? '') || from > to)
        throw new Error('Invalid historical query');
      const args = new URLSearchParams({ from, to, continuous: '0', oi: '0' });
      const data = await get(`/instruments/historical/${token}/${interval}?${args}`);
      if (!Array.isArray(data.candles) || data.candles.length > 400 ||
          !data.candles.every(recentCandle)) throw new Error('Invalid historical candles');
      return data.candles;
    },
  });
}
