# Phase36 — Cloudflare Free actual-metrics collection gate

Date: 24 October 2026. **Source integration only. Not a real Cloudflare
measurement or deployment.**

## Outcome

Created a narrowly scoped, read-only Cloudflare GraphQL analytics client for
the `nifty-paper-scheduler` project and a manual, explicit CLI. This is the
preparation needed to evaluate #1 of the live-acceptance checklist once a
Cloudflare Worker/SQLite Durable Object **actually exists** and its account
owner separately authorizes analytics access.

- `cloudflare-metrics-readonly.mjs` uses only the official Cloudflare
  `/client/v4/graphql` endpoint. The Worker query requests invocation count,
  errors, subrequests, and raw GraphQL CPU P50/P99. The Durable Object query
  fetches account-level request, CPU and maximum stored-bytes fields.
- The client accepts only an explicit 32-hex-character account tag, exactly
  the named Worker, a valid window of no more than 24 hours, and a plausible
  scoped API token. A fixed-host HTTPS POST, four-second timeout, 64 KiB
  bounded JSON reader, redirect rejection and **no auto retry** are enforced.
- Outputs contain only whitelisted aggregates. They never include the API
  token, account tag, raw errors, headers, messages, Kite tokens, Telegram
  details or identifying metadata for other Workers. The DO totals remain
  explicitly marked account-wide.
- `npm run metrics:probe` prints **no API request performed** by default.
  The explicit `--run` path additionally requires the owner-set variable
  `CLOUDFLARE_METRICS_READ_APPROVED=yes`, a finished UTC day and an Analytics
  Read credential in the calling process environment. All integration tests
  used fake GraphQL responses and never contacted Cloudflare.
- A successful query does **not** produce release approval. The account-wide
  Durable Object results can include unrelated namespaces; sampled adaptive
  Worker data can be partial, the 100-row Worker query can truncate results,
  raw API CPU field units require independent verification, and this query
  does not prove billable SQL rows or Durable Object duration GB-seconds.

## Verified status

| Check | Status |
| --- | --- |
| Full Worker unit suite | **219/219 passed** |
| Native SQLite regression suite | **18/18 passed** |
| Strict disabled-template preflight | SAFE_DISABLED_TEMPLATE_ONLY |
| Source-only GraphQL fake-response safety suite | Passed |
| No approval / default CLI | Never sends HTTP |
| Secret, foreign-script and malformed-response rejection | Passed |
| Real `nifty-paper-scheduler` Worker deployed | **No verified deployment** |
| Real GraphQL Worker/DO usage samples | **Not collected** |
| Worker CPU P99 versus Free 10 ms limit | **Unknown** |
| Durable Object duration, SQL rows, billing | **Unknown** |
| Brokerage/Telegram online | **Disabled** |

## Approved operator procedure (future, not executed)

1. Owner explicitly authorizes a **Cloudflare Free** test Worker and SQLite
   Durable Object and confirms no payment card or paid resources are needed.
   This task has **not** requested or received that approval; create nothing
   until it is granted. No custom domain is required for metrics testing.
2. Deploy only a disabled synthetic/scheduler-only candidate with all broker
   and Telegram flags off, after a separate cost/security review. Do not
   expose a public URL or disable the admin key automatically.
3. Run a short approved test and verify CPU, errors, requests and operation
   capacity in the [Workers dashboard](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/)
   and [Durable Object Metrics dashboard](https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/).
4. If and only if the owner grants **Analytics Read** access, run
   `npm run metrics:probe -- --run` with the required environment variables
   documented by `npm run metrics:probe`. Do not paste tokens into chat, GitHub,
   screenshots or shell history. This runs read-only GraphQL queries but does
   not deploy or change any cloud resources.
5. Compare actual Cloudflare CPU and quotas in their **documented units**,
   verify sampling/completeness and billed SQL/duration separately, and then
   repeat after exercising the actual market-data and notification workload.
   Record a full session and observed spend as an independent acceptance
   report. Do not infer any of this from local Miniflare wall time.

Sources checked 24 October 2026: [official Workers metrics GraphQL tutorial](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/),
[Durable Objects analytics](https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/),
and [Workers Free limits](https://developers.cloudflare.com/workers/platform/limits/).

**Outcome remains blocked on new deployment and analytics authority.** Offline
engineering 23/25 = 92%; live acceptance 0/5; ₹0 additional spending.
