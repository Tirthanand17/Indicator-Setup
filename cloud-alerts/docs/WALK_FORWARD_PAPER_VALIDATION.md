# Chronological walk-forward *paper evidence*, not a winning bot guarantee

**Milestone:** 2026-10-19. **Status:** offline evaluator with synthetic fixtures, not a real signal-performance audit.

The original `evaluation.py` requires causally timestamped, matched option **ASK at hypothetical entry**, **BID at hypothetical exit**, sufficient top-of-book depth, and caller-provided realistic round-trip fees and slippage. Historical NIFTY futures candles **cannot** recreate these missing option quotes.

`walkforward.py` adds a chronological splitting mechanism; it does not optimize parameters, ingest Kite holdings, or execute orders. Every fold uses distinct IST exchange **session dates**:

1. **TRAIN:** a contiguous set of earlier session days. Not fitted by this module.
2. **EMBARGO:** one or more intervening sessions ignored for either split.
3. **TEST:** subsequent session days used only for hypothetical after-cost quote-pair scoring.

Input rows are independently validated using `score_pair()` before reporting any fold. Duplicate event IDs, invalid bid/ask, expired options, depth shortage, future-dated/leaking quotes and inadequate train/embargo/test sessions fail closed. Folds may reuse earlier test dates as training dates in a **later** forward window, but future information never enters an earlier fold's training set.

Example (synthetic only):

```python
from cloud_alerts.evaluation import Costs
from cloud_alerts.walkforward import walk_forward_windows

# `quote_pairs` must be your independently collected PaperQuotePair objects.
# No synthetic input should ever be marketed as a live Kite performance record.
result = walk_forward_windows(quote_pairs, Costs(12, 35),
                              train_sessions=10, embargo_sessions=1,
                              test_sessions=3, step_sessions=3)
```

Returned folds contain dates, sample sizes and hypothetical test net-rupee sums; **not** a verified win-rate, strategy selection or actual account P&L. Every result explicitly sets `out_of_sample_trading_edge_proven=false`, `real_orders_placed=false`, and all per-fold fill/audit truth flags false. A provenance string `CAPTURED_KITE_QUOTE` is not independent provenance verification.

**Next:** collect eligible real option quote pairs with independent timestamps over multiple sessions; reconcile them to the signals, instrument master and fees; enforce no overfitting; then examine full forward paper runs and phone alert receipt latency. Do not raise live trading readiness on the strength of synthetic test arithmetic.
