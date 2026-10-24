# Offline Cloudflare migration — scheduler, market adapter and paper ledger

**IN DEVELOPMENT / PAPER ONLY. NOT DEPLOYED.** Checklist23/25 (92%), live acceptance0/5; [canonical progress](../cloud-alerts/docs/PROGRESS.md).

`worker.mjs` exports a Worker and `MarketSession` Durable Object. Authenticated POST `/internal/bootstrap` with empty body and GET `/internal/scheduler` use `SCHEDULER_ADMIN_KEY` (32–256 chars, at least8 distinct), with authentication at both Worker and object. `OFFLINE_SCHEDULER_ENABLED` must explicitly be `true`. The example disables scheduling, market access, workers.dev and preview URLs.

## Phase17: opt-in market-data and daily-token code (NOT activated)

The Worker additionally implements POST `/internal/token` **only if both** `OFFLINE_SCHEDULER_ENABLED=true` and `READONLY_MARKET_RUNTIME_ENABLED=true`. Its binary-bounded (2KiB) handoff matches the existing Python `token_sender.py` HMAC-SHA256 request (`X-Relay-Timestamp`, `X-Relay-Nonce`, `X-Relay-Signature`), within90s of local clock, with exact API identity check. An atomic Durable Object transaction rejects nonce replay, older signed tokens, equal-second conflicting tokens, and corrupt prior records. An independent32-byte AES-GCM key encrypts bearer credentials at rest, with cryptographically authenticated signed-time/06:00 IST expiry/fingerprint metadata. Credentials, signatures, raw HTTP error bodies and Kite headers do not appear in public diagnostics.

**For a future separately authorized activation only**, the secret bindings would be `TOKEN_RELAY_HMAC_KEY` (same strong HMAC key as the local Python sender), `TOKEN_VAULT_AES_KEY` (fresh32-byte base64 AES key), `KITE_API_KEY`, plus deployment config `KITE_FUTURE_SYMBOL` and `KITE_FUTURE_INSTRUMENT_TOKEN`. Store these as secret bindings and verify the valid monthly NIFTY futures identity before enabling; do **not** commit live values. The current example deliberately contains no credentials or actual instrument identity. Cloud service creation, domain, DNS and token upload require new permission.

Only `market-readonly.mjs` can construct external Kite market requests. Its final URL gate allows GET `https://api.kite.trade/quote?i=NFO:NIFTY…`, approved futures 5m/15m historical GETs and NFO instrument CSV. It rejects other hosts, non-HTTPS, redirects, transaction paths, unexpected types, oversized responses and malformed OHLC. The alarm's opt-in sampler performs a futures quote at an eligible20-second slot, and two historical candle reads at five-minute boundaries, recording bounded **sanitized metadata only**. Missing/stale/mismatched exchange quote timestamps, invalid futures config, expired token, network faults and storage failures fail closed. No fallback to a trading-capable SDK.

This proves an **offline synthetic integration surface**, not live deployment or usable market coverage. Contracts are configured in the sample path, not automatically rolled; external rate limits, paid Kite API access, platform alarm punctuality/CPU quotas, and actual observed market quality remain unverified. **Actual read-only market snapshots are not wired** to decisions or paper entries. Phase19 adds a separately labeled synthetic integration, not a live bridge. No real broker orders, Telegram, cloud jobs or billing are enabled. [Phase17 evidence](../audit/PHASE17_EDGE_READONLY_TOKEN.md).

SQLite-backed DO transactions persist claim and next alarm atomically. The constructor does not schedule. Duplicate ticks cannot claim twice across restart; delayed slots are dropped, not replayed. Corrupt state is preserved for diagnosis and alarms stopped; bootstrap cannot overwrite it. Clock rollback, unsupported year and4096 callbacks/UTC-day halt scheduling. Diagnostics retain128 events, not a complete paper ledger.

`alarm-core.mjs` uses pinned2026 NSE F&O regular sessions09:15–15:30 IST with requested20-second slots. No callback SLA is claimed. `strategy-core.mjs` ports VWAP, EMA, Wilder DMI/ADX/ATR and versioned fees. Three synthetic indicator fixtures match Python within1e-8;36 fee cases match exactly in paise.

`decision-core.mjs` now mirrors Python's completed five-minute/independent fifteen-minute candle gates, rising ADX, VWAP/EMA/DMI/breakout confirmation and bounded stop/target calculation, including exact CE/PE paper-review states. `exit-core.mjs` covers Python's hypothetical option ASK reference, fresh premium BID STOP/TARGET/HOLD, time-only exit review, risk-first ambiguous futures candles, and observed-BID paper exit math with fee/slippage/depth/time/duplicate protections. The pure strategy and ledger are connected **only by the Phase19 offline synthetic coordinator**, not to live polling. See [Phase16 parity report](../audit/PHASE16_DECISION_EXIT_PARITY.md).

## Phase18: durable independent paper accounts, disabled by default

`paper-ledger.mjs` maintains **two independent simulated portfolios**: ₹50,000 and ₹1,00,000. It validates a fresh option contract's executable ASK/BID, spread, depth, timestamp and 2026 NSE session, simulates whole-lot entry/exit with adverse slippage and the pinned fee policy, enforces capital/daily risk limits and three trades per day per account, and never invents exit proceeds. Missing verifiable exit evidence after 15:26 IST marks the trade unresolved and blocks that account. It does not claim any actual NSE fill, return or accuracy.

The existing `MarketSession` Durable Object stores accounts, positions, rejections and pending-only alert messages **in one atomic SQLite transaction**. A repeated signal or exit cannot double-debit/credit cash or enqueue a second event. A failed audit or journal-capacity limit blocks further writes. Authenticated GET `/internal/paper-ledger` gives only an aggregate realized-cash summary, and only with `OFFLINE_SCHEDULER_ENABLED=true` and `OFFLINE_PAPER_LEDGER_ENABLED=true`. The example config sets both to `false`. **No production endpoint accepts trade-write requests**, and this ledger is not auto-connected to alarms. Outbox delivery, complete history/restore, daily views and MTM are future work. [Phase18 audit](../audit/PHASE18_EDGE_DUAL_LEDGER.md).

## Phase19: complete 1,125-slot synthetic session, not live activation

`synthetic-session.mjs` combines pinned20-second IST ticks, fresh **synthetic** NIFTY futures observation, five-minute/independent fifteen-minute strategy gates, fresh option ASK/BID, separate paper account entry/exit, and pending alert outbox. It accepts only `OFFLINE_SYNTHETIC_TEST_ONLY` input. Completed-candle IDs make repeated reviews idempotent; open positions receive STOP/TARGET/15:15-time exit checks before any new entry. No usable exit quote by15:26 marks the position unverifiable without creating cash or P&L. Native SQLite commits the synthetic tick journal, both accounts and pending events together; tests cover concurrent replay, abort, and restart.

No production HTTP POST route feeds this coordinator. The read-only live sampler does **not** supply its full candles or option chain, and cannot automatically invoke it. Authenticated GET `/internal/synthetic-session` is sanitized and requires `OFFLINE_SCHEDULER_ENABLED=true`, `OFFLINE_PAPER_LEDGER_ENABLED=true` and `OFFLINE_SYNTHETIC_SESSION_ENABLED=true`. All three remain disabled in the example. A complete synthetic regular session of1,125 slots passes as a local deterministic test; hosted uptime, live quote availability, phone delivery and any real trading edge remain unverified. [Phase19 audit](../audit/PHASE19_SYNTHETIC_SESSION_E2E.md).

## Phase20: private mobile paper dashboard and daily reports (NOT activated)

`private-dashboard.mjs` provides a responsive, read-only browser at `/paper/dashboard`. A separate strong `PAPER_DASHBOARD_VIEW_KEY` (not the scheduler/admin key) is entered into an HTTPS-only bounded login form; it is not stored in local storage, URL or script and returns a short-lived HMAC-signed Secure/HttpOnly/SameSite=Strict cookie. The Worker and Durable Object both enforce feature flags. The example sets `OFFLINE_PRIVATE_DASHBOARD_ENABLED=false`; no key is present or generated by the repo, and **no cloud application is deployed**.

Cookie-authenticated same-origin GET `/paper/api/summary`, `/paper/api/trades` (maximum 50 latest positions) and `/paper/api/daily?date=2026-10-23` report independently audited ₹50k/₹100k paper cash, realized net P&L, unresolved/open trades, IST-day closes and synthetic-worker health. An unpriced open position is **not** counted as account equity or profit. No Telegram deliveries or real Kite data are claimed. Reports fail closed for broken ledger integrity or unsupported dates. CSP and no-store headers protect page/APIs; the browser renders dynamic text safely. Backend tests include native SQLite restart with authenticated session. Future production steps require approved cloud resources, domain/TLS, secret bindings and user sign-off. [Phase20 audit](../audit/PHASE20_PRIVATE_CLOUD_DASHBOARD.md).

## Phase22: indicative synthetic portfolio MTM, capital and health (NOT activated)

`portfolio-valuation.mjs` snapshots **at most two validated synthetic option BID/ASK marks** with each new accepted test-only market tick. The marks, account ledger, strategy session and pending-only outbox are persisted in the **same Durable Object SQLite transaction**; a duplicate tick cannot change marks, and a missing/invalid quote in a newer tick clears an earlier mark. The code validates contract identity, exchange timestamp, bid depth, 2% spread limit, and the open position's size and quote causality. Stored marks are audited against the synthetic tick before display.

Cookie-authenticated, read-only GET `/paper/api/portfolio` and an extra responsive dashboard section show available cash, capital committed to paper entries, remaining loss/trade budget, hypothetical open-position exit credit at **observed synthetic BID minus adverse slippage and modeled SELL fees**, and indicative equity. Fresh synthetic marks remain valid **at most15 seconds**: stale, missing or contract-mismatched quotes yield **null, not zero**, for open equity and unrealized P&L. Unverifiable exit positions remain blocked. Flat accounts show audited cash as known cash equity; they do not claim a market quote. `healthStatus` distinguishes flat, fresh synthetic, missing/stale, and unresolved states. ₹50k and ₹100k accounts are independent.

These marks are **never live NSE prices, guaranteed executable depth, actual fills, real account equity or investment returns**. The old cash-only `/paper/api/summary` intentionally remains cash-only. The Worker still exposes no production trade-writing or synthetic-feed endpoint; all required feature flags are disabled by default. Native restart/fresh/stale/rollback and pure accounting regressions pass. [Phase22 audit](../audit/PHASE22_SYNTHETIC_PORTFOLIO_MTM.md).

## Phase23 checkpoint: signed offline archive, retention limits and storage measurements

`paper-archive.mjs` introduces HMAC-SHA256-authenticated, size-limited **offline-only** paper research archives and verifies atomic recovery to a fully empty transactional target. The archive excludes Kite tokens, market observations, alarms and admin secrets. It does contain detailed trades and pending alert messages and is **not encrypted**; never publish it in a public GitHub repository. Ledger capacity reporting warns at75%/90%, blocks at hard record caps rather than deleting history, and distinguishes the last-128 synthetic event ring from a complete decision log. Synthetic stress tests reached512 positions,1,024 pending messages and an archive of668,356 bytes; these are not hosted cloud performance measurements.

**Checklist #23 is still OPEN** because no private off-host destination, production export endpoint, hosted restore drill, retention job or genuine capacity telemetry has been authorized or verified. Production `/internal/paper-archive`, `/internal/paper-capacity`, and `/internal/paper-restore` routes remain absent. No backup data, credentials or messages were sent to GitHub. [Phase23 checkpoint and approval boundary](../audit/PHASE23_OFFLINE_ARCHIVE_CAPACITY.md).

## Phase24: durable offline Telegram delivery-result reconciliation (NOT sending)

`paper-delivery.mjs` now implements an independent transactional `paper-delivery-v1`
claim/cursor journal against the immutable pending paper outbox. A claim is
persisted *before* a future send and remains uncertain after restart until a
definitive Bot API response is committed; timeout, malformed acceptance and
5xx become `AMBIGUOUS` and can **never automatically resend**. A valid 429
`parameters.retry_after` imposes a strict cooldown, at most three attempts,
and a 180-second entry / 600-second exit expiry. A clear 200 + `ok:true`
with positive `message_id` means only **Telegram API acceptance**, not
phone delivery. Owner-acknowledged suppression records uncertainty honestly.

The last 128 terminal receipts are retained, while a monotonic cursor prevents
replaying compacted events; the complete fixed-cap paper outbox remains
unchanged. Missing delivery state alongside a populated ledger **blocks
initialization**, protecting Phase23 archive restores from resending historical
events. Only `MarketSession` internal methods support a synthetic rehearsal,
guarded by `OFFLINE_DELIVERY_REHEARSAL_ENABLED=false` in the example. The
production Worker exposes **no** send, claim, settle or suppression API, and
contains **no network Telegram client**. Native SQLite restart and synthetic
response tests pass. No token, real message or cloud action occurred.
[Phase24 report](../audit/PHASE24_OFFLINE_DELIVERY_RECONCILIATION.md).

## Offline verification

```sh
node --test edge-cloudflare/*.test.mjs
cd edge-cloudflare
npm ci --ignore-scripts
npm run test:runtime
```

160 edge tests pass (including 16 offline Phase24 delivery safeguards), plus 39 extension tests and 7 native local workerd SQLite tests. `runtime/harness.mjs` is LOCAL TEST ONLY with synthetic clock/test endpoints and outbound traffic rejected. Never deploy it. Native tests verify synthetic decision/entry/exit accounting, atomic paper account/outbox persistence, delivery claim and restart ambiguity, synthetic indicative MTM freshness/expiry, concurrent duplicate suppression, abort rollback, private dashboard session/restart, scheduler restart and signed/encrypted token persistence, **not** hosted scheduling, real Kite reachability or phone Telegram delivery. `generate_parity.py`, `generate_decision_parity.py`, and `generate_exit_parity.py` regenerate Python reference fixtures; review changes explicitly.

## Remaining migration

Worker status reports `marketRuntimeImplemented:true`, `marketRuntimeEnabled:false` by default. It **does not** run live Kite tests, auto-choose option contracts, deliver real market data into decision/exit/ledger rules, send Telegram, activate a live mobile dashboard, compute **live** portfolio MTM or export complete paper history. Only explicitly labeled offline synthetic indicative MTM exists. The Python monolith is not a drop-in Worker deployment.

`wrangler.example.jsonc` is an undeployed template. No deploy/migration command was run. See [audit](../audit/FULL_PROJECT_AUDIT_2026-10-23.md) for capacity forecast and dependency blockers. The [deployment gate](../cloud-alerts/docs/DEPLOYMENT_APPROVAL_REQUEST.md) is a draft awaiting prerequisites, not permission to create resources.
