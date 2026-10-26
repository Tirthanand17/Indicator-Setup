/** Explicit zero-credit accounting only. Never accept a supplied historical fill. */
import {auditPaperLedger,paperPositionActive,missedExitCutoff,UNKNOWN_EXIT_WRITE_OFF_ACK,
  writeOffUnknownPaperExits} from './paper-ledger.mjs';
import {openObservedArchive,readObservedStateInTransaction,OBSERVED_ARCHIVE_KEYS} from './observed-archive.mjs';
import {OBSERVED_LIFECYCLE_KEY,RETENTION_POLICY} from './observed-lifecycle.mjs';
import {captureObservedPortfolio} from './observed-portfolio.mjs';

const fail=code=>{throw Error('POSITION_RECONCILIATION_'+code);};
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===keys.slice().sort().join(',');
export function validatePositionRequest(r) {
  if(!exact(r,['tradeIds','ledgerMutationAtMs','decision'])||!Array.isArray(r.tradeIds)||r.tradeIds.length<1||r.tradeIds.length>2||
    new Set(r.tradeIds).size!==r.tradeIds.length||r.tradeIds.some(t=>typeof t!=='string'||t.length<8||t.length>250)||
    !Number.isSafeInteger(r.ledgerMutationAtMs)||r.ledgerMutationAtMs<=0||r.decision!==UNKNOWN_EXIT_WRITE_OFF_ACK)fail('INVALID_REQUEST');
}
export function positionReconciliationView(state,{nowMs,alarmAtMs}={}) {
  auditPaperLedger(state.ledger);
  if(!Number.isSafeInteger(nowMs)||nowMs<state.ledger.lastMutationAtMs)fail('CLOCK_ROLLBACK');
  const eligible=state.ledger.positions.filter(p=>paperPositionActive(p)&&nowMs>=missedExitCutoff(p));
  const blockedBy=state.recovery!==null?'QUARANTINED_COPY':!state.scheduler?.halted||state.scheduler.scheduledAtMs!==null||alarmAtMs!==null?
    'HALT_REQUIRED':nowMs-state.ledger.lastMutationAtMs<30000?'QUIET_PERIOD_REQUIRED':null;
  return {format:'OBSERVED_POSITION_RECONCILIATION_V1',status:eligible.length?'OWNER_DECISION_REQUIRED':'NO_ELIGIBLE_POSITIONS',
    canWriteOff:Boolean(eligible.length&&!blockedBy),blockedBy:eligible.length?blockedBy:null,paperOnly:true,
    positions:eligible.map(p=>({tradeId:p.tradeId,accountId:p.accountId,symbol:p.symbol,kind:p.kind,expiry:p.expiry,
      status:p.status,entryAtMs:p.entryAtMs,entryDebitRupees:p.entryDebitPaise/100,quantity:p.lots*p.lotSize})),
    request:eligible.length?{tradeIds:eligible.map(p=>p.tradeId),ledgerMutationAtMs:state.ledger.lastMutationAtMs,
      decision:UNKNOWN_EXIT_WRITE_OFF_ACK}:null,
    cashCreditPaise:0,strategyExitFillKnown:false,schedulerResumed:false};
}
export async function reconcileUnknownPositions(storage,{request,sealedArchive,nowMs,...secrets}={}) {
  request=structuredClone(request);
  validatePositionRequest(request);
  const baseline=await openObservedArchive({sealedArchive,...secrets});
  if(!Number.isSafeInteger(nowMs)||nowMs<baseline.createdAtMs||request.ledgerMutationAtMs!==baseline.state.ledger.lastMutationAtMs)
    fail('BASELINE_CLOCK_OR_PROOF');
  return storage.transaction(async txn=>{
    const current=await readObservedStateInTransaction(storage,txn,nowMs),alarmAtMs=await txn.getAlarm();
    if(current.recovery!==null)fail('QUARANTINED_COPY');
    if(!current.scheduler?.halted||current.scheduler.scheduledAtMs!==null||alarmAtMs!==null)fail('HALT_REQUIRED');
    const ids=request.tradeIds;
    if(ids.some(id=>!baseline.state.ledger.positions.some(p=>p.tradeId===id&&paperPositionActive(p))))fail('BASELINE_POSITION_MISMATCH');
    if(ids.every(id=>current.ledger.positions.some(p=>p.tradeId===id&&p.status==='EXIT_WRITTEN_OFF'&&
      p.ownerResolution.baselineArchiveId===baseline.archiveId)))return {status:'POSITIONS_ALREADY_RECONCILED_NO_ACTION',
      tradeIds:ids,baselineArchiveId:baseline.archiveId,cashCreditPaise:0,strategyExitFillKnown:false,schedulerResumed:false};
    if(JSON.stringify(current)!==JSON.stringify(baseline.state))fail('BASELINE_NOT_CURRENT');
    const view=positionReconciliationView(current,{nowMs,alarmAtMs});
    if(!view.canWriteOff||ids.some(id=>!view.positions.some(p=>p.tradeId===id)))fail(view.blockedBy??'POSITION_INELIGIBLE');
    const ledger=writeOffUnknownPaperExits(current.ledger,{tradeIds:ids,nowMs,baselineArchiveId:baseline.archiveId,acknowledgement:request.decision});
    const lifecycle={schema:1,writerVersion:2,minimumReaderVersion:2,retentionPolicy:RETENTION_POLICY,
      migratedAtMs:nowMs,baselineArchiveId:baseline.archiveId};
    const metrics=captureObservedPortfolio(current.metrics??undefined,current.bridge,current.ledger,current.bridge,ledger,[],nowMs);
    // Existing outbox indexes/receipts stay valid; a carried OPEN may append its missing unverifiable event.
    await txn.put(OBSERVED_ARCHIVE_KEYS.ledger,ledger);
    await txn.put(OBSERVED_LIFECYCLE_KEY,lifecycle);
    await txn.put(OBSERVED_ARCHIVE_KEYS.metrics,metrics);
    return {status:'POSITIONS_WRITTEN_OFF_UNKNOWN_EXIT',tradeIds:ids,baselineArchiveId:baseline.archiveId,
      cashCreditPaise:0,ownerAdjustmentPaise:-ledger.positions.filter(p=>ids.includes(p.tradeId)).reduce((sum,p)=>sum+p.entryDebitPaise,0),
      strategyExitFillKnown:false,schedulerResumed:false};
  });
}
