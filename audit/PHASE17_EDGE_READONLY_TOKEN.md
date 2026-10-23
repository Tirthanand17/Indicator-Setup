# Phase17 — offline read-only Kite transport and signed daily-token bridge

**23 October 2026 · source-only, not deployed · paper research only · ₹0 cloud changes**

## What is implemented

- `edge-cloudflare/daily-token.mjs`: Python sender-compatible HMAC-SHA256 verification over `timestamp + "\n" + nonce + "\n" + exact JSON body`, 90-second skew guard, 2KiB streaming body limit, single API identity, 06:00 IST signed-session expiration, nonce digest and token fingerprint. AES-GCM sealed bearer with 96-nonce bounded Durable Object replay memory; signed time/expiry/fingerprint are cryptographically bound as authenticated additional data. Signed rollback/equal-second conflicts and corrupt prior vault fail closed.
- `edge-cloudflare/market-readonly.mjs`: exact HTTPS `api.kite.trade` endpoint allowlist; final transport method GET, redirect denial, 8s timeout, bounded response/type checks, NIFTY futures quote and 5/15-minute candle schema checks; no SDK transaction methods.
- `edge-cloudflare/worker.mjs`: POST `/internal/token` behind **two explicit disabled-by-default flags**, separate from admin scheduler endpoints; the existing alarm transaction still claims the tick before any market read. Only claimed ticks can invoke synthetic-tested futures quotes, with history on five-minute boundaries. Stale exchange timestamps, mismatched instrument ID, expired or missing token and all HTTP failures fail closed without fabricated paper trades. Only bounded market status, quote price and candle counts may appear behind scheduler authorization.
- `edge-cloudflare/runtime/harness.mjs` and native Miniflare tests exercise signed relay, replay and encrypted token persistence across restart, while the test harness rejects all external outbound HTTP.

## Reproducible offline checks

| Test | Result | Scope |
|---|---|---|
| `node --test edge-cloudflare/*.test.mjs` | 88 passed | Pure scheduler/indicators/parity, signed relay/quote allowlist/Worker simulations |
| `npm run test:runtime` in `edge-cloudflare/` | 2 passed | Native workerd SQLite rollback/restart and encrypted credential persistence |
| Python 3.12 `python -m pytest -q -p no:cacheprovider` in `cloud-alerts/` | 777 passed, 1 skipped | Existing local Python regression suite; no source changes in this phase |

## Explicitly unverified or unfinished

1. **No actual cloud binding/account, paid Kite API access, real token or live quote**, so success against the real Kite payload, Cloudflare Free CPU/duration quotas, alarm timing and third-party HTTP reliability is unproved.
2. Configured futures symbol/token **must be correctly provided and rolled** by a future contract resolver. Although source-level Python uses an instrument catalogue, this Cloudflare sampler does not yet dynamically select options or generate CE/PE decisions.
3. This persists only the last sanitized market observation; complete ordered market evidence, dual independent paper ledgers, Telegram outbox, mobile views, restore/capacity and operational calendar require checklist items 18–25. Simulated P&L, win ratio and trading profitability are unmeasured.
4. `OFFLINE_SCHEDULER_ENABLED=false` and `READONLY_MARKET_RUNTIME_ENABLED=false` in undeployed `wrangler.example.jsonc`. No user payment, UPI mandate, new provider account, DNS, Worker/DO creation, external HTTP or live order was authorized or attempted.

**Checklist outcome:** #17 complete as a tested offline integration deliverable; 18/25 = 72% offline engineering. **Live acceptance 0/5.** Next #18 cloud transactional two-account ledger/outbox.
