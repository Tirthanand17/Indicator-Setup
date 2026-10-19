# Phase 24 — paper-alert freshness and late Telegram acceptance

**Status:** synthetic/offline tested; NOT deployed, no real Kite orders or phone receipts.

## Problem and fix

A queue may hold several alerts. Checking a single 180-second cutoff before
processing the batch is insufficient: a preceding Telegram HTTP call can take
long enough for another message to expire before it is transmitted. A late
acknowledgment of an entry review must not authorize future virtual exit reviews.

`State.claim_fresh_delivery_attempt(event_id, aware_now)` now runs a SQLite
`BEGIN IMMEDIATE` transaction, checks that the event is queued, parses its
original time-zone-aware creation instant, applies the 180-second expiry
boundary, and records the send attempt. Missing, malformed, expired, or
excessively future-dated events are never handed to the Telegram transport.
The engine samples a new UTC/IST-aware clock value before each queued send in
normal production mode, rather than reusing the start-of-batch clock.

Telegram can still accept a request *after* 180 seconds if network processing
began just before expiration. This cannot be recalled. The original acceptance
instant is retained for the API-latency audit, but a virtual EXIT is authorized
only if acceptance is proven to have occurred within the original 180-second
window. Legacy accepted events without a stored acceptance timestamp, corrupt
acceptance timestamps, and too-early/late acknowledgements do not qualify.

`reconcile_startup()` removes paper positions whose entry acknowledgement
was expired, late, or unverifiable. Current-day candidates with valid queued
or timely accepted entry notices are preserved. **Telegram API acceptance is
not proof of handset display or execution of a real trade.**

## Tests

17 new tests prove TTL boundaries, offset equivalence, malformed times,
transactional attempt counts, slow queued-batch behavior, accepted-after-TTL
classification, old-schema uncertainty, blocked virtual exits and startup
cleanup. Full suite: **339/339 passing locally**.

## Deployment blockers

There is still no approved always-on host, deployed TLS token receiver, actual
Telegram phone receipt validation or five-session option-level evidence. The
protected local trading project is untouched; broker order execution remains
absent by design.
