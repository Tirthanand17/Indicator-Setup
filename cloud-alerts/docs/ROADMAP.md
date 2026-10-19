# Phase-by-phase delivery board

**Approximate milestone-weighted implementation progress: 55%**, as documented in [PROGRESS.md](PROGRESS.md). A code commit is not proof of live accuracy, and a bot TEST message is not proof that it caught a valid trade.

| Phase | Item | State on 2026-10-19 | Acceptance |
|---|---|---|---|
| P0 | Requirements, security boundaries and cloud architecture | **Documented** | Permission/read-only plan and hardware-off path spelled out |
| P1 | Pure indicators, quote/contract mapping, signal rules | **Implemented + synthetic tests** | All unit tests pass, alert not sent on missing/invalid data |
| P2 | Opt-in read-only daily `.env` token handoff and encrypted cloud vault | **Implemented + synthetic tests** | Signed HMAC, nonce, expiry, ciphertext at rest; still need real TLS host test |
| P3 | Kite Connect REST historical 5m/15m and quote backend | **Partial live paid Kite data smoke passed** | Actual paid API tests on fully completed exchange bars |
| P4 | Telegram cloud delivery, expiry-aware retry/outbox, health endpoint | **Atomic entry+candidate persistence, privacy-safe queue metrics (96 offline tests); unvalidated live** | Real paired phone receives TEST and market candidate exactly once in normal run |
| P5 | Deploy on approved 24×7 host with persistent storage | **NOT STARTED** | Explicit host and cost approval, safe TLS and secret store, laptop-off proof |
| P6 | KiteTicker streaming / 5m shadow aggregation and REST reconciliation | **SHADOW RUNTIME INTEGRATED + SQLite quality ledger + SYNTHETIC TESTS**; live websocket not verified | Exchange timestamps, reconnect/backfill, REST comparison metrics, p95 latency |
| P7 | Virtual exit and option premium intrabar risk tracking | **Opt-in premium BID tracker + virtual STOP/TARGET/TIME review, 96 offline tests**; no live broker quote trial | Real option BID/ASK over actual sessions, 20s latency evidence, phone delivery and no holdings assumption |
| P8 | Walk-forward option-level backtesting, audits, dashboards | **NOT STARTED** | Gross/net P&L and win %, drawdowns, cost realism, out-of-sample evidence |
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
