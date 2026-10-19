# Overall progress board — NIFTY cloud phone alerts

**As of:** 2026-10-19. **Approximate engineering readiness: 55%** (milestone-weighted estimate, not observed trading win rate or evidence of a live service).

```text
Overall engineering progress   [██████████████░░░░░░░░░░] 55%
Remaining estimated scope      [░░░░░░░░░░░░░░██████████] 45%
Live cloud alerts enabled      NO
Real-money execution enabled   NO (by design)
```

The estimate is the mean of ten phase completion fractions, **not** based on lines of code and **not** a promise about timing or future profitability. Partial phases reflect synthetic code/test evidence only.

| Phase | Scope | Estimated implementation | Evidence / blocker |
|---|---|---:|---|
| P0 | Requirements, read-only permissions, architecture | 100% | GitHub architecture and runbook |
| P1 | Five indicators, contract/quote selection, decision rules | 80% | Unit-tested, not validated against live Kite data or option P&L |
| P2 | Daily token relay, HMAC and encrypted vault | 70% | Synthetic tests; no deployed TLS host or live handoff |
| P3 | Real REST 5/15m candles, broker quote depth | 80% | Paid Kite GETs verified on 19 Oct; **option contract quote and cloud runtime still unverified** |
| P4 | Telegram delivery, dedupe/outbox, health | 65% | Prototype tests; existing browser pairing does not validate cloud phone alerts |
| P5 | Approved always-on hosting, persistence and laptop-off test | 0% | Requires eligible host, budget and permission |
| P6 | WebSocket shadow monitoring and REST reconciliation | 85% | Async lifecycle, token/instrument rotation, optional KiteTicker shadow, completed REST comparison and privacy-limited health wired to runtime; synthetic tests only |
| P7 | Virtual/option-premium exit tracking | 65% | Opt-in actual-option BID tracking and hypothetical exit alerts implemented with synthetic tests; no actual option holding, fill or live market trial |
| P8 | Walk-forward option backtests & reliability dashboard | 0% | No independent option historical bid/ask dataset or out-of-sample evidence |
| P9 | Multi-day production-style paper monitoring | 0% | Needs 5+ real market sessions and phone receipts |

Sum of percentages / 10 = **54.5%, rounded to 55%**. **Actual readiness for time-critical phone alerts is below engineering completion**, because P5 and P9 are blocked and P3 has only a limited real-data smoke test while cloud P4 has no live integration test.

## Completed in this continuation

1. Audited existing public GitHub architecture and inspected protected trading `.env` **only for key names**. No secrets copied, printed or published.
2. Confirmed current code baseline with 33 Python tests passing; cloud account only inspected in read-only mode.
3. Created the read-only KiteTicker shadow module with strict timestamp, instrument, volume and reconnect safeguards; fixed a first-partial-bar leakage uncovered by unit tests.
4. Created an idempotent 5-minute REST polling schedule with at most three scheduled attempts per boundary, and no burst after a delayed wake.
5. Added durable unsent-alert expiry after 180 seconds; queued BUY messages cannot arrive many minutes late after an outage.
6. **96 Python tests passed** after these changes, with no live Kite API calls or Telegram messages sent by the tests.

## Read-only live API evidence (19 October 2026)

- Authorized Nirala `.env` variable names verified with no secret values disclosed; original file was not changed.
- Paid Kite Connect returned HTTP 200 for **NFO instruments**, **NIFTY futures quote+depth**, and **5-minute / 15-minute history**.
- Verified active future `NIFTY26OCTFUT`, expiry 27 Oct 2026, listed lot size **65**, 78 recent 5-minute candles and 26 recent 15-minute candles. See [LIVE_API_SMOKE_2026-10-19.md](LIVE_API_SMOKE_2026-10-19.md).
- Added **four synthetic full pipeline tests** from fake broker market-data through paper option quote checks and Telegram message formatting; these do not contact Kite or Telegram.

## Completion of this continuation — P6 integrated offline

1. Introduced a `ShadowSupervisor` owning one optional read-only KiteTicker diagnostic connection (disabled by default), with asynchronous callback marshaling, token/instrument rollover, stale-callback fencing and end-of-session socket cleanup.
2. Introduced bounded `StreamEvidence` comparisons of shadow five-minute bars with completed REST candles; exposes sanitized matched/mismatched/unavailable counters from `/healthz` without changing REST decision authority.
3. Added mock-transport tests and synthetic broker integration tests: **96/96 passed**. No real Kite WebSocket message, real cloud Telegram alert or new hosting charge used for this phase.
4. Added a 45-day SQLite reconciliation ledger with strict sanitized values, duplicate suppression and summary endpoints; no tokens, raw ticks, account identifiers or broker orders are stored.
5. Checked connected Render workspace (existing free web services only) and official Always Free VM alternatives. No service was created, modified or redeployed. See [hosting evaluation](HOSTING_EVALUATION.md).

## P7 continuation — optional virtual premium tracking (offline)

1. Added [`premium.py`](../cloud_alerts/premium.py), observing the original NIFTY CE/PE contract's **fresh BID**, using the signal-time quoted ASK only as a hypothetical reference — never a claimed order fill.
2. Added an explicitly opt-in (`PAPER_PREMIUM_TRACKING_ENABLED=false` by default) 20-second read-only option quote checker, no orders/holdings calls, and fail-closed stale/depth checks.
3. Added durable STOP / TARGET / TIME virtual exit reviews through the existing Telegram outbox; at most one active virtual candidate, with no carryover across days.
4. Unit and synthetic integrated tests now pass **96/96**. Real bid/ask feed, real phone alerts, and timing on an approved cloud host are **unverified**.
5. See [Premium exit monitor technical design](PREMIUM_EXIT_MONITOR.md). Cloud deployment remains **not active**. Original read-only trading folder remains unchanged.

## P3/P4 continuation — atomic entry + recoverable option quotes (19 Oct)

1. Fixed a real loss-of-alert window: if the selected option quote is temporarily stale at a completed candle, do **not** mark that candle processed. The bounded scheduled follow-up can retry with a fresher quote; no additional unbounded API polling.
2. Added a transactional SQLite `claim_entry_with_candidate` that atomically persists the Telegram outbox message and corresponding paper-only candidate **before attempting external delivery**. Crashes cannot leave a newly queued BUY without its virtual exit reference.
3. Rejected malformed prior positions, duplicates and concurrent same-day virtual entries. A new day may clear/replace a previously expired paper candidate.
4. Telegram failures keep entry events queued; the engine reports `PHONE_DELIVERY_FAILED` rather than misrepresenting a queued event as successfully sent. The existing 180-second delivery expiry still applies.
5. Added payload-free public health counts (`phone_outbox`) for queued/accepted/expired messages; this does **not** prove mobile receipt.
6. Validated **96/96 offline tests** including restart-after-send-failure, stale-quote retry, bad stored state and outbox privacy. No real phone messages, broker orders or service provisioning occurred in this continuation.

## Next highest-priority actions

1. Live-validate the disabled-by-default shadow streamer on a properly authorized always-on host; collect five-session REST-vs-shadow quality evidence and securely persist diagnostic counters.
2. Choose and explicitly authorize a suitable always-on host and secret store, without additional charges until approved.
3. Securely hand off daily Kite access tokens from the protected `.env` (read-only) to the approved host and test expiry/restart paths.
4. Validate live paid Kite REST, option bid/ask and Telegram TEST end-to-end; then paper-test five full sessions, collect delivery delay/missed-signal statistics, and compare option backtests.

**Update rule:** after every future development pass, revise this file and report the progress percentage **and** the status of live cloud alerts separately. This file is a status ledger, not a market signal.

## October 19 follow-up — cloud lifecycle and ingress hardening (55%)

1. Added Linux/POSIX single-worker advisory lock in `STATE_DIR`: rejects a second running FastAPI worker sharing the volume; deliberate fail-closed startup on symlink attacks and releases cleanly. This does **not** replace the requirement for exactly one hosted replica.
2. Bounded daily token-handoff request bodies to 2048 bytes *before* allocating the payload, including misleading Content-Length headers. Existing HMAC signature, 90-second clock skew and durable nonce replay guard remain enforced.
3. Added `/readyz` showing only enabled/token-present configuration; **not** a broker/phone quality assertion. `/healthz` now fails 503 when its background engine dies. Docker liveness checks use `/healthz` rather than daily-token readiness.
4. Added startup and dual-process protection tests, for **106/106 offline tests passing**. No actual cloud deployment, broker order, phone message or subscription charge was initiated.
5. The previous P4 offline-completion estimate rises from 55% to 65%, moving overall from 54% to **55%**; P5 (always-on host), P8 (option backtesting) and P9 (five-session trials) remain 0%. See [reliable cloud startup](RELIABLE_CLOUD_STARTUP.md).
