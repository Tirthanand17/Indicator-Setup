# Single-worker crash supervision — Phase 27 (2026-10-20)

**Status:** synthetic/offline verified. This module has NOT been exercised on an authorized always-on cloud VM, and is not evidence that Telegram alerts reach a phone.

## Failure mode repaired

A FastAPI/Uvicorn HTTP server can stay online even after its market-monitoring background coroutine unexpectedly ends. Merely returning a failing `/healthz` does **not** cause Docker Compose's `restart: unless-stopped` to restart the container: Docker's health check and process restart policy are separate mechanisms. The system must not look healthy if the market-data engine is in recovery backoff.

## Behavior

1. The existing **single-worker POSIX lock** is acquired and the SQLite startup reconciliation runs before starting one `WorkerSupervisor` task.
2. The supervisor awaits exactly **one** `Engine.run_forever()` coroutine at a time. An unexpected exception **or unexpected normal return** counts as a failure. A normal lifespan shutdown (`asyncio.CancelledError`) exits without automatic restart.
3. Following each early failure, `/healthz` becomes **HTTP 503**, with `worker_supervisor.state=BACKOFF`. The previous REST-data freshness timestamp is cleared and engine status changes to `WORKER_RECOVERING`, so `/operationalz` cannot reuse an old positive decision. Broker exception bodies/credentials are not logged or returned.
4. Restart backoffs are **1, 2, then 5 seconds** (bounded budget: four consecutive early failures). A subsequent successful run of at least five minutes resets the consecutive failure budget. Recovering tasks use the same durable SQLite state and do not create extra workers.
5. After four repeated early failures, the supervisor transitions to `FATAL`. Its FastAPI task completion callback records a **generic** critical log message and sends **SIGTERM to its own process**. The existing container `restart: unless-stopped` configuration can then restart the whole service, rerunning secure preflight, single-worker lock and state reconciliation. This is deliberately different from assuming Docker restarts unhealthy processes.
6. `/readyz` now requires the background task to be actively running as well as an enabled service and current token. Neither `/readyz`, `/healthz`, nor `/operationalz` proves actual phone receipt, completed option fills, or a profitable strategy.

## Important limitations

- If state corruption or unavailable dependencies cause persistent failures, process restarts may recur. Hosting operators must inspect generic logs and configuration **without posting tokens** and may stop the service. Supervision is not a substitute for provider monitoring or actual market-session coverage evidence.
- Failed network I/O in `asyncio.to_thread` might take up to the SDK's request timeout to finish after cancellation. The supervisor does not start two `run_forever()` coroutines at once; no broker orders exist.
- This implementation does **not** restart a crashed VM, guarantee network uptime, schedule daily retail Kite authentication, or independently verify NSE trading holidays.
- No cloud host was provisioned and no real Telegram messages were sent by these tests. The original `Automation Day Trading` folder remains read-only and unchanged.

## Offline validation

`python -m pytest -q` passes **359/359** synthetic tests including: restart after two crashes, one-worker-only invariant, private exception suppression, unexpected clean worker return, bounded failure shutdown, backoff cancellation, callback failure safety, red health/readiness during backoff, and invalidation of stale market data after a real simulated worker restart.

**Production acceptance gate:** authorize a known ₹0-incremental-cost always-on VM, deploy the single-replica service with private durable storage, verify real TLS token handoff, confirm Telegram TEST on a handset, then collect at least five complete real market sessions. Until then, **cloud service operational = NO**.
