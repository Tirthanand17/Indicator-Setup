# NIFTY Automatic Five-Indicator Paper Alerts — Chrome MV3 beta v0.2

**No manual indicator entry.** When the current-month NIFTY futures **5m TradingView chart is open in Zerodha Kite**, this local extension attempts to read *visible chart legend text* for Session VWAP (HLC3), EMA9, EMA21, DMI14/14 (+DI, −DI, ADX) and ATR14, as well as OHLC and visible volume. It uses read-only chart DOM text, **not OCR, scraping account records, broker API endpoints, session URLs or authentication tokens**. Nothing is sent to our servers. ₹0 budget. No subscriptions. No real order submission.

**Critical limitation:** the displayed legend ordinarily describes a **forming candle**. The extension captures a sample in the last 3.5 seconds of a 5m interval, then verifies a new-bar observation after the interval boundary. This gives a **near-close snapshot, not a formally confirmed OHLCV candle**. Alerts are therefore *potential CE/PE paper setup reviews*, never definitive buy/sell orders or verified tradable signals. The chart also has **no actual option BID/ASK, expiry, IV, lot size, or position fill**, so it cannot calculate genuine option P&L or stop execution.

## Files

- `manifest.json`: limited host permission and MV3 configuration. Content scripts apply to origin-matched nested **blob** TradingView frames.
- `reader.js`: strict text parser for displayed indicator values; rejects invalid/missing fields.
- `content.js`: read-only chart-frame observer; pauses when cursor is moving in the chart so a hover on an older candle will not be misinterpreted as current.
- `auto-engine.js`: session gating, near-close sampling, strength/direction and breakout filters, virtual futures stop/target logic.
- `auto-runner.js`: deterministic history and virtual candidate state transitions.
- `background.js`: observation ingestion, browser-local state, deduplicated desktop notifications; no network or order actions.
- `popup.html/js`, `dashboard.html/js`, `style.css`: automatic live chart health, readings, paper-candidate notifications and journal.
- `tests/`: pure JS unit tests.

## Installation or upgrade

1. Download or clone **only the extension folder** from the public repository: https://github.com/Tirthanand17/Indicator-Setup/tree/main/extension.
2. Unpack the folder somewhere stable (not inside Windows Desktop if you prefer). In Chrome open **chrome://extensions** and enable **Developer mode**.
3. If older unpacked `NIFTY Five-Indicator Paper Alerts` is installed, update its source files in the *same loaded folder*, then press **Reload** on its card. Avoid loading a second duplicate extension. Alternatively uninstall the old version and **Load unpacked** from the new folder.
4. Keep Zerodha Kite open to the **current-month NIFTY futures contract** (not the NIFTY spot index) with **five-minute candles**, chart on **TradingView**, Volume visible, Session VWAP HLC3, EMA9 close, EMA21 close, DMI14/14 showing exactly +DI / −DI / ADX, ATR14.
5. **Refresh the Kite chart tab after reloading the extension** so Chrome injects into the nested chart frame. The frame reader can take a few seconds to start.
6. Click the extension **N** button and **Open Auto Signal Dashboard**. Verify last-reading timestamp is recent and all prices/indicators match the chart. You **do not type indicator values manually**.
7. Keep **Auto Monitor** and **Desktop notifications** enabled. Use **Send TEST notification** to confirm OS/browser notifications work.
8. New CE/PE candidate messages can begin only after at least **four consecutive five-minute near-close observations** (roughly 20–25 minutes, unless sampling is paused or stale); this is intentional for research discipline. The chart must stay open and responsive.
9. Windows desktop alerts say **Possible BUY CE**, **Possible BUY PE**, or **Virtual CE/PE exit review**; the latter refers to a hypothetical chart-based candidate, *not* a Kite holding. No transaction is ever sent to the broker.

## Exact research conditions

- 5-minute futures price above VWAP, EMA9 > EMA21, +DI > −DI, ADX≥25 and rising, close above three prior near-close bars' highs, and close above the 20-minute-ago observation ⇒ **REVIEW_CE**.
- Reverse all directional rules for **REVIEW_PE** with close below three prior lows.
- Reject if within 0.1×ATR of VWAP, indicator or candle fields missing, underlying volume invalid, market not inside the supported session, ADX weakening or less than 25, a near-close sample is missed, market data stops changing, or the Chrome tab is throttled.
- **15-minute trend is only approximated from sampled 5-minute price history**, not independently calculated 15m EMA/DMI.
- If an illustrative virtual CE/PE candidate was recorded, a subsequent near-close bar passing futures price stop/target/reversal rules produces an **exit review**; this is **not** the price of the corresponding option.
- All thresholds, virtual stop/targets, and breakout logic are experimental. Win rate, expectancy and risk-adjusted performance are **not established**.

## Security

- No broker order APIs, payments, credential reading, cookies, URL fragments, analytics endpoints, page-script injection, OCR, external network requests or remote servers.
- `chrome.storage.session` holds sanitized in-memory chart readings and the virtual candidate; `chrome.storage.local` holds only settings, deduplicated alert keys, and an audit journal (max 150).
- The frame observer reads only `document.body.innerText` from the origin-matched nested chart and transmits a whitelist of numeric fields into the extension; it never forwards raw page text.
- Cursor interaction, data gaps, missing or suspicious prices and browser suspension all cause **WAIT_DATA** or **NO_TRADE**, never a fabricated signal.
- Chrome must be running; this does not provide phone alerts or a cloud-hosted, laptop-independent feed.

## Tests

Run `node --test tests/*.cjs`. These unit tests do not establish broker/chart compatibility or option strategy profitability. Before trusting alerts, visually verify that the live values in the dashboard **match the current Kite chart at the same timestamp**, especially at the five-minute boundary. Do not act on a notification without a separate actual option premium and risk check.

## Recommended production upgrade

For exchange-confirmed candles and real options exit alerts, use an explicitly authorized **read-only** market-data provider that supplies timestamped NIFTY futures OHLCV plus NIFTY option BID/ASK, then independently compute all indicators and validate option risks. No paid service is activated by this extension. Any broker execution would require a distinct, explicit authorization and robust risk controls.
