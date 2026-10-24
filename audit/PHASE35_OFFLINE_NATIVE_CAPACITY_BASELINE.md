# Phase35 — offline native capacity baseline, not a cloud benchmark

Date: 24 October 2026. **Source-only and local SQLite tests. No deployment.**

## What was added

- `npm run bench:offline` starts a disposable local Miniflare + native workerd
  SQLite Durable Object and exercises **64 distinct scheduler-only alarm
  callbacks** on a pinned regular 26 October 2026 NSE F&O session. An optional
  `--samples=N` accepts 32–256 callbacks. The clock advances to each exact
  scheduled timestamp, not to a fictitious faster-than-market cadence.
- The test fetches protected scheduler state, closes and reopens the SQLite
  object, verifies that the same number of unique claims persisted, counts
  local test-database disk bytes and asserts **zero external HTTP attempts**.
  All read-only Kite, option, Telegram and live execution flags are absent;
  any unexpected outbound call is blocked before reaching the network.
- A new pure report validator rejects invalid timings and counts, and marks
  missed claims, restart mismatch or attempted egress as an integrity failure.
  Native regression tests include the actual 32-callback/restart exercise.
- The report deliberately preserves `null` for **real Cloudflare Worker CPU,
  Durable Object GB-seconds, billable SQL rows and data transfer**. Local
  end-to-end wall latency and local SQLite bytes cannot prove the platform's
  limits. No production resource measurements are fabricated.

## Verification

| Exercise | Observed result |
| --- | --- |
| Offline worker JS unit tests | 211/211 passed |
| Native workerd/SQLite integration tests | 18/18 passed |
| Local scheduler-only 64-callback baseline | 64 unique claims; 64 after SQLite restart |
| Local baseline external requests | 0 |
| Strict `npm run preflight:offline` | SAFE_DISABLED_TEMPLATE_ONLY |
| Actual cloud Worker CPU, DO duration, storage billing | **Unmeasured** |
| Real Kite/Telegram under live alarms | **Not tested** |

The 64-callback local run had a ~1.66 MB disposable Miniflare persistence
directory and about 4.8 ms callback wall-time p95 in one execution, **not a
stable guarantee, CPU benchmark or Cloudflare quota measurement**. It
included only scheduler state, without live futures/option data or Telegram
sends. Re-run locally for the current host rather than interpreting this
sample as production performance.

Official planning limits checked on 24 October 2026: [Cloudflare Workers
Free limits](https://developers.cloudflare.com/workers/platform/limits/)
indicate 10 ms CPU per invocation and 100,000 requests/day;
[Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
and [pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
must be independently verified for the actual cloud account at deployment.
An offline benchmark cannot authorize deployment, billing, telemetry or
capacity-based service guarantees.

## Mandatory next gates

1. Obtain separate owner consent before creating any cloud resources or
   configuring production secrets. The existing ₹0 cap remains absolute.
2. Measure **actual** Worker CPU p50/p95/p99, Durable Object time, SQLite
   billed rows, data transfer and alarm delivery under approved test traffic;
   reject any free-tier overage or unpredictable charges.
3. Complete a supervised Kite read-only market session and Telegram phone
   receipt test, checking missing-token and exchange-closure behavior.
4. Confirm private off-host backup and recovery; retain fail-closed 2027
   calendar until an official annual schedule is verified.

**No release authorization, no trades and no phone messages.** The fixed
offline engineering checklist stays **23/25 = 92%**; live acceptance **0/5**.
