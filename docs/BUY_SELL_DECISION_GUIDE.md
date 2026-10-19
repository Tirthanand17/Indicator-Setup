# NIFTY 50 Option Buying & Selling: Practical Five-Indicator Decision Guide

**Chart configuration:** NIFTY current-month futures, 5-minute candles; confirm 15-minute context. **Studies:** Session VWAP (yellow), EMA 9 (blue), EMA 21 (purple), DMI 14/14 (+DI green, −DI red, ADX pink), ATR 14 (orange). Full installation guide: [Five-indicator playbook](KITE_NIFTY_FIVE_INDICATOR_PLAYBOOK.md).

> **Educational, paper-trading only.** This is a checklist, not an automatic buy/sell signal or a verified profitable strategy. Trading options carries substantial risk, including potential loss of all premium. The thresholds described below are research hypotheses; they have not been demonstrated to provide the highest NIFTY win rate.

## 1. Read each indicator correctly

| Study | Bullish interpretation | Bearish interpretation | Caution |
|---|---|---|---|
| Session VWAP (yellow) | **Completed** five-minute futures candle closes above VWAP | Completed five-minute futures candle closes below VWAP | Prices oscillating around VWAP imply weak confidence; VWAP requires genuine traded volume |
| EMA 9 (blue) vs EMA 21 (purple) | EMA 9 **above** EMA 21 | EMA 9 **below** EMA 21 | Crossing / near-overlapping averages frequently whipsaw; wait for candle close |
| DMI **+DI** (green) vs **−DI** (red) | +DI > −DI | −DI > +DI | The directional lines say which side is stronger; ADX alone **does not** |
| DMI **ADX** (pink) | ADX preferably **above 25 and rising** | Same criterion, independent of direction | ADX 20–25 is transitional and <20 often weak; neither threshold is calibrated for NIFTY options |
| ATR 14 (orange) | Used to plan reasonable **futures-price** invalidation | Same | ATR measures range/volatility, **not** trend direction or option-premium movement |

## 2. When should I BUY a CE (call)?

Treat this as a candidate **only when all mandatory checks pass**.

1. Verify market open, fresh futures/option quotes, valid time stamps, and nonzero current-month NIFTY futures traded volume.
2. After the full **5-minute candle closes**, check that futures price is **above VWAP**.
3. Confirm **EMA 9 > EMA 21** without repeated flip-flops.
4. Confirm **+DI > −DI** and **ADX >= 25, preferably rising**.
5. Verify a bullish structure: a **completed** breakout above a recent swing high, preferably with a successful retest, or a bullish VWAP/EMA support retest. Check the **15-minute** context is not clearly bearish.
6. Before paper entry, inspect the **actual listed NIFTY CE contract**: strike, expiry, market depth, implied volatility, lot size, spread, entry ask, likely sell bid, premium stop and prospective net reward. Avoid buying extremely far from support or into a wide spread.
7. If any required check fails, **NO_TRADE**. If all pass, only **consider** a CE paper trade using the option quote, not the futures value as its fill.

**Do not** buy every time the price briefly crosses VWAP; one green candle is not enough.

## 3. When should I BUY a PE (put)?

Use the symmetric **bearish** checklist.

1. Fresh valid futures and option market data; market is open.
2. A complete 5-minute candle **closes below VWAP**.
3. **EMA 9 < EMA 21** and no choppy back-and-forth.
4. **−DI > +DI** and **ADX >= 25, preferably rising**.
5. Bearish structure: completed break of swing support or a failed retest / rejection below VWAP. The 15-minute context is not clearly bullish.
6. Inspect a liquid, listed NIFTY **PE** and build an affordable premium stop/target plan that accounts for bid/ask, expiry, IV and costs.
7. If every gate passes, **consider a PE paper entry**; otherwise **NO_TRADE**.

**Never** interpret high ADX alone as bearish. It only measures strength.

## 4. When do I SELL?

Here, **SELL means exiting an existing purchased option** (CE or PE), NOT initiating an uncovered short option position.

| Exit event | What to do |
|---|---|
| Defined **option-premium stop** is reached | Paper-sell to close; actual fast-market fills may be worse than planned |
| Futures crosses a predeclared **underlying invalidation level** | Exit according to the written trade plan; monitor premium and spread |
| Predeclared **profit target** is reached | Paper-sell to close; record realistic **bid** fill less slippage |
| A **completed candle** shows a convincing adverse trend reversal | Evaluate the rule-based exit; do not wait indefinitely for target |
| Intraday time cutoff, max daily loss or risk breach | Close hypothetical intraday positions according to preset controls |

A loss cap and exit plan are necessary **before** buying an option. ATR does not directly define a stop in rupees of option premium.

## 5. ATR stop-distance example

If five-minute futures **ATR = 43 points**, a purely illustrative **0.5× ATR buffer = 21.5 futures index points**, and **1.0× ATR buffer = 43 futures index points**. Locate the relevant swing low/high or VWAP invalidation first; consider an ATR buffer as a testable variant, **not** as a guaranteed safe level.

Option premium movement is different: delta, gamma, theta, implied-volatility changes, expiry and bid/ask determine the realistic potential entry/exit. A ₹43 premium stop is **NOT** implied by a 43-point futures ATR.

**Hypothetical premium example:**

- One lot's assumed option purchase fill: ₹120/unit.
- Planned exit fill: ₹110/unit; target exit fill: ₹140/unit.
- **Illustrative 50-unit lot ONLY** (not a statement of the current NSE contract lot size): gross planned stop risk = (120−110)×50 = **₹500**; gross planned reward = (140−120)×50 = **₹1,000**; gross reward:risk **2:1**.
- All-in charges and slippage reduce this ratio. If a ₹50,000 account sets a maximum **1% risk = ₹500**, the above hypothetical lot **fails** once any positive transaction costs are included. Record **NO_TRADE** unless the plan genuinely meets the budget. Verify actual lot size and eligibility on Kite.

## 6. NO_TRADE is a real trading decision

Skip the trade when:

- Market data stale, duplicate/stalled timestamps, missing futures candles, nonexistent/zero traded volume or unreliable option quotes.
- Price crosses VWAP repeatedly or sits almost on top of it.
- EMA direction conflicts with VWAP or +DI/−DI.
- ADX is below your predefined strength requirement (if the strategy uses 25, 22 does **not** pass).
- Trigger candle not closed, price structure or 15-minute direction conflicts, or price has run too far from a sensible stop.
- Poor option market liquidity, excessive spread, uncertain IV/expiry risk, insufficient net reward:risk, actual lot too large, or loss budget breached.

There is **no obligation to take three trades daily**. Even aligned indicators are not proof that a CE or PE will earn money.

## 7. Worked interpretation of the actual chart observed earlier

**Historical chart snapshot: 2026-10-19 at approximately 10:33 AM IST** on the 5-minute NIFTY October futures chart. Values are transcribed from the observed Kite display at that time; **these are NOT live prices now and are NOT a recommendation**.

| Measurement | Observed |
|---|---:|
| Futures price | 23,087.00 |
| Session VWAP | 23,086.26 |
| EMA 9 | 23,090.60 |
| EMA 21 | 23,096.28 |
| +DI (green) | 16.62 |
| −DI (red) | 20.86 |
| ADX (pink) | 22.35 |
| ATR 14 (orange) | 43.14 futures points |

**Decision under the candidate rules: NO_TRADE.** Although EMA9 < EMA21 and −DI > +DI suggested a tentative bearish bias, futures price was about **0.74 points above VWAP**, ADX **22.35** was below the proposed **25** threshold, and the 10:30–10:35 candle was not yet complete. Therefore **neither** candidate checklist was satisfied. The snapshot does not reveal the option's bid/ask, its expiry/IV, or its risk budget; a filled PE or CE must **not** be inferred.

## 8. Practice three hypothetical cases

| Case | Price vs VWAP | EMA9 vs EMA21 | DI direction | ADX rising | Completed candle + 15m | Model response |
|---|---|---|---|---|---|---|
| A | Above | EMA9 > EMA21 | +DI > −DI | 28 | Bullish breakout/retest | **Potential CE** pending actual-option risk checks |
| B | Below | EMA9 < EMA21 | −DI > +DI | 31 | Bearish breakdown/retest | **Potential PE** pending actual-option risk checks |
| C | Around VWAP | EMA9 < EMA21 | −DI > +DI | 22 | Unconfirmed | **NO_TRADE** |

For a changeable version of this practice exercise, open [offline rule checker HTML](signal-practice-checker.html) locally. On GitHub, view the file via **Raw** / download, then open it in a browser; GitHub's source-code viewer will not run its JavaScript. The checker is **not connected to Kite** and intentionally cannot place orders.

## 9. Five-minute repeatable routine

1. Observe live, **completed** futures candles rather than fast-changing intrabar lines.
2. Identify price location vs VWAP and EMA arrangement; check DMI directional lines and ADX.
3. Check a breakout/retest and a 15-minute context check.
4. Use ATR plus structure to mark futures invalidation; independently define maximum acceptable **option premium loss**, target and a session exit.
5. Review real option market depth, strike, expiry, premium, IV, delta, transaction costs and allowed risk.
6. **BUY CE candidate / BUY PE candidate / NO_TRADE**, never automatic order placement.
7. If in a paper trade, **SELL to exit** at stop/target/invalidation/closing cutoff; log time-stamped quotes, spread, slippage, net P&L and rule adherence.

## 10. Validation before real-money use

The five studies are not statistically independent. Backtest actual NIFTY **option** quotes, not just futures candles, over multiple market regimes; avoid look-ahead and include realistic spreads, fees and slippage. Measure *net* expectancy, average win and loss, profit factor and drawdown, not only winning percentage.

See the [full guide](KITE_NIFTY_FIVE_INDICATOR_PLAYBOOK.md) for installation instructions, expiry risk, one-lot sizing, the paper-trade journal and testing framework.

**Last updated: 2026-10-19.**
