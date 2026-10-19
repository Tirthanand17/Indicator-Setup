# Phase-by-phase delivery board

**All percentages withheld until milestone evidence exists.** A code commit is not proof of live accuracy, and a bot TEST message is not proof that it caught a valid trade.

| Phase | Item | State on 2026-10-19 | Acceptance |
|---|---|---|---|
| P0 | Requirements, security boundaries and cloud architecture | **Documented** | Permission/read-only plan and hardware-off path spelled out |
| P1 | Pure indicators, quote/contract mapping, signal rules | **Implemented + synthetic tests** | All unit tests pass, alert not sent on missing/invalid data |
| P2 | Opt-in read-only daily `.env` token handoff and encrypted cloud vault | **Implemented + synthetic tests** | Signed HMAC, nonce, expiry, ciphertext at rest; still need real TLS host test |
| P3 | Kite Connect REST historical 5m/15m and quote backend | **Implemented (unvalidated live)** | Actual paid API tests on fully completed exchange bars |
| P4 | Telegram cloud delivery, retry/outbox, health endpoint | **Implemented (unvalidated live)** | Real paired phone receives TEST and market candidate exactly once in normal run |
| P5 | Deploy on approved 24×7 host with persistent storage | **NOT STARTED** | Explicit host and cost approval, safe TLS and secret store, laptop-off proof |
| P6 | KiteTicker streaming / 1m→5m aggregation and REST reconciliation | **NOT STARTED** | Exchange timestamps, reconnect/backfill, no gaps, measured p95 latency |
| P7 | Virtual exit and option premium intrabar risk tracking | **VIRTUAL FUTURES EXIT prototype only** | Real option bid/ask observations, IV and liquidity checks, no holdings assumption |
| P8 | Walk-forward option-level backtesting, audits, dashboards | **NOT STARTED** | Gross/net P&L and win %, drawdowns, cost realism, out-of-sample evidence |
| P9 | Multi-day production-readiness paper trials | **NOT STARTED** | 5+ sessions, phone receipts, latency and missed alerts documented |

## Distinct sources of truth

1. **Code readiness:** GitHub PR/commit, static checks, unit tests.
2. **Data readiness:** live API quotes and **completed** broker candles, verified against Kite.
3. **Notification readiness:** actual Telegram API acceptance and mobile receipt, delayed/failed alert counts.
4. **Trading value:** genuine after-cost OPTION-level backtest and forward paper results.

Only (1) is currently demonstrated. Do not conflate tests with real trading performance.

## Next user approvals/dependencies

- Select and explicitly approve a reliable always-on cloud host and its maximum incremental cost; verify any student/free credit before starting infrastructure.
- Configure **private** Kite API key (not API secret), Telegram bot token/chat ID, Fernet vault key and relay HMAC key in cloud secret management. The existing Chrome extension credentials are not automatically available to cloud.
- Allow a read-only token sender to access the existing trading `.env` on Nirala when a fresh daily token appears. Its code and launch configuration live OUTSIDE the protected trading folder.
- Perform explicit broker-market/Telegram integration tests **in paper-only mode**; no order placement is ever authorized by this repo.

**Date:** 2026-10-19.
