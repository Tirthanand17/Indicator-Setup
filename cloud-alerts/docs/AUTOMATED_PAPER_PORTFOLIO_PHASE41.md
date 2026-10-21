# Phase 41 — autonomous NIFTY paper accounts and private dashboard

**Status:** Committed to existing cloud-alerts architecture, disabled by default. No approved cloud host or real token-to-cloud/Telegram phone proof. Absolutely NO real broker orders.

## Implemented in this phase

1. Added cloud_alerts/paper_book.py: two separate simulated portfolios starting ₹50,000 and ₹100,000, with integer-paise SQLite cash, position and trade-history records. An optional ₹3,000 account is supported for isolated educational affordability tests. Balances survive restarts.
2. Validated option quotes must have exact NIFTY CE/PE identity, actual listed contract token and expiry, coherent top-level BID/ASK and volume, bounded spread and exchange timestamp. Entry uses observed ASK plus 8 bps adverse slippage and modeled fees; exit uses observed BID minus adverse slippage. Neither is a proven fill.
3. Conservative research rules: at most one unresolved position/account, three entries/day, 3% initial capital modeled stop risk, 6% daily realized loss shutdown, 30% capital utilization. Premium stop and target research assumptions are 20% below and 40% above the ASK respectively. Fixed ₹50 round-trip charges are illustrative; brokerage/STT/exchange/SEBI/GST/stamp duties are NOT fully modeled yet.
4. The existing five-indicator worker conditionally calls the paper-account entry procedure after a VALIDATED option quote and eligible REVIEW signal. It monitors saved paper positions with independently timestamped option BID quotes every 20 seconds and closes positions when eligible stop/target/time rules are met. Existing Telegram and REST-authoritative signal logic remain.
5. Every simulated paper entry/exit and its corresponding PAPER_ENTRY/PAPER_EXIT Telegram message are persisted within the same SQLite transaction, reusing the existing durable outbox and its deduplication. Two portfolios are independent research comparisons; displayed depth is not double-counted as if actual orders were sent.
6. At post-15:26 reconciliation, any remaining position without an executable exit quote is labeled EXIT_UNVERIFIABLE, with NO P&L, NO invented fill and NO virtual cash release. It stays risk-blocked until a reliable reconciliation mechanism is added. After 15:30 on regular NSE F&O days the worker creates a deduplicated two-portfolio daily Telegram report.
7. The existing FastAPI server now offers an opt-in private mobile-responsive page, /paper/dashboard, with 15-second refresh, cash balances, open positions, net realized P&L, simple equity-change chart, performance summary and quote-level trade history. Private data APIs /paper/api/summary and /paper/api/trades require an operator-supplied strong X-Paper-Dashboard-Key header. The web page does not store keys in URLs, cookies or localStorage; nonce-based script CSP, no-store and no external CDN are used.
8. Configurations PAPER_DASHBOARD_ENABLED and PAPER_AUTOTRADE_ENABLED default to FALSE, and automatic paper mode requires monitored alerts and an explicitly enabled protected dashboard. The protected Windows trading folder stays read-only; no screenshots or broker order endpoints are used.

## Verified tests vs remaining verification

- Ran **18 of 18 local synthetic PaperBook unit tests**, passing. Covered independent sizing and capitalization, cash persistence on restart, duplicate buys/sells, stop/target/time modeled fills, slippage and fees, unverified quote blocking, displayed depth, private history, risk rejections, atomic outbox records and day-end reconciliation.
- Added **9 integration cases** for FastAPI dashboard authentication/configuration, actual market decision -> simulated positions, quote-based simulated exits, and daily reporting. Those integration cases have NOT been executed against the complete repository, so the new paper runtime must remain OFF.
- The historical latest full-suite pass is Phase 34's 451/451, before subsequent changes. The combined regression count is not verified.
- Actual live host, signed real Kite handoff, real option quote capture, confirmed Telegram phone receipt with Nirala OFF, and five real market sessions remain **0/5 proven**.

## Known limitations before calling this production autopilot

- Charges/taxes are currently research assumptions, not a date-accurate Zerodha and NSE fee schedule; slippage and market impact remain simulated.
- Missing exit BID deliberately blocks capital in an unresolved paper position; a safe automatic rollover/reconciliation policy is not implemented.
- Complete missed-trade auditing, replay evidence, advanced visual charts, weekly/monthly analytics, multi-day profitability validation and complete paginated dashboard history remain incomplete.
- User approval and verifiable ₹0 hosting are needed before starting the always-on service. OCI Always Free eligibility/capacity is not known. No hosting, payment, real trade or live phone send occurred this phase.

## Revised progress indices, NOT trading accuracy

The new user specification substantially expands the original alerts-only scope. Preserve the historical **80% original core engineering estimate** separately. The NEW simulated paper trading subsystem is **35%** (core tested in isolation, integration unverified). Live cloud market acceptance is **0%**. The revised expanded-goal implementation index is **51%**, calculated as 50% * 80% + 30% * 35% + 20% * 0%, rounded. This is a rough transparent milestone index, not a performance, uptime, or profitability claim.

**Next phases:** full suite and broker-free end-to-end synthetic tests; daily/recovery reconciliation; accurate charge modeling; complete missed-opportunity evidence; final dashboard analytics; approved always-on host, signed token relay, real Telegram receipt and five forward-market sessions.


## Additional safety regression

An 18th local test proves that a position marked EXIT_UNVERIFIABLE after the session closes **cannot** be retroactively closed using a future trading day's quote. Open-position polling now excludes such unresolved records while the account's cash remains reserved. A malformed non-ASCII dashboard access header is rejected before constant-time credential comparison.
