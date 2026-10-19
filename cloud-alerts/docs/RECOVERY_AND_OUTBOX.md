# Atomic paper-entry persistence and short-lived phone outbox

**Last reviewed:** 2026-10-19. Engineering-only evidence; does **not** imply cloud deployment, actual option positions or successful Telegram receipts.

## Safety invariants

1. A candidate must be backed by an exchange-timestamped completed 5-minute REST candle and a fresh option quote. The original `CandlePollScheduler` bounds attempts to `:08`, `:23`, and `:43` seconds of each boundary; no arbitrary re-polling loop.
2. A stale/missing option depth response **does not** permanently mark the candle complete. A later bounded retry within that candle-boundary window may succeed. If it never succeeds, there is no BUY alert.
3. The `claim_entry_with_candidate` SQLite transaction writes the paper event **and** its virtual stop/target reference together, before the Telegram request. Duplicate event IDs or another same-day virtual position fail closed.
4. The outbox sends at least once, not guaranteed exactly once. If Telegram accepts and a process crashes before the acceptance flag is persisted, a duplicate may be sent after restart. Every notification must contain the same identifiable candle/contract timestamp.
5. Telegram network failure leaves the event queued. If older than 180 seconds, the queue entry expires instead of delivering a stale BUY. Public health exposes **counts only**; message content, broker credentials and phone ID are excluded.
6. A market signal is *not* an actual option purchase. Virtual position monitoring must not be interpreted as a broker holding or real realized P&L.

## Tests

The `test_atomic_entry.py` suite covers transactional claims, restart/retry, duplicate rejection, malformed state, daily rollover, failure and expiry. `test_simulated_broker_pipeline.py` checks the stale-quote-then-fresh-quote path. The overall offline test suite is **96 passing tests**.

## Still to verify on approved always-on host

- Daily token relay and rotation (user authenticated), encrypted vault persistence through container restart.
- Fresh Kite futures/option bid-ask and REST publication timing across actual market sessions.
- Telegram API acceptance and independently observed phone receipt/latency; p50/p95 delivery timings.
- Reject unauthorized or unexpected extra workers; single-worker Docker configuration is already present but not deployment-proven.
- A minimum of five entire paper-trading sessions, with missed-candle and after-cost option backtest evidence.
