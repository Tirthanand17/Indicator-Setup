import test from 'node:test';
import assert from 'node:assert/strict';
import { assessAlarm, ALARM_INTERVAL_MS, NSE_FO_CALENDAR_VERSION,
  NSE_FO_SPECIAL_2026, sessionStatus } from './alarm-core.mjs';

const ist = (day, time) => Date.parse(`${day}T${time}+05:30`);
const assess = (observedAtMs, scheduledAtMs, lastClaimedTickId = null, calendarVersion = NSE_FO_CALENDAR_VERSION) =>
  assessAlarm({ observedAtMs, scheduledAtMs, lastClaimedTickId, calendarVersion });

test('pinned calendar, 20-second synthetic cadence, real orders permanently disabled', () => {
  const due = ist('2026-10-23', '09:15:00');
  const answer = assess(due, due);
  assert.equal(ALARM_INTERVAL_MS, 20_000);
  assert.equal(answer.status, 'POLL_SYNTHETIC_TICK');
  assert.equal(answer.tickId, '2026-10-23:0');
  assert.equal(answer.nextAlarmAtMs, ist('2026-10-23', '09:15:20'));
  assert.equal(answer.shouldPoll, true);
  assert.equal(answer.realOrdersEnabled, false);
  assert.equal(Object.isFrozen(answer), true);
});

test('at-least-once duplicate alarm is suppressed by previous claimed tick', () => {
  const due = ist('2026-10-23', '09:15:00');
  const first = assess(due, due);
  const repeated = assess(due + 500, due, first.tickId);
  assert.equal(repeated.status, 'SKIP_DUPLICATE_ALARM');
  assert.equal(repeated.shouldPoll, false);
  assert.equal(repeated.realOrdersEnabled, false);
});

test('delayed alarm never backfills or replays missed market ticks', () => {
  const due = ist('2026-10-23', '09:15:00');
  assert.equal(assess(due + 19_999, due).status, 'POLL_SYNTHETIC_TICK');
  const late = assess(due + 20_000, due);
  assert.equal(late.status, 'SKIP_LATE_ALARM');
  assert.equal(late.nextAlarmAtMs, due + 40_000);
});

test('waiting before open and before scheduled alarm is fail-closed', () => {
  const due = ist('2026-10-23', '09:15:00');
  const pre = assess(due - 60_000, due);
  assert.equal(pre.status, 'WAIT_MARKET_OPEN');
  assert.equal(pre.nextAlarmAtMs, due);
  assert.equal(pre.shouldPoll, false);
  assert.equal(assess(due + 1_000, due + 20_000).status, 'WAIT_ALARM_DUE');
});

test('unaligned alarm timestamps never produce polling candidates', () => {
  const due = ist('2026-10-23', '09:15:00');
  assert.equal(assess(due + 60_000, due + 5_000).status, 'BLOCKED_UNALIGNED_ALARM');
  assert.equal(assess(due + 60_000, due - 20_000).status, 'BLOCKED_UNALIGNED_ALARM');
});

test('weekend and end-of-day alarms re-arm for next Monday 09:15 IST', () => {
  const fri = '2026-10-23', mon = '2026-10-26';
  const lastTick = assess(ist(fri, '15:29:40'), ist(fri, '15:29:40'));
  assert.equal(lastTick.status, 'POLL_SYNTHETIC_TICK');
  assert.equal(lastTick.nextAlarmAtMs, ist(mon, '09:15:00'));
  assert.equal(assess(ist(fri, '15:30:00'), ist(fri, '15:29:40')).nextAlarmAtMs, ist(mon, '09:15:00'));
  assert.equal(assess(ist('2026-10-24', '10:00:00'), ist(fri, '15:29:40')).nextAlarmAtMs, ist(mon, '09:15:00'));
});

test('pinned 2026 NSE F&O holiday is skipped while calendar remains versioned', () => {
  const due = ist('2026-10-19', '15:29:40');
  assert.equal(assess(ist('2026-10-19', '15:30:00'), due).nextAlarmAtMs, ist('2026-10-21', '09:15:00'));
  const holiday = assess(ist('2026-10-20', '09:15:00'), due);
  assert.equal(holiday.status, 'CLOSED_NSE_SESSION');
  assert.equal(holiday.shouldPoll, false);
  assert.equal(holiday.nextAlarmAtMs, ist('2026-10-21', '09:15:00'));
});

test('unlisted year and unprovided 2027 calendar fail closed', () => {
  const due = ist('2026-12-31', '15:29:40');
  assert.equal(assess(due, due).nextAlarmAtMs, null);
  const nextYear = assess(ist('2027-01-01', '09:15:00'), due);
  assert.equal(nextYear.status, 'BLOCKED_UNSUPPORTED_YEAR');
  assert.equal(nextYear.shouldPoll, false);
});

test('published 2026 Diwali Muhurat 14:20–15:40 Sunday is known but remains excluded', () => {
  const special = NSE_FO_SPECIAL_2026['2026-11-08'];
  assert.equal(special.circular, 'NSE/FAOP/76940');
  assert.equal(special.continuousOpenIst, '14:20');
  assert.equal(special.continuousCloseIst, '15:40');
  assert.equal(special.automatedPaperSessionEligible, false);
  assert.equal(sessionStatus('2026-11-08'), 'SPECIAL');
  for (const time of ['09:15:00','14:20:00','15:00:00','15:39:40','15:40:00']) {
    const at = ist('2026-11-08', time);
    const result = assess(at, at);
    assert.equal(result.status, 'CLOSED_SPECIAL_SESSION');
    assert.equal(result.shouldPoll, false);
    assert.equal(result.nextAlarmAtMs, ist('2026-11-09', '09:15:00'));
  }
  assert.equal(sessionStatus('2026-11-07'),'WEEKEND');
  assert.equal(sessionStatus('2027-01-04'),null);
});

test('invalid data and wrong calendar version block polling', () => {
  const due = ist('2026-10-23', '09:15:00');
  assert.equal(assess(Number.NaN, due).status, 'BLOCKED_INVALID_CLOCK');
  assert.equal(assess(due, Number.POSITIVE_INFINITY).status, 'BLOCKED_INVALID_CLOCK');
  assert.equal(assess(due, due, 123).status, 'BLOCKED_INVALID_DEDUPE_STATE');
  assert.equal(assess(due, due, null, 'unverified').status, 'BLOCKED_CALENDAR_VERSION');
  assert.equal(assessAlarm().status, 'BLOCKED_INVALID_CLOCK');
});
