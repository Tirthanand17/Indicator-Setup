# Observed paper portfolio metrics

The two observed paper accounts use `readonly-portfolio-metrics-v1`, separate
from synthetic test marks. New ledger positions already persist contract strike.
Legacy missing strikes remain explicitly unavailable unless the current verified
contract supplies them. No broker orders, actual broker balances or confirmed
exchange fills are represented by these estimates.

## Accounting

All cash, fees and intermediate monetary totals use integer paise. For an open
position, net liquidation credit is quantity times observed BID after the
position's adverse exit slippage, minus the modeled SELL fees. Marked equity is
cash plus those credits. Unrealized net P&L is credit minus the original entry
debit, including entry fees; entry fees are therefore charged exactly once.
Flat equity equals verified cash without requiring a quote. Total net return
uses initial account capital as denominator.

Worked regression: a 65-unit entry at ASK ₹100.50 with 8bp adverse slippage
fills at ₹100.58; entry fees are ₹26.55 and total debit ₹6,564.25. The ₹50,000
account has ₹43,435.75 cash. A fresh BID ₹100.00 models an exit at ₹99.92,
₹36.34 SELL fees and ₹6,458.46 net credit. Estimated equity is ₹49,894.21,
unrealized net P&L −₹105.79. These are hypothetical paper calculations.

Marks must match the held contract, have a timestamp no older than 15 seconds
(at most 3 seconds ahead), valid spread and depth for the entire held quantity.
Missing entry quotes cannot replace a different held contract's marks. Missing,
stale, carried-day and unverifiable-exit positions retain debits and make open
valuation unavailable. Unverifiable exits do not become realized losses or wins.

Lifetime, daily and monthly closed-trade statistics include wins/losses,
breakeven counts, after-cost realized P&L, average winning/losing trade,
expectancy, win rate and profit factor (sum positive net trades divided by
absolute sum negative net trades). Profit factor is null with an explicit status
when there are no losing trades or no closed trades. Loss averages are signed.
Period returns use initial capital; period realized curves start at that same
initial capital and are not a reconstruction of the month's opening balance.
Per-trade net risk/reward uses the modeled stop/target exit after costs.

## Persistence, gaps and failure behavior

Marks, peaks and maximum sampled drawdown are saved in the same transaction as
the observed bridge, ledger and delivery journal. A failed transaction retains
the previous book and metrics. Duplicate captures do not add history samples.
Native tests verify real SQLite rollback, protective exits before slow history,
fresh open marks, flat close equity and recovery of the identical metrics record.

Peak equity starts from initial capital and incorporates observed net liquidation
and reconstructed realized equity. Maximum drawdown records both the greatest
paise drop and the greatest percentage drop from their respective sampled peaks.
These extrema need not occur on the same tick. Recent history retains at most
128 timestamped observations per account, including nulls for unknown values;
lifetime peak/drawdown accumulators survive truncation and restart.

Skipped ticks with held positions, missing marks and histories that predate this
feature are flagged incomplete. A sampled drawdown can miss an intervening move
even with complete recorded ticks. Past missing observations cannot be rebuilt
from later prices. Realized-only curves remain available separately.

Corrupt/orphaned metrics are preserved for inspection and projected with an
explicit invalid-history status. Their marks and drawdown are not trusted, and
the ledger's audited cash remains visible. Analytics validation cannot prevent a
verified protective exit; a storage failure still rolls the entire transaction
back. Repair/reconciliation and complete observed-state backup are separate
roadmap tasks. The new record must be included by the upcoming backup work.

## Private dashboard and verification

The existing private session/flag gates apply. The API/UI show capital, current
BID, quantity/strike, modeled exit costs, unrealized P&L, net risk/reward,
lifetime/monthly statistics, sampled equity history and health/freshness states.
The browser uses text nodes and clears all metric tables when fetching fails.
Raw quotes, instrument tokens, credentials and outbound message bodies are not
included in the dashboard projection.

Deterministic regressions cover the worked example, separate account quantities,
full-depth checks, wrong contract/strike, stale/missing quotes, mixed wins/losses,
monthly separation, drawdown gaps, bounded samples, corrupt state and no-double
costing. UI regressions execute the served script with fresh, stale and failed
reports. Local workerd and GitHub CI evidence establish offline behavior only.
No live deployment, timing guarantee, cloud cost or profitable strategy is claimed.
