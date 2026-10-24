# Phase 24 — offline paper Telegram delivery reconciliation

24 October 2026. **Offline-only engineering test. No Telegram token, Bot API
request, phone notification, broker order, cloud service or paid resource used.**
The Cloudflare production Worker has **no message-sending/claim/settlement
HTTP route**. The feature flag `OFFLINE_DELIVERY_REHEARSAL_ENABLED` stays
`false` in the undeployed sample.

## State machine and crash safety

The source ledger's 1,024-row paper outbox is immutable `PENDING` research
evidence; no delivery operation changes simulated cash or fills. A distinct
SQLite Durable Object record, `paper-delivery-v1`, tracks a monotonic index
and at most one active event. All transitions occur within native SQLite
transactions. An attempt is written as `CLAIMED_UNCONFIRMED` **before any
future network request**. An interrupted attempt cannot be resent just because
the process restarted, the market closed, or the 180-second BUY alert TTL ended.

| Synthetic outcome | Journal result | May automatically retry? |
| --- | --- | --- |
| Telegram HTTP 200, `ok=true`, positive `message_id` | `ACCEPTED_API_ONLY` | No; not proof of phone delivery |
| Telegram 429 with well-formed integer `parameters.retry_after` | `RETRY_AFTER`, exact cooldown, up to 3 attempts and TTL | Yes, only after cooldown while fresh |
| Definitive 4xx rejection, excluding 429 | `DEFINITIVE_REJECTION` | No |
| Timeout, 5xx, malformed response or unknown 429 | `AMBIGUOUS` | **No**; owner review required |
| Worker stops after claim but before settlement | `CLAIMED_UNCONFIRMED` | **No**; owner review required |
| Alert already older than 180 seconds (BUY) / 600 seconds (exit/review) with no uncertain attempt | `EXPIRED_UNSENT` | No |
| Owner explicitly acknowledges uncertainty and chooses to suppress resend | `SUPPRESSED_UNCERTAIN` | No; never marked delivered |

The last 128 **terminal** receipts are kept for quick diagnostics; an
unbounded receipt array is not used. The monotonic cursor and counters survive
tail compaction, so pruning old *receipts* cannot cause duplicate attempts.
The full paper outbox still exists under the fixed 1,024-row hard cap and is
**not** silently deleted. The delivery record never copies notification
message bodies, API responses or credentials into receipt history.

If the delivery cursor is missing but a paper ledger already contains events,
the Durable Object **refuses initialization** instead of treating old alerts as
new sends. Phase23's offline archive does not yet preserve this cursor and
therefore cannot be treated as a safe enabled-delivery restore procedure.
Restoring over an existing delivery record is also refused.

## Verified test scope

- 16 new Node tests: confirmed acceptance vs phone receipt, timeout/5xx/malformed
  ambiguity, bounded retry-after, TTL expiry, stale responses, explicit owner
  suppression, tampering and clock rollback, compacted receipt tail of **136
  genuine ledger events**, missing-cursor recovery guard and fake-DO
  transaction rollback.
- 1 new **native local workerd SQLite** scenario: journal claim persisted,
  restart blocks replay, explicit suppression, real SQLite 429 cooldown/second
  claim/API-acceptance reconciliation. The test runner intercepts and forbids
  every outbound request.
- No production Bot API integration, live host, daily Kite feed, actual
  notification, human phone confirmation or external backup/restore. Even real
  Bot API acceptance could not guarantee phone receipt or exactly-once delivery.

**Complete offline regression on 24 October:** Node edge **160 passed**,
extension **39 passed**, native workerd SQLite **7 passed**; Python
**777 passed, 1 skipped** with one external Starlette deprecation warning.
The local Python test virtual environment needed its temporary interpreter
symlink repaired before subprocess tests could pass. All cloud/runtime network
side effects remained disabled or intercepted.

**Checklist #24 is complete only for its offline reliability state machine and
native durable rehearsal.** Canonical offline engineering becomes **23/25=92%**;
items #23 (private cloud export/restore/capacity) and #25 (calendar/release
controls) remain open. All **five live acceptance gates remain unverified**.
Before any approved production delivery, implement a least-privilege transport
adapter, protect its Bot API token, include the delivery journal in authenticated
private backups, verify retry/latency on an authorized host and separately
confirm phone receipt. Nothing in this phase grants deployment or sending
permission.
