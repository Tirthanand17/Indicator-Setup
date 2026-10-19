# NIFTY 50 Options — Five-Indicator Kite Setup

A practical, step-by-step **educational / paper-trading** guide for using **five TradingView studies** on Zerodha Kite, and for evaluating hypothetical CE (call) / PE (put) option-buying setups.

**Read the full guide:** [Kite five-indicator setup and CE/PE trading playbook](docs/KITE_NIFTY_FIVE_INDICATOR_PLAYBOOK.md)

**Quick practical guide:** [Exactly when to consider CE / PE, when to sell to exit, NO_TRADE rules, ATR stop examples and the timestamped 10:33 AM chart analysis](docs/BUY_SELL_DECISION_GUIDE.md).

**Interactive learning exercise:** [Offline signal-practice checker (HTML)](docs/signal-practice-checker.html) — download/view Raw and open locally in a browser. This educational tool does **not** connect to Kite or place orders.

## The five studies

| # | Study | Inputs | Suggested display | Purpose |
|---|---|---|---|---|
| 1 | Session VWAP | HLC3, session reset | Yellow | Intraday directional price reference |
| 2 | EMA | Length 9, close, offset 0 | Blue | Short-term trend |
| 3 | EMA | Length 21, close, offset 0 | Purple | Slower trend filter |
| 4 | **DMI (including ADX)** | DI length 14, ADX smoothing 14 | Separate pane, +DI green, −DI red, ADX pink | Trend strength and direction |
| 5 | ATR | Length 14 | Separate pane | Underlying volatility and stop-distance planning |

Use **5-minute NIFTY current-month futures** candles to generate setups and verify the **15-minute** market structure. Check **the actual option contract chart/chain** separately before paper-filling a position. Do not use NIFTY cash-index zero-volume bars for volume-weighted VWAP.

## CE / PE in one minute

- **Hypothetical CE:** Valid data; five-minute candle closes above VWAP; EMA9 > EMA21; ADX strengthening and preferably above 25; if using DMI, +DI > −DI; bullish break/retest; fifteen-minute context supportive; liquid option with acceptable spread and predefined risk.
- **Hypothetical PE:** Reverse the directional conditions; ADX alone has no bearish direction; if using DMI, −DI > +DI.
- **NO_TRADE:** Stale / zero volume, mixed trend signals, repeated VWAP crosses, poor premium liquidity, inadequate reward-to-risk, exhausted daily loss budget, or a setup not confirmed by a **completed** candle.

**Never buy simply because price crosses VWAP.** ADX 25 is a heuristic, not a validated probability threshold. ATR does **not** predict price direction. All parameters must be backtested on NIFTY option outcomes, including transaction costs, slippage, spreads and decay.

## What is included

The [full playbook](docs/KITE_NIFTY_FIVE_INDICATOR_PLAYBOOK.md) explains:

1. Opening Kite's TradingView chart, choosing the correct futures instrument and setting candles.
2. Installing and checking every one of the five indicators.
3. Choosing ADX vs DMI without double-counting indicator studies.
4. Saving and later verifying the chart layout.
5. How to interpret bullish, bearish, sideways and conflicting signals.
6. CE and PE entry confirmation, stop-loss, target, time exits and NO_TRADE gates.
7. Selecting ATM / slightly ITM options, liquidity, IV, delta and option-specific risks.
8. Worked paper-trade arithmetic for ₹50,000 / ₹100,000 accounts.
9. A reusable trade checklist, log template, failure scenarios and research-validation plan.
10. Official references and a clear distinction between examples and verified results.

## Operational status (visually checked 2026-10-19)

- **Chart observed and configured:** `NIFTY26OCTFUT` / NIFTY OCT FUT (NFO-FUT), **5-minute candles**, volume bars nonzero.
- **Five studies visible:** VWAP HLC3 Session (yellow); EMA9 close (blue); EMA21 close (purple); DMI DI length 14 / ADX smoothing 14 (+DI green, −DI red, ADX pink; optional DX and ADXR hidden); ATR length 14 (orange).
- **Kite layout renamed:** `NIFTY 5 Indicator Setup`. The layout menu showed **Save layout disabled** after renaming, consistent with no pending changes. Reopen/reload persistence was **not** independently verified.
- **Repository privacy:** public, and contains no credentials, broker account data, API tokens or trade receipts.
- **Order placement:** none; chart work and example orders are paper-only.
- These confirmations establish chart setup, **not profitable signals, a win rate, or live-order readiness**.

## Disclaimer

This repository is an educational research checklist, **not investment advice**, a validated high-win-rate trading system, or a signal service. Options are high risk and can lose the entire paid premium. No win rate or profit is promised. Do not trade based solely on these rules without independent verification and appropriate risk controls.
