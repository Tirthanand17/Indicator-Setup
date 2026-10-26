/** Shared validation for archived and running scheduler/market documents. */
import {validClaimedTickId,NSE_FO_CALENDAR_VERSION} from './alarm-core.mjs';

export function validState(s) {
  return s && Object.keys(s).sort().join(',') ===
    'calendarVersion,callbacks,events,halted,lastClaimedTickId,lastObservedAtMs,scheduledAtMs,schema,status,totalClaims,usageDay' &&
    s.schema === 1 && s.calendarVersion === NSE_FO_CALENDAR_VERSION &&
    Number.isSafeInteger(s.lastObservedAtMs) && s.lastObservedAtMs > 0 &&
    (s.scheduledAtMs === null || (Number.isSafeInteger(s.scheduledAtMs) && s.scheduledAtMs > 0)) &&
    (s.lastClaimedTickId === null || validClaimedTickId(s.lastClaimedTickId)) &&
    ((s.totalClaims === 0) === (s.lastClaimedTickId === null)) &&
    typeof s.halted === 'boolean' && typeof s.status === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(s.usageDay) &&
    Number.isSafeInteger(s.callbacks) && s.callbacks >= 0 && s.callbacks <= 4096 &&
    Number.isSafeInteger(s.totalClaims) && s.totalClaims >= 0 &&
    Array.isArray(s.events) && s.events.length <= 128 &&
    s.events.every(e => e && typeof e.status === 'string' &&
      Number.isSafeInteger(e.scheduledAtMs) && Number.isSafeInteger(e.observedAtMs) &&
      (e.tickId === null || typeof e.tickId === 'string'));
}

export function validMarketObservation(value) {
  return value && value.schema === 1 && typeof value.tickId === 'string' &&
    Number.isSafeInteger(value.observedAtMs) &&
    ['BLOCKED_MARKET_DATA', 'BLOCKED_OBSERVATION_STORAGE',
      'QUOTE_OBSERVED', 'HISTORY_OBSERVED','OPTION_OBSERVED',
      'OPTION_BLOCKED','OPTION_NO_MASTER','OPTION_ENTRY_UNAVAILABLE',
      'MARKET_BATCH_OBSERVED','MARKET_BATCH_PARTIAL','MARKET_BATCH_BLOCKED'].includes(value.status);
}
