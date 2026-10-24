# Phase 26 checkpoint — ₹0 Worker/SQLite quota forecast and disabled-template guard

**Date:** 24 October 2026. **Outcome:** offline checks only; **no Cloudflare account, Worker, billing or server was created or activated**. This is an add-on checkpoint, not a change to the fixed 25-item project checklist.

## Authoritative Cloudflare reference snapshot

Official limits consulted before implementing the estimate:

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/): Free Workers have 100,000 requests/day and a **10 ms CPU-time limit per invocation**.
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/): SQLite-backed Durable Objects work on the Free plan, with 100,000 requests/day, 13,000 GB-seconds/day compute duration, 5 million SQLite rows read/day and 100,000 rows written/day. Each alarm invocation counts as a request, and `setAlarm()` is a row write.
- [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/): Free SQLite storage cap is **5 GB per account**, with a **2 MB individual key/value size cap**. The per-account cap is not an off-site backup.

These are **dated, changeable quotas**, not an independently verified subscription or guarantee that the user will be offered account access without a payment method. The Free plan fails operations that exceed daily limits; that is not an uptime guarantee. Confirm account terms and limits before any authorized deployment.

## Reproducible forecast (NOT measured cloud usage)

From `edge-cloudflare/`: `npm run preflight:offline`. This reads only the repository's `wrangler.example.jsonc` and package scripts; the command has **no Cloudflare or other network operations**.

The model assumes a regular 09:15–15:30 IST day with 20-second cadence: **1,125 alarms**. For each alarm it pessimistically budgets 6 SQLite row reads and 6 writes; adds 100 read-only dashboard requests at 8 rows read each and one signed handoff request. It assumes 4 MB of aggregate persistent data, **not** an observed allocation.

| Modeled category | Approximate use per regular day | Official Free-plan reference | Proven live? |
|---|---:|---:|---|
| Worker HTTP requests | 101 | 100,000 | No |
| Durable Object requests including alarms | 1,226 | 100,000 | No |
| SQLite rows read | 7,551 | 5,000,000 | No |
| SQLite rows written | 6,751 | 100,000 | No |
| Stored data | 4 MB | 5 GB | No |
| Worker CPU per invocation | Unknown | 10 ms | No |
| Durable Object active duration | Unknown | 13,000 GB-s/day | No |

The model does not calculate or guarantee actual outbound Kite/Telegram API usage, Workers CPU, DO active wall-clock duration, individual SQLite KV size, request pacing, worker availability, broker token lifetime, alarms during runtime faults, or restored data provenance. Actual cloud measurements and owner approvals remain mandatory. **No separate account is presumed to be connected.**

## Source-code stop conditions

`free-tier-preflight.mjs`:

1. Fail-closes if the example template enables *any* scheduler/data/ledger/synthetic/delivery/dashboard flag, `workers_dev`, preview URL, observability, or injects public routes, cron triggers, R2, billing-related service bindings or secret literals in `vars`.
2. Requires only the designated SQLite Durable Object binding/migration and no deploy/publish script in the package manifest. This confirms **the sample source is disabled**, not that all external scripts/hosting accounts are safe.
3. Rejects invalid inputs, arithmetic overflow and unverified 2027. Unknown annual dates cannot be assumed regular; known exceptional Muhurat and holidays have **zero automatic alarm slots**.
4. Returns `ESTIMATE_ONLY_NOT_DEPLOYMENT_APPROVAL` and `deploymentAuthorized:false` regardless of modeled headroom. Exceeded dimensions are reported as blockers.

Tests cover the checked-in sample, unauthorized config drift, forecast arithmetic, overages, special days and unsupported years. **Verified locally: 168/168 Cloudflare JS unit tests and 8/8 native workerd SQLite tests passed.** Python modules were not changed in this checkpoint; the prior full Python baseline was 778 passed / 1 skipped. Actual cloud Worker and Durable Object deployment, operation or quota measurement are still **not authorized** in this checkpoint.

## Status and next gate

- Existing **Phase 23** stays incomplete: private, independent backup/restore and real persistent capacity observation need authorization.
- Existing **Phase 25** stays incomplete: authoritative 2027 F&O annual calendar and operator release signoff unavailable.
- Fixed engineering checklist **23/25 = 92%**, live acceptance **0/5**. A13 free-tier risk is better modeled, not resolved.
- Before spending any money or activating a service: require explicit user approval, verify account plan allows ₹0/no-card, run a non-billable trial if approved, measure CPU, row/write and duration quotas, and independently test backup/restore and five paper-only sessions.
