# In-process worker restart reconciliation — Phase 28 (2026-10-20)

**Status:** tested offline with 363/363 Python tests. No approved always-on server is deployed. Not proof of delivered phone alerts, Kite API validity or profitable trading.

## Why this matters

The Phase 27 `WorkerSupervisor` restarts a crashed market-data coroutine **within the same FastAPI process**, without re-entering the application's lifespan. Earlier, `State.reconcile_startup()` ran only on initial application startup. Consequently, a queued Telegram BUY review could expire or a virtual paper position become invalid while a worker was failing, and the recovered task could begin using persisted state that had not been re-checked.

## New invariant

1. The previous worker must have fully exited before the supervisor's synchronous `on_failure` callback runs. The single-worker app-level file lock remains held.
2. Immediately clear the previous worker's `last_data_at` and mark the engine as recovering, before any new healthy-data claim.
3. Run the same atomic SQLite `reconcile_startup(now_ist)` before the next `run_forever()` begins. This expires notifications older than 180 seconds and clears outdated or unsent-entry virtual positions. Recent queued messages and correctly linked, current-day candidates remain intact for safe retry. **No broker or Telegram network requests** occur during reconciliation.
4. If the database contains a malformed or missing-link current-day paper candidate, reconciliation raises a **generic** failure. The supervisor becomes `FATAL`, does **not** start a replacement worker and signals controlled container shutdown. Fatal cleanup does not incorrectly propagate another exception during FastAPI teardown.
5. `/healthz` reports only sanitized counters from the last in-process recovery: whether it ran, how many unsent notifications were expired, how many stale virtual candidates were cleared, and whether a currently valid candidate was preserved. This endpoint **does not expose alert message bodies**, credentials, account IDs or individual event timestamps.
6. The next worker must collect new authenticated REST decisions to restore operational readiness. Telegram API acceptance still does **not** imply delivery to the phone; no orders can be placed by this worker.

## Regression evidence

Four new integration tests simulate a worker crash *after* application startup while mutating the durable state:

- Expired unsent paper entry and linked virtual position are both reconciled before the replacement worker begins.
- A current-day **accepted** entry and its candidate survive the crash.
- A recent, still-queued entry and its candidate survive for retry without exposing its payload in `/healthz`.
- Corrupted candidate data prevents a second worker start and causes a generic fatal shutdown, without leaking synthetic exception or payload text.

`python -m pytest -q` => **363 passed**; `python -m compileall -q cloud_alerts` => passed. Tests simulate the broker and phone; they do not send messages or fetch quotes.

## Remaining operational gate

Approve and provision a genuinely always-on ₹0-incremental-cost server, with private durable encrypted-at-rest data volume and TLS ingress. Validate the signed daily Kite access-token handoff and end-to-end Telegram TEST on the user's actual phone, then observe at least five complete market sessions. Until those checks pass: **cloud alerts operational = NO**, **actual option win rate verified = NO**.
