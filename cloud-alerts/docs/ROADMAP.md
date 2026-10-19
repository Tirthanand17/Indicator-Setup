# Phase-by-phase delivery board

**Approximate milestone-weighted implementation progress: 68%**, as documented in [PROGRESS.md](PROGRESS.md). A code commit is not proof of live accuracy, and a bot TEST message is not proof that it caught a valid trade.

| Phase | Item | State on 2026-10-19 | Acceptance |
|---|---|---|---|
| P0 | Requirements, security boundaries and cloud architecture | **Documented** | Permission/read-only plan and hardware-off path spelled out |
| P1 | Pure indicators, quote/contract mapping, signal rules | **Implemented + synthetic tests** | All unit tests pass, alert not sent on missing/invalid data |
| P2 | Opt-in read-only daily `.env` token handoff and encrypted cloud vault | **Implemented + synthetic tests** | Signed HMAC, nonce, expiry, ciphertext at rest; still need real TLS host test |
| P3 | Kite Connect REST historical 5m/15m and quote backend | **Partial live paid Kite data smoke passed** | Actual paid API tests on fully completed exchange bars |
| P4 | Telegram cloud delivery, expiry-aware retry/outbox, health endpoint | **Atomic entry+candidate persistence, privacy-safe queue metrics (96 offline tests); unvalidated live** | Real paired phone receives TEST and market candidate exactly once in normal run |
| P5 | Deploy on approved 24×7 host with persistent storage | **NOT STARTED** | Explicit host and cost approval, safe TLS and secret store, laptop-off proof |
| P6 | KiteTicker streaming / 5m shadow aggregation and REST reconciliation | **SHADOW RUNTIME INTEGRATED + SQLite quality ledger + SYNTHETIC TESTS**; live websocket not verified | Exchange timestamps, reconnect/backfill, REST comparison metrics, p95 latency |
| P7 | Virtual exit and option premium intrabar risk tracking | **Premium BID tracker and Telegram-accepted entry notice gate, 184 offline tests**; no live broker quote trial | Real option BID/ASK over actual sessions, 20s latency evidence, phone delivery and no holdings assumption |
| P8 | Walk-forward option-level backtesting, audits, dashboards | **Offline replay + chronology/checkpoint tests; option quote archive missing** | Gross/net P&L and win %, drawdowns, cost realism, out-of-sample evidence |
| P9 | Multi-day production-readiness paper trials | **NOT STARTED** | 5+ sessions, phone receipts, latency and missed alerts documented |

## Distinct sources of truth

1. **Code readiness:** GitHub PR/commit, static checks, unit tests.
2. **Data readiness:** live API quotes and **completed** broker candles, verified against Kite.
3. **Notification readiness:** actual Telegram API acceptance and mobile receipt, delayed/failed alert counts.
4. **Trading value:** genuine after-cost OPTION-level backtest and forward paper results.

(1) is demonstrated and a **limited read-only subset of (2)** was verified from Nirala via paid Kite market-data HTTP GETs; cloud market session, live option alerts and (3)/(4) remain unverified. Do not conflate tests with real trading performance.

## Next user approvals/dependencies

- Select and explicitly approve a reliable always-on cloud host and its maximum incremental cost; verify any student/free credit before starting infrastructure.
- Configure **private** Kite API key (not API secret), Telegram bot token/chat ID, Fernet vault key and relay HMAC key in cloud secret management. The existing Chrome extension credentials are not automatically available to cloud.
- Allow a read-only token sender to access the existing trading `.env` on Nirala when a fresh daily token appears. Its code and launch configuration live OUTSIDE the protected trading folder.
- Perform explicit broker-market/Telegram integration tests **in paper-only mode**; no order placement is ever authorized by this repo.

**Date:** 2026-10-19. See [P7 virtual premium exit monitor](PREMIUM_EXIT_MONITOR.md).

## October 19 reliability continuation

- [x] Retry transient stale option quotes within bounded already-scheduled REST probes.
- [x] Atomically queue paper-entry Telegram event and save its virtual candidate.
- [x] Surface queued/accepted/expired alert counts without payload content.
- [x] Test duplicate protection, malformed candidate fail-closed, restart and Telegram failure.
- [ ] Live Telegram acceptance and mobile receipt from the cloud.
- [ ] Always-on host, daily token relay and 5 full market-session paper trial.


## 2026-10-19 — P4 deployment-readiness continuation

- [x] Non-root Docker health probe on `/healthz`, including worker-crash detection.
- [x] Single-process Linux lock, fail-closed duplicate worker on the same durable volume.
- [x] Enforce 2048-byte token relay ingress limit before memory allocation.
- [x] Distinguish app liveness from token-present readiness (not proof of Kite authorization).
- [x] **106/106** offline tests passing.
- [ ] Choose and approve always-on cloud host and persistent storage (₹0 extra only if verified and approved).
- [ ] Real signed daily token transfer and Telegram phone delivery.
- [ ] Confirm restart recovery across a real persistent volume and multi-day market evidence.


## 2026-10-19 — P8 non-misleading performance evidence foundation

- [x] Reject missing/delayed/invalid NIFTY option quote pairs and synthetic-as-real win-rate claims.
- [x] Estimate hypothetical ASK-entry/BID-exit gross/net P&L with caller-supplied realistic per-trade slippage and brokerage/tax charges.
- [x] Require 30 paired paper observations and 5 days before a sample can be reviewed; tags alone never prove capture provenance.
- [x] **116/116** offline tests passing across all cloud modules.
- [ ] Collect independently verified real quote-pair evidence and calendar; implement chronological walk-forward train/test split.
- [ ] Full live-market session trials and real Telegram mobile receipt checks on an explicitly approved always-on host.

## 2026-10-19 — P4 operational health gate (57%)

- [x] `/operationalz` distinguishes fresh REST decisions from basic process and token presence.
- [x] Fail closed if outbox queued, missing/expired token, stale data, weekend/after hours, or background worker stopped.
- [x] Never call cloud Telegram API acceptance proof of handset delivery.
- [x] Preserve `/internal/token` and tests for replay, request size, and signed submission.
- [x] **129/129** synthetic/offline tests passing.
- [ ] Deploy only after verified free/approved always-on host; test actual phone receipt and hardware-off operation.

## 2026-10-19 — chronological P8 paper evaluation (58%)

- [x] Day-segregated TRAIN/EMBARGO/TEST fold planner and ASK/BID after-cost paper scoring.
- [x] Ensure no test-day observations leak into earlier training windows.
- [x] Synthetic records never presented as real win rate, verified fills or trading edge.
- [x] **136/136 offline tests** passed.
- [ ] Acquire independent timestamped option bid/ask pairs, source authenticity and session outcomes.
- [ ] Choose free-credit/approved always-on host and complete real paper-mode Telegram receipt trials.

## 2026-10-19 — P2 signed daily token relay hardening (60%)

- [x] Restrict protected `.env` parsing to API key and daily access token; do not extract API secret.
- [x] Reject bad or non-HTTPS endpoint configuration before network transmission.
- [x] Ensure one-shot push returns a nonzero exit code on failed cloud delivery.
- [x] Verify offline sender → FastAPI route → encrypted vault, including replay/tamper checks.
- [x] Regression suite **143/143 passed**.
- [ ] Validate real broker token on approved live host, real daily session rollover, shutdown and recovery.
- [ ] Deploy only on an explicitly approved always-on host with private secret store and controlled spend.


## Phase 12 — cloud deployment safety added (2026-10-19)

- [x] Read-only deployment preflight with secret-presence-only reports, per-file path checks, private worker-owned state and durable-mount inspection
- [x] Fail closed on unverified root/overlay/tmpfs state, insufficient disk, symlinked token store and missing secrets
- [x] Single-worker Compose skeleton, localhost-only application port, read-only root, bounded logs and limited container privileges
- [x] Eight synthetic tests; **151/151 local suite passes**
- [ ] Obtain **specific** operator approval for an eligible ₹0 always-on VM; verify quotas/cost and storage persistence
- [ ] Install TLS reverse proxy, secure DNS and rate limiting; configure private secrets in cloud only
- [ ] Demonstrate real daily Kite login handoff, phone receipt and multi-day paper monitoring with Nirala switched off


## Phase 13 safety checkpoint (2026-10-19)

- [x] Reject example secret placeholders in cloud preflight **and** runtime, without printing secret values.
- [x] Reject malformed active Kite/Telegram settings and trivial relay keys; format checks are not identity checks.
- [x] Check existing SQLite, WAL, SHM, token and worker lock permissions/owner; fail closed, never mutate.
- [x] Use `umask 077` before container worker initialization and statically verify runtime isolation.
- [ ] Deploy an explicitly approved ₹0 incremental-cost, genuinely always-on host with a persistent volume.
- [ ] Test authenticated daily token relay to that host and confirm vault survives VM restart.
- [ ] Confirm actual Telegram TEST receipt on the phone, and collect market-session signal / delay evidence.

**Engineering progress estimate: 62%; live-host activation: 0%; additional broker orders: none.**


## Phase 14 — HTTPS ingress and Telegram channel verification template (2026-10-19)

- [x] Create a TLS-terminating Caddy configuration example with only `POST /internal/token` publicly routed; all other URLs return 404.
- [x] Keep the worker `127.0.0.1:8080` only and limit ingress request bodies.
- [x] Add an explicitly confirmed TEST-only Telegram command, with offline configuration check and safe JSON acceptance reporting.
- [x] Verify **177/177 local tests passed**; nothing was sent to real Telegram or Kite.
- [ ] Obtain explicit host/cost approval and verify uptime, DNS, certificate issuance, VM firewall and persistent volume.
- [ ] Run signed live token handoff and TEST from an approved cloud host; confirm physical phone receipt.
- [ ] Prove Nirala-off monitoring and five real paper-only trading sessions.

**Engineering progress estimate: 63%; cloud host still inactive; live strategy proof still missing.**


## Phase 15 — entry notification must precede virtual exit (2026-10-19)

- [x] Persist and enforce linked `entry_event_id` in every new paper candidate at the SQLite transaction boundary; reject mismatched links.
- [x] Suppress both underlying-candle and option-BID virtual exits until Telegram reports accepted entry notice.
- [x] Clear an expired/unsent candidate without generating a misleading orphan exit.
- [x] Fail closed for missing/corrupt linked outbox references; test recovery after restart.
- [x] Full offline suite: **186/186 passed**.
- [ ] Validate actual phone receipt and option-level paper evidence across five trading sessions on an approved always-on host.

**Overall engineering estimate: 64%. Live cloud service still OFF.**

## October 19 Phase 16 — quote and higher-timeframe integrity (65%)

- [x] Reject non-finite BID/ASK and contract-token mismatches before making a paper option review.
- [x] Normalize naive Kite quote exchange timestamps as IST, independent of UTC cloud host timezone.
- [x] Validate 15-minute OHLC, ordering, current-session alignment, and recent same-day contiguous history.
- [x] Synthetic broker pipeline rejects a `NaN` option quote without posting Telegram or creating a virtual entry.
- [x] **203/203** offline tests pass; `compileall` passes.
- [ ] Compare 15-minute EMA and full option depth against captured live Kite/reference data on an authorized host; validate actual market sessions.

## 2026-10-19 — Phase 17 deterministic historical replay (66%)

- [x] Offline causal 5-minute decisions with completed 15-minute context only.
- [x] Restart checkpoint fingerprints catch warmup / later historical revision.
- [x] Normalize IST/UTC, reject malformed or missing intraday bar data and secret-bearing JSON exports.
- [x] Runnable offline CLI; 224/224 tests passed. No broker credentials or order pathways.
- [ ] Capture verified option BID/ASK history and calculate after-cost results.
- [ ] Deploy on approved always-on host and complete five market sessions.


## Phase 18 — quote-level paper evidence, 67% overall

- [x] Capture sanitized broker adapter option BID/ASK and timestamps alongside queued entry reviews, without a new market-data API call.
- [x] Capture later opt-in premium STOP/TARGET quote only when a real BID observation exists; never fabricate an option quote for a time cutoff or futures-only exit.
- [x] Add immutable SQLite evidence snapshots, conflict detection, restart checks, and a strictly offline, read-only after-cost report with counts of unpaired and rejected evidence.
- [x] Fix timezone-suffixed event IDs and pass 251/251 local synthetic tests.
- [ ] Obtain independently attested live option data over five market sessions and validate actual Telegram receipts, latency, spread, depth and fee model.
- [ ] Select and explicitly approve an always-on host before deployment; no paid services, auth secrets or broker orders added.


## Phase 19 — complete-case quote-evidence coverage (68%)

- [x] Enumerate all paper REVIEW entry IDs for optionally reconciling quote observations to real alert candidates.
- [x] Require no orphan quote records in reconciled mode, and explicitly count no-quote/entry-only/invalid-exit events.
- [x] Withhold unqualified summary/rankable win-rate claims; show only clearly labeled complete-case descriptive paper rates.
- [x] Add tests for selection bias, SQLite read-only source audit, and missing/invalid evidence; **264/264** local tests.
- [ ] Capture 5+ market sessions and independently verify real option depth, Telegram handset receipt and realistic costs.
- [ ] Deploy only on approved always-on cloud infrastructure, after provider/cost eligibility checks.
