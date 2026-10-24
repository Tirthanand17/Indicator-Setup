/** Pure, read-only NIFTY option evidence. No orders, portfolios, alarms, or messages. */
import { sessionStatus } from './alarm-core.mjs';
import { parseAwareCandleTimestamp } from './market-readonly.mjs';

const IST_MS = 330 * 60_000;
const MASTER_MAX_AGE_MS = 12 * 60 * 60_000;
const HEADER = ['instrument_token','exchange_token','tradingsymbol','name',
  'last_price','expiry','strike','tick_size','lot_size','instrument_type','segment','exchange'];
const SYMBOL = /^NIFTY[A-Z0-9]+(CE|PE)$/;
const fail = code => { throw new Error(`NIFTY_OPTION_READONLY_${code}`); };
const positiveInt = n => Number.isSafeInteger(n) && n > 0;
const positiveNumber = n => typeof n === 'number' && Number.isFinite(n) && n > 0;
const dayIst = ms => new Date(ms + IST_MS).toISOString().slice(0, 10);
const validDay = day => typeof day === 'string' && /^2026-\d\d-\d\d$/.test(day) &&
  Number.isFinite(Date.parse(day+'T00:00:00Z')) &&
  new Date(day+'T00:00:00Z').toISOString().slice(0, 10) === day;

function csvRecord(line) {
  const fields=[]; let value='', quoted=false, closed=false;
  for(let i=0;i<line.length;i++) {
    const c=line[i];
    if(quoted) {
      if(c==='"' && line[i+1]==='"') { value+='"'; i++; }
      else if(c==='"') { quoted=false; closed=true; }
      else value+=c;
    } else if(c===',' && !closed) { fields.push(value); value=''; }
    else if(c===',' && closed) { fields.push(value); value=''; closed=false; }
    else if(c==='"' && value==='' && !closed) quoted=true;
    else if(c==='"' || closed) fail('BAD_CSV');
    else value+=c;
  }
  if(quoted) fail('BAD_CSV');
  fields.push(value);
  return fields;
}

/**
 * Select a paired near-ATM NIFTY CE/PE with identical expiry, strike and lot
 * size from the day's Kite NFO master; do not assume an expiry or lot size.
 * Master freshness here is the fetch time, not proof of exchange publication.
 */
export function discoverAtmNiftyOptionPair(csv, {
  observedAtMs, masterFetchedAtMs, futuresLastPrice,
}={}) {
  if(typeof csv !== 'string' || csv.length < 40 || csv.length > 16*1024*1024 ||
      !positiveInt(observedAtMs) || !positiveInt(masterFetchedAtMs) ||
      masterFetchedAtMs > observedAtMs ||
      observedAtMs - masterFetchedAtMs > MASTER_MAX_AGE_MS ||
      !positiveNumber(futuresLastPrice)) fail('INVALID_MASTER_EVIDENCE');
  const today=dayIst(observedAtMs);
  if(dayIst(masterFetchedAtMs)!==today || sessionStatus(today)!=='REGULAR')
    fail('CLOSED_OR_STALE_MASTER');
  const lines=csv.replace(/^\uFEFF/,'').split(/\r?\n/);
  if(lines.length > 180_000 ||
      csvRecord(lines[0]).join('|')!==HEADER.join('|')) fail('BAD_MASTER_SCHEMA');
  const pairs=new Map();
  const seenTokens=new Set();
  for(let i=1;i<lines.length;i++) {
    const line=lines[i];
    if(!line || !line.includes('NIFTY')) continue;
    const a=csvRecord(line);
    if(a.length!==HEADER.length) fail('BAD_NIFTY_ROW');
    const [token, , symbol, name, , expiry, strikeRaw, tickRaw, lotRaw, kind, segment, exchange]=a;
    if(name!=='' && name!=='NIFTY') continue;
    if(exchange!=='NFO' || segment!=='NFO-OPT' || !['CE','PE'].includes(kind) ||
       !SYMBOL.test(symbol) || !symbol.endsWith(kind)) continue;
    const strike=Number(strikeRaw), lotSize=Number(lotRaw),
      tokenNumber=Number(token), tickSize=Number(tickRaw);
    if(!validDay(expiry) ||
       !positiveInt(tokenNumber) || !positiveInt(lotSize) ||
       !Number.isSafeInteger(strike) || strike<=0 ||
       !Number.isFinite(tickSize) || tickSize<=0) fail('BAD_NIFTY_ROW');
    // The exchange can list expiry-day instruments; this strategy must not use them.
    if(expiry<=today) continue;
    if(seenTokens.has(tokenNumber)) fail('DUPLICATE_TOKEN');
    seenTokens.add(tokenNumber);
    const id=`${expiry}:${strike}`;
    const record=pairs.get(id)??{expiry,strike};
    if(record[kind]) fail('DUPLICATE_CONTRACT');
    record[kind]=Object.freeze({symbol,kind,expiry,strike,token:tokenNumber,lotSize,tickSize});
    pairs.set(id,record);
  }
  const valid=[...pairs.values()].filter(p=>p.CE&&p.PE)
    .sort((a,b)=>a.expiry.localeCompare(b.expiry) ||
      Math.abs(a.strike-futuresLastPrice)-Math.abs(b.strike-futuresLastPrice) ||
      a.strike-b.strike);
  if(!valid.length) fail('NO_COMPLETE_PAIR');
  const best=valid[0];
  if(Math.abs(best.strike-futuresLastPrice)>250 ||
     best.CE.lotSize!==best.PE.lotSize || best.CE.token===best.PE.token)
    fail('PAIR_INCONSISTENT');
  return Object.freeze({CE:best.CE,PE:best.PE,expiry:best.expiry,
    strike:best.strike,masterFetchedAtMs,selectedAtMs:observedAtMs});
}

/** Kite quote timestamps without an offset are exchange-local IST, not UTC. */
export function parseKiteQuoteTimestamp(value) {
  if(typeof value!=='string') return NaN;
  if(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)) {
    const normalized=value.replace(' ','T')+'+05:30';
    const ms=Date.parse(normalized);
    if(!Number.isFinite(ms)) return NaN;
    const reconstructed=new Date(ms+IST_MS).toISOString().slice(0,19).replace('T',' ');
    return reconstructed===value?ms:NaN;
  }
  return parseAwareCandleTimestamp(value);
}

/** Return the strict shape accepted by checkQuote, but never enter a position. */
export function normalizeKiteOptionQuote(quote, contract, observedAtMs) {
  if(!positiveInt(observedAtMs) || sessionStatus(dayIst(observedAtMs))!=='REGULAR' ||
     !contract || !SYMBOL.test(contract.symbol??'') ||
     !['CE','PE'].includes(contract.kind) || !contract.symbol.endsWith(contract.kind) ||
     !validDay(contract.expiry) || contract.expiry<=dayIst(observedAtMs) ||
     !positiveInt(contract.token) || !positiveInt(contract.lotSize) ||
     !positiveInt(contract.strike)) fail('INVALID_CONTRACT');
  if(!quote || typeof quote!=='object' || Array.isArray(quote) ||
     quote.instrument_token!==contract.token) fail('QUOTE_TOKEN_MISMATCH');
  const updatedAtMs=parseKiteQuoteTimestamp(quote.timestamp);
  if(!Number.isSafeInteger(updatedAtMs) ||
     dayIst(updatedAtMs)!==dayIst(observedAtMs) ||
     observedAtMs-updatedAtMs>15_000 || updatedAtMs-observedAtMs>3_000)
    fail('STALE_QUOTE');
  const bidLevel=quote.depth?.buy?.[0], askLevel=quote.depth?.sell?.[0];
  const bid=bidLevel?.price, ask=askLevel?.price;
  const bidQuantity=bidLevel?.quantity, askQuantity=askLevel?.quantity;
  if(!positiveNumber(bid) || !positiveNumber(ask) ||
     ask<=bid || (ask-bid)*200>(ask+bid)*2) fail('INVALID_SPREAD');
  if(!positiveInt(bidQuantity) || !positiveInt(askQuantity) ||
     bidQuantity<contract.lotSize || askQuantity<contract.lotSize)
    fail('INSUFFICIENT_DEPTH');
  return Object.freeze({contract:Object.freeze({symbol:contract.symbol,kind:contract.kind,
    expiry:contract.expiry,strike:contract.strike,token:contract.token,
    lotSize:contract.lotSize}),bid,ask,bidQuantity,askQuantity,updatedAtMs});
}

/** All-or-nothing validation; explicitly prohibits trading and notifications. */
export function validatePairEvidence({pair,quotes,observedAtMs}={}) {
  if(!pair?.CE || !pair?.PE || pair.CE.kind!=='CE' || pair.PE.kind!=='PE' ||
      pair.CE.expiry!==pair.PE.expiry || pair.CE.strike!==pair.PE.strike ||
      pair.CE.lotSize!==pair.PE.lotSize || !quotes) fail('PAIR_INCONSISTENT');
  const CE=normalizeKiteOptionQuote(quotes.CE,pair.CE,observedAtMs);
  const PE=normalizeKiteOptionQuote(quotes.PE,pair.PE,observedAtMs);
  return Object.freeze({CE,PE,source:'READONLY_OPTION_EVIDENCE_ONLY',
    paperEntryAuthorized:false,telegramAuthorized:false,realOrdersEnabled:false});
}
