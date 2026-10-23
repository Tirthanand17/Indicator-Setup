# Phase 19 — complete offline synthetic market-session integration

23 October 2026. **Not deployed. No live Kite data, Telegram delivery or broker orders.**

## Implemented

`edge-cloudflare/synthetic-session.mjs` adds a pure, deterministic **test-only** coordinator for a whole 2026 NSE F&O session. It combines the Python-parity five-minute/independent fifteen-minute five-indicator `decide` function, synthetic NIFTY futures quote provenance and recency, an independently supplied fresh NIFTY option top-of-book quote, the two-account cash/position ledger, price/fee/slippage-aware simulated exits, and the pending-only alert outbox.

- Exactly one source label is accepted: `OFFLINE_SYNTHETIC_TEST_ONLY`. Calendar version, 20-second tick IDs, observed scheduling window, monotonic clocks, futures symbol/token/age and futures-versus-candle consistency fail closed. Unsupported years, holidays, skipped/late ticks, payloads mislabeled as live and noncausal updates never become accepted signals. A 2026 NSE calendar exception is not implicitly inferred from system weekdays.
- Successful five-minute/15-minute CE/PE review generates a deterministic signal ID based on the completed futures candle, not current receipt time. Both hypothetical accounts transact independently, preventing repeated signals and duplicated cash debits or outbox messages. Changing a synthetic strategy threshold is allowed **only as labeled test-fixture configuration**, never as a live remote strategy control.
- Existing open positions are evaluated against recent executable option BID/depth **before** any new entry review. Fresh STOP, TARGET and 15:15 TIME decisions close at modeled fill/fees. No quote, invalid contract, stale quote or inadequate depth keeps the position unresolved, rather than crediting invented cash. At 15:26, missing proof marks it `EXIT_UNVERIFIABLE`; reserved cash remains unavailable and the account stays blocked.
- The `MarketSession.processSyntheticMarketTurn` method commits the **session tick receipt + both paper accounts/positions/rejections/outbox** inside one SQLite Durable Object transaction. A test-only native workerd harness exercises this method, including concurrent duplicate ticks, abort rollback, closed positions and restart recovery. The session's diagnostic evidence is bounded to128 recent tick summaries; full retention/export is item23.
- Authenticated `GET /internal/synthetic-session` exposes sanitized summary metadata only if scheduler, ledger and synthetic-session flags are enabled. The example sets `OFFLINE_SYNTHETIC_SESSION_ENABLED=false`, as well as the other activation flags. There is **no production HTTP write endpoint** for a synthetic turn, broker trade or Telegram dispatch.

## Verification

Synthetic tests drive one entire regular IST session of **1,125 distinct 20-second slots (09:15–15:30)**, including a verified Python parity CE signal, two independent account entries, a later executable option BID closing both, and 128-record bounded diagnostic history. Other cases cover PE review, missing/stale/mismatched futures, missing/invalid option liquidity, clock rollback, wrong source, holidays, signal replay, 15:15 forced exit and unresolved 15:26 close. Native Workerd tests restart after actual SQLite transaction commits and verify byte-for-byte state recovery. All outbound requests are rejected inside local native tests.

Run:

```sh
node --test edge-cloudflare/*.test.mjs
cd edge-cloudflare && npm run test:runtime
node --test ../extension/tests/*.test.cjs
```

This phase is **synthetic E2E**, not a cloud production system. The current read-only Kite polling adapter only stores sanitized futures quote/history count metadata. It does **not** persist raw verified 5m/15m candles, discover and roll live NIFTY option instruments, select/extract option-chain depth, or call this test coordinator. The alert outbox has no network sender, retry/ambiguity resolution or physical phone confirmation. No cost-free always-on host, daily token relay on laptop-off days, real persistence guarantees, live market-session evidence, strategy win rate or profitability was established. Remaining checklist items20,22–25 and all five live acceptance gates are unverified.

`PAPER_ONLY` means hypothetical accounting with modeled slippage/fees, not an exchange-traded fill or investment recommendation. Real broker execution stays disabled. Cloud deployment, DNS, credentials, phone messaging and resources require separate owner approval and a verified ₹0 budget.
