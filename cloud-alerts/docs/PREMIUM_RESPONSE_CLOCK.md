# Phase 26 — Response-time clock for opt-in virtual CE/PE premium exits

**Status:** 2026-10-19, locally tested read-only paper prototype. **NOT hosted or validated on a live market session.** No real Kite orders or user holdings are accessed.

## Bug and scope

`poll_virtual_premium()` previously received a time sampled at the beginning of a 20-second polling slot. It used that old timestamp to validate Kite option BID/ASK timestamps, calculate paper STOP/TARGET events, persist quote evidence, and stamp Telegram outbox messages. A slow quote request could make a stale quote appear fresh or incorrectly reject a fresh response as future-dated. The unattended `run_forever()` loop explicitly passed its captured slot timestamp, so this was a live-path issue, not merely an offline-test issue.

## Corrected invariants

1. The unattended worker invokes `poll_virtual_premium()` with **no explicit time**. In this mode, it takes a new current IST timestamp *after* the Kite quote returns. The response timestamp is used for the max-15-second option-depth freshness check, STOP/TARGET evaluation, quote-evidence observation, and the paper exit review's event timestamp. Live Telegram send/acceptance TTL checks sample the wall clock at the send/response time.
2. An explicitly supplied `now=...` is an **offline-only deterministic replay/testing seam**, with no production clock inference. The task-local live mode is reset even after a broker exception.
3. If a quote response crosses **15:15 IST** while fetching data, issue a **TIME review without an asserted executable exit BID**. Do not record an EXIT quote pair or score a hypothetical fill from that late response.
4. If the response arrives at or after **15:26 IST** or changes the exchange-date, do not create a new STOP, TARGET, or TIME alert from that response. The unclosed virtual candidate remains for existing end-of-day/restart cleanup, not for overnight real position tracking.
5. Network errors, timeouts, stale option quotes, mismatched tokens, and unverified linked-entry notices remain fail-closed. The premium watcher is **disabled by default** (`PAPER_PREMIUM_TRACKING_ENABLED=false`). The REST five-minute candle signal engine continues to be the only source of entry reviews.

## Evidence

Reproduced the **346/346**-passing Phase 25 baseline. Added **six synthetic regression tests** including a delayed quote that turns stale, a fresh quote that returns later, time-cutoff crossing, session-end clock shift, explicit-clock replay, and context reset after broker exceptions. **352/352** local tests pass with no Zerodha, Telegram, or cloud network requests. The tests do **not** prove phone receipt, trade execution, strategy profitability or a working 24×7 server.

## Production work left

Select and authorize a truly always-on host with persistent encrypted storage within the agreed zero-new-cost budget. Validate daily signed Kite access-token handoff, live option quote response times, real Telegram handset reception, reconnect and session-end behavior across at least five market days. No such host is activated as part of this change.
