# Phase 42 — realistic option charges, strict risk budget, decision audit and research analytics

**Status: committed development implementation, NOT cloud activated. 21 October 2026.**

## Delivered

### 1. Date-specific estimated NSE option costs

- Added `cloud_alerts/paper_charges.py` with policy `ZERODHA_NSE_OPTIONS_2026_04_V1`: brokerage ₹20 per executed option BUY/SELL order; NSE transaction fee 0.03553% of premium turnover; SEBI ₹10/crore; buy-side stamp duty 0.003%; GST 18% of brokerage, exchange and SEBI charges; sell-side STT 0.15% from 1 April 2026, rounded to nearest full rupee. Estimates are calculated separately for each BUY/SELL leg using the **simulated fill premium**, not NIFTY futures prices.
- Authoritative publications: [Zerodha charges](https://zerodha.com/charges/), [Zerodha STT rounding](https://support.zerodha.com/category/account-opening/resident-individual/ri-charges/articles/how-is-the-securities-transaction-tax-stt-calculated), [NSE option STT](https://www.nseindia.com/static/products-services/equity-derivatives-securities-transaction-tax). Fee values are a **versioned research approximation**, NOT actual brokerage contract notes or a guarantee about future rates. Exercise/expiry settlements, exchange billing aggregation, additional account-specific charges, broker account tiers and partial fills remain outside this model.
- Existing paper positions with explicit flat roundtrip fees remain `FIXED_RS_V1`. SQLite migration creates `fee_model_version` safely without wiping prior balances. New entries use the dated per-leg fee model by default; exit fees use **observed BID-based simulated exit fills** rather than a guessed flat ₹25. Dashboard trade history exposes both modeled entry/exit fees, sum and policy version.

### 2. No exceeding remaining daily risk budget

- Before simulated BUY, evaluate each affordable whole-lot size with cash, maximum 30% capital utilization, 3% initial-equity per-trade stop risk, **remaining** 6% daily loss risk budget, and actual ASK depth. Stop-side risk includes adverse slippage and **both estimated charges**.
- Two previous losing trades can now prevent a third apparently affordable trade when little daily loss budget remains. Prior implementation only blocked after the daily loss limit was already fully reached. No real broker orders, naked option writes, negative virtual balances or minimum daily trade frequency.

### 3. Causal missed-opportunity audit

- Added append-only `cloud_alerts/signal_audit.py` with timestamped five-minute futures contract, candle time, observation time, eight indicator values, strategy/quote/eligibility/portfolio gate, safe reason code, eligible option symbol and outcome.
- Runtime integration records eligible `REVIEW_CE/REVIEW_PE`, `NO_TRADE`, rejected liquidity and risk, existing candidates and accepted simulated portfolio entries. Deduplication refuses contradictory records at the same observed instant; no screenshots or retrospective options price invention.
- `/paper/api/opportunities` is private behind the existing dashboard key. The mobile UI shows qualifying signals, rejections and individual reasons and supports `YYYY-MM-DD` date filtering. Missed opportunity P&L remains `unverified` unless actual forward BID/ASK observations support it. The daily Telegram paper report can include same-day qualified, liquidity-rejected and risk-rejected counts.

### 4. Expanded research dashboard performance

- Added `cloud_alerts/paper_analytics.py` and `/paper/api/analytics`, with separate results for ₹50,000 and ₹100,000 comparison accounts.
- Win/loss/breakeven rates, sample sizes, gross realized wins/losses, modeled profit factor and expectancy, longest streaks, CE/PE results, entry-hour counts, realized drawdown, and day/week/month/total net returns **on starting paper capital** are computed from actual completed simulated journal entries. The dashboard's earlier mixed-account equity line was replaced by separately labeled portfolio curves.
- Unknown exits are excluded from win-rate and realized-equity statistics. Unrealized P&L is **unknown**, not zero, for outstanding positions. These metrics **do not establish profitability or fill accuracy**.

### 5. Safeguards and tests

- Added a static AST test to fail if direct broker execution methods appear in the production cloud_alerts runtime, and a test that the Kite wrapper has only market-data methods.
- **13/13** focused local pure-module tests passed in an isolated Python environment: fees (4), causal audit (5), analytics (4). These are focused harnesses, not the full GitHub repository.
- Added and committed additional regression/integration tests for fee-version migration behavior, risk-budget exhaustion, main worker signal audit, authenticated date-filtered APIs, analytics/PaperBook cross-check, and zero-order boundaries. **These full integration tests have not been executed**, nor has the full preexisting suite. The container cannot directly clone GitHub and no GitHub Actions credits or Nirala protected files were used.
- Fixed the browser's calendar-date regular-expression escaping following code read-back. Automatic paper trading remains OFF by default. The latest committed diff was reviewed through GitHub; that is **not** proof of live behavior.

## Known major blockers to genuine 100% completion

1. Run complete Python/FastAPI integration tests with the entire repository and repair any failures.
2. Complete a versioned fee ledger with actual broker contract-note reconciliation and evaluate any additional applicable charges, exercise/expiry rules and slippage uncertainty.
3. Capture more market-timed option BID/ASK evidence and handle unresolved positions with a documented, safe automatic evidence reconciliation policy (never invent fills).
4. Complete remaining dashboard capabilities, forward walk-forward strategy evaluation and reliability reporting.
5. Approve an always-on ₹0 infrastructure account with truly durable storage, domain and HTTPS. Complete real signed daily Kite token handoff, genuine read-only market REST observations, Telegram handset receipt when Nirala is OFF, and at least five complete NSE trading sessions.

## Honest progress metrics

- **Original alerts-only preparation:** approximately 80% engineering, actual host OFF.
- **Expanded paper subsystem:** approximately **43% engineering**, focused module tests passed, full integration unverified (previously 35%).
- **Cloud + real phone + five-session live acceptance:** **0/5 gates** proven.
- **Overall expanded scope index: 53%**, computed as 0.50×80 + 0.30×43 + 0.20×0 = 52.9%, rounded. This is *estimated implementation progress*, **not** trading accuracy, win rate, profitability or production uptime.

No new payments, cloud services, real broker orders or protected Windows folder writes occurred.
