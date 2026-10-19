# Phase 21: Telegram Bot API acceptance and restart-safe latency evidence

**Status: offline implemented and synthetically tested. No host is deployed; no phone alert or market-triggered delivery has been observed from cloud.** This is a paper-review notification quality audit, **not trade P&L**, no broker order execution, and not a confirmation that Telegram displayed a message on a handset.

## Why this audit exists

The existing outbox stores alert texts and 0/1/2 states, but the old schema cannot tell how many times a queued event was attempted or how long it took the Telegram Bot API to accept it. A service may appear responsive while repeatedly failing sends, and a restart may conceal the outage. Trading-relevant BUY notices have a short 180-second TTL: a late accepted request should never silently be counted as an on-time delivery.

## New durable metadata

A non-destructive SQLite schema migration adds four columns to `events`:

- `delivery_attempts` — monotonic attempted HTTP requests per event. Incremented *before* attempting the external send, so restart after a timeout preserves the failed try.
- `first_attempt_utc` / `last_attempt_utc` — time of first and most recent attempt. No exception messages, chat IDs, API tokens, message bodies or broker account data added.
- `accepted_at_utc` — time when the Telegram Bot API reported success, **not when a phone received anything**. Only queued events can transition to accepted; expired/accepted events are immutable. Historic accepted rows with no acceptance timestamp remain explicitly **unknown-latency**.

The pre-existing `events.payload` field already contains the Telegram review body; the new audit does **not** select, copy, log or expose its contents. The CLI connects to SQLite **read-only**, never migrates it or creates a database, and returns only aggregated statistics.

## Usage after a real paper-monitoring session

On a private machine with access to a read-only copy of the encrypted host's persistent-volume SQLite file (do not upload it publicly):

```bash
cd cloud-alerts
python -m cloud_alerts.delivery_audit_cli \
  --db /private/research-copy/alerts.sqlite3 \
  --session-date 2026-10-19
```

`--session-date` may be repeated for up to twenty **explicitly confirmed** NSE open session weekdays. The tool does not infer that a weekday is a real trading day. Back up the SQLite database safely using SQLite's backup API (including WAL consistency); do not copy only the main `.sqlite3` while the bot is writing.

The command outputs machine-readable JSON including:

- `review_alerts`, `accepted_by_bot_api`, `expired_unsent`, `still_queued`, `telegram_api_acceptance_rate_pct`.
- `send_attempts_recorded`, `alerts_requiring_retry`.
- `median_api_latency_seconds`, `p95_api_latency_seconds`, `max_api_latency_seconds`, `accepted_after_180s`.
- `accepted_without_timing_evidence` for legacy events whose true acceptance latency is unknown.
- Explicit boolean **false** for phone-receipt validation, independently verified Kite source, real trades, and credentials in report.

A session with **zero eligible alerts** has a **null**, not 100%, acceptance rate. The audit excludes test-only `NO_TRADE` rows. It rejects malformed states, naive timestamps, reversed attempt chronology and corrupted old metadata instead of fabricating a delivery metric.

## Acceptance test and limits

Synthetic failure/restart test: the Telegram send fails after the first durable attempt; a new worker reads the same database, retries once, and records acceptance after 35 seconds. The report counts **two attempts**, **one retried alert**, and **35 seconds API-acceptance latency**.

Other tests cover schema migration from the old five-column event table, attempted sends on expired events, immutable successful accepts, privacy of CLI output, null percentages, UTC-to-IST date selection, p95 calculation, and read-only schema rejection.

**At-least-once remains the delivery model.** A crash between Telegram API success and the SQLite acceptance commit can lead to a duplicate on retry; these counters cannot prove exactly-once delivery. Telegram can accept a message while a user has notifications off or loses connectivity. Live evidence requires an approved always-on cloud host, real daily Kite token transfer, actual Bot API requests, and an independent handset confirmation. Never enable order placement; paper reviews only.
