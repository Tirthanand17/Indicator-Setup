# Phase 43 — autonomous partial-paper-entry crash recovery

**State on 2026-10-21:** reviewed implementation on feature branch `feature/phase43-paper-recovery-audit`; **14/14 isolated unit tests passed** in the current container; 2 new integration tests and the entire GitHub repository regression suite remain **NOT RUN**. This branch is deliberately not merged and no live flags were changed.

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

## Test ledger

**Executed locally:** `PYTHONPATH=. pytest -q tests/test_paper_integrity.py` on the isolated pure recovery module and fixtures -> **14 passed (0 failures)**. Covers activation durability, old REVIEW history, full vs partial account outcomes, grace, recovery idempotence, exact UTC offset comparisons, corrupt and future timestamps, bounded status reports, explicit missed entries and no invented positions.

**Committed, not executed:** `tests/test_paper_integrity_integration.py` adds 2 realistic State/PaperBook worker tests using the actual SQLite schemas and fake broker. The complete repository was not cloned in this environment because `github.com` and `api.github.com` DNS resolution fails. No GitHub Actions runs exist in the repository; do not spend Actions credits just to represent unverified tests as green. Check Python pytest dependencies and run the full project suite on a user-approved trusted runner before merging or activating paper automation.

## Source/branch and exact continuation

- Repository: `Tirthanand17/Indicator-Setup`.
- Main checkpoint before this work: `c5c4d0f90e11e841991c0efe9a351fd44e3dd94c` (Phase 42, expanded scope 53%).
- Working branch: `feature/phase43-paper-recovery-audit`. Files changed: new `paper_integrity.py`, 14 synthetic unit tests, 2 integration tests, updated `engine.py`, `server.py` and private `paper_dashboard_view.py`, plus this ledger.
- **Remaining blockers:** run entire Python/FastAPI pytest suite and repair any failures; merge only after evidence; finish fee verification and irregular end-of-day settlement treatment; complete real missed-opportunity quote coverage; approve a durable ₹0 always-on host; verify live daily read-only Kite API/HMAC relay, Telegram handset and Nirala-OFF functionality; complete at least 5 NSE trading sessions.
- **Progress:** expanded-goal engineering **53% (unchanged)**, paper subsystem prior estimate **43%**, original alert-only prep **80%**, deployment acceptance **0/5**. Changes in a draft branch do not justify increasing the headline percentage.

The current chat cannot execute continuously after it ends. A separate authorized CI/runner or next explicit session is required; no persistent development agent was provisioned.
