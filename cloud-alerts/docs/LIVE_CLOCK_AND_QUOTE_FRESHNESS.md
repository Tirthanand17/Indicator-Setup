# Phase 25 — live response-time and Telegram send-time safety

**Status: locally tested code only. Cloud service NOT deployed.** Read-only Kite and paper-review notifications; no actual option orders or fills.

## Failure mode corrected

The five-minute scheduler previously handed a captured candle-poll timestamp to the engine. That timestamp could persist through the historical 5-minute/15-minute REST fetch, NFO option quote fetch, SQLite write and Telegram HTTP call. Comparing a fresh quote against the older timestamp could incorrectly reject a valid exchange quote as future dated; conversely, a quote already stale when its HTTP response arrived could appear fresh. Passing the old timestamp into `_deliver_outbox()` could also reauthorize a BUY alert that had become stale during market-data processing.

## Invariants

1. **Live worker:** `run_forever()` calls `run_once()` without supplying its scheduler timestamp. A task-local marker selects live wall-clock sampling for each Telegram attempt and for the post-response acceptance timestamp. No batch-level poll time authorizes an outbound message.
2. **Offline deterministic tests:** explicit `run_once(now=aware_datetime)` retains a supplied clock. The marker is restored in `finally` even if the broker fails. It does not introduce a new background service or collect any real data.
3. **Option quote:** live quote freshness is measured immediately after its HTTP response using the current IST clock; only that instant may become a fresh option-reference time, paper-entry event timestamp, and quote-evidence timestamp.
4. **Entry cutoff:** a quote arriving after **15:00 IST** may not authorize a new paper BUY review, even if the candle decision was computed earlier. No late fetch authorizes a real order—there is no order API.
5. **Delivery remains best-effort:** the Telegram API call is already in flight by the time its eventual result is known. A successfully submitted HTTP message cannot be recalled. Late API acceptance is measured but cannot authorize a virtual EXIT. The phone's actual delivery remains unverified.

## Test evidence (2026-10-19)

Seven added offline regression tests plus all previously existing tests: **346/346 passed**. Scenarios include delayed broker reads that cause a queued alert to expire, correct simulated-time behavior for historical tests, actual Telegram response timestamps after network delay, context reset after errors, option quote timestamp newer than the poll time, option quote becoming stale during a delayed request, and a post-cutoff quote. No Kite/Telegram/host calls were used.

## Production prerequisites

Deploy only on a user-approved always-on host with TLS, protected persistent storage, authorized credentials and zero additional charges. Test daily Kite token handoff, real option depth, Telegram handset receipt and five real paper sessions. **These are not completed by this phase.**
