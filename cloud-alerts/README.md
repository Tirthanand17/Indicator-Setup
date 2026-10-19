# NIFTY 50 cloud alerts — official Kite Connect, no chart required

**Status: architecture and a testable read-only prototype; NOT deployed or live validated.** This code intentionally cannot place orders. No browser extension, open Kite chart or powered-on laptop is required *after the daily token has been securely handed to an always-on cloud worker*.

The existing [Indicator-Setup](https://github.com/Tirthanand17/Indicator-Setup) repository also includes a separate, older **screen-reading Chrome extension**. This folder is a **different architecture**: it uses the officially supported paid Kite Connect market-data API, with complete exchange-timestamped candles and actual bid/ask depth.

## Development progress (2026-10-19)

**Overall engineering implementation estimate: 41%** — `[████████░░░░░░░░░░░░]` (**59% remaining**).

The architecture and read-only local prototypes exist; **live cloud alerts are NOT deployed or validated**. See [docs/PROGRESS.md](docs/PROGRESS.md) for detailed phase percentages and evidence. The newer [WebSocket shadow-data design](docs/STREAMING_DESIGN.md) adds a diagnostic tick aggregator that cannot issue trading alerts until separately tested against Kite REST candles.

**Tests:** 47 local synthetic Python tests passed; no authenticated Kite REST/WebSocket session or real phone notification was used in this development pass.

## Start here

- [Full architecture and dataflow](docs/ARCHITECTURE.md)
- [Daily login, token relay and cloud deployment runbook](docs/DEPLOYMENT.md)
- [Security and read-only-folder agreement](docs/SECURITY.md)
- [Testing and acceptance requirements](docs/TEST_PLAN.md)
- [Phase-by-phase implementation checklist](docs/ROADMAP.md)

## What is implemented in this prototype

- Read-only Kite REST historical **5-minute** and **15-minute** OHLCV adapter; dynamic NIFTY futures symbol from the live instrument master; liquid current-expiry NIFTY CE/PE instrument selection from the master; bid/ask/depth, timestamp and spread validation.
- Fresh, completed candle guards. Calculates **Session HLC3 VWAP**, **EMA9**, **EMA21**, **DMI/ADX14** and **ATR14** from underlying futures candles. Separately calculates **15-minute EMA** context from broker 15-minute candles.
- Paper candidate `REVIEW_CE`, `REVIEW_PE`, `NO_TRADE`, `WAIT_DATA` decisions. Requires ADX >=25 **and rising**, DMI direction, aligned VWAP and EMAs, three-prior-bar breakout, and 15-minute confirmation. Thresholds are unoptimized research assumptions.
- Chooses an actual listed option, checks fresh top-of-book **BID/ASK** and lot quantity. Telegram text reports strike, bid/ask, lot size, futures underlying stop and *illustrative* target. Does not claim an executable premium stop or option P&L.
- A tracked **virtual futures candidate** may produce later `EXIT REVIEW` alerts. It does not know actual holdings and **cannot close an option**.
- Read-only **daily token handoff**: an opt-in local sender reads the existing trading project's `.env` without changing it, and transfers only the access token to an approved HTTPS cloud endpoint using signed, replay-protected requests. Cloud encryption-at-rest uses a separately configured Fernet key on a persistent volume.
- Persistent SQLite candidate dedupe and Telegram outbox, privacy-limited `/healthz`, cloud container skeleton, unit/security tests, and opt-in defaults.

## What is NOT done yet

- No public cloud host deployed, no hosting bill authorized, no Kite credentials moved, and no Telegram cloud secrets configured. Nothing is listening on an Internet endpoint yet.
- No true real-time Kite WebSocket collector: **REST candle polling** is the initial testable prototype; streaming ticks, per-second option premium monitoring, reconnect/backfill, and latency benchmarking are next phases.
- No live Kite subscription authentication test, no real option bid/ask end-to-end test, no historical strategy validation, and no actual market-generated phone candidate alert proof.
- No promise that any indicator combination has high win probability. This is still **PAPER / SIGNAL REVIEW ONLY**.

## Quick local checks — no broker data or tokens needed

```bash
python -m pip install -r requirements.txt
python -m pip install pytest pytest-asyncio httpx
python -m pytest -q
python -m compileall -q cloud_alerts
```

**Never use** this repository's public source files, Issues, Actions, logs, or GitHub Secrets as a place to publish your Kite access token or Telegram bot token. GitHub Actions are not enabled for this prototype to avoid unnecessary CI credit consumption.

## Runtime overview

1. You log into Zerodha as usual and your existing protected project saves the updated daily access token into its `.env`.
2. On Nirala, an **opt-in local token sender** can read it (read-only) and send it once to a private, HTTPS cloud token endpoint with HMAC authentication. A `--watch` mode can detect the daily token change while the computer is ON.
3. The cloud worker stores only the access token as **encrypted ciphertext** in its private persistent volume. The API **secret is never needed in cloud**. If the cloud restarts, it reloads the still-valid token. The token expires at next 06:00 IST, as documented by Zerodha.
4. You can now shut down Nirala. The always-on cloud instance queries paid Kite Connect, calculates completed-candle indicators, checks actual option spreads and messages your already-chosen Telegram bot/chat when a **review candidate** passes.
5. On the next trading day, the broker-authenticated daily login and token handoff repeat. This cannot be completely bypassed for retail Kite sessions.

**One non-negotiable rule:** no proper token handoff means the cloud cannot see the `.env` once the computer is off. It must explicitly enter `WAIT_TOKEN`, not send pretend signals.

## References

- [Kite historical 5-minute candles](https://kite.trade/docs/connect/v3/historical/)
- [Kite instruments, quote bid/ask and timestamps](https://kite.trade/docs/connect/v3/market-quotes/)
- [Kite WebSocket streaming](https://kite.trade/docs/connect/v3/websocket/)
- [Kite daily session expiry](https://kite.trade/docs/connect/v3/user/)
- [Render free web-service limits (not suitable for time-critical production)](https://render.com/docs/free)

**Last updated:** 2026-10-19. **Cloud deployment:** OFF. **Live order execution:** DISABLED / NOT IMPLEMENTED.
