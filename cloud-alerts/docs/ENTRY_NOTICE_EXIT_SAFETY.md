# P7/P4: virtual EXIT notices require a confirmed entry notice

**Status:** offline implemented and tested, **not deployed**. October 19, 2026.

## Why

A paper-review entry can be safely persisted while Telegram delivery temporarily fails. Previously, the virtual candidate could trigger an `EXIT REVIEW` even though its matching `BUY REVIEW` never reached the Telegram API. This is misleading. No Kite order execution or actual holding ever occurs in the project.

## New invariant

1. The entry-processing transaction saves the outbox event and virtual candidate together. Every **new** candidate includes the `entry_event_id` used for the outbox event; the SQLite transaction injects a missing ID and rejects an ID that points to a different event.
2. While delivery state is **0 / queued**, both the 5-minute underlying virtual exit checker and opt-in 20-second option-BID watcher refrain from emitting exit notices. The premium watcher does not query Kite.
3. When Telegram returns success and the outbox is marked **1 / accepted**, the virtual exit watchers may resume. Success means only Telegram Bot API acceptance, **not** handset delivery or a filled trade.
4. When the entry is **2 / expired** (180-second limit), virtual tracking is cleared without a linked exit. The entry remains in the privacy-limited historical outbox counts.
5. A malformed or missing linked entry event never authorizes an exit. Previous research-only candidate records without `entry_event_id` use backward-compatible legacy processing; all new candidates are linked.
6. The existing SQLite outbox remains **at-least-once**. If Telegram accepts a message just before the process crashes, the same message might be retried. Nothing in this change claims exactly-once handset delivery.

## Test evidence

Nine new synthetic tests: pending entry, expired entry, accepted entry, premium network skip, premium expiration, missing linkage, restart survival, transaction-created linkage and mismatched foreign-link rejection. Full suite **186/186**. The tests use synthetic phone transports and futures/option objects only.

## Remaining production blockers

An explicitly approved always-on host with verified persistent storage and TLS, real daily token handoff, live Kite option market data, Telegram TEST and phone receipt, plus at least five full paper sessions. No live service, broker trade, secret publication or hosting charge was initiated by this phase.
