# Phase 33 — Missing daily token notice and opt-in HTTPS acceptance probe

**Status:** implemented and tested offline on 2026-10-20; **NOT a deployed cloud worker**. No Kite API credentials, Telegram messages, phone receipt, cloud service, or orders were used in the tests. This is not proof of strategy accuracy or hosting availability.

## Daily missing-token warning

When `ALERTS_ENABLED=true`, the market calendar confirms a regular NSE F&O weekday, and a due five-minute REST polling boundary falls between 09:25 and 15:25 IST **without a valid daily Kite token**, the engine creates exactly one per-market-day operational alert:

`NIFTY ALERT MONITOR — ACTION REQUIRED (NOT A TRADE SIGNAL)`

The text explains that NIFTY CE/PE paper monitoring is **paused**, and that the operator must complete the normal Zerodha login and signed token handoff. No access token, API key, Telegram chat identifier, order, price or speculative BUY/SELL is contained in that notice.

The event ID is `SESSION_WAIT_TOKEN:YYYY-MM-DD`; the existing SQLite uniqueness constraint prevents duplicate same-day notices across polls or restarts. The standard Telegram outbox applies a maximum **180-second** age, recording API acceptance or expiry. An unsent warning is not retried indefinitely or fabricated as delivered. Failures remain visible through the outbox while `WAIT_TOKEN` stays the primary engine status. A holiday, unsupported calendar, weekend, disabled worker or premarket poll creates no warning.

**Limit:** the warning itself requires a working configured Telegram bot and outbound network. If Telegram is unavailable, it cannot guarantee a phone alert. Sending an operational warning does not mean Kite market monitoring or options alerts are operational.

## HTTPS ingress probe (strict opt-in, NO credentials)

After a host is separately approved and public DNS/TLS is installed, run from an operator-controlled terminal:

```bash
python -m cloud_alerts.https_acceptance \
  --endpoint https://alerts.example.org/internal/token \
  --confirm-network-checks --json
```

Replace `alerts.example.org` with the **approved** domain. The CLI never reads any `.env` file or sends a real API key, access token, relay signature or Telegram credential. It uses HTTPS certificate verification, does not follow redirects, ignores inherited HTTP proxies, requires a public FQDN on port 443, and never prints the domain in the JSON result.

The probe checks that anonymous GETs for `/`, `/healthz`, `/readyz`, `/operationalz`, `/docs`, `/openapi.json` and `/internal/token` are blocked (403 or 404). One **unsigned** `POST /internal/token` with literal `{}` must return HTTP 401. Non-matching status codes, redirects, TLS failures or network errors **block** acceptance. There are eight requests maximum; no external requests are made without `--confirm-network-checks`.

The example domain above is **not an activated host**. Do not run the network probe before host approval. Even a green probe proves only the observed public HTTP access policy at that moment. It does **not** prove persistent disk, Kite validity, HMAC-signed relay from Nirala, broker REST data quality, Telegram API acceptance, phone receipt, cloud uptime, or a ₹0 bill.

## Testing and go/no-go

Synthetic tests cover daily deduplication, a failed Telegram attempt and restart, exchange-closed suppression, next-day independence, TLS checks, rejected public probes, redirect refusal, absent network confirmation, secret-free reports, and tampering/no-access-token guardrails. Full project suite: **443/443 passed**. Python compilation passed.

**Go/no-go:** deployment remains **NO-GO** until a verified provider account/VM, independent charge assessment, persistent private storage, approved domain, real TLS acceptance, live Kite token handoff, and observed phone notification are documented. Broker order execution is absent by design.
