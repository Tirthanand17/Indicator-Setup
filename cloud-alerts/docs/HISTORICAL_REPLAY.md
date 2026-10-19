# Phase 17: deterministic offline historical replay

**Status:** implemented and synthetic-tested. Not deployed. No trading results have been verified.

The module `cloud_alerts/replay.py` replays completed NIFTY futures five-minute candles with only fifteen-minute context already completed at each simulated decision time. Observations occur twelve seconds after the five-minute candle close; higher-timeframe data require an eight-second close buffer.

The SHA-256 checkpoint includes historical five-minute warmup data, each subsequently processed bar, and the currently available fifteen-minute context. Restart replay validates that prefix before continuing. This detects historical data revisions; it is **not cryptographic proof of original Kite data provenance**.

The offline CLI (`python -m cloud_alerts.replay_cli`) takes a JSON export with exactly three top-level keys: `schema` set to `nifty-replay-v1`, `candles_5m`, and `candles_15m`. Each candle must have `start` (ISO-8601 with offset), `open`, `high`, `low`, `close` (numeric), and `volume` (integer). No tokens, accounts, credentials, extra fields, network calls or order submissions are permitted.

Example:

```bash
python -m cloud_alerts.replay_cli --input /path/to/candles.json --start '2026-10-19T09:30:00+05:30' --end '2026-10-19T15:00:00+05:30'
```

A returned `checkpoint` may be supplied using `--resume-candle` and `--resume-sha` to reject mismatched historical input after restarting.

**Limitations:** This is historical futures **signal research only**. It produces neither real Telegram messages nor an option win rate. Past option bid/ask depth, slippage and real fills are not reconstructed from futures OHLCV. Actual after-cost option results and five-session paper testing still need independently captured evidence. Exchange holiday and unscheduled halt calendars are not independently checked.

Local complete baseline: **224/224 Python tests passed**. Remote GitHub includes essential replay and CLI regression cases. No cloud host is running and no protected trading folder was modified.
