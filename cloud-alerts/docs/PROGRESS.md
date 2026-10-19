# Overall progress board — NIFTY cloud phone alerts

**As of:** 2026-10-19. **Approximate engineering readiness: 68%** (milestone-weighted estimate, not observed trading win rate or evidence of a live service).

```text
Overall engineering progress   [████████████████░░░░░░░░] 68%
Remaining estimated scope      [░░░░░░░░░░░░░░░█████████] 32%
Live cloud alerts enabled      NO
Real-money execution enabled   NO (by design)
```

The estimate is the mean of ten phase completion fractions, **not** based on lines of code and **not** a promise about timing or future profitability. Partial phases reflect synthetic code/test evidence only.

| Phase | Scope | Estimated implementation | Evidence / blocker |
|---|---|---:|---|
| P0 | Requirements, read-only permissions, architecture | 100% | GitHub architecture and runbook |
| P1 | Five indicators, contract/quote selection, decision rules | 90% | Synthetic integrity tests now reject malformed 15-minute confirmation bars and nonfinite/mismatched option quotes; real signal performance not validated |
| P2 | Daily token relay, HMAC and encrypted vault | 90% | Offline signed end-to-end relay, failure exit codes and read-only selective env parser; **no real cloud TLS handoff** |
| P3 | Real REST 5/15m candles, broker quote depth | 85% | Quote time-zone and numeric fail-closed checks added; earlier paid Kite GET smoke verified, but **option contract quote and cloud runtime still unverified** |
| P4 | Telegram delivery, dedupe/outbox, health | 80% | Explicit cloud Telegram TEST-only CLI with safe API-acceptance reporting; no physical-phone receipt or live host |
| P5 | Approved always-on hosting, persistence and laptop-off test | 25% | TLS proxy route-restriction template added; **host activation, deployed TLS checks and laptop-off verification remain 0%** |
| P6 | WebSocket shadow monitoring and REST reconciliation | 85% | Async lifecycle, token/instrument rotation, optional KiteTicker shadow, completed REST comparison and privacy-limited health wired to runtime; synthetic tests only |
| P7 | Virtual/option-premium exit tracking | 75% | Outbox-linked virtual entries now suppress EXIT reviews until Telegram API accepts the corresponding entry; no actual holding, fill, handset receipt or live trial |
| P8 | Walk-forward option backtests & reliability dashboard | 50% | Includes entry-notice coverage reconciliation, excluded-pair accounting and deliberately withheld rankable win rate; real quote provenance and out-of-sample proof absent |
| P9 | Multi-day production-style paper monitoring | 0% | Needs 5+ real market sessions and phone receipts |

Sum of current percentages / 10 = **68.0%, rounded to 68%**. **Actual readiness for time-critical phone alerts is below engineering completion**, because P5 and P9 are blocked and P3 has only a limited real-data smoke test while cloud P4 has no live integration test.

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

## October 19 follow-up — honest option-level paper evidence (56%)

1. Added a pure paper quote-pair validator and after-cost scoring module with explicit post-signal quote timestamps, listed option contract, expiry, top-of-book BID/ASK and sufficient available depth.
2. Gross and net reference estimates use ASK on entry and BID on exit, bounded pessimistic slippage on both legs and mandatory positive per-roundtrip charges. **No actual fill or market profitability is claimed.**
3. Invalid, over-delayed, weekend, expired, reversed, wide-spread or liquidity-insufficient quote observations fail closed.
4. The summary refuses any sample under 30 paired observations over at least 5 days; synthetic/unverified inputs get an explicit `UNVERIFIED_SOURCE` label even when counts are high. Captured-quote tags alone are **not independently verified**.
5. Offline test suite now **116/116 passed**. P8 research-evidence scaffolding moves from 0% to **10%**; overall 55% to **56%**. Actual option depth archive, independent provenance validation, chronological walk-forward split and multi-day trial remain pending. See [paper-evidence technical design](PAPER_EVIDENCE_EVALUATION.md).

## October 19 follow-up — operational health that cannot fake readiness (57%)

1. Added [`operational.py`](../cloud_alerts/operational.py) and `/operationalz` to separate worker liveness, daily token presence, and **fresh completed REST decision data**.
2. The operational gate fails closed for disabled worker, market closure, no daily token, pending Telegram outbox, erroneous state, absent/stale/future REST observations, or missing broker decisions.
3. The response explicitly says `phone_receipt_verified=false` and `real_orders_enabled=false`; a successful API call **cannot prove** delivery on the physical phone.
4. Preserved `/healthz` for Docker liveness and `/readyz` for token availability; neither is a substitute for full market-trial evidence.
5. Ran **129/129 offline tests** after preserving the signed `/internal/token` route and its auth/replay/size protection tests. See [operational readiness details](OPERATIONAL_READINESS.md). No live cloud host was created and no account credentials entered.
6. P4 offline completion moves **65% → 75%**; P5 and P9 remain **0%** until genuinely deployed and tested. Overall estimated scope **57% implemented, 43% remaining**.

## October 19 follow-up — chronological paper walk-forward (58%)

1. Added [`walkforward.py`](../cloud_alerts/walkforward.py) for non-overlapping training/embargo/test sessions and strictly chronological evaluations. No strategy parameters are automatically fitted to future observations.
2. Fails closed on duplicate event IDs, insufficient session history, invalid bid/ask or provenance, timestamps that reverse causality, and illegal partition sizes.
3. Reuses the existing conservative quote-pair cost scorer: **entry ASK, exit BID, depth, slippage and charges**, with simulated source explicitly marked **NOT verified trading performance**.
4. Added seven tests for embargo and walk-forward ordering, data shuffling, invalid costs/quotes, insufficient evidence, duplicates and synthetic-truth flags. **136/136 tests passed**.
5. P8 offline research plumbing moves **10% → 20%**; the actual quote-pair dataset, real walk-forward profitability and five-session phone trials are absent. Overall estimate **58% complete, 42% remaining**. See [walk-forward paper validation](WALK_FORWARD_PAPER_VALIDATION.md).


## October 19 continuation — secure daily-token transfer and truthful CLI exit (60%)

1. Fixed a **false-success exit bug**: one-shot `--push` now exits nonzero if cloud receipt cannot be verified, including network timeout and wrong endpoint, instead of quietly succeeding.
2. Sender extracts only Kite API key and daily access token from an existing bounded read-only `.env`; it never loads Kite API secret or unrelated env variables.
3. Strict URL preflight refuses non-HTTPS/URL-credential/redirect-prone handoff targets and invalid endpoint forms.
4. Added seven end-to-end synthetic tests through real signed sender payload, actual FastAPI handoff route, encrypted token vault, nonce replay and tamper rejection; confirms protected mock `.env` stays unmodified.
5. Offline suite **143/143 passed**. No actual credentials, external host, broker calls or Telegram messages were used. **Daily broker validity and cloud delivery still require live tests**.
6. P2 offline readiness moves **70% → 90%**, raising the ten-phase mean from 57.5% to **59.5%, rounded to 60%**. P5 and P9 remain 0%. See [daily handoff validation](DAILY_TOKEN_HANDOFF_VALIDATION.md).

## October 19 Phase 12 — fail-closed cloud deployment preflight (61%)

1. Implemented `cloud_alerts/preflight.py` to reject absent/invalid essential secret settings without logging any value; reject missing, non-owned or too-permissive dedicated cloud state directories.
2. Reject container overlay/tmpfs/root mounts in place of a private persistent volume and require at least 100 MiB free; test temporary local write/fsync/delete before startup. **A detected mount is not proof of long-term host-level persistence**.
3. Docker now executes the preflight before starting a **single** Uvicorn worker; added operator-reviewed `deploy/compose.yml` with localhost-only port binding, private named volume, read-only root, dropped Linux capabilities, restricted process count and bounded logs. No HTTPS ingress is provisioned by this code.
4. Added eight synthetic preflight tests; complete suite **151/151 passed** locally. Existing protected Windows trading folder remains read-only and was not used in these tests. No broker or Telegram calls.
5. P5 implementation plan rises **0% to 10%** because a deployment template and preflight exist, but **host activation and laptop-off testing remain 0%**. Overall phase mean becomes **60.5%, rounded to 61%**. Existing P0–P9 figures unchanged otherwise. **Live cloud alerts are NOT enabled**.


## October 19 Phase 13 — reject placeholder secrets and secure persistent files (62%)

1. Added `cloud_alerts/config_guard.py`: a shared, **secret-redacting** configuration validator, used by both the fail-closed cloud preflight and direct ASGI runtime setup. A direct Uvicorn startup cannot silently bypass placeholder checks.
2. Rejects `.env.example` placeholder keys, invalid boolean values and bad Fernet keys. When alerts are enabled, rejects malformed Kite API-key format, Telegram bot/chat formats and trivially repeated HMAC strings. This is only format validation, **not proof that credentials work**.
3. Existing sensitive state files (`token.enc`, SQLite database, WAL, SHM and single-worker lock) must be regular, worker-owned and private. Symlinks and world/group-readable sensitive files block startup; they are **not** silently rewritten or deleted.
4. Docker startup explicitly sets `umask 077` before the preflight and Uvicorn execution. Offline static checks enforce a single worker, localhost-bound ingress, a mounted private state volume and no credential COPY instructions.
5. Full **168/168 offline tests** pass. No cloud infrastructure, broker requests, Telegram messages or real trades were used. The original protected Windows trading directory was not accessed or changed in this phase.
6. Only **P5 preparatory infrastructure scope 10% → 20%**, bringing ten-phase mean to **61.5%, rounded to 62%**. The continuously running host, live token handoff and phone receipt remain **not verified**. See [fail-closed configuration and state guide](FAIL_CLOSED_CONFIG.md).


## October 19 Phase 14 — HTTPS ingress blueprint and explicit Telegram TEST (63%)

1. Added a Caddy HTTPS reverse-proxy example that forwards **only signed `POST /internal/token`** to the localhost-bound application and responds 404 to public health, readiness and all other routes. Its 2 KB request limit complements the existing receiver-side HMAC, nonce replay and 2048-byte checks. This is a **static example, not a deployed TLS endpoint or a certificate test**.
2. Added `python -m cloud_alerts.telegram_probe --check-only` for offline sanitized Telegram environment validation and an explicitly confirmed `--send-test --confirm-send` TEST-only command. The command cannot send a signal/order and does not call Kite.
3. Telegram's HTTP API acceptance is reported separately from **physical-phone receipt, which remains unverified**. All exceptions produce safe codes with no secret values in output.
4. New offline tests for endpoint route restrictions and Telegram fake transports bring the complete suite to **177/177 tests passed**. No live Telegram calls, cloud deployments, DNS/TLS operations, protected trading-folder modifications or orders occurred.
5. P4 engineering estimate **75 → 80%**; P5 preparation **20 → 25%**. Ten-phase average **62.5%, rounded to 63%**. P5 host provisioning and real cloud operation remain **0% observed**; P9 market sessions remain **0%**. See [Phase 14 HTTPS ingress and phone test](HTTPS_INGRESS_AND_PHONE_TEST.md).


## October 19 Phase 15 — no virtual exits for unseen entry notifications (64%)

1. Each new virtual CE/PE candidate now carries its original `entry_event_id`, enforced in the SQLite transaction even when a caller omits it; mismatched IDs fail closed; this points to the existing durable Telegram outbox row, **not** to a real Kite order or holding.
2. Both underlying-futures and optional actual-option-BID virtual exit monitors **wait** while the entry review is queued, and issue **no EXIT review** if the entry review never receives Telegram Bot API acceptance. This avoids confusing an unseen BUY review with a subsequent orphan EXIT.
3. If the entry review expires after 180 seconds, the associated virtual candidate is cleared before it can generate an EXIT. Corrupt/missing linked events fail closed without exposing message payloads.
4. Pre-existing legacy virtual candidates without an `entry_event_id` retain research-only compatibility; no host has been deployed to contain legacy real entries. New candidates always use the linked safety gate.
5. Added **9 tests** for queued/expired/accepted entries, optional premium watcher network avoidance, crash/restart persistence, automatic SQLite event linkage and foreign event-ID rejection; **186/186 offline tests pass**. No real broker/Telegram requests or cloud deployment.
6. P7 engineering estimate **65% → 75%**. Overall estimated engineering scope **63% → 64%**; live host activation and five-session proof remain **0%**. See [entry-notice gate](ENTRY_NOTICE_EXIT_SAFETY.md).


## October 19 Phase 16 — fail-closed option quotes and 15-minute context (65%)

1. Reject non-finite (`NaN`, positive/negative infinity) option BID/ASK before Telegram formatting, virtual premium monitoring, or performance calculations. Reject an optional Kite `instrument_token` that disagrees with the selected option; quotes missing this optional field remain compatible.
2. Interpret naive Kite exchange quote timestamps explicitly in **Asia/Kolkata**, even if the cloud worker's supplied clock uses UTC; reject a naive validation clock. Stale/future-dated checks remain enforced.
3. Validate **every** independent 15-minute confirmation candle's OHLC and timestamp ordering, and check recent same-session bars for gaps and invalid 15-minute session boundaries. The 15-minute EMA must not be based on missing/duplicate/corrupt intraday history.
4. Added 17 new offline regression tests including synthetic full broker→option quote→Telegram suppression of `NaN` option prices. **203/203 local tests passed**. No real Kite, Telegram or hosting actions were used.
5. P1 increases **80% → 90%**, P3 **80% → 85%**; the ten-phase mean is now **65% implemented, 35% remaining**. P5 hosting and P9 multi-day observed operations remain unchanged.
6. See [market-data integrity gate](MARKET_DATA_INTEGRITY.md) for explicit scope and remaining live validation.


## October 19 Phase 17 — causal historical replay and restart proof (66%)

1. Introduced [deterministic historical replay](HISTORICAL_REPLAY.md) using broker futures 5-minute history and independently completed 15-minute confirmation bars at each historical observation time. **No data from future candles may influence past decisions**.
2. Built a SHA-256 decision chain binding all five-minute warmup history, each replayed candle, the available 15-minute prefix and decision status. Changed input history fails a resume-checkpoint comparison; consistent restart returns identical subsequent decisions. Hashes are tamper-*evident* for accidental changes, not signed broker provenance.
3. Reject missing/duplicate/reversed candles, out-of-session bars, timestamp misalignment, nonfinite OHLCV and invalid replay JSON. The offline CLI accepts no secrets and performs no Kite, Telegram or trading API requests.
4. Added 21 offline replay/CLI tests, including a test-discovered warmup-chain omission that was repaired. Full suite **224/224 passed**, and Python bytecode compilation passed. Synthetic futures decisions **do not establish any option win rate**.
5. P8 research/evaluation scaffolding **20% → 30%**. Overall ten-phase estimate **65% → 66%**, leaving **34%**. Always-on hosting and five live market sessions remain unstarted. No protected desktop folder was accessed.


## October 19 Phase 18 — paired option quote observation evidence (67%)

1. Added an allowlisted, paper-only option BID/ASK snapshot schema carrying distinct exchange and worker-observed timestamps, listed contract identity, liquidity and local SHA-256 consistency hash. Neither schema validation nor a hash authenticates a provider observation.
2. Stores the `ENTRY` quote **atomically** with the SQLite virtual paper candidate and Telegram outbox record; records a later `EXIT` quote only when the optional premium BID watcher actually receives a fresh option quote. No time-cutoff or futures-only exit is presumed to have an executable option BID.
3. Added append-only, conflict-rejecting evidence persistence and verified non-mutating report access. The offline CLI accepts a private SQLite snapshot and caller-supplied **nonzero fees** and bounded slippage; evaluates ASK-in/BID-out using the existing hypothetical option scorer. Missing/mismatched/corrupt pairs are reported, never invented.
4. Fixed the evaluator's event-ID validation, which previously rejected the actual `+05:30` timezone suffix in paper entry event IDs. Added a regression test for that case and full synthetic entry→virtual exit→P&L evidence integration.
5. **251/251 local offline tests passed**, modules compile; no real broker quote data, Telegram phone receipt, live host, quote-origin audit, trades or profit edge was proven. Source hashes are not signatures and synthetic wins are not verified accuracy.
6. P8 offline research/evidence tooling moves **30% → 40%**; overall phase-weighted estimate **66% → 67%**, with 33% estimated scope remaining. Cloud host and five-session operational validation remain outstanding. See [option quote ledger documentation](OPTION_QUOTE_EVIDENCE_LEDGER.md).


## October 19 Phase 19 — complete-case / survivorship-bias guard (68%)

1. Corrected an evidence-selection risk: a report based on one profitable paired quote could previously display a 100% `net_win_rate_pct` while omitting nine entry notices with no recorded exit/option quote. This is **not** a demonstrated strategy win rate.
2. The quote report now explicitly separates a **descriptive `complete_case_win_rate_pct`** (conditional on scorable paired quotes) from `rankable_win_rate_pct` and the ordinary summary `net_win_rate_pct`, which remain **null** without independently authenticated, complete, sufficient samples.
3. Added an opt-in `--reconcile-entry-outbox` switch that counts every original SQLite `REVIEW_CE` / `REVIEW_PE` event, including events without any quote observations; strict reconciliation rejects orphan option records. Only aggregate counts and safe review states are printed, never alert text or identifiers.
4. Adds `scorable_event_coverage_pct`, `entry_events_missing_all_quotes`, `incomplete_quote_pairs`, `rejected_quote_pairs`, and explicit `ranking_blockers`. None are model accuracy claims; no signals are issued by this offline CLI.
5. Full offline suite **264/264 passed**; tests include one win out of ten claimed entries, no observations, conflicting quote contracts, unsafe unregistered quote observations and read-only SQLite audits. No live market sampling, hosting, Telegram receipt or order execution.
6. P8 synthetic tooling estimated **40% → 50%**, ten-phase average **67% → 68%**, **32% remaining**. P5 host activation and P9 market-session evidence remain **0% observed**. See [coverage audit](QUOTE_COVERAGE_AUDIT.md).
