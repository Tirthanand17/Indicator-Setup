/** Owner suppression of uncertainty. No sender, retry, acceptance or resume. */
import {auditPaperLedger} from './paper-ledger.mjs';
import {readBoundedBody} from './ingress.mjs';
import {auditPaperDelivery,paperDeliverySummary,suppressAmbiguousDelivery} from './paper-delivery.mjs';
import {validState} from './runtime-state.mjs';

export const RECONCILIATION_ACK='OWNER_SUPPRESS_RESEND_ACKNOWLEDGING_UNKNOWN_DELIVERY';
export const RECONCILIATION_QUIET_MS=30000;
export const MAX_RECONCILIATION_BYTES=4096;
const positive=n=>Number.isSafeInteger(n)&&n>0;
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).sort().join(',')===keys.slice().sort().join(',');
const fail=code=>{throw Error('DELIVERY_RECONCILIATION_'+code);};
function audit(ledger,journal,scheduler,nowMs) {
  auditPaperLedger(ledger);auditPaperDelivery(journal,ledger);
  if(scheduler!==undefined&&!validState(scheduler))fail('CORRUPT_SCHEDULER');
  if(!positive(nowMs)||nowMs<ledger.lastMutationAtMs||nowMs<journal.lastChangedAtMs)fail('CLOCK_ROLLBACK');
}
export function validateReconciliationRequest(input) {
  if(!exact(input,['eventId','index','attempt','claimedAtMs','journalChangedAtMs','decision'])||
    typeof input.eventId!=='string'||input.eventId.length<10||input.eventId.length>300||
    !Number.isSafeInteger(input.index)||input.index<0||!positive(input.attempt)||input.attempt>3||
    !positive(input.claimedAtMs)||!positive(input.journalChangedAtMs)||input.decision!==RECONCILIATION_ACK)
    fail('INVALID_REQUEST');
  return true;
}
export function deliveryReconciliationView(ledger,journal,{scheduler,alarmAtMs,quarantined=false,nowMs}={}) {
  audit(ledger,journal,scheduler,nowMs);
  const active=journal.active,uncertain=active&&['CLAIMED_UNCONFIRMED','AMBIGUOUS'].includes(active.status);
  const blockedBy=quarantined?'QUARANTINED_COPY':!scheduler?.halted||scheduler.scheduledAtMs!==null||alarmAtMs!==null?
    'HALT_REQUIRED':uncertain&&nowMs-active.claimedAtMs<RECONCILIATION_QUIET_MS?'QUIET_PERIOD_REQUIRED':null;
  const request=uncertain?{eventId:active.eventId,index:active.index,attempt:active.attempt,
    claimedAtMs:active.claimedAtMs,journalChangedAtMs:journal.lastChangedAtMs,decision:RECONCILIATION_ACK}:null;
  const summary=paperDeliverySummary(journal,ledger);
  delete summary.networkSenderImplemented; // Inspection does not infer deployment capabilities.
  return {format:'OBSERVED_DELIVERY_RECONCILIATION_V1',paperOnly:true,
    status:uncertain?'OWNER_DECISION_REQUIRED':active?'RETRY_SCHEDULED_NOT_UNCERTAIN':'NO_UNCERTAIN_DELIVERY',
    canSuppress:Boolean(uncertain&&!blockedBy),blockedBy:uncertain?blockedBy:null,request,
    activeState:active?.status??null,quietPeriodMs:RECONCILIATION_QUIET_MS,
    summary,deliveryAttempted:false,schedulerResumed:false,
    phoneDeliveredVerified:false};
}
export function reconcileUncertainDelivery(ledger,journal,context,input) {
  validateReconciliationRequest(input);audit(ledger,journal,context.scheduler,context.nowMs);
  if(context.quarantined)fail('QUARANTINED_COPY');
  if(!context.scheduler?.halted||context.scheduler.scheduledAtMs!==null||context.alarmAtMs!==null)fail('HALT_REQUIRED');
  if(ledger.outbox[input.index]?.eventId!==input.eventId)fail('EVENT_MISMATCH');
  // Never override a definitive acknowledgement that won the race.
  if(input.index<journal.nextIndex) {
    const receipt=journal.recent.find(r=>r.index===input.index&&r.eventId===input.eventId);
    if(!receipt)fail('TERMINAL_RECEIPT_NOT_RETAINED');
    return {journal,result:{status:'ALREADY_TERMINAL_NO_ACTION',eventId:input.eventId,
      terminalStatus:receipt.status,cursor:journal.nextIndex,deliveryAttempted:false,
      schedulerResumed:false,phoneDeliveredVerified:false}};
  }
  const a=journal.active;
  if(!a||a.eventId!==input.eventId||a.index!==input.index||a.attempt!==input.attempt||
    a.claimedAtMs!==input.claimedAtMs||journal.lastChangedAtMs!==input.journalChangedAtMs||
    !['CLAIMED_UNCONFIRMED','AMBIGUOUS'].includes(a.status))fail('STALE_OR_INELIGIBLE_ATTEMPT');
  if(context.nowMs-a.claimedAtMs<RECONCILIATION_QUIET_MS)fail('QUIET_PERIOD_REQUIRED');
  const outcome=suppressAmbiguousDelivery(journal,ledger,{eventId:input.eventId,
    nowMs:context.nowMs,decision:input.decision});
  return {journal:outcome.journal,result:{...outcome.result,eventId:input.eventId,
    terminalStatus:'SUPPRESSED_UNCERTAIN',cursor:outcome.journal.nextIndex,
    possibleTelegramAcceptance:true,deliveryOutcome:'UNKNOWN_OWNER_SUPPRESSED_RESEND',
    deliveryAttempted:false,schedulerResumed:false,phoneDeliveredVerified:false}};
}
export async function readReconciliationJSON(stream) {
  if(!stream)fail('BODY_REQUIRED');
  let bytes;
  try {bytes=await readBoundedBody(stream,MAX_RECONCILIATION_BYTES);}
  catch (error) {fail(error?.message==='BODY_TOO_LARGE'?'BODY_TOO_LARGE':'BODY_UNAVAILABLE');}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('INVALID_JSON');}
}
