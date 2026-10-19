# NIFTY Automatic Five-Indicator Paper Alerts — Chrome MV3 beta v0.3

**No manual indicator entry.** When the current-month NIFTY futures **5m TradingView chart is open in Zerodha Kite**, this local extension attempts to read *visible chart legend text* for Session VWAP (HLC3), EMA9, EMA21, DMI14/14 (+DI, −DI, ADX) and ATR14, as well as OHLC and visible volume. It uses read-only chart DOM text, **not OCR, scraping account records, broker API endpoints, session URLs or authentication tokens**. By default the original chart reader and desktop notifications remain local. **Optional Telegram phone alerts** transmit only paper-alert summaries to Telegram's servers **after you explicitly pair a bot**; no credentials, brokerage account data or raw Kite page URLs are transmitted. ₹0 integration. No new paid subscriptions or real order submission.

**Critical limitation:** the displayed legend ordinarily describes a **forming candle**. The extension captures a sample in the last 3.5 seconds of a 5m interval, then verifies a new-bar observation after the interval boundary. This gives a **near-close snapshot, not a formally confirmed OHLCV candle**. Alerts are therefore *potential CE/PE paper setup reviews*, never definitive buy/sell orders or verified tradable signals. The chart also has **no actual option BID/ASK, expiry, IV, lot size, or position fill**, so it cannot calculate genuine option P&L or stop execution. Even after Telegram is paired, these alerts are **reviews**, not precise actionable option prices.

## Files

- `manifest.json`: limited host permission and MV3 configuration. Content scripts apply to origin-matched nested **blob** TradingView frames.
- `reader.js`: strict text parser for displayed indicator values; rejects invalid/missing fields.
- `content.js`: read-only chart-frame observer; pauses when cursor is moving in the chart so a hover on an older candle will not be misinterpreted as current.
- `auto-engine.js`: session gating, near-close sampling, strength/direction and breakout filters, virtual futures stop/target logic.
- `auto-runner.js`: deterministic history and virtual candidate state transitions.
- `background.js`: observation ingestion, browser-local state, deduplicated desktop notifications, and **opt-in** Telegram outbound notifications. No broker network or order actions.\n- `telegram.js`: one-time private-chat pairing and Telegram Bot API message formatting; no logging of bot tokens or personal chats.
- `popup.html/js`, `dashboard.html/js`, `style.css`: automatic live chart health, readings, paper-candidate notifications and journal.
- `tests/`: pure JS unit tests.

## Phone alerts: Telegram connection (requires your opt-in)\n\nYou can receive NIFTY paper-review alerts as **Telegram messages on Android or iOS**, without manually entering indicator numbers. This requires a Telegram bot created by you; the Chrome extension must stay running alongside the Kite chart. Telegram may delay delivery, and it does not guarantee the market price at the time you open a notification. **GitHub notifications are not used for time-critical trade alerts.**\n\n1. Install Telegram on your phone, allow notifications, disable mute for the bot's chat, and consider turning off battery optimization for Telegram if messages are delayed.\n2. In Telegram, visit **https://t.me/BotFather** (the official verified bot), send `/newbot`, set a bot name and unique username, and receive the **bot token**. **Never paste the token in GitHub, ChatGPT, or any screenshot.**\n3. On Nirala, open the `N` Chrome extension → **Open Auto Signal Dashboard** → **Phone notifications — Telegram**.\n4. Click **Generate pairing code**. In your new Telegram bot's PRIVATE CHAT, send exactly `/start PAIRING_CODE`. The code expires in 10 minutes.\n5. Paste the bot token into the local password field on the extension dashboard. Click **Pair bot and send confirmation to phone**. Chrome will ask to allow access to `https://api.telegram.org/*`. Approve only if you want to connect Telegram.\n6. The extension fetches bot updates and binds only a **recent, unique private chat** containing that exact code. It sends a confirmation message, stores the bot token and target chat ID in **Chrome local extension storage** (not GitHub or cloud sync), and enables phone notifications. No other chat can be paired without that code.\n7. Click **Send phone TEST message**. Confirm it arrives on your phone and is not muted. Check status in the dashboard.\n8. Candidate `REVIEW_CE` / `REVIEW_PE` and virtual futures exit alerts will generate Telegram messages along with desktop notices. Disable the phone toggle any time, or click **Disconnect & erase bot token**. If necessary use @BotFather to revoke a compromised token.\n\n**Privacy:** Telegram is a third-party service; the outgoing alert carries NIFTY futures symbol, provisional side, readings, candle boundary time and risk caveats. It does not carry your broker credentials, portfolio, order details or Telegram authentication token in the message body. Since the HTTPS Telegram Bot API requires the token within the request URL, it is transmitted to Telegram over TLS. The token is stored locally on Nirala; anyone with access to your Chrome extension profile could potentially recover it, so do not configure on a shared computer.\n\n**Caution:** You will not receive phone messages while Nirala / Chrome / Kite chart is closed or offline. It may require 20–25 minutes of consecutive five-minute boundary samples after a reset before its first candidate. Test the phone path and the strategy separately; Telegram delivery confirmation does **not** establish signal accuracy. No Telegram connection has been made until you complete the pairing flow.\n\n## Verified Nirala installation (19 October 2026)

- Verified installed Chrome extension **v0.2.0** from `%LOCALAPPDATA%\\IndicatorSetup\\extension` on Nirala; repo updated with the same v0.2 sources and the new automatic-reader tests.
- Confirmed dashboard reported **Automatic read: RUNNING**, detected `NIFTY26OCTFUT`, and populated futures price, volume, Session VWAP, EMA9/EMA21, DMI and ATR without user-entered values.
- Both **Auto Monitor** and **Desktop notifications** toggles were checked. A TEST notification was requested, but an operating-system toast was **not independently observed**; review Windows/Chrome notification settings if none appears.
- Current result after restoring chart layout: **WAIT_DATA**, because the system needs four consecutive near-close five-minute readings before assessing its first candidate. Do not infer that an alert has fired; only the live reader has been verified.
- **Important Kite behavior:** Reloading the chart URL opened its default `1D` view with no five indicators. Restore **Save dropdown → Open layout → NIFTY 5 Indicator Setup** to return to the saved 5m study layout. This chart-state restoration has not been automated. The extension correctly suppresses signals until the required 5m indicator fields are displayed.
- Chrome must remain open. Background-tab throttling and a missing candle-boundary reading can still suspend alerts. No historical win rate or exchange-confirmed execution reliability has been established.

## Installation or upgrade

1. Download or clone **only the extension folder** from the public repository: https://github.com/Tirthanand17/Indicator-Setup/tree/main/extension.
2. Unpack the folder somewhere stable (not inside Windows Desktop if you prefer). In Chrome open **chrome://extensions** and enable **Developer mode**.
3. If older unpacked `NIFTY Five-Indicator Paper Alerts` is installed, update its source files in the *same loaded folder*, then press **Reload** on its card. Avoid loading a second duplicate extension. Alternatively uninstall the old version and **Load unpacked** from the new folder.
4. Keep Zerodha Kite open to the **current-month NIFTY futures contract** (not the NIFTY spot index) with **five-minute candles**, chart on **TradingView**, Volume visible, Session VWAP HLC3, EMA9 close, EMA21 close, DMI14/14 showing exactly +DI / −DI / ADX, ATR14.
5. **Refresh the Kite chart tab after reloading the extension** so Chrome injects into the nested chart frame. The frame reader can take a few seconds to start.
6. Click the extension **N** button and **Open Auto Signal Dashboard**. Verify last-reading timestamp is recent and all prices/indicators match the chart. You **do not type indicator values manually**.
7. Keep **Auto Monitor** and **Desktop notifications** enabled. Use **Send TEST notification** to confirm OS/browser notifications work.
8. New CE/PE candidate messages can begin only after at least **four consecutive five-minute near-close observations** (roughly 20–25 minutes, unless sampling is paused or stale); this is intentional for research discipline. The chart must stay open and responsive.
9. Windows desktop alerts say **Possible BUY CE**, **Possible BUY PE**, or **Virtual CE/PE exit review**; opt-in Telegram messages use the same candidate states. The latter refers to a hypothetical chart-based candidate, *not* a Kite holding. No transaction is ever sent to the broker.

## Exact research conditions

- 5-minute futures price above VWAP, EMA9 > EMA21, +DI > −DI, ADX≥25 and rising, close above three prior near-close bars' highs, and close above the 20-minute-ago observation ⇒ **REVIEW_CE**.
- Reverse all directional rules for **REVIEW_PE** with close below three prior lows.
- Reject if within 0.1×ATR of VWAP, indicator or candle fields missing, underlying volume invalid, market not inside the supported session, ADX weakening or less than 25, a near-close sample is missed, market data stops changing, or the Chrome tab is throttled.
- **15-minute trend is only approximated from sampled 5-minute price history**, not independently calculated 15m EMA/DMI.
- If an illustrative virtual CE/PE candidate was recorded, a subsequent near-close bar passing futures price stop/target/reversal rules produces an **exit review**; this is **not** the price of the corresponding option.
- All thresholds, virtual stop/targets, and breakout logic are experimental. Win rate, expectancy and risk-adjusted performance are **not established**.

## Security

- No broker order APIs, payments, broker credential reading, cookies, URL fragments, analytics endpoints, page-script injection or OCR. Network requests go only to Telegram's official API after explicit user permission, pairing and opt-in; the default chart reader has no outbound third-party data.
- `chrome.storage.session` holds sanitized in-memory chart readings, the virtual candidate, and a temporary pairing code. `chrome.storage.local` holds settings, alert keys, an audit journal (max 150), and **only when enabled**, the sensitive Telegram bot token and private chat ID. Nothing is committed to GitHub.
- The frame observer reads only `document.body.innerText` from the origin-matched nested chart and transmits a whitelist of numeric fields into the extension; it never forwards raw page text.
- Cursor interaction, data gaps, missing or suspicious prices and browser suspension all cause **WAIT_DATA** or **NO_TRADE**, never a fabricated signal.
- Chrome must be running for desktop or Telegram alerts; it is not a cloud-hosted or laptop-independent feed.

## Tests

Run `node --test tests/*.cjs`. These unit tests do not establish broker/chart compatibility or option strategy profitability. Before trusting alerts, visually verify that the live values in the dashboard **match the current Kite chart at the same timestamp**, especially at the five-minute boundary. Do not act on a notification without a separate actual option premium and risk check.

## Recommended production upgrade

For exchange-confirmed candles and real options exit alerts, use an explicitly authorized **read-only** market-data provider that supplies timestamped NIFTY futures OHLCV plus NIFTY option BID/ASK, then independently compute all indicators and validate option risks. No paid service is activated by this extension. Any broker execution would require a distinct, explicit authorization and robust risk controls.
