# Phase 49 — No-credit-card Cloudflare Free edge control plane

This is **a live, cloud-hosted, inert research bridge** — **NOT** the migrated
Python NIFTY indicator engine or production paper trading bot.

## Public URL and verified evidence

- Worker: `indicator-paper-edge-inert`, new and isolated from existing FlowMinute Workers.
- Public readiness (safe metadata only):
  `https://indicator-paper-edge-inert.applinkguard-e99c01364333.workers.dev/status`
- Token sender endpoint reserved (currently **DISABLED**):
  `https://indicator-paper-edge-inert.applinkguard-e99c01364333.workers.dev/internal/token`
- Separate APAC Cloudflare D1 database: `indicator-paper-edge-inert`.
- `wrangler deploy` reported a successful upload and installed UTC Cron:
  `*/5 3-10 * * 1-5` (weekdays; corresponds to 08:30–16:25 IST).
- Live external GET `/healthz` **404**; `/status` **200** with
  `paper_trading_enabled:false`, `broker_orders:false`, `live_data:false`.
  Live unsigned POST `/internal/token` **401**. Private paper API routes **404**.
- The existing Python `cloud_alerts.https_acceptance` eight-check external
  HTTPS ingress probe completed with **result PASS, blockers []**, exit 0.
  This validates TLS/route blocking on the internet, not 24/7 uptime, market
  quotes, credential acceptance, cloud Cron execution, or phone receipt.
- Windows Node 24 tests on the actual GitHub branch: **16/16 passed**, no
  real tokens, trading orders, Kite calls or Telegram calls.

## Why we use the Cloudflare architecture

Under the user's HARD requirements — **no credit card, no paid upgrades,
no Nirala-hosted VPS, and unattended cloud scheduling** — there is no
verified traditional forever-free VPS from mainstream providers. Azure for
Students is blocked by institution-domain verification, OCI and standard
Google/AWS VPS signup require card verification, and sleeping/ephemeral Render
Free breaks the Python/SQLite worker's requirements.

Cloudflare Workers Free DOES accept scheduled cron without a continuously
running VPS, and Cloudflare D1 offers persistent SQL state. This existing
authenticated account had 5 D1 databases; **the sixth** was created for
Indicator. No existing FlowMinute database, Worker or DNS zone was modified.
No billing plan change, upgrade, service purchase or credit-card signup was
authorized.

**Strict performance limitation:** Workers Free is currently limited to
**10 milliseconds of CPU per invocation**, 50 subrequests per invocation and
100,000 requests/day. Cron scheduling may be delayed and must not be treated
as a hard real-time trading clock. D1 Free grants 5 million reads/day,
100,000 writes/day and 5 GB combined storage (**500 MB per database**).
Existing Cloudflare projects consume some of those account-wide limits.
The current Worker does NO market polling, indicator calculations, option
chain loading or Telegram sends; the actual strategy must be explicitly
ported, benchmarked and shown to fail closed before any enablement.

## Source and configuration

- `src/index.mjs`: one inert `/status` handler; optional signed daily
  token receiver compatible with the existing Python token sender's exact
  HMAC-SHA256 body format, with AES-256-GCM encryption and D1 nonce uniqueness,
  UTC timestamp tolerance, relay timestamp monotonicity and 06:00 IST
  daily expiry. **Disabled in deployed settings.** Neither ciphertext nor
  plaintext token is returned by any HTTP endpoint.
- `migrations/0001_init.sql`: isolated D1 nonce, ciphertext-only vault and
  inert cron heartbeat tables. Migration applied successfully to the
  new APAC database (3 SQL queries, 0.03 MB DB initially).
- `wrangler.toml`: the deployed D1 binding, public `workers.dev`, weekday
  Cron and explicit `TOKEN_RELAY_ENABLED="false"`. Contains NO API secrets.
- `test/bridge.test.mjs`: 16 Node-native unit/security checks using ONLY
  synthetic tokens. `npm test` and `npm run check`.
- `wrangler.toml.example`: reusable offline template, no working D1 ID.

**No relay HMAC, encryption key, API key or token secret was set in Cloudflare.**
The Python daily token file remains READ-ONLY and was not accessed, uploaded,
moved, copied, edited or deleted.

## Manual re-deployment (only after reviewed code changes)

```powershell
cd "$env:TEMP\indicator-phase43-qa-20261021\cloud-alerts\edge-worker"
npm test
npx wrangler deploy --config wrangler.toml
```

For an independent HTTPS route check (no actual credentials):

```powershell
cd "$env:TEMP\indicator-phase43-qa-20261021\cloud-alerts"
& "$env:TEMP\indicator-phase43-qa-20261021\.venv\Scripts\python.exe" `
  -m cloud_alerts.https_acceptance `
  --endpoint https://indicator-paper-edge-inert.applinkguard-e99c01364333.workers.dev/internal/token `
  --confirm-network-checks --json
```

Do NOT set `TOKEN_RELAY_ENABLED=true`, real Cloudflare secrets or broker
feature flags in this phase. Before any token transmission, validate Web Crypto
latency under the 10ms Free CPU budget and cross-language HMAC/nonce behavior
in the actual Cloudflare runtime. Verify replay/idempotency under concurrent
D1 writes. Avoid Cloudflare free quota exhaustion (hard fail, not automatic
success), and do not claim the real trading engine is online until those
separate integrations are complete.

## Free domain

The live `workers.dev` URL provides HTTPS without adding a domain. The user
has a free domain, but the exact registered zone, Cloudflare DNS access and
ownership of the desired Indicator hostname were not verified in this turn.
We did **not** edit existing DNS or interfere with WordPress/FlowMinute.
When verified, attach an Indicator-specific subdomain using Cloudflare
Custom Domains, which issues TLS and DNS records automatically for zones
under that account.

## Pending (NO claimed completion)

- Confirm live Cron event actually fired and D1 `edge_heartbeat` row updated;
  deploying a schedule does not itself prove an executed event.
- Port and benchmark the existing Python 5m/15m VWAP/EMA/ADX/ATR decision
  logic and official NSE F&O holiday calendar against Python golden fixtures.
  Keep the source strategy as ground truth. Verify the JS path respects
  real quote freshness and options L1 bid/ask fills.
- Safely port paper-account ledger/conservation/recovery from local SQLite to
  cloud D1 and verify no duplicate entries after retries.
- Approved signed real daily Kite token handoff, quote read-only calls, clearly
  labeled Telegram TEST delivery, observed phone receipt with Nirala OFF and
  five entire real market sessions. **No real broker orders at any point.**
- Account cost and usage inspection from Cloudflare dashboard, including other
  existing apps, to rule out free quota clashes. A free deployment is not an
  SLA or a guarantee against errors.

**Scope indicator:** An online HTTPS/scheduled control layer is deployed.
The real unattended NIFTY paper trade engine is NOT deployed. Overall
expanded engineering estimate **53% (unchanged)** until genuine live acceptance.
