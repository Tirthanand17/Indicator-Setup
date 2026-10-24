# Phase30: disabled durable option snapshots and shared quote pacing

Date: 24 October 2026. **Repository code only; zero new cloud resources,
broker traffic, orders, Telegram messages or charges.**

## Implemented

1. `option-runtime.mjs` supplies bounded, schema-checked records for the
   `MarketSession` SQLite Durable Object. A **transactional reservation before
   every permitted option-mode quote GET** retains the request slot across
   failures and restarts. An individual alarm cannot issue both a futures
   quote and a CE+PE option quote. The option-mode schedule gives every third
   20-second alarm slot to a paired option GET; other slots retain the
   futures sampler and optional 5m/15m review.
2. Durable rate controls reject repeats, time reversal, under-1,100ms bursts,
   unknown years, closed sessions and excess daily requests. HTTP 429 causes
   at least a 60-second cooldown, while a 401/403 quote authentication fault
   blocks further quote requests until a **new** valid signed token handoff
   or a new exchange day. A repeated identical token handoff cannot lift it.
   This is per single Durable Object instance, not proof of account-wide
   pacing if other clients also use the same Kite API credentials.
3. The first eligible future observation claims a same-day NFO master fetch
   before reading the CSV, with at most three tries per trading day and 30
   minutes between failed attempts. Only two compact contract records are
   stored, never the full CSV or bearer headers.
4. A dedicated option-only alarm samples a selected CE+PE pair using exactly
   one read-only Kite GET and validates exchange-local IST age, token identity,
   top-of-book executable BID/ASK and one-lot depth. It stores bounded
   observation-only evidence, clears previous evidence on a failed attempt,
   and refuses cross-day reuse, wrong instruments and invalid records.
5. The already authenticated scheduler status exposes only a sanitized
   option-readiness status, expiry/strike, evidence freshness and request
   pacing status. It does not grant paper-entry rights or provide an
   alert-sending/real-order endpoint. Production configuration introduces
   `OFFLINE_OPTION_SNAPSHOT_ENABLED=false`; the strict offline preflight
   requires this flag to remain false.
6. All tests use locally generated instrument master rows/quote responses.
   Native workerd SQLite tests cover claim persistence, CE/PE normalized
   evidence, replay after restart and a hard-blocked outbound network.

## Verified tests

- `npm test`: **192/192 JavaScript tests passed**.
- `npm run test:runtime`: **9/9 native workerd/SQLite tests passed**,
  including the new restart-safe option snapshot. Temporary write permission
  was used solely for local SQLite test fixtures.
- `npm run preflight:offline`: **safe disabled template**, zero enabled
  runtime flags; no deploy or service call executed.

## Limits of this milestone

- Still **not deployed**. No actual Kite authentication, current live option
  quotes, option-chain source quality, live exchange-time latency, Telegram
  phone receipt, real paper entries, or observed cloud duration/CPU usage.
- The regular NSE 2027 calendar remains intentionally unsupported.
- Market snapshots are **not connected** to `enterPaperBasket`, exits,
  portfolio marks, or delivery dispatch. There are no live-market paper
  outcomes or verified strategy accuracy figures.
- Downloading/parsing a daily master within the Cloudflare Workers Free CPU
  budget, 16 MiB CSV sufficiency, upstream publication timeliness and
  continuous service availability must be measured before deployment.
- Quote pacing is durable within this one Durable Object only. Other
  independent applications sharing the API key are not coordinated.
- The `OFFLINE_OPTION_SNAPSHOT_ENABLED` flag is shipped **false** and there
  is no owner approval to activate it in a cloud runtime.

**Fixed engineering checklist remains 23/25 = 92%, real-cloud acceptance
remains 0/5.** This checkpoint extends a completed offline item and does not
close the remaining hosted backup, release or real-session gates.
