/**
 * Offline-only Cloudflare alarm eligibility core. No network, API keys,
 * subscription, cloud account, actual quotes, Telegram, or broker orders.
 * A qualifying tick is a *synthetic candidate*, NOT trade authorization.
 */
export const NSE_FO_CALENDAR_VERSION = 'NSE-FO-2026-FAOP71777-FAOP72262';
export const ALARM_INTERVAL_MS = 20_000;
const IST_OFFSET_MS = 330 * 60_000;
const CLOSED_2026 = new Set([
  '2026-01-15', '2026-01-26', '2026-03-03', '2026-03-26',
  '2026-03-31', '2026-04-03', '2026-04-14', '2026-05-01',
  '2026-05-28', '2026-06-26', '2026-09-14', '2026-10-02',
  '2026-10-20', '2026-11-10', '2026-11-24', '2026-12-25',
]);
const result = (status, nextAlarmAtMs = null, tickId = null, latenessMs = null) =>
  Object.freeze({
    status, shouldPoll: status === 'POLL_SYNTHETIC_TICK',
    nextAlarmAtMs, tickId, latenessMs, realOrdersEnabled: false,
  });
const validMillis = (v) => Number.isSafeInteger(v) && Number.isFinite(v);

export function validClaimedTickId(value) {
  if (typeof value !== 'string' || !/^2026-\d{2}-\d{2}:(0|[1-9]\d{0,3})$/.test(value)) return false;
  const [date, slot] = value.split(':');
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date &&
    Number(slot) < 1125 && !CLOSED_2026.has(date) && ![0, 6].includes(parsed.getUTCDay());
}

// Re-arm across nights, weekends and known 2026 F&O holidays.
// Return null when the pinned calendar ends rather than assuming a 2027 session.
function nextMarketOpenAfter(observedAtMs) {
  const local = new Date(observedAtMs + IST_OFFSET_MS);
  for (let daysAhead = 0; daysAhead <= 8; daysAhead += 1) {
    const localDay = new Date(Date.UTC(
      local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + daysAhead,
    ));
    if (localDay.getUTCFullYear() !== 2026) return null;
    const day = localDay.getUTCDay();
    if (day === 0 || day === 6 ||
        CLOSED_2026.has(localDay.toISOString().slice(0, 10))) continue;
    const openingAt = localDay.getTime() + 9 * 60 * 60_000 +
      15 * 60_000 - IST_OFFSET_MS;
    if (openingAt > observedAtMs) return openingAt;
  }
  return null;
}

/**
 * Assess an at-least-once alarm from the *real observed* timestamp.
 * lastClaimedTickId must eventually be loaded/updated atomically in
 * persistent DO storage; this function is pure and persists nothing.
 */
export function assessAlarm({
  observedAtMs, scheduledAtMs, lastClaimedTickId = null, calendarVersion,
} = {}) {
  if (!validMillis(observedAtMs) || !validMillis(scheduledAtMs)) {
    return result('BLOCKED_INVALID_CLOCK');
  }
  if (calendarVersion !== NSE_FO_CALENDAR_VERSION) {
    return result('BLOCKED_CALENDAR_VERSION');
  }
  if (lastClaimedTickId !== null && !validClaimedTickId(lastClaimedTickId)) {
    return result('BLOCKED_INVALID_DEDUPE_STATE');
  }

  // IST has a fixed UTC+05:30 offset. Never use host local timezone.
  const local = new Date(observedAtMs + IST_OFFSET_MS);
  if (!Number.isFinite(local.valueOf())) return result('BLOCKED_INVALID_CLOCK');
  if (local.getUTCFullYear() !== 2026) return result('BLOCKED_UNSUPPORTED_YEAR');
  const date = local.toISOString().slice(0, 10);
  const weekday = local.getUTCDay();
  if (weekday === 0 || weekday === 6 || CLOSED_2026.has(date)) {
    return result('CLOSED_NSE_SESSION', nextMarketOpenAfter(observedAtMs));
  }
  const y = local.getUTCFullYear(), m = local.getUTCMonth(), d = local.getUTCDate();
  const open = Date.UTC(y, m, d, 9, 15) - IST_OFFSET_MS;
  const close = Date.UTC(y, m, d, 15, 30) - IST_OFFSET_MS;
  if (observedAtMs < open) return result('WAIT_MARKET_OPEN', open);
  if (observedAtMs >= close) return result('CLOSED_NSE_SESSION', nextMarketOpenAfter(observedAtMs));

  // Always re-arm to the next anchored slot; NEVER replay skipped ticks.
  const nextSlot = Math.floor((observedAtMs - open) / ALARM_INTERVAL_MS) + 1;
  const proposedNext = open + nextSlot * ALARM_INTERVAL_MS;
  const next = proposedNext < close ? proposedNext : nextMarketOpenAfter(observedAtMs);
  const dueSlot = (scheduledAtMs - open) / ALARM_INTERVAL_MS;
  if (scheduledAtMs < open || scheduledAtMs >= close ||
      !Number.isInteger(dueSlot)) {
    return result('BLOCKED_UNALIGNED_ALARM', next);
  }
  if (scheduledAtMs > observedAtMs) {
    return result('WAIT_ALARM_DUE', scheduledAtMs);
  }
  const tickId = `${date}:${dueSlot}`;
  const lateness = observedAtMs - scheduledAtMs;
  if (lastClaimedTickId !== null) {
    const [claimedDate, claimedSlot] = lastClaimedTickId.split(':');
    if (claimedDate > date || (claimedDate === date && Number(claimedSlot) > dueSlot)) {
      return result('BLOCKED_CLOCK_ROLLBACK');
    }
  }
  if (lastClaimedTickId === tickId) {
    return result('SKIP_DUPLICATE_ALARM', next, tickId, lateness);
  }
  if (lateness >= ALARM_INTERVAL_MS) {
    return result('SKIP_LATE_ALARM', next, tickId, lateness);
  }
  return result('POLL_SYNTHETIC_TICK', next, tickId, lateness);
}
