# Test matrix and acceptance gates

**Dependency follow-up:** default REST SDK dependency chain removed; fresh Linux suite774 passed/1 skipped, REST contract suite15 passed, pip check clean and advisory scan reports no known vulnerabilities. Live WebSocket shadow is explicitly disabled pending review. [Evidence](../../audit/DEPENDENCY_REMEDIATION_2026-10-23.md). Engineering remains15/25 (60%) because type-checking/reproducibility work remains. Earlier round counts below are historical snapshots.


Current round: **771 Python passed,1 skipped,1 warning;63 Node passed;1 native local workerd test passed.** [Exact environment/results and limitations](../../audit/FIX_VERIFICATION_MATRIX.md). Live acceptance **0/5**, engineering checklist **15/25 (60%)**. Static type checking and Python vulnerability remediation remain open. Historical test totals below are dated records, not current totals. Full cloud end-to-end coverage remains absent; the DO test covers scheduler persistence only.

**Current automated suite:** unit/fail-closed tests on **synthetic data only**. No real Zerodha REST or Telegram integration is activated by tests. Run from this folder:

```bash
python -m pip install -r requirements-test.txt
python -m pytest -q
python -m compileall -q cloud_alerts
```

| Test group | Acceptance | Implemented? |
|---|---|---|
| Indicator math | 5m HLC3 session VWAP, EMA9/EMA21, Wilder +DI/−DI/ADX14, ATR14; malformed/OHLC gaps rejected | Unit tests pass |
| Clock / strategy | 5m close+8s only, 15m context, no-trade on conflicts, stale/out-of-order/timezone invalid | Verified2026 regular-calendar gates; exceptional sessions and2027 require updates |
| Dynamic instruments | NFO-FUT current month, nearest eligible NFO-OPT expiry, listed strike and lot size | Unit tests pass |
| Option liquidity | Quote must include fresh timestamp, BID below ASK, ≥1-lot top depth, spread cap | Unit tests pass |
| Protected folder | Existing `.env` only read, source untouched, no secrets echoed | Unit test with synthetic read-only fixture |
| Credential relay | Reject HTTP, forged HMAC, expired signatures, nonce replay; encrypt vault on disk | Unit/in-process API tests pass |
| Phone | Telegram formatting, signed connection, failure retry and one candidate per candle | Outbox unit tests; **real cloud delivery not tested** |
| Container/cloud | Health, persistent volume, TLS, latency after restart, cloud with laptop OFF | **NOT TESTED** |
| Live Kite REST | Real 5m/15m OHLCV + bid/ask + expiry accuracy, broker timestamps | **NOT TESTED** |
| Live KiteTicker | Exchange-timestamped full ticks, reconnection, 1m/5m aggregation, REST reconciliation | **NOT IMPLEMENTED** |
| Historical option performance | Chronological backtests with option-level quotes, charges and slippage, win rate and drawdown | **NOT TESTED** |

## Exact next tests after cloud deployment

1. **Token cycle:** Submit a legitimately generated token from existing read-only `.env` via approved TLS host. Confirm it remains encrypted, is valid before exchange hours, is rejected or expires by 06:00 IST next morning, and rejects replay. Test cloud restart with persistent state and same vault key.
2. **Market data integrity:** Compare full-day completed `5minute` and `15minute` futures REST candles to Kite, allow for broker publication delay, and prove no signal from still-forming bars, zero volume, data gaps or outdated contracts. Verify dynamic contract rollover.
3. **Indicator equality:** Collect 50+ completed real 5m candles; compare VWAP, EMA, DMI/ADX and ATR against saved TradingView values at matching candle and volume source. Document seed/tolerance differences.
4. **Telegram synthetic integration:** Inject a **clearly marked synthetic TEST ONLY** candidate into a test harness and verify Telegram API response plus phone receipt timestamps. Never spoof a live CE/PE recommendation.
5. **Market-generated integration:** Wait for an actual qualifying closed candle; confirm correct option contract, real depth, correct expiry and lot size, unique alert timestamp, Telegram acceptance and phone receipt. Missing a signal is safer than sending one without valid quotes.
6. **Outage drills:** Disconnect cloud broker access, rotate an invalid token, simulate 429/rate limit, quote missing depth, cloud restart, Redis/SQLite volume absent, machine off, Telegram timeout. Require WAIT_TOKEN/WAIT_DATA and no fake alerts.
7. **Latency:** Measure exchange 5m close → broker 5m published → signal calculated → Telegram HTTP 200 → mobile received. Report p50 and p95, plus dropped-candle ratio and notification errors. No guarantee of immediate price fill.
8. **Economic research:** Hold-out tests on NIFTY option quotes with realistic bid/ask fees, slippage, expiry effects and option Greeks. Segment by CE/PE, expiry day, market regime, months; trade count and confidence intervals. Don't label 60%+ or any high win rate without evidence.

## Ship gates for real-money review alerts

- [ ] Zero false alerts on stale/missing/incomplete bars across multiple full sessions.
- [ ] Correct daily token rotation and restart restoration.
- [ ] Provider stable always-on during market hours and tested laptop-off operation.
- [ ] Telegram phone confirmations plus observable health/incident path.
- [ ] No order capabilities and no passwords/secrets logged or pushed to GitHub.
- [ ] No unapproved hosting charge.
- [ ] Strategy economic validity separately demonstrated; otherwise **paper-only experimental notifications**.
