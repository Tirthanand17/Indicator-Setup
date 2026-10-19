# Zerodha Kite: Complete NIFTY 50 Five-Indicator Setup and CE/PE Paper-Trading Playbook

**Version:** 1.1 | **Date:** 2026-10-19 | **Scope:** NIFTY intraday directional **option buying** (CE / PE), not option selling.

> EDUCATIONAL AND PAPER-TRADING ONLY. None of the rules below has been established as the statistically best or most accurate setup for NIFTY. No live orders, broker API permissions or automation are implied. Option buyers may lose 100% of premium paid. Always inspect real spreads, fills, charges and slippage.

## Contents

1. [Prerequisites and instrument selection](#1-prerequisites-and-instrument-selection)
2. [Configure the chart](#2-configure-the-chart)
3. [Indicator 1 — Session VWAP](#3-indicator-1--session-vwap)
4. [Indicator 2 — EMA 9](#4-indicator-2--ema-9)
5. [Indicator 3 — EMA 21](#5-indicator-3--ema-21)
6. [Indicator 4 — ADX 14 / DMI](#6-indicator-4--adx-14--dmi)
7. [Indicator 5 — ATR 14](#7-indicator-5--atr-14)
8. [Save and verify](#8-save-and-verify)
9. [What every signal means](#9-what-every-signal-means)
10. [CE entry rules](#10-ce-entry-rules)
11. [PE entry rules](#11-pe-entry-rules)
12. [No-trade rules](#12-no-trade-rules)
13. [Option selection and execution realism](#13-option-selection-and-execution-realism)
14. [Stops, exits and position size](#14-stops-exits-and-position-size)
15. [Worked paper-trade examples](#15-worked-paper-trade-examples)
16. [Pre-trade checklist](#16-pre-trade-checklist)
17. [Daily workflow and journaling](#17-daily-workflow-and-journaling)
18. [Testing and dashboard metrics](#18-testing-and-dashboard-metrics)
19. [Troubleshooting](#19-troubleshooting)
20. [References](#20-references)

---

## 1. Prerequisites and instrument selection

**Equipment:** Zerodha Kite web (TradingView chart view), signed in normally. Do not share password, OTP, API key, account identifiers or screenshots of account balances with a public repository.

**Use a traded, liquid underlying for VWAP:**

1. Open https://kite.zerodha.com in your browser.
2. Open any chart from the watchlist. If it opens the ChartIQ renderer, switch to the available TradingView chart style as needed; menus may differ.
3. In the TradingView chart, click the instrument symbol/name at the **upper-left**.
4. Search for **NIFTY** and, if necessary, select the **NFO** source / futures filter.
5. Choose the **current-month NIFTY futures** contract (e.g. October 2026 contract on October 19, 2026; do **not** reuse a past-expiry contract later).
6. Confirm the chart subtitle says **NFO-FUT**, the expected expiry month is correct, and the volume study has nonzero data.
7. **Do not** calculate VWAP on an untraded NIFTY cash-index chart showing zero volume. A stock/index chart can show spot price structure separately, but a valid session VWAP requires traded volume.
8. Trading the option and trading futures are different. The futures chart is used here to analyze direction; **option buying, if ever authorized, uses the corresponding actual NIFTY CE/PE instrument**, not the futures contract.

**Why futures?** A spot index is a calculation rather than a tradeable security and often carries zero direct traded volume; VWAP requires volumes. NIFTY futures and spot differ by basis, so do not compare their absolute price levels as if identical.

## 2. Configure the chart

1. On the Kite chart toolbar, select **5m** from the timeframe dropdown. The chart may initially show 1m.
2. Use **Candlesticks** (chart-type icon) rather than a plain line.
3. Ensure the chart timezone is India Standard Time (IST, UTC+05:30).
4. Retain the volume bars under the chart to check traded volume.
5. Once the first chart is ready, occasionally switch to **15m** to inspect higher-timeframe swing direction. Return to **5m** before evaluating entry candles.
6. Allow the 5-minute candle to **close** before treating its signals as confirmed: for example, at 09:35 a 09:30–09:35 candle is complete. A candle still forming can reverse before its close.
7. Session times, market holidays and expiry rules can change; verify the relevant NSE market calendar.

**Suggested chart coloring:**

| Item | Suggested color or view | Goal |
|---|---|---|
| VWAP | Yellow | Distinguish intraday reference |
| EMA 9 | Blue | Fast trend line |
| EMA 21 | Purple | Slower trend line |
| DMI/ADX | Separate pane; ADX pink, +DI green, −DI red | Trend-strength/direction check |
| ATR | Separate pane; orange | Volatility measure |
| Candles | Green and red | Price action |
| Volume | Default bars | Confirm actual traded activity |

## 3. Indicator 1 — Session VWAP

**How to add / configure:**

1. Click **Indicators** or the fx indicator icon at the top.
2. Type **VWAP**.
3. Select **Volume Weighted Average Price (VWAP)**.
4. Hover over the newly added indicator label at the top-left of the chart and click its **settings/gear** icon.
5. In **Inputs**, use **Source = HLC3** (typical price = (High+Low+Close)/3), if shown. Choose **Anchor = Session** (a daily intraday reset), if offered.
6. In **Style**, turn on the VWAP plot, choose **Yellow**, and choose a visible line width.
7. Keep its price-scale label enabled if useful.
8. Click **OK** and confirm a colored line appears with a changing numeric VWAP value. A blank line plus zero volume indicates a data/symbol problem.

**What it tells you:** price higher than VWAP can support a bullish intraday bias; price lower than VWAP can support a bearish bias. Repeated crossings, especially within a narrow range, often signal chop rather than high-conviction trades.

**It does NOT mean:** every close above VWAP is a call buy; every close below VWAP is a put buy. The distance from VWAP, the latest closed candle, and actual option premium matter.

## 4. Indicator 2 — EMA 9

**How to add / configure:**

1. Click **Indicators**.
2. Search **Moving Average Exponential** or **EMA**.
3. Click the study.
4. Hover over its chart label and click **gear/settings**.
5. Under **Inputs**, set **Length = 9**, **Source = close**, **Offset = 0**.
6. If the dialog has a **Smoothed MA** checkbox under Style, leave it **off** for the base strategy (it is an optional extra smoothed line).
7. In **Style**, choose **Blue**.
8. Click **OK** and verify the label says **EMA 9 close 0**.

**Meaning:** fast, responsive average of recent closes. EMA 9 rising above EMA 21 suggests shorter-term momentum may be stronger; a single intrabar crossover is not confirmed.

## 5. Indicator 3 — EMA 21

**How to add / configure:**

1. Repeat **Indicators → Moving Average Exponential**; add a **second instance** of the study.
2. Open the **second** EMA's gear icon, not the first.
3. Under **Inputs**, set **Length = 21**, **Source = close**, **Offset = 0**.
4. Keep optional smoothed plot off; choose **Purple** under Style.
5. Click **OK** and verify you see **both** study labels: **EMA 9 close 0** and **EMA 21 close 0**.

**Meaning:** the slower of the two averages. If EMA 9 > EMA 21, the trend filter is bullish; if EMA 9 < EMA 21, bearish; repeated crossings are evidence of unstable direction.

**Important:** The two moving averages are technically **two indicator instances**. VWAP + EMA9 + EMA21 + ADX/DMI + ATR = **five studies**.

## 6. Indicator 4 — ADX 14 / DMI

**A key distinction:** ADX measures **trend strength**, not whether that trend is bullish or bearish. A standalone **Average Directional Index (ADX)** on TradingView generally plots only ADX. **Directional Movement (DMI)** plots ADX, +DI and −DI in one study. For determining CE vs PE, **DMI is preferable if it is available on your Kite chart.** Use **ADX or DMI, not both**, to maintain five studies.

### Preferred and actually installed: DMI (ADX + direction in one pane)

1. Click **Indicators**.
2. Search **Directional Movement**, **DMI** or **Directional Movement Index**.
3. Select **Directional Movement** if Kite exposes it.
4. Open settings. Set **DI Length = 14** and **ADX Smoothing = 14**, where both are offered.
5. On the observed Kite TradingView DMI, there are **five available plots**: **+DI, −DI, DX, ADX, ADXR**. Leave **+DI, −DI and ADX checked**. **Uncheck DX and ADXR** to simplify the study, while retaining ADX calculation.
6. For visual clarity: set **+DI green, −DI red and ADX pink**. Click **OK**. The Kite Inputs panel was observed to offer both **DI Length = 14** and **ADX Smoothing = 14**.
7. Inspect the separate pane: strength (ADX) and which DI line is on top should be readable.

### Fallback: standalone ADX

1. If DMI is unavailable, search **Average Directional Index**.
2. Select it and set **Length = 14** or **ADX Smoothing = 14**, according to Kite's exposed inputs.
3. Display the ADX plot in a separate pane.
4. **Without DI values, do not claim ADX by itself proves bullish or bearish direction.** Use price relative to VWAP and EMA arrangement instead, or seek an equivalent DMI display later.

### Reading ADX / DMI

| Observation | Tentative interpretation |
|---|---|
| ADX below 20 | Weak/trendless: high caution for trend-following entries |
| ADX 20–25 | Transitional: demand exceptionally clear price confirmation |
| ADX above 25, rising | Stronger trend may be present; direction still needs confirmation |
| ADX above 25, falling | Trend strength may be fading; evaluate exits / tightening |
| +DI above −DI (if DMI visible) | Bullish directional movement dominates |
| −DI above +DI (if DMI visible) | Bearish directional movement dominates |

**The 20/25 thresholds are unoptimized reference heuristics, not calibrated winning probabilities.** ADX can rise in a sharp selloff; never label a high ADX as automatically bullish.

## 7. Indicator 5 — ATR 14

**How to add / configure:**

1. Click **Indicators**.
2. Search **Average True Range** or **ATR**.
3. Select **Average True Range**.
4. Open its gear icon. Set **Length = 14**. Use the standard smoothing default unless testing another one.
5. Under Style, choose **Orange** or another clearly visible color.
6. Keep the ATR in its **own pane** below price; click **OK**.
7. Confirm the numeric value is present on the 5-minute futures chart.

**Meaning:** ATR approximates the underlying's recent range / volatility in **underlying price points**, not in rupees of option profit and not in probability terms.

**Example:** if five-minute futures ATR = 32 points, then a 1.0 × ATR buffer represents 32 **futures points**. This does **not** mean the CE/PE premium will move ₹32. Premium changes depend on delta, gamma, theta, vega, IV, expiry, and liquidity.

**ATR does not tell direction.** ATR often rises during **both** sharp upward and sharp downward moves.

## 8. Save and verify

**Observed configuration on 2026-10-19:** The `NIFTY26OCTFUT` chart showed all five studies, 5-minute candles, nonzero volume, and DMI plotted in one lower pane plus ATR 14 in another. The layout was renamed from `VWAP Chart` to **`NIFTY 5 Indicator Setup`**. On the subsequent layout-menu inspection, **Save layout** was disabled (consistent with no unsaved changes). A manual re-open or reload confirmation **was not completed**; verify persistence on the next visit. The following steps are instructions for independent repeatability.

1. Inspect all five studies' labels on the chart and lower panes.
2. Click **Save** in the upper-right of Kite's TradingView toolbar.
3. If prompted, select/save an appropriately named layout such as **NIFTY-5M-VWAP-EMA9-EMA21-DMI14-ATR14**.
4. If the chart supports a named layout, use the dropdown next to Save and select it.
5. After saving, refresh or reopen the chart and **confirm** the same symbol, 5-minute timeframe, and studies remain. **Do not assume Save worked without verification.**
6. Change to the **15m** chart for confirmation, then back to **5m**, checking that the layout persists.
7. Keep the browser tab containing Kite open; no need to open an order window.
8. Later in a new contract month, open the **new current-month futures contract** and re-check indicator data; do not trade from a stale expired symbol.

## 9. What every signal means

| Signal | Bullish context | Bearish context | Reason to skip |
|---|---|---|---|
| Price vs VWAP | 5m close above | 5m close below | Repeated crosses / no line |
| EMA 9 vs EMA 21 | 9 > 21 and preferably rising | 9 < 21 and preferably falling | Tight intertwined / crossing |
| ADX / DMI | ADX rising >25, +DI > −DI | ADX rising >25, −DI > +DI | Low ADX, wrong DI direction |
| ATR 14 | Allows structured volatility-buffered stop | Same | Stops too wide vs budget; ATR unreliable |
| 15m trend | Higher highs/higher lows, support | Lower highs/lower lows, resistance | Opposes 5m setup |
| Option instrument | Liquid CE | Liquid PE | Wide spread, high IV risk, bad fill |

A **fully aligned** setup improves *signal discipline* but is **not** proof of a higher win rate. Indicators can overlap statistically; more confirmations can also make entries late.

## 10. CE entry rules

A hypothetical **CALL BUY** candidate must pass all gates:

**Data and timing gates**
1. Market is open with genuine live price, continuous 5m candles and nonzero traded futures volume.
2. No stale price sequence, out-of-order timestamp, zero-volume fake bar, future-dated bar, or missing option quote.
3. As a research starting convention, avoid the very first opening minutes (e.g. begin new entries at 09:30 IST); test this rule, do not treat it as universal.

**Directional gates**
4. A fully completed **5-minute futures candle CLOSES above session VWAP**.
5. **EMA 9 > EMA 21**; both reasonably directional, not churning around VWAP.
6. **ADX >= 25 and rising** over recent completed readings. If DMI: **+DI > −DI**.
7. The 15m swing structure does not clearly contradict the bull trade.
8. Prefer either (a) breakout above a recent swing high **then a retest that holds**, or (b) a VWAP/EMA support retest that closes bullish.
9. Avoid entering when price has sprinted so far above VWAP that the nearest valid stop is too costly relative to a sensible target.

**Execution and risk gates**
10. A real eligible **NIFTY ATM or slightly ITM CE** shows live bid/ask, sufficient depth, and reasonable spread.
11. The selected option is not disqualified by unexpectedly high IV, imminent expiry/time decay, or a poor fill.
12. A pre-defined underlying invalidation and **option-premium exit plan** exist, with enough potential reward **after all costs**.
13. Available capital and lot size permit the defined maximum loss. If not, **NO_TRADE**, even if the chart is bullish.

**Example trigger:** after a completed bullish breakout, consider a paper entry on confirmation (e.g. next candle showing hold above breakout/retest) using the **actual quoted option ASK** plus realistic slippage. Never invent fills from the underlying alone.

## 11. PE entry rules

A hypothetical **PUT BUY** candidate is symmetric:

1. Valid market session, timestamps, volume, completed candle and live option quotes.
2. **5m futures close below session VWAP**.
3. **EMA 9 < EMA 21** and downward momentum is reasonably consistent.
4. **ADX >= 25 and rising**; if DMI is used, **−DI > +DI**.
5. 15m bearish or at least non-conflicting structure.
6. A completed breakdown below recent support or rejection from VWAP / EMA resistance; preferably a failed retest.
7. Avoid chasing a far-extended breakdown when risk-to-stop is too large.
8. Select a liquid ATM or slightly ITM **PE**, validate IV and spread, determine invalidation, stop, target and lot-size affordability.
9. Log a hypothetical fill using option ASK + slippage, and a hypothetical sale on BID − slippage.

**A high ADX alone is not a put signal.**

## 12. No-trade rules

Flag **NO_TRADE** whenever any of these holds:

- The underlying is a zero-volume spot/index chart on which session VWAP is invalid or absent.
- A price feed is stale, has repeated identical captures suspiciously, timestamps inconsistent, candles missing, or broker quotes are unreliable.
- VWAP and EMA directional signals disagree; EMA 9/21 cross repeatedly; price oscillates around VWAP.
- ADX is weak or DMI lines show direction opposite to the proposed option trade.
- The 15m chart clearly opposes the direction.
- No completed trigger candle exists.
- Current price is too extended from the planned stop or target; gap/news risk is unacceptably high.
- Bid/ask spread or liquidity is poor; IV/expiry creates unfavorable premium risk.
- Risk budget cannot fit **one actual exchange lot** with expected costs.
- The daily loss limit, time cutoff or max failed trades has been reached.
- A planned target cannot plausibly exceed risk after costs.

Never demand **three trades every day**. A zero-trade day is valid if criteria were not satisfied.

## 13. Option selection and execution realism

**Option type and strike**
- Bullish underlying setup -> study an **ATM or slightly ITM CE**.
- Bearish setup -> study an **ATM or slightly ITM PE**.
- For experiments, a delta magnitude around **0.45–0.65** may be screened first; this is not a universally optimal delta.
- Verify strike availability, the listed exchange lot quantity, and contract expiry on the **actual Kite option chain**; both evolve and should never be hard-coded.

**What to inspect**
- Market depth and bid-ask spread; as an initial candidate filter, research spreads <=1–2% of premium, but adapt this to liquidity and volatility.
- Implied volatility relative to prior sessions, upcoming events and expiry. Buying when IV is inflated can lose despite a correct underlying move.
- **Theta** (time decay), **delta** (first-order underlying sensitivity), **gamma** (delta change), and **vega** (IV sensitivity).
- Current option ASK for **buy** estimation; current option BID for **sell** estimation. Never paper-fill at last traded price alone.
- Brokerage, exchange and regulatory charges, GST, stamp duty, STT treatment, bid-ask spreads, and slippage.

**Note:** Trading futures price direction does not fix option profits. An option can lose value on an up move due to IV crush, passage of time or poor entry price. Expiry-day trades are particularly sensitive to timing and liquidity; benchmark them separately.

## 14. Stops, exits and position size

**Step A — underlying invalidation**
- CE: identify the most recent logically relevant swing low, VWAP hold/retest failure or clear reversal.
- PE: identify swing high, rejected resistance, or confirmed recovery above invalidation level.
- As an *experiment*, buffer the underlying invalidation by **0.5–1.0 × 5m ATR**, but never set an arbitrary buffer just to fit a preferred risk budget.
- Decide before entry what candle confirmation constitutes invalidation.

**Step B — option-premium risk**
- Define an actual **premium exit** and a worst-case monetary-loss budget. An underlying stop alone cannot guarantee a premium fill.
- The premium stop can be based on projected premium at underlying invalidation but should be verified against observed option Greeks and its own chart.
- Option premium can gap through a stop. Realized loss may exceed planned loss under fast conditions.

**Step C — affordability**
- Initial research risk budget: **0.5% to 1% of allocated capital** per trade, including an allowance for transaction costs. This is a conservative *hypothesis*, not a universally safe risk limit.
- Let C = capital, r = risk fraction, E = expected option **buy fill**, S = planned option **sell fill at stop**, L = exchange lot quantity, k = expected total costs for the lot.
- **Risk budget B = C × r.**
- **Estimated one-lot risk = (E − S) × L + k.**
- **One-lot capital outlay = E × L + charges.**
- **Maximum whole lots = floor(min(B / estimated one-lot risk, available_capital / one-lot outlay)).** Round **down**; if fewer than one, **NO_TRADE**.
- Real fills can be worse than these calculations. No scaling up after losses.

**Step D — exit conditions**
1. **Stop exit:** execute the paper exit immediately when invalidation or premium stop rules trigger.
2. **Profit exit:** use predefined target from chart structure and realistic option-premium reward; a **>=1.5R net reward-to-risk** is one sensible initial filter, **not a guarantee**.
3. **Time exit:** no new entries near a predetermined session cutoff (e.g. 15:00 IST in research), and flatten remaining **intraday** paper positions before market close.
4. **Signal reversal exit:** sustained closed-candle break of VWAP/EMA arrangement; never rely solely on a flickering tick.
5. **Risk exit:** end paper trading for the day after the predetermined maximum daily loss or consecutive valid losing trades.

A fixed 10–20% option premium stop is **not automatically valid** for every strike or expiry. Premium stops must be tested and sized for the position.

## 15. Worked paper-trade examples

**All prices, indicator readings, fills and lot sizes below are fabricated teaching examples; they are not trading signals, actual live quotes or verified profitable historical trades.**

### Example A — hypothetical CE candidate

| Variable | Example |
|---|---|
| Futures last completed 5m close | 23,140 |
| Session VWAP | 23,086 |
| EMA 9 / EMA 21 | 23,117 / 23,109 |
| ADX | 27 and rising |
| DMI (if chosen) | +DI 29 / −DI 15 |
| 5m ATR | 31 futures points |
| Price structure | Bullish breakout + successful retest |
| Actual instrument considered | Liquid NIFTY ATM/ITM CE, correct listed expiry |
| Hypothetical option entry ASK+slippage | ₹120 per unit |
| Planned option exit fill at stop | ₹112 per unit |
| Planned target sale fill | ₹138 per unit |
| **Illustrative lot size ONLY** | **50 units** (NOT a claim about the current NSE lot size) |
| Premium outlay | ₹120 × 50 = ₹6,000 |
| Gross stop risk | (₹120−₹112) × 50 = **₹400** |
| Gross target gain | (₹138−₹120) × 50 = **₹900** |
| Gross reward / risk | 900 / 400 = **2.25R** |

At **₹50,000** capital and a **1%** research risk cap, the theoretical maximum is ₹500. With this made-up 50-unit contract, estimated all-in costs must be <=₹100 for the one lot to remain inside that theoretical cap. Replace lot size, actual fills and all costs with verified values before recording any real paper fill. A stop fill is not guaranteed.

### Example B — hypothetical PE candidate

| Variable | Example |
|---|---|
| Futures 5m closed below VWAP | Yes |
| EMA 9 vs EMA 21 | EMA 9 below EMA 21 |
| ADX | 30 and rising |
| DMI | −DI 31 > +DI 14 |
| Price structure | Rejection after failed VWAP retest |
| Hypothetical PE entry fill | ₹150 |
| Hypothetical option stop fill | ₹140 |
| Hypothetical target fill | ₹175 |
| Illustrative quantity | 50 units — dummy only |
| Gross stop risk | (150−140)×50 = **₹500** |
| Gross target gain | (175−150)×50 = **₹1,250** |
| Gross ratio | **2.5R** before costs |

For **₹50,000**, this already consumes the entire 1% risk budget before brokerage, so **NO_TRADE** under a strict all-in 1% cap. For **₹100,000**, a 1% cap is ₹1,000 but price structure, real lot size and costs still must pass. No assumption of profitability follows.

### Example C — NO_TRADE despite bullish indicators

- Price is above VWAP and EMA9 > EMA21, but ADX is 14 and price has crossed VWAP four times in 30 minutes.
- The nearest structural stop is far from current price and option spread is unusually wide.
- **Decision: NO_TRADE.** Do not force a CE because two lines are bullish.

## 16. Pre-trade checklist

Check every relevant item **before** marking a paper entry:

- [ ] Current trading day and correct IST exchange session, not a holiday.
- [ ] Correct **current-month NIFTY futures** symbol; the chart is 5m candles.
- [ ] Valid fresh data: price, timestamp, completed candle, nonzero volume, no stale sequence.
- [ ] Session VWAP line and value present.
- [ ] EMA 9 and EMA 21 have correct periods; no accidental duplicate EMA9.
- [ ] ADX or DMI is length 14; if DMI, ADX smoothing 14 and DI length 14.
- [ ] ATR is length 14 and its value is plausible.
- [ ] Higher timeframe (15m) agrees or is non-conflicting.
- [ ] CE or PE directional gates and price action trigger confirmed on a CLOSED candle.
- [ ] Choppiness, news/gap, overextension and expiry risks assessed.
- [ ] Actual option strike, type, expiry, lot size and liquid market depth verified.
- [ ] ASK for entry and BID for exit are available; premium, IV, delta, theta, spread examined.
- [ ] Underlying invalidation, option-premium stop, realistic target and session exit defined.
- [ ] Whole-lot quantity respects risk and capital budgets after estimated all-in charges.
- [ ] Broker execution disabled / paper-only mode where using an automated research agent.
- [ ] Log entry or NO_TRADE reason with timestamps and decision evidence.

## 17. Daily workflow and journaling

**Before 09:15 IST:**
- Check exchange calendar, economic/event announcements, contract expiry date, available capital, daily loss limit, symbol expiry month and data integrity. Confirm paper-only broker execution mode.
- Reopen the saved layout and verify all five indicator labels and 5m timeframe.
- Note major previous-day highs/lows and 15m support/resistance. Do not invent overnight signals.

**09:15–09:30:** observe opening-range formation and quality of live candles. A 09:30 start for new trades is a testable research convention rather than a verified optimal entry window.

**During the session:** on every *completed* five-minute candle, evaluate the checklist. If valid, record proposed direction, signal price, actual option quote, lot-size calculation and planned exit. For invalid setups, record a structured NO_TRADE reason. Do not trigger orders.

**Before close:** flatten simulated intraday positions at a realistic quote; record all costs, slippage and any data problems. Never relabel a missed trade as filled.

**After close:** reconcile every hypothetical entry/exit, compute gross/net P&L, risk metrics and results broken down by signal type, hour, expiry proximity and market regime.

**Journal fields (CSV-compatible):**

| Date IST | Time IST | Futures symbol | Signal | VWAP | EMA9 | EMA21 | ADX | +DI | −DI | ATR | 15m trend | Strike/type/expiry | Lot size | ASK entry | BID exit | Stop | Target | Costs | Net P&L | R result | Reason / data flag |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

For ADX-only studies, mark +DI and −DI as **not available** rather than assuming values. Store provenance of quotes and timestamps.

## 18. Testing and dashboard metrics

Test hypotheses, not anecdotes. Compare:

- **A:** VWAP + EMA9/21 baseline.
- **B:** Baseline + ADX/DMI filter.
- **C:** Baseline + ADX/DMI + ATR-based invalidation/stop approach.

**Dataset requirements:** historical NIFTY futures OHLCV and corresponding time-aligned historical NIFTY CE/PE executable bid/ask or depth snapshots. Ensure contract changes, expiry, strike mappings, timezones and missing data are handled correctly. A futures backtest **alone** cannot establish an options-strategy win rate.

**Design:**
1. Define unambiguous entry and exit rules **before** seeing holdout results.
2. Use walk-forward chronological train/validation/test periods with no look-ahead, repainting or selection bias.
3. Include market open/close liquidity, spread, slippage, brokerage/charges and option time decay / IV behavior.
4. Segment by trending vs sideways market, expiry vs non-expiry, CE vs PE, week/month, bullish vs bearish sessions.
5. Avoid cherry-picking thresholds (ADX 20/25, ATR multiplier, timeframe, expiry) from the same holdout.
6. Seek at least 100–200 resolved **out-of-sample option trades per variant** where feasible; more are preferable, but enough data and regime diversity matter more than a rigid count.
7. Report error bars / sample counts; reject conclusions based on small samples.

**Scoreboard columns:** signals examined, trade count, rejected/NO_TRADE count, win%, gross return, **net expectancy after costs**, profit factor, max drawdown, volatility of R, average win/loss, time in trade, expiry segment, slippage per leg, liquidity failure rate, stale-data incidents, realized-vs-assumed fills, and calibration drift.

**What constitutes improvement?** Better **net** expectancy and acceptable drawdown with stable holdout performance; a superficially higher win rate with large average losses does not qualify.

## 19. Troubleshooting

| Problem | Likely issue | Action |
|---|---|---|
| VWAP says unavailable or no visible line | Symbol is index with zero direct traded volume, or data incomplete | Switch to liquid current-month NIFTY futures, confirm nonzero volume and reset/inspect VWAP |
| Five studies but EMA9 duplicated | Second EMA left at default 9 | Open second EMA settings, change **Length to 21**, save |
| ADX high but market falling | ADX measures strength only | Use futures/VWAP/EMAs and **DMI −DI/+DI** for direction |
| ADX missing +DI/−DI | Standalone ADX study | Replace with **Directional Movement (DMI)** where available |
| ATR jumps suddenly | Genuine opening gap, corrupted bar, or event volatility | Inspect underlying data; do not use ATR value mechanically |
| Chart confusing | Too many plots on candles | Place DMI/ADX and ATR in separate panes, apply contrasting colors |
| Layout missing after reload | Layout not saved or wrong layout/symbol | Reapply studies, press Save, select saved layout and verify |
| Symbols old/expired | Contract-month rollover | Search current NFO-FUT contract, verify expiry and volume |
| Strong chart setup but option losing | IV crush, theta decay, bid/ask spread or slippage | Examine actual option market and net P&L, not just futures direction |
| Agent says NO_TRADE all day | May be correct or a faulty data/heartbeat pipeline | Distinguish no valid setup from stale-data, candle, contract or quote integrity failures |
| Stops frequently triggered | Over-tight invalidation / high ATR / chase entries | Test structural stops, costs and reasonable option premium risk, do not loosen after losses |

## 20. References

- TradingView — **Directional Movement (DMI)** (includes ADX, +DI, −DI; interpretation and 14-length defaults): https://www.tradingview.com/support/solutions/43000502250-directional-movement-dmi/
- TradingView — **Average Directional Index (ADX)** (standalone ADX vs DMI): https://www.tradingview.com/support/solutions/43000589099-average-directional-index-adx/
- TradingView — **Average True Range (ATR)** (volatility, not direction): https://www.tradingview.com/support/solutions/43000501823-average-true-range-atr/
- Zerodha Support — **TradingView multichart layouts and saving**: https://support.zerodha.com/category/trading-and-markets/charts-and-orders/charts/articles/view-multiple-charts-in-tradingview
- Zerodha Kite (actual broker chart): https://kite.zerodha.com/
- NSE India: https://www.nseindia.com/ (consult active listed instrument specs, trading hours, holidays, corporate/exchange circulars and lot quantities).

**Maintenance:** Kite/TradingView menus and contract specifications can change. Always verify the screen's current labels. The numeric thresholds and entry/exit rules above are **testable hypotheses** for a paper-research system, not proven live-edge claims.

---

**Last documentation update:** 2026-10-19. **Kite visual checks were performed separately from this GitHub commit:** all five studies were present on the observed browser chart and the named layout showed no pending save action; persistence after browser reload has not been verified. Documentation alone is never evidence of a profitable strategy or live-order execution.
