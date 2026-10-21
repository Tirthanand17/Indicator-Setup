# Phase 43 — autonomous partial-paper-entry crash recovery

**State on 2026-10-21:** reviewed implementation on feature branch `feature/phase43-paper-recovery-audit`; **29/29 focused recovery/accounting unit tests passed locally** in the current container; 10 new worker/schema/private-API/frontend integration tests and the entire GitHub repository regression suite remain **NOT RUN**. This branch is deliberately not merged and no live flags were changed.

## Audited failure mode

The Phase 41/42 worker first persists a five-indicator REVIEW candidate and Telegram outbox row in SQLite, then creates independent ₹50,000 and ₹100,000 simulated entries in separate transactions. A crash between those writes could leave a source REVIEW with zero or one account outcome. A retry of the completed candle can be suppressed by the existing persisted virtual-candidate gate, so paper performance could silently omit one account.

A critical rule: **never use an old quote to backdate the missing paper purchase**, never fabricate P&L, and never release cash without valid observed option BID.

## Phase 43 changes

- New `cloud_alerts/paper_integrity.py`. Before the opt-in paper worker starts, save an immutable UTC activation marker in the existing `runtime` table. Alert-only REVIEW events *before* the activation marker are correctly excluded, so a legacy alert history is not misidentified as incomplete paper simulations.
- The restart audit checks that **each** post-activation REVIEW has either `paper_positions` or `paper_rejections` for **each of the two comparison accounts**. Return only sanitized counts; no tokens, message bodies, option prices or user chat IDs appear in the API.
- When a matching account outcome is absent for less than the 180-second grace window, pause new simulated entries (fail closed). After grace, an exclusive `BEGIN IMMEDIATE` SQLite transaction records an explicit `CRASH_GAP_NO_SIMULATED_FILL` rejection for each missing account and atomically queues one `PAPER_RECOVERY` operational Telegram notification per affected REVIEW event. Repeated runs are idempotent.
- The worker's new optional `paper_integrity_enforced` gate runs only when `PAPER_AUTOTRADE_ENABLED=true` through the approved FastAPI server. The original alerts-only mode and disabled paper dashboard do not trigger new paper trades or recovery migrations. Once complete, normal monitoring may continue. Prior actual paper positions and capital are unchanged.
- A paper account with existing simulated positions but **no activation marker** is fail-closed at activation; the program cannot safely guess when simulation mode originally began.
- Private `/paper/api/summary` includes `paper_recovery_integrity`; the mobile dashboard highlights blocked or not-activated simulation state without exposing credentials.


## Phase 43 continuation — after-hours recovery

- Moved common recovery handling into `Engine.reconcile_paper_journal(now, market_poll=False)`, which runs locally without a Kite token, brokerage order method, or market-data HTTP request.
- The minute-level unattended worker now reconciles partial paper REVIEW/account outcomes **outside 09:25–15:26**, including after session close and on non-trading days. It checks integrity BEFORE an end-of-day Telegram paper report and defers that report while recovery grace is pending.
- Added two extra standalone recovery tests for missed entries found after close and over a multi-day non-trading gap. **29/29 focused local tests passed** (Python 3.13 isolated module).
- Added **two further Engine integration tests (five in total)**: after-hours recovery without accessing the Kite vault, and report eligibility after the grace period. These remain **not executed** until the complete repository is available on a trusted Python 3.12 runner.
- Branch is still draft PR #1. `main` remains unchanged, `PAPER_AUTOTRADE_ENABLED=false` and cloud acceptance remains 0/5.

## Additional recovery hardening in this session

- Detect contradictory position-and-rejection evidence for one account/signal, and unexpected account names, before claiming completion or writing any recovery record. These cases fail closed.
- Test a synthetic SQLite failure during the second account reconciliation write: the first insert and recovery notification roll back together, leaving original cash and journal intact.
- Move purely local crash-gap reconciliation before daily Kite token lookup. Missing a token continues to pause all new signal processing, but cannot prevent existing account journal repairs. A third worker integration case covers this path; it is committed but NOT executed with the full application.
- Local cross-module smoke exercised one paper BUY in the 50k account and a missing 100k account outcome against a SQLite events/runtime schema and the locally available PaperBook implementation; repair preserved cash and recorded the missing outcome as MISSED. This is not the full Phase 42/43 app suite.
- Target Docker Python is 3.12, whereas focused unit tests ran on Python 3.13. Full target-runtime validation is still mandatory.


## Phase 43 follow-up — suppress contaminated dashboard performance

The authenticated paper dashboard previously showed available cash, net realized P&L and chart data even if a cash/journal integrity check reported FAIL_CLOSED. This could mislead a researcher reviewing a damaged SQLite file.

- `/paper/api/summary` now masks recorded cash, realized P&L, equity and trade counts on cash reconciliation failure, while preserving identity and the starting paper capital. It emits only sanitized FAIL_CLOSED metadata.
- `/paper/api/trades` and `/paper/api/analytics` now return HTTP **503** after authenticated access if the cash journal does not reconcile; neither serves potentially contaminated performance figures.
- The mobile page fetches and validates the protected summary **before** querying trade history/analytics. When cash integrity fails it displays an explicit stop message and does not plot anything.
- Updated existing private-API regression and added one frontend fail-closed test to the project test suite. **These FastAPI integration tests remain UNRUN** in this environment.
- 29/29 isolated recovery/cash-ledger cases still pass locally. Full Python 3.12 regression and actual deployment are not verified.

## Phase 43 extension — verify cash/journal conservation before simulation

**Why:** A completed pair of account outcomes is insufficient evidence of correct cash accounting. A database edit or interrupted/out-of-band cash write could make simulated P&L or available balance false, even when every REVIEW has both outcomes.

**Implemented on draft PR #1:**
- New read-only `audit_cash_reconciliation()` computes each account's expected cash in exact integer paise: initial paper capital minus all recorded simulated entry debits plus all simulated close credits. Require precisely `PAPER_50K` and `PAPER_100K` accounts with nonnegative integer cash and positive starting balances. Enforce exact `CLOSED` net P&L = exit credit − entry debit; refuse credits or P&L on `OPEN`/`EXIT_UNVERIFIABLE` trades and refuse orphan/unknown-account positions.
- Invoke this audit **before** the worker's existing crash-gap recovery writes or any Kite calls. A mismatch leaves new paper entry blocked with `WAIT_PAPER_RECONCILIATION` and never resets cash or invents fills.
- The authenticated `/paper/api/summary` API now includes only sanitized cash-integrity metadata. Missing or malformed audit evidence returns a **FAIL_CLOSED** state, never a 200 response misleadingly claiming the journal is healthy. The mobile dashboard has different warnings for a corrupted cash journal and a broken REVIEW/clock history.
- **Ran 29/29 local isolated Python 3.13 recovery/accounting tests:** 19 prior restart/crash tests, plus 10 new tests for fresh accounts, closed and unresolved ledger conservation, 1-paise tampering, wrong P&L, fictional unresolved credit, orphan accounts, extra account, negative and non-integer cash. `python -m compileall` on the local isolated sources also passed.
- **Added 4 additional full application tests (10 Phase 43 application integration tests total), NOT EXECUTED:** actual PaperBook entry/exit conservation; worker refuses cash corruption before Kite reads; private authenticated API flags changed cash; authenticated API safely handles a corrupt REVIEW timestamp. The complete preexisting repository suite remains unexecuted; the isolated local tests are not a substitute.
- Main remains unchanged. No current paid runner, OCI host, public service, live Kite relay, handset receipt or real orders.

## Phase 43 — actual Nirala checkout and full Windows suite (RED; 53% retained)

1. Connected to **Nirala online** through the linked Desktop Commander Personal account. Cloned real Phase 43 branch into `%TEMP%\indicator-phase43-qa-20261021`, with isolated Python venv. No Desktop or protected Kite trading-folder mutations, no production services.
2. Ran `python -m compileall -q cloud_alerts tests` — PASS. Windows Python **3.11** (production Docker targets **Linux Python 3.12**). Added conditional `tzdata` to project requirements so Windows can load `Asia/Kolkata`.
3. **Full GitHub checkout pytest executed: 458 PASSED, 120 FAILED, 4 SKIPPED; red.** Failure signatures are dominated by Linux-only `os.fchmod`, `os.geteuid`, deliberate Linux/POSIX lock requirement, Windows symlink/file-lock constraints and local loopback smoke; do NOT fake POSIX security to force Windows green. No verified all-green Linux suite.
4. Independently ran the paper research subset against actual source: **68/68 PASSED**, including new journal, fees, quote audit and realized-only analytics. **Two real State/PaperBook recovery integration tests PASSED** (5 in same integration file deselected); these overlap the full-suite pass total and are not additive.
5. No merge, GitHub CI, paid host, real Kite key, phone send or real order. See [Full Windows QA results, failure classification and next Linux runner command](PHASE43_NIRALA_WINDOWS_QA_20261021.md).
6. Expanded engineering estimate **53%**, original alert preparation **80%**, paper subsystem historical estimate **43%**; **live acceptance remains 0/5**. Next: authorized isolated Linux Python 3.12 full pytest, patch legitimate failures, merge then cloud acceptance.

## Linux Python 3.12 CircleCI regression path

The existing user's alternative CI provider is **CircleCI**, previously used for other trading-research repositories. In this Indicator-Setup draft branch, added a branch-filtered `.circleci/config.yml` using `cimg/python:3.12`, a small Docker resource, offline test-only environment flags, explicit unsetting of live Kite/Telegram secrets, and a JUnit test artifact. It targets **only** `feature/phase43-paper-recovery-audit`; there is no deploy/publish job or GitHub Actions use.

**Run status:** GitHub commit-status API returned `statuses: []`, and GitHub workflow-runs returned `[]` after the config commit. This does not prove CircleCI project registration or an executed Linux job. CircleCI is not exposed as a connected action in this ChatGPT tool context, so a successful CircleCI job **has not been verified**. Do not merge pending all-green Linux evidence. Docs: https://circleci.com/docs/guides/getting-started/language-python/


## Test ledger

**Executed locally:** `PYTHONPATH=. python -m pytest -q tests/test_paper_integrity.py tests/test_paper_integrity_hardening.py tests/test_paper_integrity_cash.py` on the isolated recovery module and fixtures -> **29 passed (0 failures)**. Three adversarial cases assert rejection of conflicting account evidence, refusal of unexpected paper account IDs, and full atomic rollback after an injected failure on the second account. Covers activation durability, old REVIEW history, full vs partial account outcomes, grace, recovery idempotence, exact UTC offset comparisons, corrupt and future timestamps, bounded status reports, explicit missed entries and no invented positions.

**Committed, not executed:** `tests/test_paper_integrity_integration.py` adds 7 realistic State/PaperBook worker tests using the actual SQLite schemas and fake broker. The complete repository was not cloned in this environment because `github.com` and `api.github.com` DNS resolution fails. No GitHub Actions runs exist in the repository; do not spend Actions credits just to represent unverified tests as green. Check Python pytest dependencies and run the full project suite on a user-approved trusted runner before merging or activating paper automation.

## Source/branch and exact continuation

- Repository: `Tirthanand17/Indicator-Setup`.
- Main checkpoint before this work: `c5c4d0f90e11e841991c0efe9a351fd44e3dd94c` (Phase 42, expanded scope 53%).
- Working branch: `feature/phase43-paper-recovery-audit`. Files changed: new `paper_integrity.py`, 29 focused unit tests, 10 integration tests across the Phase 43 files, updated `engine.py`, `server.py` and private `paper_dashboard_view.py`, plus this ledger.
- **Remaining blockers:** run entire Python/FastAPI pytest suite and repair any failures; merge only after evidence; finish fee verification and irregular end-of-day settlement treatment; complete real missed-opportunity quote coverage; approve a durable ₹0 always-on host; verify live daily read-only Kite API/HMAC relay, Telegram handset and Nirala-OFF functionality; complete at least 5 NSE trading sessions.
- **Progress:** expanded-goal engineering **53% (unchanged)**, paper subsystem prior estimate **43%**, original alert-only prep **80%**, deployment acceptance **0/5**. Changes in a draft branch do not justify increasing the headline percentage.

The current chat cannot execute continuously after it ends. A separate authorized CI/runner or next explicit session is required; no persistent development agent was provisioned.
