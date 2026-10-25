/** Durable, offline-testable *read-only* quote pacing and option observations.
 * Persist its records inside DO transactions. No broker writes or messages.
 */
import { validClaimedTickId, sessionStatus } from './alarm-core.mjs';

export const READONLY_QUOTE_PACE_KEY='readonly-quote-pace-v1';
export const READONLY_OPTION_STATE_KEY='readonly-option-state-v1';
const IST_OFFSET=330*60_000;
const MIN_QUOTE_INTERVAL_MS=1_100;
const MASTER_RETRY_MS=30*60_000;
const MAX_MASTER_ATTEMPTS=3;
const MAX_DAILY_REQUESTS=1_125;
const KINDS=['FUTURE','OPTION_PAIR'];
const fail=code=>{throw new Error('READONLY_OPTION_RUNTIME_'+code);};
const integer=n=>Number.isSafeInteger(n)&&n>0;
const dayIst=ms=>new Date(ms+IST_OFFSET).toISOString().slice(0,10);
const isTick=(id,now)=>typeof id==='string'&&validClaimedTickId(id)&&
  id.split(':')[0]===dayIst(now)&&sessionStatus(dayIst(now))==='REGULAR';
const symbol=/^NIFTY[A-Z0-9]+(?:CE|PE)$/;

export function validateQuotePace(state) {
  if(state==null) return true;
  if(!state||state.schema!==1||sessionStatus(state.day)!=='REGULAR'||
     !integer(state.lastReservedAtMs)||dayIst(state.lastReservedAtMs)!==state.day||
     !validClaimedTickId(state.lastTickId)||state.lastTickId.split(':')[0]!==state.day||
     !KINDS.includes(state.lastKind)||!Number.isSafeInteger(state.count)||
     state.count<1||state.count>MAX_DAILY_REQUESTS||
     !Number.isSafeInteger(state.blockedUntilMs)||state.blockedUntilMs<0||
     typeof state.authBlocked!=='boolean') fail('CORRUPT_RATE_STATE');
  return true;
}

/** Consumes a request slot BEFORE the network operation; never refund on fault. */
export function reserveQuoteRequest(state,{tickId,observedAtMs,kind}={}) {
  validateQuotePace(state);
  if(!integer(observedAtMs)||!isTick(tickId,observedAtMs)||!KINDS.includes(kind))
    fail('BAD_RESERVATION');
  const day=dayIst(observedAtMs);
  const previous=state?.day===day?state:null;
  if(previous && (previous.authBlocked||
      observedAtMs<previous.blockedUntilMs||
      observedAtMs-previous.lastReservedAtMs<MIN_QUOTE_INTERVAL_MS||
      previous.count>=MAX_DAILY_REQUESTS||
      tickId===previous.lastTickId||
      Number(tickId.split(':')[1])<Number(previous.lastTickId.split(':')[1])))
    return {allowed:false,state,reason:previous.authBlocked?'AUTH_BLOCKED':
      observedAtMs<previous.blockedUntilMs?'RATE_COOLDOWN':
      previous.count>=MAX_DAILY_REQUESTS?'DAILY_QUOTA_GUARD':'DUPLICATE_OR_PACED'};
  const next=Object.freeze({schema:1,day,lastReservedAtMs:observedAtMs,
    lastTickId:tickId,lastKind:kind,count:(previous?.count??0)+1,
    blockedUntilMs:previous?.blockedUntilMs??0,authBlocked:false});
  return {allowed:true,state:next,reason:'CLAIMED'};
}

/** Only the most recent claim may record an external HTTP failure. */
export function recordQuoteFailure(state,{tickId,observedAtMs,errorCode}={}) {
  validateQuotePace(state);
  if(!integer(observedAtMs)||!state||state.lastTickId!==tickId||
      observedAtMs<state.lastReservedAtMs||!['AUTH_EXPIRED','RATE_LIMITED'].includes(errorCode))
    fail('OUT_OF_ORDER_FAILURE');
  return Object.freeze({...state,authBlocked:state.authBlocked||errorCode==='AUTH_EXPIRED',
    blockedUntilMs:errorCode==='RATE_LIMITED' ?
      Math.max(state.blockedUntilMs,observedAtMs+60_000):state.blockedUntilMs});
}

/** Only a newly authorized token handoff can lift the sticky 403 block. */
export function clearQuoteAuthBlock(state) {
  validateQuotePace(state);
  return state?Object.freeze({...state,authBlocked:false}):null;
}

export function quotePaceStatus(state,nowMs) {
  validateQuotePace(state);
  if(!integer(nowMs)||sessionStatus(dayIst(nowMs))===null)
    fail('BAD_CLOCK');
  if(!state||state.day!==dayIst(nowMs))
    return {status:'NO_DAILY_REQUESTS',requestCount:0,authBlocked:false,
      cooldownRemainingMs:0};
  return {status:state.authBlocked?'AUTH_BLOCKED':
    state.blockedUntilMs>nowMs?'RATE_COOLDOWN':'READY',
    requestCount:state.count,authBlocked:state.authBlocked,
    cooldownRemainingMs:Math.max(0,state.blockedUntilMs-nowMs)};
}

const contractOk=(c,kind)=>c&&c.kind===kind&&typeof c.symbol==='string'&&
  symbol.test(c.symbol)&&c.symbol.endsWith(kind)&&integer(c.token)&&
  integer(c.lotSize)&&integer(c.strike)&&typeof c.expiry==='string'&&
  /^20\d\d-\d\d-\d\d$/.test(c.expiry)&&Number.isFinite(Date.parse(c.expiry+'T00:00:00Z'))&&
  new Date(c.expiry+'T00:00:00Z').toISOString().slice(0,10)===c.expiry;
const legMatches=(v,c,day)=>v&&c&&v.contract&&
  v.contract.symbol===c.symbol&&v.contract.kind===c.kind&&
  v.contract.expiry===c.expiry&&v.contract.strike===c.strike&&
  v.contract.lotSize===c.lotSize&&v.contract.token===c.token&&
  integer(v.updatedAtMs)&&dayIst(v.updatedAtMs)===day&&
  typeof v.bid==='number'&&Number.isFinite(v.bid)&&v.bid>0&&
  typeof v.ask==='number'&&Number.isFinite(v.ask)&&v.ask>v.bid&&
  (v.ask-v.bid)*200<=(v.ask+v.bid)*2&&
  integer(v.bidQuantity)&&integer(v.askQuantity)&&
  v.bidQuantity>=c.lotSize&&v.askQuantity>=c.lotSize;

export function validateOptionRuntime(state) {
  if(state==null) return true;
  if(!state||state.schema!==1||sessionStatus(state.day)!=='REGULAR'||
      !Number.isSafeInteger(state.attempts)||state.attempts<0||
      state.attempts>MAX_MASTER_ATTEMPTS||
      !Number.isSafeInteger(state.nextMasterTryAtMs)||state.nextMasterTryAtMs<0||
      (state.lastMasterTickId!==null&&(!validClaimedTickId(state.lastMasterTickId)||
        state.lastMasterTickId.split(':')[0]!==state.day))||
      (state.lastOptionTickId!==null&&(!validClaimedTickId(state.lastOptionTickId)||
        state.lastOptionTickId.split(':')[0]!==state.day))||
      ((state.attempts===0)!==(state.lastMasterTickId===null))||
      (state.pair!==null&&(!contractOk(state.pair.CE,'CE')||
        !contractOk(state.pair.PE,'PE')||
        state.pair.CE.expiry!==state.pair.PE.expiry||
        state.pair.CE.strike!==state.pair.PE.strike||
        state.pair.CE.lotSize!==state.pair.PE.lotSize||
        state.pair.CE.token===state.pair.PE.token||
        state.pair.CE.expiry<=state.day||
        !integer(state.pair.masterFetchedAtMs)||
        dayIst(state.pair.masterFetchedAtMs)!==state.day))||
      (state.evidence!==null&&(!state.pair||!integer(state.evidence.observedAtMs)||
        dayIst(state.evidence.observedAtMs)!==state.day||
        state.evidence.source!=='READONLY_OPTION_EVIDENCE_ONLY'||
        !legMatches(state.evidence.CE,state.pair.CE,state.day)||
        !legMatches(state.evidence.PE,state.pair.PE,state.day)))||
      !['NO_MASTER','MASTER_PENDING','MASTER_READY','MASTER_BLOCKED',
        'OPTION_PENDING','OPTION_OBSERVED','OPTION_BLOCKED'].includes(state.status)||
      (state.status==='OPTION_OBSERVED'&&!state.evidence)||
      (state.status!=='OPTION_OBSERVED'&&state.evidence!==null)||
      (['MASTER_READY','OPTION_PENDING','OPTION_OBSERVED','OPTION_BLOCKED'].includes(state.status)&&!state.pair))
    fail('CORRUPT_OPTION_STATE');
  return true;
}

export function newOptionRuntime(observedAtMs) {
  if(!integer(observedAtMs)||sessionStatus(dayIst(observedAtMs))!=='REGULAR')
    fail('BAD_CLOCK');
  return {schema:1,day:dayIst(observedAtMs),attempts:0,nextMasterTryAtMs:0,
    lastMasterTickId:null,lastOptionTickId:null,pair:null,evidence:null,status:'NO_MASTER'};
}

/** Rotate the daily snapshot only on a confirmed regular-session alarm. */
export function optionRuntimeForDay(state,nowMs) {
  validateOptionRuntime(state);
  if(!integer(nowMs)||sessionStatus(dayIst(nowMs))!=='REGULAR') fail('BAD_CLOCK');
  if(state?.day===dayIst(nowMs)) return state;
  if(state && state.day>dayIst(nowMs)) fail('CLOCK_ROLLBACK');
  return newOptionRuntime(nowMs);
}

export function claimMasterFetch(state,{tickId,observedAtMs}={}) {
  const current=optionRuntimeForDay(state,observedAtMs);
  if(!isTick(tickId,observedAtMs)) fail('BAD_TICK');
  if(current.pair||current.attempts>=MAX_MASTER_ATTEMPTS||
      observedAtMs<current.nextMasterTryAtMs||current.lastMasterTickId===tickId)
    return {allowed:false,state:current};
  return {allowed:true,state:{...current,attempts:current.attempts+1,
    lastMasterTickId:tickId,nextMasterTryAtMs:observedAtMs+MASTER_RETRY_MS,
    evidence:null,status:'MASTER_PENDING'}};
}

export function commitMasterPair(state,{tickId,pair}={}) {
  validateOptionRuntime(state);
  if(!state||state.status!=='MASTER_PENDING'||state.lastMasterTickId!==tickId||
      !pair||!contractOk(pair.CE,'CE')||!contractOk(pair.PE,'PE')||
      pair.CE.expiry!==pair.PE.expiry||pair.CE.strike!==pair.PE.strike||
      pair.CE.lotSize!==pair.PE.lotSize||!integer(pair.masterFetchedAtMs)||
      dayIst(pair.masterFetchedAtMs)!==state.day) fail('MASTER_COMMIT_REJECTED');
  const compact={CE:{...pair.CE},PE:{...pair.PE},
    masterFetchedAtMs:pair.masterFetchedAtMs};
  return {...state,pair:compact,evidence:null,status:'MASTER_READY'};
}

export function noteMasterFailure(state,{tickId}={}) {
  validateOptionRuntime(state);
  if(!state||state.status!=='MASTER_PENDING'||state.lastMasterTickId!==tickId)
    fail('MASTER_FAILURE_REJECTED');
  return {...state,pair:null,evidence:null,status:'MASTER_BLOCKED'};
}

/** Reselect from a separately cached daily master; never rewrite in-flight evidence. */
export function reselectOptionPair(state,{tickId,observedAtMs,pair,masterAttempts=1}={}) {
  const current=optionRuntimeForDay(state,observedAtMs);
  if(!isTick(tickId,observedAtMs)||!pair||!contractOk(pair.CE,'CE')||!contractOk(pair.PE,'PE')||
    pair.CE.expiry!==pair.PE.expiry||pair.CE.strike!==pair.PE.strike||
    pair.CE.lotSize!==pair.PE.lotSize||pair.CE.token===pair.PE.token||pair.CE.expiry<=current.day||
    !integer(pair.masterFetchedAtMs)||dayIst(pair.masterFetchedAtMs)!==current.day||
    pair.masterFetchedAtMs>observedAtMs||!integer(masterAttempts)||masterAttempts>3)
    fail('PAIR_RESELECT_REJECTED');
  if(current.status==='OPTION_PENDING'||(current.lastOptionTickId&&
    Number(tickId.split(':')[1])<=Number(current.lastOptionTickId.split(':')[1])))fail('PAIR_RESELECT_IN_FLIGHT');
  const compact={CE:{...pair.CE},PE:{...pair.PE},masterFetchedAtMs:pair.masterFetchedAtMs};
  if(JSON.stringify(current.pair)===JSON.stringify(compact))return current;
  const next={...current,attempts:Math.max(current.attempts,masterAttempts),
    lastMasterTickId:current.lastMasterTickId??tickId,nextMasterTryAtMs:observedAtMs+MASTER_RETRY_MS,
    pair:compact,
    evidence:null,status:'MASTER_READY'};
  validateOptionRuntime(next);return next;
}

/** Consume an option tick even on network failure to prevent replay. */
export function claimOptionSnapshot(state,{tickId,observedAtMs}={}) {
  const current=optionRuntimeForDay(state,observedAtMs);
  if(!isTick(tickId,observedAtMs)) fail('BAD_TICK');
  if(!current.pair||current.pair.CE.expiry<=current.day||
      (current.lastOptionTickId &&
        Number(tickId.split(':')[1])<=Number(current.lastOptionTickId.split(':')[1])))
    return {allowed:false,state:current};
  return {allowed:true,state:{...current,lastOptionTickId:tickId,
    evidence:null,status:'OPTION_PENDING'}};
}

export function finishOptionSnapshot(state,{tickId,evidence}={}) {
  validateOptionRuntime(state);
  if(!state||state.status!=='OPTION_PENDING'||state.lastOptionTickId!==tickId||
      evidence?.source!=='READONLY_OPTION_EVIDENCE_ONLY'||
      evidence.realOrdersEnabled!==false||evidence.paperEntryAuthorized!==false||
      evidence.telegramAuthorized!==false||
      !legMatches(evidence.CE,state.pair?.CE,state.day)||
      !legMatches(evidence.PE,state.pair?.PE,state.day))
    fail('OPTION_COMMIT_REJECTED');
  const observedAtMs=Math.max(evidence.CE.updatedAtMs,evidence.PE.updatedAtMs);
  if(dayIst(observedAtMs)!==state.day) fail('OPTION_DAY_MISMATCH');
  return {...state,status:'OPTION_OBSERVED',evidence:{
    observedAtMs,source:evidence.source,
    CE:evidence.CE,PE:evidence.PE}};
}

export function noteOptionFailure(state,{tickId}={}) {
  validateOptionRuntime(state);
  if(!state||state.status!=='OPTION_PENDING'||state.lastOptionTickId!==tickId)
    fail('OPTION_FAILURE_REJECTED');
  return {...state,status:'OPTION_BLOCKED',evidence:null};
}

/** Authenticated status only; no raw quote, credential or stale mark. */
export function optionStatus(state,nowMs) {
  validateOptionRuntime(state);
  if(!state) return {status:'NOT_INITIALIZED',paperEntryAuthorized:false};
  const legFresh=v=>v&&nowMs-v.updatedAtMs<=15_000&&v.updatedAtMs-nowMs<=3_000;
  const fresh=integer(nowMs)&&state.day===dayIst(nowMs)&&
    state.status==='OPTION_OBSERVED'&&state.evidence&&
    legFresh(state.evidence.CE)&&legFresh(state.evidence.PE);
  return {status:state.status,day:state.day,masterAttempts:state.attempts,
    expiry:state.pair?.CE.expiry??null,strike:state.pair?.CE.strike??null,
    observedAtMs:fresh?state.evidence.observedAtMs:null,
    evidenceFresh:!!fresh,paperEntryAuthorized:false,realOrdersEnabled:false};
}
