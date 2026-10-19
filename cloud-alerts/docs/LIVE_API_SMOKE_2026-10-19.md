# Live paid Kite Connect read-only smoke test — 2026-10-19

**Scope:** Authenticated market-data **GET** requests only, executed on the user's authorized Nirala machine with access-token values read from the existing protected `.env` file. **NO writes** to the protected trading folder, broker orders, account/holding/profile queries, secrets in outputs or GitHub secrets. The test script and result summary were kept in the Windows user temp directory, not in the trading folder.

## Sanitized result

| Endpoint / check | Observed result |
|---|---|
| API key and daily token | Both keys present; **actual values never printed** |
| `GET /instruments/NFO` | HTTP 200 |
| Instrument rows returned | 38,814 |
| Active front-month NIFTY futures | `NIFTY26OCTFUT` |
| Futures contract expiry | 2026-10-27 |
| Listed futures lot size | **65** (verify dynamically again each future session) |
| `GET /quote?i=NFO:...` | HTTP 200, payload present, exchange quote timestamp present, bid/ask depth present |
| `GET /instruments/historical/{token}/5minute` | HTTP 200; 78 bars in requested range |
| Most recent observed 5-minute bar start | 2026-10-19T15:10:00+0530 |
| `GET /instruments/historical/{token}/15minute` | HTTP 200; 26 bars in requested range |
| Most recent observed 15-minute bar start | 2026-10-19T15:00:00+0530 |
| Latest bars' futures traded volume | Nonzero |
| Order, position, holdings or account endpoints | **Never called** |

**Meaning:** Existing paid Kite access credentials did successfully authenticate the market-data requests needed for the chartless indicator architecture. This does **not** show that a cloud server can yet receive the daily token, remain on, deliver Telegram candidate alerts, or calculate a profitable strategy. Nor does this smoke test verify live option-contract depth or broker data rate-limit behavior under load.

**Follow-up security:** The local temporary diagnostic file does not embed credential values or broker request URLs containing tokens; it reads the `.env` at runtime and outputs sanitized status indicators only. Protect the original `.env` as before.

## Technical follow-on

1. Keep `KiteReadOnly.historical()` as the authoritative completed-broker-candle source; the raw WebSocket aggregator remains **shadow-only** until REST reconciliation evidence exists.
2. Verify actual option quote freshness and depth using a small, authenticated market-data test during a trading session, without placing orders.
3. Provision approved always-on hosting with TLS, dedicated secret storage and persistent encrypted token store; perform a **signed HMAC local-to-cloud handoff** after daily user-authorized login.
4. Run 5+ multi-session paper trials, measuring missing bars, old alert drops and end-to-end mobile latency.

**Progress impact:** P3 (broker REST data adapter) moves from 50% synthetic-only to **75%** after successful authenticated live-market access; the complete system remains **44% engineering-ready** by the published phase-weighting method. No live cloud deployment yet.
