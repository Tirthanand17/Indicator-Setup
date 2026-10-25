/** Read-only operational evidence, not provider connectivity or cost acceptance. */
import {sessionStatus} from './alarm-core.mjs';
import {validState,validMarketObservation} from './runtime-state.mjs';
import {auditPaperLedger} from './paper-ledger.mjs';
import {auditPaperDelivery} from './paper-delivery.mjs';
import {validateQuotePace} from './option-runtime.mjs';
import {auditObservedLifecycle,observedRetentionReport} from './observed-lifecycle.mjs';

export const OPS_CODES=Object.freeze({
  CALENDAR_UNVERIFIED:'WARNING',STATE_INVALID:'CRITICAL',RECOVERY_QUARANTINE:'WARNING',RUNTIME_DISABLED:'WARNING',
  SCHEDULER_NOT_INITIALIZED:'CRITICAL',SCHEDULER_HALTED:'WARNING',HEARTBEAT_STALE:'CRITICAL',ALARM_MISSING:'CRITICAL',
  TOKEN_MISSING:'CRITICAL',TOKEN_EXPIRED:'CRITICAL',TOKEN_INVALID:'CRITICAL',TOKEN_EXPIRING:'WARNING',
  AUTH_BLOCKED:'CRITICAL',MARKET_UNAVAILABLE:'CRITICAL',MARKET_PARTIAL:'WARNING',MARKET_STALE:'CRITICAL',
  QUOTE_BUDGET_PRESSURE:'WARNING',CALLBACK_BUDGET_PRESSURE:'WARNING',QUOTE_BUDGET_EXHAUSTED:'CRITICAL',
  CALLBACK_BUDGET_EXHAUSTED:'CRITICAL',JOURNAL_PRESSURE:'WARNING',JOURNAL_FULL:'CRITICAL',
  EXIT_UNVERIFIABLE:'CRITICAL',DELIVERY_UNCERTAIN:'WARNING',ENDPOINT_UNAVAILABLE:'CRITICAL',
});
export function operationalHealth({scheduler,market,pacing,ledger,delivery,lifecycle,recovery,
  tokenStatus,tokenExpiresAtMs,alarmAtMs,runtimeEnabled,nowMs}={}) {
  if(!Number.isSafeInteger(nowMs)||nowMs<=0)throw Error('INVALID_OPERATIONS_CLOCK');
  const local=new Date(nowMs+330*60000),day=local.toISOString().slice(0,10),minute=local.getUTCHours()*60+local.getUTCMinutes();
  const calendar=sessionStatus(day),expected=runtimeEnabled&&calendar==='REGULAR'&&minute>=555&&minute<930;
  const preparation=runtimeEnabled&&calendar==='REGULAR'&&minute>=540&&minute<930;
  const opening=Date.parse(day+'T09:15:00+05:30');
  const issues=new Set(),add=code=>issues.add(code);
  if(calendar===null||calendar==='SPECIAL')add('CALENDAR_UNVERIFIED');
  if(!runtimeEnabled)add('RUNTIME_DISABLED');
  if(recovery!==undefined)add('RECOVERY_QUARANTINE');
  let schedulerOk=false,bookOk=false,paceOk=false;
  try {auditObservedLifecycle(lifecycle);if(lifecycle===null)throw Error('null stored manifest');}
  catch{add('STATE_INVALID');}
  if(scheduler===undefined){if(expected)add('SCHEDULER_NOT_INITIALIZED');}
  else if(!validState(scheduler)||scheduler.lastObservedAtMs>nowMs){add('STATE_INVALID');}
  else {
    schedulerOk=true;
    if(expected&&scheduler.halted)add('SCHEDULER_HALTED');
    if(expected&&!scheduler.halted) {
      // getAlarm may be null while a due callback starts; allow a short due-time grace.
      if(alarmAtMs===null&&(scheduler.scheduledAtMs===null||scheduler.scheduledAtMs>nowMs||
        nowMs-scheduler.scheduledAtMs>60000))add('ALARM_MISSING');
      if(nowMs>=opening+90000&&nowMs-scheduler.lastObservedAtMs>90000)add('HEARTBEAT_STALE');
    }
    if(expected&&scheduler.usageDay===new Date(nowMs).toISOString().slice(0,10)) {
      if(scheduler.callbacks>=4096)add('CALLBACK_BUDGET_EXHAUSTED');
      else if(scheduler.callbacks>=Math.ceil(4096*.9))add('CALLBACK_BUDGET_PRESSURE');
    }
  }
  if(preparation) {
    if(tokenStatus==='MISSING')add('TOKEN_MISSING');
    else if(tokenStatus==='EXPIRED'||tokenStatus==='NOT_TODAY')add('TOKEN_EXPIRED');
    else if(tokenStatus!=='HANDOFF_DECRYPTABLE')add('TOKEN_INVALID');
    else if(tokenExpiresAtMs-nowMs<=20*60000)add('TOKEN_EXPIRING');
  }
  try {
    validateQuotePace(pacing);paceOk=true;
    if(expected&&pacing?.day===day) {
      if(pacing.authBlocked)add('AUTH_BLOCKED');
      if(pacing.count>=1125&&nowMs<Date.parse(day+'T15:29:40+05:30'))add('QUOTE_BUDGET_EXHAUSTED');
      else if(pacing.count>=Math.ceil(1125*.9))add('QUOTE_BUDGET_PRESSURE');
    }
  }catch{add('STATE_INVALID');}
  if(market!==undefined&&(!validMarketObservation(market)||market.observedAtMs>nowMs))add('STATE_INVALID');
  else if(expected&&schedulerOk&&!scheduler.halted) {
    if(nowMs>=opening+90000&&(!market||nowMs-market.observedAtMs>90000))add('MARKET_STALE');
    if(market&&nowMs-market.observedAtMs<=90000) {
      if(['BLOCKED_MARKET_DATA','BLOCKED_OBSERVATION_STORAGE','MARKET_BATCH_BLOCKED','OPTION_BLOCKED','OPTION_NO_MASTER'].includes(market.status))add('MARKET_UNAVAILABLE');
      if(['MARKET_BATCH_PARTIAL','OPTION_ENTRY_UNAVAILABLE'].includes(market.status))add('MARKET_PARTIAL');
    }
  }
  if(ledger!==undefined)try {
    auditPaperLedger(ledger);bookOk=true;
    const report=observedRetentionReport({ledger,lifecycle});
    if(report.capacityStatus==='AT_LIMIT')add('JOURNAL_FULL');
    else if(['WARNING','CRITICAL'].includes(report.capacityStatus))add('JOURNAL_PRESSURE');
    if(ledger.positions.some(p=>p.status==='EXIT_UNVERIFIABLE'))add('EXIT_UNVERIFIABLE');
    if(delivery!==undefined) {
      auditPaperDelivery(delivery,ledger);
      if(delivery.lastChangedAtMs>nowMs)throw Error('future delivery metadata');
      if(delivery.active&&(delivery.active.status==='AMBIGUOUS'||delivery.active.status==='CLAIMED_UNCONFIRMED'&&
        nowMs-delivery.active.claimedAtMs>=30000))add('DELIVERY_UNCERTAIN');
    }else if(ledger.outbox.length)add('STATE_INVALID');
  }catch{add('STATE_INVALID');}
  else if(delivery!==undefined)add('STATE_INVALID');
  const list=[...issues].sort().map(code=>({code,severity:OPS_CODES[code]}));
  return {format:'OBSERVED_OPERATIONS_V1',checkedAtMs:nowMs,status:list.length?'ATTENTION_REQUIRED':'NO_REPORTED_CONDITIONS',
    session:calendar??'UNVERIFIED',expectedSession:expected,runtimeEnabled:Boolean(runtimeEnabled),
    issues:list,heartbeatAtMs:schedulerOk?scheduler.lastObservedAtMs:null,
    tokenStatus:tokenStatus??'INVALID',quoteRequestCount:paceOk&&pacing?.day===day?pacing.count:0,
    ledgerAvailable:bookOk,readOnly:true,providerAuthenticationVerified:false,phoneDeliveredVerified:false,
    cloudUsageMeasured:false};
}
