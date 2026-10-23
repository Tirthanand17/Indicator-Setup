# Offline Cloudflare migration — scheduler, rule parity and read-only market adapter

**IN DEVELOPMENT / PAPER ONLY. NOT DEPLOYED.** Checklist18/25 (72%), live acceptance0/5; [canonical progress](../cloud-alerts/docs/PROGRESS.md).

`worker.mjs` exports a Worker and `MarketSession` Durable Object. Authenticated POST `/internal/bootstrap` with empty body and GET `/internal/scheduler` use `SCHEDULER_ADMIN_KEY` (32–256 chars, at least8 distinct), with authentication at both Worker and object. `OFFLINE_SCHEDULER_ENABLED` must explicitly be `true`. The example disables scheduling, market access, workers.dev and preview URLs.

## Phase17: opt-in market-data and daily-token code (NOT activated)

The Worker additionally implements POST `/internal/token` **only if both** `OFFLINE_SCHEDULER_ENABLED=true` and `READONLY_MARKET_RUNTIME_ENABLED=true`. Its binary-bounded (2KiB) handoff matches the existing Python `token_sender.py` HMAC-SHA256 request (`X-Relay-Timestamp`, `X-Relay-Nonce`, `X-Relay-Signature`), within90s of local clock, with exact API identity check. An atomic Durable Object transaction rejects nonce replay, older signed tokens, equal-second conflicting tokens, and corrupt prior records. An independent32-byte AES-GCM key encrypts bearer credentials at rest, with cryptographically authenticated signed-time/06:00 IST expiry/fingerprint metadata. Credentials, signatures, raw HTTP error bodies and Kite headers do not appear in public diagnostics.

**For a future separately authorized activation only**, the secret bindings would be `TOKEN_RELAY_HMAC_KEY` (same strong HMAC key as the local Python sender), `TOKEN_VAULT_AES_KEY` (fresh32-byte base64 AES key), `KITE_API_KEY`, plus deployment config `KITE_FUTURE_SYMBOL` and `KITE_FUTURE_INSTRUMENT_TOKEN`. Store these as secret bindings and verify the valid monthly NIFTY futures identity before enabling; do **not** commit live values. The current example deliberately contains no credentials or actual instrument identity. Cloud service creation, domain, DNS and token upload require new permission.

Only `market-readonly.mjs` can construct external Kite market requests. Its final URL gate allows GET `https://api.kite.trade/quote?i=NFO:NIFTY…`, approved futures 5m/15m historical GETs and NFO instrument CSV. It rejects other hosts, non-HTTPS, redirects, transaction paths, unexpected types, oversized responses and malformed OHLC. The alarm's opt-in sampler performs a futures quote at an eligible20-second slot, and two historical candle reads at five-minute boundaries, recording bounded **sanitized metadata only**. Missing/stale/mismatched exchange quote timestamps, invalid futures config, expired token, network faults and storage failures fail closed. No fallback to a trading-capable SDK.

This proves an **offline synthetic integration surface**, not live deployment or usable market coverage. Contracts are configured in the sample path, not automatically rolled; external rate limits, paid Kite API access, platform alarm punctuality/CPU quotas, and actual observed market quality remain unverified. Market snapshots **are not wired** to the pure decision/exit rules or dual-account ledger; that belongs to later checklist items. No real broker orders, Telegram, cloud jobs or billing are enabled. [Phase17 evidence](../audit/PHASE17_EDGE_READONLY_TOKEN.md).

SQLite-backed DO transactions persist claim and next alarm atomically. The constructor does not schedule. Duplicate ticks cannot claim twice across restart; delayed slots are dropped, not replayed. Corrupt state is preserved for diagnosis and alarms stopped; bootstrap cannot overwrite it. Clock rollback, unsupported year and4096 callbacks/UTC-day halt scheduling. Diagnostics retain128 events, not a complete paper ledger.

`alarm-core.mjs` uses pinned2026 NSE F&O regular sessions09:15–15:30 IST with requested20-second slots. No callback SLA is claimed. `strategy-core.mjs` ports VWAP, EMA, Wilder DMI/ADX/ATR and versioned fees. Three synthetic indicator fixtures match Python within1e-8;36 fee cases match exactly in paise.

`decision-core.mjs` now mirrors Python's completed five-minute/independent fifteen-minute candle gates, rising ADX, VWAP/EMA/DMI/breakout confirmation and bounded stop/target calculation, including exact CE/PE paper-review states. `exit-core.mjs` covers Python's hypothetical option ASK reference, fresh premium BID STOP/TARGET/HOLD, time-only exit review, risk-first ambiguous futures candles, and observed-BID paper exit math with fee/slippage/depth/time/duplicate protections. **These are pure offline modules and are not connected to the Worker**, which still has no broker HTTP, cloud ledger or Telegram transport. See [Phase16 parity report](../audit/PHASE16_DECISION_EXIT_PARITY.md).

## Offline verification

```sh
node --test edge-cloudflare/*.test.mjs
cd edge-cloudflare
npm ci --ignore-scripts
npm run test:runtime
```

88 edge tests pass (9 alarm,15 worker,5 numerical parity,31 decision,19 exit,5 market transport,4 token), plus39 extension tests and2 native local workerd SQLite tests. `runtime/harness.mjs` is LOCAL TEST ONLY with synthetic clock/test endpoints and outbound traffic rejected. Never deploy it. Native tests verify transactional scheduler restart plus signed/encrypted token persistence, **not** hosted scheduling or real Kite reachability. `generate_parity.py`, `generate_decision_parity.py`, and `generate_exit_parity.py` regenerate Python reference fixtures; review changes explicitly.

## Remaining migration

Worker status reports `marketRuntimeImplemented:true`, `marketRuntimeEnabled:false` by default. It **does not** run live Kite tests, auto-choose contracts, deliver market data into decision/exit rules, maintain cloud portfolios, send Telegram, serve a mobile dashboard or export paper history. Those are required before full end-to-end/capacity verification. The Python monolith is not a drop-in Worker deployment.

`wrangler.example.jsonc` is an undeployed template. No deploy/migration command was run. See [audit](../audit/FULL_PROJECT_AUDIT_2026-10-23.md) for capacity forecast and dependency blockers. The [deployment gate](../cloud-alerts/docs/DEPLOYMENT_APPROVAL_REQUEST.md) is a draft awaiting prerequisites, not permission to create resources.
