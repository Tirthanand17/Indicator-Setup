/** Private, read-only projection of Kite-observed *paper* positions.
 * Never return tokens, broker credentials, raw quotes or alert messages.
 */
import { auditReadOnlyBridge } from './readonly-paper-bridge.mjs';
import { auditPaperLedger, paperLedgerSummary } from './paper-ledger.mjs';
import { paperDeliverySummary } from './paper-delivery.mjs';

const IST_MS=330*60_000;
const rupees=paise=>Number((paise/100).toFixed(2));
const istDay=ms=>new Date(ms+IST_MS).toISOString().slice(0,10);
const validDay=day=>typeof day==='string'&&/^2026-\d\d-\d\d$/.test(day)&&
  Number.isFinite(Date.parse(`${day}T00:00:00Z`))&&
  new Date(`${day}T00:00:00Z`).toISOString().slice(0,10)===day;

/** Audits both persistent documents before deriving or disclosing any numbers. */
export function privateReadOnlySnapshot(bridge,ledger,{account='ALL',day,
  limit='50',nowMs=Date.now(),schedulerStatus='NOT_INITIALIZED',deliveryJournal}={}) {
  auditReadOnlyBridge(bridge);
  auditPaperLedger(ledger);
  const delivery=deliveryJournal===undefined?null:paperDeliverySummary(deliveryJournal,ledger);
  if (ledger.positions.length>0 && bridge.totalOptionTicks===0)
    throw Error('ORPHAN_READONLY_PAPER_POSITIONS');
  const reportDay=day??istDay(nowMs);
  if(!['ALL','PAPER_50K','PAPER_100K'].includes(account)||
      !/^(?:[1-9]|[1-4]\d|50)$/.test(String(limit))||!validDay(reportDay)||
      !Number.isSafeInteger(nowMs)||nowMs<=0||
      typeof schedulerStatus!=='string'||!/^[A-Z_]{2,60}$/.test(schedulerStatus))
    throw Error('INVALID_READONLY_DASHBOARD_QUERY');
  const balances=paperLedgerSummary(ledger).accounts.map(a=>({
    accountId:a.accountId,initialRupees:rupees(a.initialPaise),
    cashRupees:rupees(a.cashPaise),realizedNetPnlRupees:rupees(a.realizedNetPnlPaise),
    openCount:a.openCount,closedCount:a.closedCount,
    unverifiableCount:a.unverifiableCount,
    markedEquityRupees:null,unrealizedPnlRupees:null,
    valuationStatus:a.openCount+a.unverifiableCount===0?'FLAT_CASH':'NO_FRESH_POSITION_MARK',
  }));
  const selected=ledger.positions.filter(p=>account==='ALL'||p.accountId===account);
  const trades=selected.slice().reverse().slice(0,Number(limit)).map(p=>({
    tradeId:p.tradeId,accountId:p.accountId,symbol:p.symbol,kind:p.kind,
    expiry:p.expiry,lots:p.lots,lotSize:p.lotSize,status:p.status,
    entryAtMs:p.entryAtMs,entryFillRupees:rupees(p.entryFillPaise),
    exitAtMs:p.status==='CLOSED'?p.exitAtMs:null,
    exitFillRupees:p.status==='CLOSED'?rupees(p.exitFillPaise):null,
    netPnlRupees:p.status==='CLOSED'?rupees(p.netPnlPaise):null,
    exitReason:p.status==='CLOSED'?p.exitReason:null,
  }));
  const daily=balances.map(a=>{
    const positions=ledger.positions.filter(p=>p.accountId===a.accountId);
    const entries=positions.filter(p=>istDay(p.entryAtMs)===reportDay);
    const exits=positions.filter(p=>p.status==='CLOSED'&&istDay(p.exitAtMs)===reportDay);
    return {accountId:a.accountId,entries:entries.length,verifiedExits:exits.length,
      unresolvedEntries:entries.filter(p=>p.status==='EXIT_UNVERIFIABLE').length,
      wins:exits.filter(p=>p.netPnlPaise>0).length,
      losses:exits.filter(p=>p.netPnlPaise<0).length,
      realizedNetPnlRupees:rupees(exits.reduce((sum,p)=>sum+p.netPnlPaise,0)),
      winRate:exits.length?Number((100*exits.filter(p=>p.netPnlPaise>0).length/exits.length).toFixed(1)):null};
  });
  const lastAt=bridge.lastOptionAtMs;
  const evidenceStatus=lastAt===null?'NO_OPTION_OBSERVATIONS':
    nowMs>=lastAt&&nowMs-lastAt<=30_000?'RECENT_READONLY_OBSERVATION':'STALE_OR_HISTORIC_OBSERVATION';
  return {status:'READY',source:'READONLY_KITE_EVIDENCE_PAPER_ONLY',paperOnly:true,
    syntheticOnly:false,realOrdersEnabled:false,telegramDelivered:false,
    markedToMarket:false,livePositionValuationAvailable:false,
    account,day:reportDay,schedulerStatus,evidenceStatus,
    lastOptionAtMs:lastAt,lastOptionTickId:bridge.lastOptionTickId,
    totalOptionTicks:bridge.totalOptionTicks,
    pendingSignalKind:bridge.pending?.kind??null,
    lastMutationAtMs:ledger.lastMutationAtMs,
    retainedOutboxCount:ledger.outbox.length,
    pendingOutboxCount:delivery?ledger.outbox.length-delivery.cursor:null,
    deliveryStatus:delivery?'JOURNAL_VERIFIED':'DELIVERY_JOURNAL_UNAVAILABLE',
    delivery,
    totalTrades:selected.length,accounts:balances,daily,trades};
}
