# Phase 23 — fail-closed alert recovery before starting the worker

**Status: implemented and synthetic-tested locally on 19 October 2026. Not validated on a deployed cloud host.** No broker orders, account trading, or Telegram requests are used in recovery.

## Why

A cloud restart can occur while a Telegram BUY review is queued. Pending alerts are valid for only 180 seconds, but a restored virtual paper candidate might outlive that interval. In addition, ISO timestamps persisted by older code can carry different time-zone offsets. Comparing them directly as SQLite **strings** can expire a future alert or leave a stale alert queued.

## New recovery sequence

1. Acquire the existing single-worker lock. Before starting the polling loop, call `State.reconcile_startup(now)` using an aware clock.
2. Inspect persisted virtual candidate state **before any writes**. Invalid JSON, an unsupported/future expiry, missing candidate metadata or an unlinked current-day entry raises an error and **blocks startup**. No automatic database deletion or overwrite occurs; an authorized operator must inspect and repair private state before retrying.
3. Atomically mark queued alerts older than 180 seconds as expired using timezone-normalized SQLite `julianday()` comparisons. Previously accepted Telegram API events retain their accepted status.
4. Clear only a candidate from a previous trading date or a current-day candidate whose linked BUY review has expired unsent. Preserve a candidate linked to a queued-but-still-valid or Telegram-accepted entry notice.
5. Return **sanitized counts only**: expired notifications, cleared candidates, preserved candidate flag. Never report private Telegram content, account values, bot keys or virtual position prices.
6. The normal outbox and 5-minute REST scheduler start afterward. No historical signals are replayed as fresh BUY recommendations.

The standalone `expire_events_before` method and the pending-outbox ordering also use normalized instants, so old records written in UTC and IST are evaluated equivalently.

## Offline acceptance tests

- Mixed-offset SQLite record expiry, including a future UTC alert that must **not** expire.
- Reject naive cutoff timestamps.
- Expire a stale linked entry and clear its virtual position; ensure a second restart is idempotent.
- Preserve a same-day accepted or still-young queued entry and candidate.
- Clear previous-day candidate without mutating previously accepted entry evidence.
- Abort atomically on malformed, unlinked or future-dated candidates; no partial expiry.
- Verify FastAPI lifespan performs recovery **before** launching its background worker.

**Full local suite: 321/321 passing**. These tests use synthetic clocks and SQLite files. There has been no laptop-off cloud trial or live phone receipt.

## Limitations

- Telegram API acceptance is not handset delivery; at-least-once delivery may duplicate after a crash in an external send window.
- If Telegram accepted a message while a network request was in flight, it cannot be unsent. A recovery after a crash may retry within the original expiry window.
- The SQLite database stores sensitive alert text. The separate snapshot/backup tool does not encrypt backups; keep private backups on encrypted-at-rest storage.
- Older **same-day legacy** virtual candidates lacking an `entry_event_id` block startup intentionally. The operator must review them; no automatic migration can prove a historical phone notification was accepted.
- Weekday checks do not establish exchange holidays. The monitoring service remains undeployed.
