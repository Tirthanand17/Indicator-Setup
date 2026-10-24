/** Read-only market evidence -> *separate* hypothetical paper accounts.
 * Pure transitions only. The production alarm may call these exclusively
 * behind all required OFFLINE_* gates, with no orders or Telegram sending.
 */
import { validClaimedTickId, sessionStatus, ALARM_INTERVAL_MS } from './alarm-core.mjs';
import { READONLY_REVIEW_SOURCE } from './market-review.mjs';
import { auditPaperLedger, checkQuote, enterPaperBasket, exitPaperPosition,
  markPaperUnverifiable } from './paper-ledger.mjs';

export const READONLY_PAPER_LEDGER_KEY='readonly-paper-ledger-v1';
export const READONLY_PAPER_BRIDGE_KEY='readonly-paper-bridge-v1';
const IST_MS=330*60_000;
const MAX_EVENTS=128;
const fail=s=>{throw new Error('READONLY_PAPER_BRIDGE_'+s);};
const integer=x=>Number.isSafeInteger(x)&&x>0;
const istDay=ms=>new Date(ms+IST_MS).toISOString().slice(0,10);
const minuteIst=ms=>{const d=new Date(ms+IST_MS);return d.getUTCHours()*60+d.getUTCMinutes();};
const idParts=id=>{const [day,slot]=id.split(':');return {day,slot:Number(slot)};};
function validSlot(tickId,nowMs) {
  if(!integer(nowMs)||!validClaimedTickId(tickId)) return false;
  const {day,slot}=idParts(tickId);
  if(day!==istDay(nowMs)||sessionStatus(day)!=='REGULAR') return false;
  const due=Date.parse(`${day}T09:15:00+05:30`)+slot*ALARM_INTERVAL_MS;
  return nowMs>=due&&nowMs<due+ALARM_INTERVAL_MS;
}
const nextTick=(old,current)=>{
  if(old===null) return true;
  const a=idParts(old),b=idParts(current);
  if(a.day>b.day||(a.day===b.day&&a.slot>b.slot)) fail('TICK_ROLLBACK');
  return old!==current;
};
const allowedQuoteFault=error=>typeof error?.message==='string'&&
  /^PAPER_LEDGER_(INVALID_CONTRACT|STALE_QUOTE|INVALID_PREMIUM|INVALID_SPREAD|INSUFFICIENT_DEPTH|CONTRACT_MISMATCH|NONCAUSAL_EXIT)$/.test(error.message);

export function newReadOnlyBridge() {
  return {schema:1,lastReviewTickId:null,lastOptionTickId:null,
    lastOptionAtMs:null,pending:null,totalOptionTicks:0,events:[]};
}

function validPending(p) {
  if(p===null) return true;
  if(!p||!validClaimedTickId(p.reviewTickId)||
      idParts(p.reviewTickId).slot%15!==1||
      !integer(p.reviewAtMs)||!validSlot(p.reviewTickId,p.reviewAtMs)||
      !['CE','PE'].includes(p.kind)||
      !integer(p.candleAtMs)||istDay(p.candleAtMs)!==idParts(p.reviewTickId).day||
      p.candleAtMs+308_000>p.reviewAtMs||
      !integer(p.futuresExchangeAtMs)||
      p.reviewAtMs-p.futuresExchangeAtMs>60_000||
      p.futuresExchangeAtMs-p.reviewAtMs>3_000||
      typeof p.futuresLastPrice!=='number'||!Number.isFinite(p.futuresLastPrice)||
      p.futuresLastPrice<=0||p.futuresLastPrice>1_000_000||
      p.signalId!==`READONLY:${idParts(p.reviewTickId).day}:${p.candleAtMs}:${p.kind}`)
    return false;
  return true;
}

export function auditReadOnlyBridge(s) {
  if(!s||s.schema!==1||
      (s.lastReviewTickId!==null&&!validClaimedTickId(s.lastReviewTickId))||
      (s.lastOptionTickId!==null&&!validClaimedTickId(s.lastOptionTickId))||
      (s.lastOptionAtMs!==null&&!integer(s.lastOptionAtMs))||
      ((s.lastOptionTickId===null)!==(s.lastOptionAtMs===null))||
      !validPending(s.pending)||
      (s.pending!==null&&s.pending.reviewTickId!==s.lastReviewTickId)||
      !Number.isSafeInteger(s.totalOptionTicks)||s.totalOptionTicks<0||
      s.totalOptionTicks>500_000||
      (s.totalOptionTicks===0)!==(s.lastOptionTickId===null)||
      !Array.isArray(s.events)||s.events.length>MAX_EVENTS||
      s.events.length>s.totalOptionTicks) fail('CORRUPT_STATE');
  let previous=null;
  for(const e of s.events) {
    if(!e||!validClaimedTickId(e.tickId)||!integer(e.observedAtMs)||
        !validSlot(e.tickId,e.observedAtMs)||
        !Number.isSafeInteger(e.entered)||e.entered<0||e.entered>2||
        !Number.isSafeInteger(e.exited)||e.exited<0||e.exited>2||
        typeof e.status!=='string'||(previous!==null&&!nextTick(previous,e.tickId)))
      fail('CORRUPT_EVENT');
    previous=e.tickId;
  }
  if(s.events.length&&(s.events.at(-1).tickId!==s.lastOptionTickId||
      s.events.at(-1).observedAtMs!==s.lastOptionAtMs)) fail('CORRUPT_LAST_OPTION');
  return true;
}

/** Only a completed review from the already checked Phase28 candle pipeline. */
export function stageReadOnlyReview(state,{tickId,observedAtMs,review,futures}={}) {
  auditReadOnlyBridge(state);
  if(!validSlot(tickId,observedAtMs)||idParts(tickId).slot%15!==1||
      !nextTick(state.lastReviewTickId,tickId)) fail('REVIEW_SLOT_REPLAY');
  if(review?.source!==READONLY_REVIEW_SOURCE||
      review.paperEntryAuthorized!==false||review.telegramAuthorized!==false||
      review.realOrdersEnabled!==false) fail('UNTRUSTED_REVIEW');
  let pending=null;
  if(['REVIEW_CE','REVIEW_PE'].includes(review.status)) {
    const kind=review.status.slice(-2);
    const f=futures;
    if(!/^NFO:NIFTY[A-Z0-9]+FUT$/.test(f?.symbol??'')||
        !integer(f.instrumentToken)||!integer(f.exchangeAtMs)||
        f.exchangeAtMs>observedAtMs+3_000||
        observedAtMs-f.exchangeAtMs>60_000||
        istDay(f.exchangeAtMs)!==istDay(observedAtMs)||
        typeof f.lastPrice!=='number'||!Number.isFinite(f.lastPrice)||
        f.lastPrice<=0||f.lastPrice>1_000_000||
        !integer(review.fiveMinuteCandleAtMs)||
        istDay(review.fiveMinuteCandleAtMs)!==istDay(observedAtMs)||
        review.fiveMinuteCandleAtMs+308_000>observedAtMs) fail('INCOMPLETE_REVIEW');
    pending={reviewTickId:tickId,reviewAtMs:observedAtMs,kind,
      signalId:`READONLY:${istDay(observedAtMs)}:${review.fiveMinuteCandleAtMs}:${kind}`,
      candleAtMs:review.fiveMinuteCandleAtMs,
      futuresExchangeAtMs:f.exchangeAtMs,futuresLastPrice:f.lastPrice};
  }
  const next={...state,lastReviewTickId:tickId,pending};
  auditReadOnlyBridge(next);
  return next;
}

/** Exit-first, then entry; purely paper and atomic with bridge journal. */
export function advanceReadOnlyPaperTurn(state,ledger,{
  tickId,observedAtMs,evidence,
}={}) {
  auditReadOnlyBridge(state);
  auditPaperLedger(ledger);
  if(!validSlot(tickId,observedAtMs)||idParts(tickId).slot%3!==2)
    fail('OPTION_SLOT_INVALID');
  if(!nextTick(state.lastOptionTickId,tickId))
    return {state,ledger,result:{status:'DUPLICATE_OPTION_TICK',paperOnly:true}};
  if(state.lastOptionAtMs!==null&&observedAtMs<state.lastOptionAtMs)
    fail('CLOCK_ROLLBACK');
  if(observedAtMs<ledger.lastMutationAtMs) fail('LEDGER_CLOCK_ROLLBACK');
  if(evidence?.source!=='READONLY_OPTION_EVIDENCE_ONLY'||
      evidence.paperEntryAuthorized!==false||evidence.telegramAuthorized!==false||
      evidence.realOrdersEnabled!==false||
      !evidence.CE||!evidence.PE||
      evidence.CE.contract?.kind!=='CE'||evidence.PE.contract?.kind!=='PE')
    fail('UNTRUSTED_OPTION_EVIDENCE');
  const q={CE:evidence.CE,PE:evidence.PE};
  for(const kind of ['CE','PE']) {
    const leg=q[kind];
    if(!integer(leg.updatedAtMs)||istDay(leg.updatedAtMs)!==istDay(observedAtMs)||
        observedAtMs-leg.updatedAtMs>15_000||
        leg.updatedAtMs-observedAtMs>3_000)
      fail('STALE_OPTION_EVIDENCE');
  }
  const ce=checkQuote(q.CE,observedAtMs).c;
  const pe=checkQuote(q.PE,observedAtMs).c;
  if(ce.expiry!==pe.expiry||ce.lotSize!==pe.lotSize||
      ce.strike!==pe.strike||ce.token===pe.token)
    fail('INCONSISTENT_OPTION_PAIR');
  let nextLedger=ledger;
  const exits=[];let entered=0;
  const minute=minuteIst(observedAtMs);
  if(minute>=15*60+26) {
    const marked=markPaperUnverifiable(nextLedger,observedAtMs);
    nextLedger=marked.ledger;
    exits.push(...marked.marked.map(tradeId=>({tradeId,status:'EXIT_UNVERIFIABLE'})));
  } else if(minute>=9*60+30) {
    for(const p of nextLedger.positions.filter(x=>x.status==='OPEN')) {
      try {
        const r=exitPaperPosition(nextLedger,{tradeId:p.tradeId,quote:q[p.kind],
          nowMs:observedAtMs});
        nextLedger=r.ledger;
        exits.push({tradeId:p.tradeId,status:r.result.status});
      } catch(err) {
        if(!allowedQuoteFault(err)) throw err;
        exits.push({tradeId:p.tradeId,status:'WAIT_VALID_EXIT_EVIDENCE'});
      }
    }
  }
  const pending=state.pending;
  let entryStatus='NO_FRESH_SIGNAL';
  if(pending&&minute>=9*60+30&&minute<15*60&&
      idParts(tickId).day===idParts(pending.reviewTickId).day&&
      idParts(tickId).slot===idParts(pending.reviewTickId).slot+1&&
      observedAtMs-pending.reviewAtMs<=25_000&&
      observedAtMs-pending.futuresExchangeAtMs<=30_000&&
      pending.futuresExchangeAtMs-observedAtMs<=3_000&&
      Math.abs(pending.futuresLastPrice-q[pending.kind].contract.strike)<=250) {
    try {
      const r=enterPaperBasket(nextLedger,{signalId:pending.signalId,
        quote:q[pending.kind],nowMs:observedAtMs});
      nextLedger=r.ledger;
      entered=Object.values(r.results).filter(x=>x?.status==='OPEN').length;
      entryStatus=entered>0?'PAPER_ENTRY':'RISK_OR_DUPLICATE_REJECTED';
    } catch(err) {
      if(!allowedQuoteFault(err)) throw err;
      entryStatus='WAIT_VALID_ENTRY_EVIDENCE';
    }
  }
  const next=structuredClone(state);
  next.lastOptionTickId=tickId;
  next.lastOptionAtMs=observedAtMs;
  next.totalOptionTicks++;
  next.pending=null; // Never queue an entry into a later/stale option tick.
  next.events.push({tickId,observedAtMs,entered,
    exited:exits.filter(e=>e.status==='CLOSED').length,status:entryStatus});
  next.events=next.events.slice(-MAX_EVENTS);
  auditReadOnlyBridge(next);
  auditPaperLedger(nextLedger);
  return {state:next,ledger:nextLedger,result:{status:'READONLY_PAPER_TICK',
    paperOnly:true,realOrdersEnabled:false,entered,
    exited:exits.filter(e=>e.status==='CLOSED').length,
    entryStatus,exitResults:exits,pendingOutboxCount:nextLedger.outbox.length}};
}

export function readOnlyBridgeSummary(state,ledger) {
  auditReadOnlyBridge(state);
  auditPaperLedger(ledger);
  return {paperOnly:true,realOrdersEnabled:false,liveOrdersEnabled:false,
    lastOptionTickId:state.lastOptionTickId,totalOptionTicks:state.totalOptionTicks,
    pendingSignal:state.pending?{kind:state.pending.kind,
      candleAtMs:state.pending.candleAtMs}:null,
    recentResults:state.events.slice(-8),
    accountBalances:Object.entries(ledger.accounts).map(([accountId,value])=>
      ({accountId,cashPaise:value.cashPaise,initialPaise:value.initialPaise})),
    totalPaperPositions:ledger.positions.length,pendingOutboxCount:ledger.outbox.length};
}
