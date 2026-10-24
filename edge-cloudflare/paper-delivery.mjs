/** Phase24: offline-only, durable Telegram-result reconciliation for PAPER alerts.
 * No HTTP client, token or outbound call. A claimed attempt is uncertain until
 * a definitive Bot API response is durably committed. An ambiguous claim is
 * NEVER automatically retried, even across restart or clock expiry.
 */
import { auditPaperLedger } from './paper-ledger.mjs';

export const PAPER_DELIVERY_KEY = 'paper-delivery-v1';
export const DELIVERY_RECENT_LIMIT = 128;
export const DELIVERY_MAX_ATTEMPTS = 3;
const MAX_RETRY_SECONDS = 86_400;
const TERMINAL = ['ACCEPTED_API_ONLY', 'DEFINITIVE_REJECTION',
  'EXPIRED_UNSENT', 'SUPPRESSED_UNCERTAIN'];
const integer = n => Number.isSafeInteger(n);
const validTime = t => integer(t) && t > 0;
const fail = code => { throw new Error(`PAPER_DELIVERY_${code}`); };
const ttlMs = event => event.kind === 'PAPER_ENTRY' ? 180_000 : 600_000;
const keys = (value, expected) => value && !Array.isArray(value) &&
  typeof value === 'object' &&
  Object.keys(value).sort().join(',') === expected.slice().sort().join(',');

export function newPaperDeliveryJournal(atMs) {
  if (!validTime(atMs)) fail('INVALID_CLOCK');
  return { schema: 1, nextIndex: 0, active: null, recent: [],
    totalAttempts: 0, accepted: 0, rejected: 0, expired: 0,
    suppressed: 0, ambiguousOutcomes: 0, lastChangedAtMs: atMs };
}

/** The immutable paper ledger is the sole source of alert identity and order.
 * nextIndex tombstones all terminal prefixes; the last-128 receipt ring is NOT
 * a complete export history and cannot drive resend decisions.
 */
export function auditPaperDelivery(journal, ledger) {
  auditPaperLedger(ledger);
  if (!keys(journal, ['schema', 'nextIndex', 'active', 'recent',
    'totalAttempts', 'accepted', 'rejected', 'expired', 'suppressed',
    'ambiguousOutcomes', 'lastChangedAtMs']) ||
      journal.schema !== 1 || !integer(journal.nextIndex) ||
      journal.nextIndex < 0 || journal.nextIndex > ledger.outbox.length ||
      !validTime(journal.lastChangedAtMs) ||
      !Array.isArray(journal.recent) || journal.recent.length > DELIVERY_RECENT_LIMIT ||
      !['totalAttempts', 'accepted', 'rejected', 'expired', 'suppressed',
        'ambiguousOutcomes'].every(k => integer(journal[k]) && journal[k] >= 0) ||
      journal.accepted + journal.rejected + journal.expired +
        journal.suppressed !== journal.nextIndex) fail('CORRUPT_JOURNAL');
  if (journal.totalAttempts < journal.accepted + journal.rejected ||
      journal.ambiguousOutcomes > journal.totalAttempts ||
      journal.recent.length !== Math.min(journal.nextIndex, DELIVERY_RECENT_LIMIT)) {
    fail('CORRUPT_COUNTERS');
  }
  for (let i = 0; i < journal.recent.length; i++) {
    const receipt = journal.recent[i];
    const index = journal.nextIndex - journal.recent.length + i;
    if (!keys(receipt, ['index', 'eventId', 'status', 'atMs', 'attempts',
      'telegramMessageId']) || receipt.index !== index ||
        receipt.eventId !== ledger.outbox[index]?.eventId ||
        !TERMINAL.includes(receipt.status) || !validTime(receipt.atMs) ||
        receipt.atMs > journal.lastChangedAtMs ||
        receipt.atMs < ledger.outbox[index]?.atMs ||
        !integer(receipt.attempts) || receipt.attempts < 0 ||
        receipt.attempts > DELIVERY_MAX_ATTEMPTS ||
        (receipt.status !== 'EXPIRED_UNSENT' && receipt.attempts === 0) ||
        (receipt.telegramMessageId !== null &&
          !validTime(receipt.telegramMessageId)) ||
        (receipt.status === 'ACCEPTED_API_ONLY') !==
          (receipt.telegramMessageId !== null)) fail('CORRUPT_RECEIPT');
  }
  if (journal.active !== null) {
    const active = journal.active;
    if (journal.nextIndex >= ledger.outbox.length ||
        !keys(active, ['index', 'eventId', 'status', 'attempt',
          'claimedAtMs', 'retryAtMs']) ||
        active.index !== journal.nextIndex ||
        active.eventId !== ledger.outbox[active.index]?.eventId ||
        !['CLAIMED_UNCONFIRMED', 'AMBIGUOUS', 'RETRY_AFTER'].includes(active.status) ||
        !integer(active.attempt) || active.attempt < 1 ||
        active.attempt > DELIVERY_MAX_ATTEMPTS ||
        active.attempt > journal.totalAttempts ||
        !validTime(active.claimedAtMs) ||
        active.claimedAtMs < ledger.outbox[active.index]?.atMs ||
        active.claimedAtMs > journal.lastChangedAtMs ||
        (active.status === 'RETRY_AFTER') !== (active.retryAtMs !== null) ||
        (active.retryAtMs !== null && (!validTime(active.retryAtMs) ||
          active.retryAtMs <= active.claimedAtMs))) fail('CORRUPT_ACTIVE');
  }
  return true;
}

function verified(journal, ledger, nowMs) {
  auditPaperDelivery(journal, ledger);
  if (!validTime(nowMs) || nowMs < journal.lastChangedAtMs ||
      nowMs < ledger.lastMutationAtMs) fail('CLOCK_ROLLBACK');
}

function finish(state, ledger, status, nowMs, telegramMessageId = null) {
  const index = state.nextIndex;
  const event = ledger.outbox[index];
  if (!event || !TERMINAL.includes(status)) fail('INVALID_FINISH');
  const attempts = state.active?.attempt ?? 0;
  const counter = ({ ACCEPTED_API_ONLY: 'accepted',
    DEFINITIVE_REJECTION: 'rejected', EXPIRED_UNSENT: 'expired',
    SUPPRESSED_UNCERTAIN: 'suppressed' })[status];
  state[counter]++;
  state.recent.push({ index, eventId: event.eventId, status,
    atMs: nowMs, attempts, telegramMessageId });
  state.recent = state.recent.slice(-DELIVERY_RECENT_LIMIT);
  state.nextIndex++;
  state.active = null;
  state.lastChangedAtMs = nowMs;
}

/** A successful claim is persisted BEFORE any future external send.
 * Here it only returns an offline simulation payload; there is no sender.
 */
export function claimPaperDelivery(journal, ledger, nowMs) {
  verified(journal, ledger, nowMs);
  const next = structuredClone(journal);
  if (next.active && next.active.status !== 'RETRY_AFTER') {
    return { journal, result: { status: 'AMBIGUOUS_ACK_REQUIRED',
      possibleTelegramAcceptance: true, paperOnly: true } };
  }
  if (next.active?.status === 'RETRY_AFTER' && nowMs < next.active.retryAtMs) {
    return { journal, result: { status: 'RATE_LIMIT_WAIT',
      retryAtMs: next.active.retryAtMs, paperOnly: true } };
  }
  while (next.nextIndex < ledger.outbox.length &&
      nowMs - ledger.outbox[next.nextIndex].atMs >= ttlMs(ledger.outbox[next.nextIndex])) {
    if (next.active && next.active.status !== 'RETRY_AFTER') fail('UNSAFE_EXPIRY');
    finish(next, ledger, 'EXPIRED_UNSENT', nowMs);
  }
  if (next.nextIndex === ledger.outbox.length) {
    auditPaperDelivery(next, ledger);
    return { journal: next, result: { status: 'NO_ELIGIBLE_ALERT', paperOnly: true } };
  }
  const event = ledger.outbox[next.nextIndex];
  const attempt = next.active ? next.active.attempt + 1 : 1;
  if (attempt > DELIVERY_MAX_ATTEMPTS) fail('ATTEMPT_CAPACITY');
  next.active = { index: next.nextIndex, eventId: event.eventId,
    status: 'CLAIMED_UNCONFIRMED', attempt, claimedAtMs: nowMs, retryAtMs: null };
  next.totalAttempts++;
  next.lastChangedAtMs = nowMs;
  auditPaperDelivery(next, ledger);
  return { journal: next, result: { status: 'SIMULATED_ATTEMPT_CLAIM',
    eventId: event.eventId, attempt, message: event.message,
    paperOnly: true, sent: false } };
}

/** Only a matching in-flight attempt can be settled. Raw Bot API bodies,
 * credentials and message text are not stored in delivery receipts.
 */
export function settlePaperDelivery(journal, ledger, { eventId, attempt, nowMs,
  httpStatus, botResponse } = {}) {
  verified(journal, ledger, nowMs);
  const active = journal.active;
  if (!active || active.status !== 'CLAIMED_UNCONFIRMED' ||
      active.eventId !== eventId || active.attempt !== attempt) fail('STALE_SETTLEMENT');
  const next = structuredClone(journal);
  let status;
  if (httpStatus === 200 && botResponse?.ok === true &&
      validTime(botResponse.result?.message_id)) {
    finish(next, ledger, 'ACCEPTED_API_ONLY', nowMs, botResponse.result.message_id);
    status = 'ACCEPTED_API_ONLY';
  } else if (httpStatus === 429 && botResponse?.ok === false &&
      botResponse.error_code === 429 &&
      integer(botResponse.parameters?.retry_after) &&
      botResponse.parameters.retry_after >= 1 &&
      botResponse.parameters.retry_after <= MAX_RETRY_SECONDS) {
    const retryAtMs = nowMs + botResponse.parameters.retry_after * 1000;
    if (!integer(retryAtMs)) fail('INVALID_RETRY_CLOCK');
    if (active.attempt >= DELIVERY_MAX_ATTEMPTS ||
        retryAtMs - ledger.outbox[active.index].atMs >=
          ttlMs(ledger.outbox[active.index])) {
      finish(next, ledger, 'EXPIRED_UNSENT', nowMs);
      status = 'EXPIRED_AFTER_RATE_LIMIT';
    } else {
      next.active = { ...active, status: 'RETRY_AFTER', retryAtMs };
      next.lastChangedAtMs = nowMs;
      status = 'RATE_LIMIT_WAIT';
    }
  } else if (integer(httpStatus) && httpStatus >= 400 && httpStatus < 500 &&
      httpStatus !== 429 && botResponse?.ok === false &&
      botResponse.error_code === httpStatus) {
    finish(next, ledger, 'DEFINITIVE_REJECTION', nowMs);
    status = 'DEFINITIVE_REJECTION';
  } else {
    next.active = { ...active, status: 'AMBIGUOUS' };
    next.ambiguousOutcomes++;
    next.lastChangedAtMs = nowMs;
    status = 'AMBIGUOUS_ACK_REQUIRED';
  }
  auditPaperDelivery(next, ledger);
  return { journal: next, result: { status, paperOnly: true,
    phoneDelivered: false,
    possibleTelegramAcceptance: status === 'AMBIGUOUS_ACK_REQUIRED' } };
}

/** An explicit operator decision can skip the uncertain event, without
 * asserting acceptance or retrying it. No HTTP endpoint exposes this method.
 */
export function suppressAmbiguousDelivery(journal, ledger,
  { eventId, nowMs, decision } = {}) {
  verified(journal, ledger, nowMs);
  if (!journal.active || journal.active.eventId !== eventId ||
      !['CLAIMED_UNCONFIRMED', 'AMBIGUOUS'].includes(journal.active.status) ||
      decision !== 'OWNER_SUPPRESS_RESEND_ACKNOWLEDGING_UNKNOWN_DELIVERY') {
    fail('OWNER_ACK_REQUIRED');
  }
  const next = structuredClone(journal);
  finish(next, ledger, 'SUPPRESSED_UNCERTAIN', nowMs);
  auditPaperDelivery(next, ledger);
  return { journal: next, result: { status: 'SUPPRESSED_UNCERTAIN',
    acceptedByTelegram: false, phoneDelivered: false, paperOnly: true } };
}

export function paperDeliverySummary(journal, ledger) {
  auditPaperDelivery(journal, ledger);
  return { schema: 1, paperOnly: true, networkSenderImplemented: false,
    phoneDeliveredVerified: false, cursor: journal.nextIndex,
    queued: ledger.outbox.length - journal.nextIndex - (journal.active ? 1 : 0),
    acceptedByBotApi: journal.accepted, rejected: journal.rejected,
    expiredWithoutDelivery: journal.expired, suppressedUnknown: journal.suppressed,
    attempted: journal.totalAttempts, ambiguousResponses: journal.ambiguousOutcomes,
    blockingState: journal.active ? (journal.active.status === 'RETRY_AFTER' ?
      'RATE_LIMIT_WAIT' : 'AMBIGUOUS_ACK_REQUIRED') : null,
    retainedReceiptCount: journal.recent.length,
    terminalReceiptRetention: 'LAST_128_ONLY',
    fullPaperOutboxRetainedInLedger: true };
}
