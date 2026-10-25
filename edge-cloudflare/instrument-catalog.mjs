/** Bounded daily NIFTY master. Prices always come from fresh quotes, never CSV. */
import {sessionStatus,validClaimedTickId} from './alarm-core.mjs';
import {csvRecord} from './option-readonly.mjs';
import {auditPaperLedger} from './paper-ledger.mjs';

export const INSTRUMENT_CATALOG_KEY='readonly-instrument-catalog-v1';
const OFFSET=330*60_000,MAX_AGE=12*60*60_000,RETRY=30*60_000;
const HEADER='instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange';
const fail=code=>{throw Error('NIFTY_CATALOG_'+code);};
const integer=n=>Number.isSafeInteger(n)&&n>0;
const day=ms=>new Date(ms+OFFSET).toISOString().slice(0,10);
const validDate=s=>typeof s==='string'&&/^2026-\d\d-\d\d$/.test(s)&&
  Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const optionIdentity=c=>c&&['CE','PE'].includes(c.kind)&&
  new RegExp('^NIFTY\\d{2}[A-Z0-9]+'+c.kind+'$').test(c.symbol)&&validDate(c.expiry)&&
  integer(c.token)&&integer(c.lotSize)&&integer(c.strike);
const option=c=>optionIdentity(c)&&Number.isFinite(c.tickSize)&&c.tickSize>0;
const months=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const future=c=>c&&validDate(c.expiry)&&integer(c.token)&&integer(c.lotSize)&&
  c.symbol===`NIFTY${c.expiry.slice(2,4)}${months[Number(c.expiry.slice(5,7))-1]}FUT`;
const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).byteLength;

export function auditCatalog(catalog,nowMs) {
  if(!catalog||catalog.schema!==1||!validDate(catalog.day)||sessionStatus(catalog.day)!=='REGULAR'||
    !integer(catalog.fetchedAtMs)||day(catalog.fetchedAtMs)!==catalog.day||
    !Array.isArray(catalog.futures)||catalog.futures.length<1||catalog.futures.length>6||
    !Array.isArray(catalog.pairs)||catalog.pairs.length>1000||bytes(catalog)>1_500_000) fail('INVALID_CATALOG');
  const symbols=new Set(),tokens=new Set(),strikes=new Set(),expiries=new Set();
  const unique=c=>{
    if(symbols.has(c.symbol)||tokens.has(c.token))fail('DUPLICATE_CONTRACT');
    symbols.add(c.symbol);tokens.add(c.token);
  };
  for(const c of catalog.futures) {
    if(!future(c)||c.expiry<catalog.day||expiries.has(c.expiry))fail('INVALID_FUTURE');
    expiries.add(c.expiry);unique(c);
  }
  let pairExpiry=null;
  for(const p of catalog.pairs) {
    if(!option(p.CE)||!option(p.PE)||p.CE.kind!=='CE'||p.PE.kind!=='PE'||
      p.CE.expiry!==p.PE.expiry||p.CE.expiry<=catalog.day||p.CE.strike!==p.PE.strike||
      p.CE.lotSize!==p.PE.lotSize||(pairExpiry!==null&&pairExpiry!==p.CE.expiry)||
      strikes.has(`${p.CE.expiry}:${p.CE.strike}`))fail('INVALID_PAIR');
    pairExpiry=p.CE.expiry;
    strikes.add(`${p.CE.expiry}:${p.CE.strike}`);unique(p.CE);unique(p.PE);
  }
  if(nowMs!==undefined&&(!integer(nowMs)||day(nowMs)!==catalog.day||nowMs<catalog.fetchedAtMs||
    nowMs-catalog.fetchedAtMs>MAX_AGE))fail('STALE_CATALOG');
  return true;
}

export function compileNiftyCatalog(csv,nowMs) {
  if(typeof csv!=='string'||csv.length<40||csv.length>16*1024*1024||
    !integer(nowMs)||sessionStatus(day(nowMs))!=='REGULAR')fail('INVALID_MASTER');
  const lines=csv.replace(/^\uFEFF/,'').split(/\r?\n/);
  if(lines.length>180000||csvRecord(lines[0]).join(',')!==HEADER)fail('INVALID_SCHEMA');
  const today=day(nowMs),futures=[],pairs=new Map(),tokens=new Set(),symbols=new Set();
  for(const line of lines.slice(1)) {
    if(!line||!line.includes('NIFTY'))continue;
    const a=csvRecord(line);
    if(a.length!==12)fail('INVALID_ROW');
    const [rawToken,,symbol,name,,expiry,strike,tick,lot,kind,segment,exchange]=a;
    if((name!==''&&name!=='NIFTY')||exchange!=='NFO')continue;
    if(!(kind==='FUT'&&segment==='NFO-FUT'&&/^NIFTY\d{2}[A-Z]{3}FUT$/.test(symbol))&&
      !(['CE','PE'].includes(kind)&&segment==='NFO-OPT'&&/^NIFTY\d{2}[A-Z0-9]+(?:CE|PE)$/.test(symbol)))continue;
    if(!validDate(expiry)||!integer(Number(rawToken))||!integer(Number(lot))||
      !Number.isFinite(Number(tick))||Number(tick)<=0)fail('INVALID_ROW');
    if(tokens.has(Number(rawToken))||symbols.has(symbol))fail('DUPLICATE_CONTRACT');
    tokens.add(Number(rawToken));symbols.add(symbol);
    if(kind==='FUT') {
      const c={symbol,expiry,token:Number(rawToken),lotSize:Number(lot)};
      if(!future(c))fail('INVALID_FUTURE');
      if(expiry>=today)futures.push(c);
    } else {
      const c={symbol,kind,expiry,strike:Number(strike),token:Number(rawToken),lotSize:Number(lot),tickSize:Number(tick)};
      if(!option(c))fail('INVALID_OPTION');
      if(expiry<=today)continue;
      const key=`${expiry}:${strike}`,p=pairs.get(key)??{};
      if(p[kind])fail('DUPLICATE_CONTRACT');
      p[kind]=c;pairs.set(key,p);
    }
  }
  // Retain every strike for the earliest complete eligible expiry. Never clip
  // the strike range around a morning price or assume an expiry/lot size.
  const complete=[...pairs.values()].filter(p=>p.CE&&p.PE);
  const expiry=complete.map(p=>p.CE.expiry).sort()[0];
  const catalog={schema:1,day:today,fetchedAtMs:nowMs,
    futures:futures.sort((a,b)=>a.expiry.localeCompare(b.expiry)),
    pairs:complete.filter(p=>p.CE.expiry===expiry).sort((a,b)=>a.CE.strike-b.CE.strike)};
  auditCatalog(catalog,nowMs);return catalog;
}

export function selectCatalogFuture(catalog,nowMs) {
  auditCatalog(catalog,nowMs);
  return catalog.futures.slice().sort((a,b)=>a.expiry.localeCompare(b.expiry))[0];
}

export function selectCatalogPair(catalog,nowMs,price) {
  auditCatalog(catalog,nowMs);
  if(typeof price!=='number'||!Number.isFinite(price)||price<=0||price>1_000_000)fail('INVALID_PRICE');
  const p=catalog.pairs.slice().sort((a,b)=>Math.abs(a.CE.strike-price)-Math.abs(b.CE.strike-price)||
    a.CE.strike-b.CE.strike)[0];
  if(!p||Math.abs(p.CE.strike-price)>250)fail('NO_ATM_PAIR');
  return {...p,expiry:p.CE.expiry,strike:p.CE.strike,masterFetchedAtMs:catalog.fetchedAtMs,selectedAtMs:nowMs};
}

export function auditCatalogState(state) {
  if(state===undefined)return;
  if(!state||state.schema!==1||sessionStatus(state.day)!=='REGULAR'||
    !Number.isSafeInteger(state.attempts)||state.attempts<1||state.attempts>3||
    !validClaimedTickId(state.tickId)||state.tickId.split(':')[0]!==state.day||
    !integer(state.retryAtMs)||!['PENDING','READY','BLOCKED'].includes(state.status)||
    (state.status==='READY')!==(state.catalog!==null))fail('INVALID_CACHE_STATE');
  if(state.catalog!==null){auditCatalog(state.catalog);if(state.catalog.day!==state.day)fail('CACHE_DAY');}
}

export function claimCatalogFetch(state,tickId,nowMs) {
  auditCatalogState(state);
  if(!integer(nowMs)||!validClaimedTickId(tickId)||tickId.split(':')[0]!==day(nowMs)||
    sessionStatus(day(nowMs))!=='REGULAR'||(state&&state.day>day(nowMs)))fail('INVALID_TICK');
  const old=state?.day===day(nowMs)?state:undefined;
  if(old&&(old.catalog||old.attempts>=3||nowMs<old.retryAtMs||old.tickId===tickId))return {allowed:false,state:old};
  return {allowed:true,state:{schema:1,day:day(nowMs),attempts:(old?.attempts??0)+1,
    tickId,retryAtMs:nowMs+RETRY,status:'PENDING',catalog:null}};
}

export function settleCatalogFetch(state,tickId,catalog) {
  auditCatalogState(state);
  if(!state||state.status!=='PENDING'||state.tickId!==tickId)fail('STALE_FETCH_RESULT');
  if(catalog!==null){auditCatalog(catalog);if(catalog.day!==state.day)fail('CACHE_DAY');}
  return {...state,status:catalog===null?'BLOCKED':'READY',catalog};
}

/** Preserve exact open-position identity, even after a new ATM pair is selected. */
export function optionQuotePlan(pair,ledger,catalog,nowMs) {
  if(ledger!==undefined)auditPaperLedger(ledger);
  const contracts=[pair.CE,pair.PE];
  for(const p of ledger?.positions??[]) {
    if(p.status!=='OPEN')continue;
    const match=catalog?.pairs.flatMap(x=>[x.CE,x.PE]).find(c=>c.symbol===p.symbol&&c.token===p.token);
    if(match&&(match.expiry!==p.expiry||match.lotSize!==p.lotSize||
      (p.strike!==undefined&&match.strike!==p.strike)))fail('OPEN_CONTRACT_MISMATCH');
    const c={symbol:p.symbol,kind:p.kind,expiry:p.expiry,token:p.token,lotSize:p.lotSize,
      strike:p.strike??match?.strike};
    if(!optionIdentity(c)||c.expiry<=day(nowMs))fail('OPEN_CONTRACT_UNAVAILABLE');
    const existing=contracts.find(x=>x.symbol===c.symbol);
    if(contracts.some(x=>x.token===c.token&&x.symbol!==c.symbol))fail('OPEN_CONTRACT_MISMATCH');
    if(existing&&(existing.token!==c.token||existing.expiry!==c.expiry||existing.lotSize!==c.lotSize||existing.strike!==c.strike))fail('OPEN_CONTRACT_MISMATCH');
    if(!existing)contracts.push(c);
  }
  if(contracts.length>4)fail('QUOTE_PLAN_CAPACITY');
  return contracts;
}
