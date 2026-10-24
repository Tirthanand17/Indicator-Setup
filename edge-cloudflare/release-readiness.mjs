/** Operator-only, credential-free release gate report. No network or side effects.
 * A pinned circular or successful offline test is not cloud deployment approval.
 */
import { sessionStatus, NSE_FO_CALENDAR_VERSION } from './alarm-core.mjs';

const IST_OFFSET_MS = 330 * 60_000;

export function assessOfflineRelease({ nowMs, schedulerState = null,
  dailyTokenHandoffAcknowledged = false, readonlyMarketRuntimeEnabled = false } = {}) {
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) throw new RangeError('invalid clock');
  const istDate = new Date(nowMs + IST_OFFSET_MS).toISOString().slice(0, 10);
  const marketDayStatus = sessionStatus(istDate) ?? 'UNVERIFIED';
  const blockers = ['OWNER_CLOUD_APPROVAL_REQUIRED', 'LIVE_ACCEPTANCE_NOT_VERIFIED'];
  if (marketDayStatus === 'UNVERIFIED') blockers.push('OFFICIAL_ANNUAL_CALENDAR_REQUIRED');
  else if (marketDayStatus === 'SPECIAL') blockers.push('SPECIAL_SESSION_NOT_AUTHORIZED');
  else if (marketDayStatus !== 'REGULAR') blockers.push('NOT_A_REGULAR_NSE_SESSION');
  if (schedulerState === null) blockers.push('SCHEDULER_NOT_INITIALIZED');
  else if (schedulerState.halted || schedulerState.scheduledAtMs === null)
    blockers.push('SCHEDULER_HALTED');
  if (!dailyTokenHandoffAcknowledged) blockers.push('DAILY_TOKEN_HANDOFF_MISSING');
  if (!readonlyMarketRuntimeEnabled) blockers.push('READONLY_MARKET_RUNTIME_DISABLED');
  return Object.freeze({
    status: 'BLOCKED_PRE_RELEASE', istDate,
    marketDayStatus, calendarVersion: NSE_FO_CALENDAR_VERSION,
    calendarLiveReverified: false, dailyTokenHandoffAcknowledged: !!dailyTokenHandoffAcknowledged,
    paperOnly: true, automatedReleaseAuthorized: false, realOrdersEnabled: false,
    blockers: Object.freeze(blockers),
  });
}
