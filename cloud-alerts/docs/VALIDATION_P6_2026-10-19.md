# P6 streaming integration — offline validation report

**Date:** 2026-10-19. **Result:** 61/61 local Python tests passed; **live Kite WebSocket, live option buy/exit alert and cloud host NOT tested** in this pass.

## New implementation

- `cloud_alerts/stream_supervisor.py`: optional single KiteTicker connection; async main-loop ingestion of threaded callbacks via `call_soon_threadsafe`, generation fencing so stale callbacks from a previous connection are ignored, separate session token/instrument rollover, shutdown after exchange closes.
- `StreamEvidence`: bounded ring of unconfirmed 5-minute tick shadow candles, reconciled against the **completed** authoritative Kite REST 5-minute candle with OHLC and volume tolerances; compares exactly once for each unique broker candle; emits sanitized mismatch counts/reasons to `/healthz` without raw tokens, account numbers or tick payloads.
- `Engine`: controlled opt-in shadow feed via injected supervisor; starts only after retrieving current-month NIFTY futures token and valid daily access token. It does not alter the existing read-only broker `KiteReadOnly` API or the REST candle trading rule path. Historical REST remains the sole source of candidate alerts.
- `FastAPI` lifecycle: `KITE_SHADOW_ENABLED=false` by default; closes shadow connection when cloud worker stops. `Engine.run_forever` calls after-hours shutdown once a minute.

## Fail-closed safeguards and tests

| Safeguard | Offline coverage |
|---|---|
| Initially partial tick bucket never produces trusted candle | `test_streaming.py` |
| Tick gaps, stale/future timestamps, out-of-order packets and volume rollback rejected | `test_streaming.py` |
| Broker REST vs shadow mismatch tracked without promoting shadow to source of trade | `test_stream_supervisor.py` |
| Bounded history, stale shadow eviction, exactly-once in-memory REST comparison | `test_stream_supervisor.py` |
| Token rotation closes previous socket; stale callbacks cannot contaminate state | `test_stream_supervisor.py` |
| Contract month/instrument rollover closes old socket and re-subscribes | `test_stream_supervisor.py` |
| Socket failure does not block confirmed REST `NO_TRADE` decisions | `test_shadow_worker.py` |
| No socket after session cutoff | `test_stream_supervisor.py` |
| Default-off configuration, signature/replay safety and delayed alert expiration | `test_server.py`, `test_security.py`, `test_stale_delivery.py` |

## Known limitations

1. No real streaming tick or end-to-end cloud alert has been observed. The worker's official KiteTicker connection and callbacks must be exercised on an approved real host with read-only paid API access.
2. A sampled tick OHLCV stream can diverge from actual historical broker candles. Shadow mismatch does **not** contaminate signals. A full market-session reconciliation report is needed before considering streaming-derived entry decisions.
3. Current candidate entry rules wait for completed broker REST candles. Sub-second entries cannot be guaranteed; documented polling retries at 8, 23 and 43 seconds after each five-minute boundary are hypotheses to validate with real publication delays.
4. Actual CE/PE premiums, fills, slippage, and held positions remain unverified. Virtual exit alerts **do not sell Kite holdings**.
5. Hosting and persistent token relay remain unprovisioned. Broker `order` APIs are not called.

**Acceptance status:** code tests passed; **real-world P6 acceptance not met**.
