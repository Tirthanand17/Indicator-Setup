import test from 'node:test';
import assert from 'node:assert/strict';
import { newPaperLedger, enterPaperBasket, exitPaperPosition,
  auditPaperLedger } from './paper-ledger.mjs';
import { sessionStatus } from './alarm-core.mjs';
import { PAPER_DELIVERY_KEY, newPaperDeliveryJournal, auditPaperDelivery,
  claimPaperDelivery, settlePaperDelivery, suppressAmbiguousDelivery,
  paperDeliverySummary, DELIVERY_RECENT_LIMIT } from './paper-delivery.mjs';
import worker, { MarketSession } from './worker.mjs';

const AT = Date.parse('2026-10-23T04:30:00Z');
const quote = nowMs => ({ contract: { symbol: 'NIFTY26OCT23000CE',
  kind: 'CE', expiry: '2026-10-29', token: 12345, lotSize: 65 },
  bid: 100, ask: 100.5, bidQuantity: 650, askQuantity: 650,
  updatedAtMs: nowMs - 1000 });
const ledger = () => enterPaperBasket(newPaperLedger(AT), {
  signalId: 'delivery-test-001', quote: quote(AT), nowMs: AT,
}).ledger;
const initial = () => newPaperDeliveryJournal(AT);
const claim = (state, data = ledger(), nowMs = AT) =>
  claimPaperDelivery(state, data, nowMs);
const accepted = (state, data, claimed, at = AT + 1000) =>
  settlePaperDelivery(state, data, { eventId: claimed.result.eventId,
    attempt: claimed.result.attempt, nowMs: at, httpStatus: 200,
    botResponse: { ok: true, result: { message_id: 42 } } });

test('claim is offline only, preserves source alert and requires definitive settlement', () => {
  const data = ledger(), start = initial();
  assert.equal(auditPaperLedger(data), true);
  const first = claim(start, data);
  assert.equal(first.result.status, 'SIMULATED_ATTEMPT_CLAIM');
  assert.equal(first.result.sent, false);
  assert.match(first.result.message, /SIMULATED ONLY/);
  assert.equal(first.journal.totalAttempts, 1);
  assert.equal(first.journal.active.status, 'CLAIMED_UNCONFIRMED');
  assert.equal(paperDeliverySummary(first.journal, data).acceptedByBotApi, 0);
  assert.deepEqual(data.outbox.map(e => e.status), ['PENDING', 'PENDING']);
  const repeat = claim(first.journal, data, AT + 500);
  assert.equal(repeat.result.status, 'AMBIGUOUS_ACK_REQUIRED');
  assert.equal(repeat.journal, first.journal);
});

test('success only records Bot API acknowledgement, not phone receipt', () => {
  const data = ledger(), first = claim(initial(), data);
  const done = accepted(first.journal, data, first);
  assert.equal(done.result.status, 'ACCEPTED_API_ONLY');
  assert.equal(done.result.phoneDelivered, false);
  assert.equal(done.journal.nextIndex, 1);
  assert.equal(done.journal.recent[0].telegramMessageId, 42);
  assert.equal(JSON.stringify(done.journal).includes('SIMULATED ONLY'), false);
  assert.equal(paperDeliverySummary(done.journal, data).acceptedByBotApi, 1);
  assert.equal(claim(done.journal, data, AT + 1001).result.attempt, 1);
  assert.throws(() => accepted(done.journal, data, first), /STALE_SETTLEMENT/);
});

test('crash after claim remains ambiguous across serialized restart, never resends', () => {
  const data = ledger(), first = claim(initial(), data);
  const restarted = JSON.parse(JSON.stringify(first.journal));
  for (const at of [AT + 1, AT + 5_000, AT + 500_000, AT + 86_400_000]) {
    const result = claim(restarted, data, at);
    assert.equal(result.result.status, 'AMBIGUOUS_ACK_REQUIRED');
    assert.equal(result.journal.totalAttempts, 1);
    assert.equal(result.journal.nextIndex, 0);
  }
  assert.equal(paperDeliverySummary(restarted, data).blockingState, 'AMBIGUOUS_ACK_REQUIRED');
});

test('timeouts, 5xx, malformed success and unknown 429 never auto-retry', () => {
  const cases = [{ httpStatus: undefined, botResponse: null },
    { httpStatus: 502, botResponse: null },
    { httpStatus: 200, botResponse: { ok: true } },
    { httpStatus: 429, botResponse: { ok: false, error_code: 429 } }];
  for (const response of cases) {
    const data = ledger(), first = claim(initial(), data);
    const resolved = settlePaperDelivery(first.journal, data, {
      eventId: first.result.eventId, attempt: 1, nowMs: AT + 1000, ...response });
    assert.equal(resolved.result.status, 'AMBIGUOUS_ACK_REQUIRED');
    assert.equal(resolved.journal.ambiguousOutcomes, 1);
    assert.equal(claim(resolved.journal, data, AT + 200_000).result.status,
      'AMBIGUOUS_ACK_REQUIRED');
  }
});

test('429 retry_after is respected exactly and attempted no more than three times', () => {
  const data = ledger(), first = claim(initial(), data);
  const rate = (state, attempt, nowMs, seconds) => settlePaperDelivery(state, data, {
    eventId: first.result.eventId, attempt, nowMs, httpStatus: 429,
    botResponse: { ok: false, error_code: 429, parameters: { retry_after: seconds } } });
  const a = rate(first.journal, 1, AT + 1000, 5);
  assert.equal(a.result.status, 'RATE_LIMIT_WAIT');
  assert.equal(a.journal.active.retryAtMs, AT + 6000);
  assert.equal(claim(a.journal, data, AT + 5999).result.status, 'RATE_LIMIT_WAIT');
  const second = claim(a.journal, data, AT + 6000);
  assert.equal(second.result.attempt, 2);
  const b = rate(second.journal, 2, AT + 7000, 7);
  const third = claim(b.journal, data, AT + 14000);
  assert.equal(third.result.attempt, 3);
  const c = rate(third.journal, 3, AT + 15000, 7);
  assert.equal(c.result.status, 'EXPIRED_AFTER_RATE_LIMIT');
  assert.equal(c.journal.nextIndex, 1);
  assert.equal(c.journal.expired, 1);
  assert.equal(c.journal.totalAttempts, 3);
  assert.equal(claim(c.journal, data, AT + 15001).result.attempt, 1);
});

test('rate-limit cooldown later than expiry stops stale BUY before new request', () => {
  const data = ledger(), first = claim(initial(), data);
  const next = settlePaperDelivery(first.journal, data, { eventId: first.result.eventId,
    attempt: 1, nowMs: AT + 1000, httpStatus: 429,
    botResponse: { ok: false, error_code: 429, parameters: { retry_after: 200 } } });
  assert.equal(next.result.status, 'EXPIRED_AFTER_RATE_LIMIT');
  assert.equal(next.journal.recent[0].status, 'EXPIRED_UNSENT');
  const late = claim(next.journal, data, AT + 601_000);
  assert.equal(late.result.status, 'NO_ELIGIBLE_ALERT');
  assert.equal(late.journal.expired, 2);
});

test('definite 4xx rejection is terminal; conflicting late responses cannot modify journal', () => {
  const data = ledger(), first = claim(initial(), data);
  const rejected = settlePaperDelivery(first.journal, data, {
    eventId: first.result.eventId, attempt: 1, nowMs: AT + 1000,
    httpStatus: 403, botResponse: { ok: false, error_code: 403 } });
  assert.equal(rejected.result.status, 'DEFINITIVE_REJECTION');
  assert.equal(rejected.journal.rejected, 1);
  assert.throws(() => accepted(rejected.journal, data, first), /STALE_SETTLEMENT/);
});

test('explicit owner suppresses unknown result without claiming delivery or resending', () => {
  const data = ledger(), first = claim(initial(), data);
  assert.throws(() => suppressAmbiguousDelivery(first.journal, data, {
    eventId: first.result.eventId, nowMs: AT + 1000,
    decision: 'RETRY_ANYWAY' }), /OWNER_ACK_REQUIRED/);
  const resolved = suppressAmbiguousDelivery(first.journal, data, {
    eventId: first.result.eventId, nowMs: AT + 1000,
    decision: 'OWNER_SUPPRESS_RESEND_ACKNOWLEDGING_UNKNOWN_DELIVERY' });
  assert.equal(resolved.result.status, 'SUPPRESSED_UNCERTAIN');
  assert.equal(resolved.result.acceptedByTelegram, false);
  assert.equal(resolved.journal.nextIndex, 1);
  assert.equal(resolved.journal.suppressed, 1);
  assert.equal(claim(resolved.journal, data, AT + 1001).result.attempt, 1);
});

test('journal tampering, attempt replay, wrong cursor and clock rollback all fail closed', () => {
  const data = ledger(), first = claim(initial(), data);
  const mutants = [
    j => { j.nextIndex = 5; },
    j => { j.totalAttempts = -1; },
    j => { j.active.eventId = 'forged'; },
    j => { j.active.attempt = 0; },
    j => { j.recent.push({ unexpected: true }); },
  ];
  for (const mutate of mutants) {
    const corrupt = structuredClone(first.journal);
    mutate(corrupt);
    assert.throws(() => auditPaperDelivery(corrupt, data), /PAPER_DELIVERY_/);
  }
  assert.throws(() => claim(first.journal, data, AT - 1), /CLOCK_ROLLBACK/);
  assert.throws(() => settlePaperDelivery(first.journal, data, {
    eventId: first.result.eventId, attempt: 2, nowMs: AT + 1,
    httpStatus: 200, botResponse: { ok: true, result: { message_id: 42 } },
  }), /STALE_SETTLEMENT/);
});

test('bounded terminal receipt retention preserves a non-replayable cursor', () => {
  let data, signals = 0;
  for (let dayOffset = 0; dayOffset < 100 && signals < 34; dayOffset++) {
    const day = new Date(Date.parse('2026-04-02T00:00:00Z') +
      dayOffset * 86_400_000).toISOString().slice(0, 10);
    if (sessionStatus(day) !== 'REGULAR') continue;
    const at = Date.parse(`${day}T10:00:00+05:30`);
    if (!data) data = newPaperLedger(at);
    const id = `retention-signal-${String(signals).padStart(3, '0')}`;
    data = enterPaperBasket(data, { signalId: id, nowMs: at,
      quote: quote(at) }).ledger;
    for (const accountId of ['PAPER_50K', 'PAPER_100K']) {
      const exitAt = at + 120_000;
      data = exitPaperPosition(data, { tradeId: `${accountId}:${id}`,
        nowMs: exitAt, quote: { ...quote(exitAt), bid: 141, ask: 141.5 } }).ledger;
    }
    signals++;
  }
  assert.equal(signals, 34);
  assert.equal(data.outbox.length, 136);
  assert.equal(auditPaperLedger(data), true);
  const after = data.lastMutationAtMs + 700_000;
  const expired = claim(newPaperDeliveryJournal(after), data, after);
  assert.equal(expired.result.status, 'NO_ELIGIBLE_ALERT');
  assert.equal(expired.journal.nextIndex, 136);
  assert.equal(expired.journal.expired, 136);
  assert.equal(expired.journal.recent.length, DELIVERY_RECENT_LIMIT);
  assert.equal(expired.journal.recent[0].index, 8);
  assert.equal(expired.journal.recent.at(-1).index, 135);
  assert.equal(expired.journal.totalAttempts, 0);
  assert.equal(auditPaperDelivery(expired.journal, data), true);
  assert.equal(claim(expired.journal, data, after + 1).result.status, 'NO_ELIGIBLE_ALERT');
  assert.equal(DELIVERY_RECENT_LIMIT, 128);
});

test('production worker exposes no remotely callable delivery claim/settlement paths', async () => {
  const env = { SCHEDULER_ADMIN_KEY: 'Strong-Delivery-Admin-Test-000123456789',
    OFFLINE_SCHEDULER_ENABLED: 'true', OFFLINE_PAPER_LEDGER_ENABLED: 'true',
    OFFLINE_DELIVERY_REHEARSAL_ENABLED: 'true',
    MARKET_SESSION: { idFromName: () => { throw Error('unexpected DO lookup'); } } };
  for (const path of ['/internal/paper-delivery/claim',
    '/internal/paper-delivery/settle', '/internal/paper-delivery/suppress']) {
    const result = await worker.fetch(new Request('https://offline.invalid' + path,
      { method: 'POST', headers: { authorization:
        'Bearer Strong-Delivery-Admin-Test-000123456789' } }), env);
    assert.equal(result.status, 404);
  }
  assert.equal(PAPER_DELIVERY_KEY, 'paper-delivery-v1');
});

function transactionalStore(source, withJournal = true) {
  const rows = new Map([['paper-ledger-v1', structuredClone(source)]]);
  if (withJournal) rows.set(PAPER_DELIVERY_KEY, newPaperDeliveryJournal(AT));
  let abortNextCommit = false;
  const storage = {
    rows,
    get: async key => structuredClone(rows.get(key)),
    async transaction(callback) {
      const draft = new Map(structuredClone([...rows.entries()]));
      const txn = { get: async key => structuredClone(draft.get(key)),
        put: async (key, value) => { draft.set(key, structuredClone(value)); } };
      const result = await callback(txn);
      if (abortNextCommit) {
        abortNextCommit = false;
        throw new Error('SYNTHETIC_SQLITE_COMMIT_ABORT');
      }
      rows.clear();
      for (const [key, value] of draft) rows.set(key, value);
      return result;
    },
    abort: () => { abortNextCommit = true; },
  };
  return storage;
}
const workerEnv = () => ({ OFFLINE_SCHEDULER_ENABLED: 'true',
  OFFLINE_PAPER_LEDGER_ENABLED: 'true', OFFLINE_DELIVERY_REHEARSAL_ENABLED: 'true' });

test('DO transactional journal survives synthetic restart and blocks unconfirmed reclaims', async () => {
  const data = ledger(), storage = transactionalStore(data);
  const firstWorker = new MarketSession({ storage }, workerEnv());
  const first = await firstWorker.claimPaperDeliveryRehearsal(AT);
  assert.equal(first.status, 'SIMULATED_ATTEMPT_CLAIM');
  assert.equal(storage.rows.get(PAPER_DELIVERY_KEY).active.status, 'CLAIMED_UNCONFIRMED');
  const restarted = new MarketSession({ storage }, workerEnv());
  assert.equal((await restarted.claimPaperDeliveryRehearsal(AT + 1000)).status,
    'AMBIGUOUS_ACK_REQUIRED');
  assert.equal((await restarted.paperDeliveryRehearsalSummary()).attempted, 1);
  const acceptedResult = await restarted.settlePaperDeliveryRehearsal({
    eventId: first.eventId, attempt: first.attempt, nowMs: AT + 2000,
    httpStatus: 200, botResponse: { ok: true, result: { message_id: 99 } } });
  assert.equal(acceptedResult.status, 'ACCEPTED_API_ONLY');
  assert.equal((await restarted.paperDeliveryRehearsalSummary()).acceptedByBotApi, 1);
  assert.equal(storage.rows.get('paper-ledger-v1').accounts.PAPER_50K.cashPaise,
    data.accounts.PAPER_50K.cashPaise);
});

test('DO transaction rollback never records a false Bot API acknowledgement', async () => {
  const storage = transactionalStore(ledger());
  const session = new MarketSession({ storage }, workerEnv());
  const first = await session.claimPaperDeliveryRehearsal(AT);
  storage.abort();
  await assert.rejects(() => session.settlePaperDeliveryRehearsal({
    eventId: first.eventId, attempt: first.attempt, nowMs: AT + 1000,
    httpStatus: 200, botResponse: { ok: true, result: { message_id: 99 } },
  }), /SYNTHETIC_SQLITE_COMMIT_ABORT/);
  assert.equal((await session.paperDeliveryRehearsalSummary()).acceptedByBotApi, 0);
  assert.equal((await session.claimPaperDeliveryRehearsal(AT + 2000)).status,
    'AMBIGUOUS_ACK_REQUIRED');
});

test('DO delivery rehearsal is disabled without its own opt-in flag', async () => {
  const storage = transactionalStore(ledger(), false);
  const session = new MarketSession({ storage },
    { ...workerEnv(), OFFLINE_DELIVERY_REHEARSAL_ENABLED: 'false' });
  await assert.rejects(() => session.claimPaperDeliveryRehearsal(AT), /DISABLED/);
  assert.equal(storage.rows.has(PAPER_DELIVERY_KEY), false);
});

test('missing delivery journal with historical alerts blocks replay after restore', async () => {
  const storage = transactionalStore(ledger(), false);
  const session = new MarketSession({ storage }, workerEnv());
  await assert.rejects(() => session.claimPaperDeliveryRehearsal(AT + 1000),
    /MISSING_REPLAY_WATERMARK/);
  assert.equal(storage.rows.has(PAPER_DELIVERY_KEY), false);
  assert.equal(storage.rows.get('paper-ledger-v1').outbox.length, 2);
});

test('empty paper ledger may initialize delivery cursor safely before any alerts', async () => {
  const storage = transactionalStore(newPaperLedger(AT), false);
  const session = new MarketSession({ storage }, workerEnv());
  const empty = await session.claimPaperDeliveryRehearsal(AT);
  assert.equal(empty.status, 'NO_ELIGIBLE_ALERT');
  assert.equal(storage.rows.get(PAPER_DELIVERY_KEY).nextIndex, 0);
});
