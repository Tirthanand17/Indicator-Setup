/** Requested cadence and bounded traffic plan; never a cloud timing guarantee. */
import {ALARM_INTERVAL_MS,validClaimedTickId,sessionStatus} from './alarm-core.mjs';

export const PAPER_OPTION_INTERVAL_MS=ALARM_INTERVAL_MS;
export const MAX_MARKET_BATCH_INSTRUMENTS=5;

export function currentMarketTick(tickId,nowMs) {
  if(!validClaimedTickId(tickId)||!Number.isSafeInteger(nowMs))return false;
  const [day,slot]=tickId.split(':');
  const due=Date.parse(day+'T09:15:00+05:30')+Number(slot)*ALARM_INTERVAL_MS;
  return nowMs>=due&&nowMs<due+ALARM_INTERVAL_MS;
}

export function marketTrafficPlan(istDate) {
  const session=sessionStatus(istDate);
  if(session===null)throw Error('CADENCE_CALENDAR_UNAVAILABLE');
  const slots=session==='REGULAR'?375*60_000/ALARM_INTERVAL_MS:0;
  return Object.freeze({requestedOptionIntervalMs:PAPER_OPTION_INTERVAL_MS,
    maximumQuoteRequests:slots,maximumInstrumentsPerQuote:MAX_MARKET_BATCH_INSTRUMENTS,
    maximumInstrumentObservations:slots*MAX_MARKET_BATCH_INSTRUMENTS,
    maximumHistoryRequests:slots/15*2,maximumMasterAttempts:slots?3:0,
    cloudTimingVerified:false,realOrdersEnabled:false});
}
