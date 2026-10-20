# NIFTY 50 cloud alerts — official Kite Connect, no chart required

**Status: architecture and a testable read-only prototype; NOT deployed or live validated.** This code intentionally cannot place orders. No browser extension, open Kite chart or powered-on laptop is required *after the daily token has been securely handed to an always-on cloud worker*.

The existing [Indicator-Setup](https://github.com/Tirthanand17/Indicator-Setup) repository also includes a separate, older **screen-reading Chrome extension**. This folder is a **different architecture**: it uses the officially supported paid Kite Connect market-data API, with complete exchange-timestamped candles and actual bid/ask depth.

## Development progress (2026-10-20)

**Overall engineering implementation estimate: 77%** — `[███████████████████░░░░░]` (**23% remaining**).

The architecture and read-only local prototypes exist; **live cloud alerts are NOT deployed or validated**. See [docs/PROGRESS.md](docs/PROGRESS.md) for detailed phase percentages and evidence. The [WebSocket shadow-data design](docs/STREAMING_DESIGN.md) now integrates a disabled-by-default WebSocket **shadow diagnostic supervisor** with the cloud runtime. It compares untrusted stream bars against completed Kite REST candles and **never drives buy/sell alerts**.

**Tests:** 359 local synthetic Python tests passed (including signed token handoff, deployment preflight and recovery). Paid Kite REST had a limited real read-only API smoke check earlier on 19 October; **WebSocket and cloud Telegram delivery remain unverified**.

**Phase 28 update:** a supervised in-process worker restart now performs atomic SQLite safety reconciliation before polling again. Expired Telegram entries and their virtual paper candidates are cleared, valid current-day candidates are preserved, and corrupted references fail closed. Sanitized recovery counts appear in `/healthz` with no alert text or secrets. **363/363 offline tests passed**. Hosting and phone validation remain pending. See [restart safety](docs/IN_PROCESS_RESTART_RECONCILIATION.md).

**Phase 27 update:** a supervised market-data coroutine now restarts after an unexpected worker crash or exit, with bounded backoff and a fail-closed health state. Repeated early crashes trigger a generic SIGTERM of the current container process, allowing an existing `restart: unless-stopped` policy to work. The previous REST freshness indicator is invalidated after a crash, preventing a false-green operational report. **359/359 offline tests passed**; this is not proof of live hosting. See [background worker recovery](docs/BACKGROUND_WORKER_SUPERVISION.md).

## October 19 Phase 12 — offline cloud deployment safety

- **151/151 offline tests passed** including deployment preflight, private volume checks and startup guards.
- Added a fail-closed `cloud_alerts.preflight` and a single-worker hardened Docker Compose template (`deploy/compose.yml`). The container refuses to start if critical secrets, a private writable persistent mount, or minimum free space are missing.
- This is **structural readiness only**. It does not deploy a host, install credentials, transmit Telegram messages, or validate a live trade signal.
- See [cloud deployment preflight](docs/CLOUD_DEPLOYMENT_PREFLIGHT.md).

**Phase 26 update:** the optional live virtual-premium BID watcher now checks broker depth using the **actual quote response clock**, rather than the previous 20-second polling timestamp. Late option responses crossing 15:15 IST become TIME reviews with no claimed executable exit price; responses after 15:26 do not create a new exit alert. Explicit-time replay remains deterministic; **352/352 offline tests passed**. No live cloud deployment. See [premium response-time guardrails](docs/PREMIUM_RESPONSE_CLOCK.md).

**Phase 25 update:** real-mode Telegram send/acceptance timestamps now use fresh clock samples after slow REST calls. Option BID/ASK quote freshness, virtual entry reference and observation evidence use the actual quote response clock, with post-15:00 IST entries blocked. **346/346 local tests passed**. No cloud validation yet. See [live response-time safety](docs/LIVE_CLOCK_AND_QUOTE_FRESHNESS.md).

## Start here

- [Read-only daily Kite token handoff and offline end-to-end test](docs/DAILY_TOKEN_HANDOFF_VALIDATION.md)

- [Full architecture and dataflow](docs/ARCHITECTURE.md)
- [Daily login, token relay and cloud deployment runbook](docs/DEPLOYMENT.md)
- [Security and read-only-folder agreement](docs/SECURITY.md)
- [Testing and acceptance requirements](docs/TEST_PLAN.md)
- [Hosting evaluation and zero-incremental-spend restrictions](docs/HOSTING_EVALUATION.md)
- [P6 shadow integration test report](docs/VALIDATION_P6_2026-10-19.md)
- [Phase-by-phase implementation checklist](docs/ROADMAP.md)
- [Single-worker crash supervision and fail-closed restart readiness](docs/BACKGROUND_WORKER_SUPERVISION.md)
- [Premium BID watcher response-time and session cutoff safety](docs/PREMIUM_RESPONSE_CLOCK.md)
- [Live quote-response and Telegram send-time safety](docs/LIVE_CLOCK_AND_QUOTE_FRESHNESS.md)
- [Read-only five-minute REST session coverage ledger](docs/REST_SESSION_COVERAGE.md)
- [Telegram Bot API acceptance and retry/latency audit](docs/TELEGRAM_DELIVERY_AUDIT.md)
- [Private WAL-consistent SQLite state snapshots and recovery](docs/STATE_SNAPSHOT_RECOVERY.md)
- [Startup reconciliation: timezone-safe alert expiry and virtual candidate recovery](docs/STARTUP_RECONCILIATION.md)
- [Restricted HTTPS ingress and TEST-only Telegram probe](docs/HTTPS_INGRESS_AND_PHONE_TEST.md)
- [Prevent virtual EXIT reviews for undelivered entry notices](docs/ENTRY_NOTICE_EXIT_SAFETY.md)

## What is implemented in this prototype

- Read-only Kite REST historical **5-minute** and **15-minute** OHLCV adapter; dynamic NIFTY futures symbol from the live instrument master; liquid current-expiry NIFTY CE/PE instrument selection from the master; bid/ask/depth, timestamp and spread validation.
- Fresh, completed candle guards. Calculates **Session HLC3 VWAP**, **EMA9**, **EMA21**, **DMI/ADX14** and **ATR14** from underlying futures candles. Separately calculates **15-minute EMA** context from broker 15-minute candles.
- Paper candidate `REVIEW_CE`, `REVIEW_PE`, `NO_TRADE`, `WAIT_DATA` decisions. Requires ADX >=25 **and rising**, DMI direction, aligned VWAP and EMAs, three-prior-bar breakout, and 15-minute confirmation. Thresholds are unoptimized research assumptions.
- Chooses an actual listed option, checks fresh top-of-book **BID/ASK** and lot quantity. Telegram text reports strike, bid/ask, lot size, futures underlying stop and *illustrative* target. Does not claim an executable premium stop or option P&L.
- A tracked **virtual futures candidate** may produce later `EXIT REVIEW` alerts **only once its matching paper entry review is accepted by the Telegram Bot API**; unsent/expired reviews produce no linked exit. It does not know actual holdings and **cannot close an option**.
- Read-only **daily token handoff**: an opt-in local sender reads the existing trading project's `.env` without changing it, and transfers only the access token to an approved HTTPS cloud endpoint using signed, replay-protected requests. Cloud encryption-at-rest uses a separately configured Fernet key on a persistent volume.
- Persistent SQLite candidate dedupe and Telegram outbox, privacy-limited `/healthz`, cloud container skeleton, unit/security tests, and opt-in defaults.


### Option premium evidence ledger (Phase 18, paper-only)

The worker now persists only sanitized `ENTRY` option ASK/BID depth with each newly queued paper candidate. A later opt-in premium `STOP` or `TARGET` may add a matching `EXIT` quote. No quote means no option paper P&L row; no execution is implied. The non-mutating `python -m cloud_alerts.evidence_cli` provides an after-cost paper evidence summary from a private SQLite snapshot. See [Phase 18 observation ledger](docs/OPTION_QUOTE_EVIDENCE_LEDGER.md). **No actual data has yet been captured in a deployed cloud market session.**

## What is NOT done yet

- No public cloud host deployed, no hosting bill authorized, no Kite credentials moved, and no Telegram cloud secrets configured. Nothing is listening on an Internet endpoint yet.
- The optional read-only WebSocket **shadow** connection is integrated, but not live-validated. **REST candle polling** remains the ONLY source that can trigger paper alerts. Per-second option premium monitoring, live reconnect/backfill validation and **actual** delivery-latency measurement remain pending (offline audit implemented).
- No live Kite subscription authentication test, no real option bid/ask end-to-end test, no historical strategy validation, and no actual market-generated phone candidate alert proof.
- No promise that any indicator combination has high win probability. This is still **PAPER / SIGNAL REVIEW ONLY**.

## Quick local checks — no broker data or tokens needed

```bash
python -m pip install -r requirements.txt
python -m pip install pytest pytest-asyncio httpx
python -m pytest -q
python -m compileall -q cloud_alerts
```

**Never use** this repository's public source files, Issues, Actions, logs, or GitHub Secrets as a place to publish your Kite access token or Telegram bot token. GitHub Actions are not enabled for this prototype to avoid unnecessary CI credit consumption.

## Runtime overview

1. You log into Zerodha as usual and your existing protected project saves the updated daily access token into its `.env`.
2. On Nirala, an **opt-in local token sender** can read it (read-only) and send it once to a private, HTTPS cloud token endpoint with HMAC authentication. A `--watch` mode can detect the daily token change while the computer is ON.
3. The cloud worker stores only the access token as **encrypted ciphertext** in its private persistent volume. The API **secret is never needed in cloud**. If the cloud restarts, it reloads the still-valid token. The token expires at next 06:00 IST, as documented by Zerodha.
4. You can now shut down Nirala. The always-on cloud instance queries paid Kite Connect, calculates completed-candle indicators, checks actual option spreads and messages your already-chosen Telegram bot/chat when a **review candidate** passes.
5. On the next trading day, the broker-authenticated daily login and token handoff repeat. This cannot be completely bypassed for retail Kite sessions.

**One non-negotiable rule:** no proper token handoff means the cloud cannot see the `.env` once the computer is off. It must explicitly enter `WAIT_TOKEN`, not send pretend signals.

## References

- [Kite historical 5-minute candles](https://kite.trade/docs/connect/v3/historical/)
- [Kite instruments, quote bid/ask and timestamps](https://kite.trade/docs/connect/v3/market-quotes/)
- [Kite WebSocket streaming](https://kite.trade/docs/connect/v3/websocket/)
- [Kite daily session expiry](https://kite.trade/docs/connect/v3/user/)
- [Render free web-service limits (not suitable for time-critical production)](https://render.com/docs/free)

**Last updated:** 2026-10-19. **Cloud deployment:** OFF. **Live order execution:** DISABLED / NOT IMPLEMENTED.

## Historical cloud worker milestone (54% at the time)

At an earlier milestone, progress was estimated at **54%** with 96 tests. Current progress is reported at the top and in [the up-to-date progress board](docs/PROGRESS.md). Cloud hosting remains inactive; no orders.

## Latest reliability patch — 19 October 2026

- Broker option quote failures can now be retried at the same completed-candle boundary under the existing bounded scheduler; stale depth still never produces a signal.
- Paper entry event and virtual position are committed together **before** Telegram network delivery. Restart/failure recovery never claims a buy was actually filled.
- `/healthz` now includes only sanitized counts of queued, Telegram-accepted and expired messages; it does not confirm phone receipt.
- **96 offline tests pass.** Cloud hosting and real phone-generated signals remain unverified. See [progress evidence](docs/PROGRESS.md).


## Cloud operational hardening — P4 continuation (55% overall)

- Linux singleton lock prevents competing market workers on the **same** durable volume; infrastructure must still restrict to **one replica**.
- Signed token relay rejects bodies larger than 2048 bytes before reading them fully.
- `/healthz` reports whether the background worker is alive; `/readyz` reports only enabled + daily-token-present configuration, **not** market/phone readiness.
- Container liveness probe and 106 passing offline tests. See [startup security/runbook](docs/RELIABLE_CLOUD_STARTUP.md) and [progress ledger](docs/PROGRESS.md).
- **No always-on cloud instance activated**, no real alert sent from cloud, no real orders and no modifications in the protected trading folder.

### Cloud operational readiness (Phase 8 continuation)

A separate **`GET /operationalz`** checks that completed REST market decisions are recent and Telegram has no pending messages. Unlike `/healthz` (process liveness) and `/readyz` (token presence), it intentionally reports HTTP 503 on stale data and market closure. Its result **never proves that the operator received a Telegram push**, and all alert execution remains disabled until separately configured. See [operational gate and safety notes](docs/OPERATIONAL_READINESS.md). Offline tests: **129 passing**. Overall estimated code readiness **57%**, not live service readiness.


## October 19 — 60% engineering milestone

Daily token handoff now refuses to report success when a transfer fails, loads only the two necessary Kite values, and passes an in-process signed HTTPS-contract simulation through the genuine cloud handler and encrypted vault. **143/143 offline Python tests pass.** This is not a production cloud test, proof of valid broker authentication, a live Telegram phone receipt, or verified profitability.


## Phase 13 (62%) — additional cloud startup hardening

The server and standalone preflight now share secret-redacting checks that reject example placeholders; **enabled** alerts require syntactically valid Kite API and Telegram settings. Existing sensitive state artifacts must be private and worker-owned, and the Docker entrypoint sets `umask 077` before creating database or lock files. **168/168 offline tests** pass. This is not proof of real credential validity, cloud uptime, or message delivery.

See [fail-closed configuration guide](docs/FAIL_CLOSED_CONFIG.md) and the [overall progress ledger](docs/PROGRESS.md). No always-on host has been approved or activated; alerts stay disabled by default.


## Phase 14 — restricted HTTPS ingress and TEST-only Telegram probe

- Added [`deploy/Caddyfile.example`](deploy/Caddyfile.example) for **operator-reviewed** host-level TLS termination exposing only signed POST token handoff to the localhost worker. This example is **not deployed** and does not prove TLS issuance.
- Added `python -m cloud_alerts.telegram_probe --check-only` and `python -m cloud_alerts.telegram_probe --send-test --confirm-send`. The latter is an **explicit** non-market test; API acceptance does **not** establish that the user's phone received it.
- **177/177 synthetic tests pass**. No cloud costs, hosted service, real Telegram/Kite requests, broker orders or changes to the read-only original trading folder. Engineering estimate **63%**, live cloud operation **not started**.


## Phase 15 — virtual-exit notice safety (64%)

- The SQLite transaction automatically links each new virtual entry to its queued paper notification and rejects a conflicting `entry_event_id`.
- Pending entry notifications suppress futures and option-premium virtual EXIT notifications. Expired entries clear virtual tracking; missing/corrupted event status blocks exit reviews.
- Telegram API acceptance is **not** proof of phone receipt or a real broker holding.
- **186/186 offline Python tests pass**. No cloud host or live messages. See [Phase 15 report](docs/ENTRY_NOTICE_EXIT_SAFETY.md).


## Phase 16: quote/15-minute integrity (2026-10-19)

- Strict finite option BID/ASK values, optional NFO instrument-token identity check and unambiguous IST quote timestamps on UTC cloud workers.
- Independent 15-minute confirmation input now rejects corrupt OHLC, duplicate or unordered rows and recent session gaps before an alert can be considered.
- **203/203** offline tests pass, including broker-to-quote suppression of a corrupted option price. No new live market session, cloud instance, real Telegram message or order. See [integrity test design](docs/MARKET_DATA_INTEGRITY.md).
- **Overall engineering progress: 65%, remaining: 35%**. Hosting and five-session paper operation are still unverified.


## Phase 17 — offline replay with deterministic restart checkpoints (66%)

The new [causal historical replay utility](docs/HISTORICAL_REPLAY.md) reconstructs completed-futures-candle decisions without future 15-minute data, uses a SHA-256 chained checkpoint that detects revised warmup history after a restart, and rejects incomplete intraday candle sequences. A local-only CLI reads exported 5m/15m OHLCV JSON; it never reads account credentials, sends Telegram notifications, or places orders. **224/224 offline tests passed**.

**Overall estimated implementation: 66%, 34% remaining.** Real option quote archives, approved always-on cloud hosting, cloud Telegram receipts and five-session market trials remain outstanding.


## Phase 19 — option-evidence completeness and ranking guard (68%)

The quote-evidence report can now reconcile **all** claimed `REVIEW_CE` / `REVIEW_PE` outbox entries, including those lacking any exit quote. A conditional complete-case paper win percentage is deliberately distinguished from a rankable verified strategy metric, which remains unavailable until sufficient, complete, independently verified data is collected. Use the non-mutating report on a **private snapshot** of the cloud SQLite database:

```bash
python -m cloud_alerts.evidence_cli --state-db /private/snapshot/alerts.sqlite3 \
  --slippage-bps 8 --roundtrip-charges-rs 50 \
  --min-trades 30 --min-days 5 --reconcile-entry-outbox
```

Rates/costs above are *illustrative assumptions*, not current verified fee estimates. [Coverage audit and interpretation](docs/QUOTE_COVERAGE_AUDIT.md). **Overall: 68% implementation estimate; 32% remaining.** Cloud is **not** active.

## October 19 Phase 20 — monitoring coverage and cutoff correction

- Reconciled 09:25–15:25 IST inclusive polling: **73 five-minute boundaries** for an explicitly selected open weekday. Fixed the inaccessible 15:25:08+ boundary and unsatisfiable 09:20 poll.
- Added a persisted, sanitized outcome ledger (per-boundary success/failure/retry), a read-only operator session audit and fail-closed malformed-data checks. These measure REST polling coverage, **not** actual Kite provenance, Telegram handset receipt, or option win rate.
- **283/283 local offline tests passed**; project code remains read-only and paper-only. Overall engineering estimate **69%**, cloud service still NOT deployed.

## Phase 21: offline Telegram acceptance latency audit (70%)

The outbox now keeps restart-safe attempted-send counts and timestamps, and a first Bot API acceptance timestamp; legacy rows are migrated without losing their messages. Run `python -m cloud_alerts.delivery_audit_cli --db /private/alerts.sqlite3 --session-date 2026-10-19` on an **operator-reviewed private read-only SQLite copy** to see per-session retry, expiry, median/p95/max API latency and unverifiable legacy counters. See [audit guide](docs/TELEGRAM_DELIVERY_AUDIT.md). **No phone receipts or live messages were obtained.**


## Phase 22 — private WAL-consistent recovery snapshots (71% overall)

- Added the offline-only `python -m cloud_alerts.snapshot --snapshot --db ... --output ...` tool and read-only `--verify`. It creates an atomic SQLite backup including uncheckpointed WAL commits, and refuses unsafe permissions or overwriting an existing backup.
- A snapshot contains sensitive paper-review message text and **is not encrypted by the tool**. Use it only on approved, private, encrypted-at-rest infrastructure. The separate Kite access token vault is not backed up.
- **309/309 local offline tests passed.** No cloud host activated, no live phone receipts or broker orders. See [state snapshot and recovery runbook](docs/STATE_SNAPSHOT_RECOVERY.md).
