# Phase 31 — bounded Telegram dispatch and market-data scheduling priority

**Status:** implemented and verified with local synthetic tests. **Cloud hosting is NOT active.** No live Kite credential, actual Telegram Bot API call, phone receipt, or broker trade was used during this phase.

## The specific failure mode

The older single-coroutine worker processed up to ten queued Telegram notices sequentially before checking the next five-minute REST market-data boundary. A Bot API HTTP call has a seven-second timeout; ten slow successes could therefore consume roughly seventy seconds of market-monitoring time, not counting scheduler, quote or database work. An expired/failed batch could also delay market collection. This is a *latency risk*, not a measured production outage.

## Revised fail-closed behavior

1. The worker's main loop prioritizes a due five-minute completed-candle REST poll before its periodic phone outbox and optional paper-premium BID check. Kite historical REST remains the only source of CE/PE review decisions.
2. Every `_deliver_outbox` pass permits at most **two Telegram send attempts**. The queue is durable: remaining notices are processed in subsequent minute passes, or expire under the existing strict 180-second freshness policy. This change never promises all messages will be sent; it deliberately prefers data freshness over flooding.
3. An attempted send is registered in SQLite **before** the outbound HTTP call. A failed request ends the current batch; pending records retain delivery attempts and can be retried. An accepted notice is marked with Telegram's API acceptance timestamp; this is **not evidence of handset receipt**.
4. A malformed/stale notice is rejected by the existing atomic SQLite send-time guard without spending one of the two allowed network attempts. A malformed limit or request to send more than two in one pass fails closed.
5. A market-data poll that has already started may still take its configured bounded time; a slow broker service or OS scheduler may still miss a boundary. This change cannot guarantee precise execution timing or prevent an in-flight Telegram request from completing late.

## Test evidence

- Reproduced **402/402 baseline tests** from the v79 source.
- Added offline tests for ten-record FIFO backlog, bounded multi-pass draining, retry persistence, a failure on the second send, malformed batch limits, expiration between passes, and market-data priority over outbox and premium monitoring.
- Full local suite: **414/414 passing** with Python compilation. No external network or account access in these tests.

## Cloud acceptance still required

Approved persistently running host, validated private storage, real HTTPS handoff, fresh Kite market-session market-data, actual Telegram Bot API and handset receipt, five market-day trials, real quote evidence and measured p95 alert latency. Keep `ALERTS_ENABLED=false` until operator has approved the target and completed the deployment runbook. No live orders are implemented.
