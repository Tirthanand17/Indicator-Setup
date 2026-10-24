import test from 'node:test';
import assert from 'node:assert/strict';
import { assessOfflineRelease } from './release-readiness.mjs';

const at = (date, time = '09:25:00') => Date.parse(`${date}T${time}+05:30`);
const running = { halted: false, scheduledAtMs: at('2026-10-26') };
const inspect = (date, options = {}) => assessOfflineRelease({
  nowMs: at(date), schedulerState: running,
  dailyTokenHandoffAcknowledged: true, readonlyMarketRuntimeEnabled: true, ...options,
});

test('even a ready-looking 2026 paper scheduler never authorizes production', () => {
  const report = inspect('2026-10-26');
  assert.equal(report.status, 'BLOCKED_PRE_RELEASE');
  assert.equal(report.marketDayStatus, 'REGULAR');
  assert.equal(report.automatedReleaseAuthorized, false);
  assert.equal(report.realOrdersEnabled, false);
  assert.equal(report.calendarLiveReverified, false);
  assert.deepEqual(report.blockers,
    ['OWNER_CLOUD_APPROVAL_REQUIRED', 'LIVE_ACCEPTANCE_NOT_VERIFIED']);
});

test('special session, verified holiday and unknown 2027 calendar remain blocked', () => {
  const special = inspect('2026-11-08', { nowMs: at('2026-11-08','14:20:00') });
  assert.equal(special.marketDayStatus, 'SPECIAL');
  assert.ok(special.blockers.includes('SPECIAL_SESSION_NOT_AUTHORIZED'));
  assert.equal(inspect('2026-11-10').marketDayStatus, 'HOLIDAY');
  const unverified = inspect('2027-01-04');
  assert.equal(unverified.marketDayStatus, 'UNVERIFIED');
  assert.ok(unverified.blockers.includes('OFFICIAL_ANNUAL_CALENDAR_REQUIRED'));
});

test('missing handoff and stopped scheduler are explicit even with owner token', () => {
  const report = inspect('2026-10-26', { schedulerState: { halted: true,
    scheduledAtMs: null }, dailyTokenHandoffAcknowledged: false,
    readonlyMarketRuntimeEnabled: false });
  assert.ok(report.blockers.includes('SCHEDULER_HALTED'));
  assert.ok(report.blockers.includes('DAILY_TOKEN_HANDOFF_MISSING'));
  assert.ok(report.blockers.includes('READONLY_MARKET_RUNTIME_DISABLED'));
  assert.equal(report.dailyTokenHandoffAcknowledged, false);
  assert.throws(() => assessOfflineRelease({ nowMs: NaN }), RangeError);
});
