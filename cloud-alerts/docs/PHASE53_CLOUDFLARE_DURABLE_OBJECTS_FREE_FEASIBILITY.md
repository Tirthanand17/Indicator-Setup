# Phase 53 — Cloudflare Workers Free + Durable Objects feasibility (RESEARCH ONLY; NOT DEPLOYED)

**Date:** 2026-10-23. **Decision:** Best next candidate to **evaluate**, not a qualified production host. **No Cloudflare account, Worker, Durable Object, D1, DNS record or secret has been created or accessed.** Separate owner consent is mandatory before creation of any cloud resource or service. Zero bank card, UPI AutoPay/e-mandate, verification hold and recurring charge remain hard conditions.

## Why this candidate deserves a closer look

Cloudflare advertises a genuine **Workers Free signup without a credit card**. Workers Free has 100,000 requests/day, 128 MB memory and a 10-ms CPU budget per normal HTTP/Cron invocation. It is not a Linux VPS and cannot simply run the current always-on `uvicorn`/SQLite/background-supervisor deployment.

The less obvious option is **SQLite-backed Durable Objects**, newly available on Workers Free. A Durable Object owns durable state and can schedule **programmatic alarms measured in milliseconds**, including a proposed recurring **20-second wakeup**. Alarms have *at-least-once* execution (duplicates/retries are possible), **not a punctual 20-second delivery SLA**. Cloudflare documents 30-second default Durable Object invocation CPU allowance, separate from the strict Workers Free HTTP/Cron 10-ms budget; confirm behavior with tests.

The Free Durable Objects inclusion published on 2026-10-18 is **100,000 request/alarm invocations per day**, **13,000 GB-seconds duration/day**, **5 million rows read/day**, **100,000 rows written/day**, and **5 GB total SQLite storage** (individual SQLite-backed DO max 1 GB). `setAlarm()` counts as one written row. On the Free plan, quota exhaustion fails operations; there is no paid overage to authorize when using only the Free plan.

A 9:15–15:30 IST session spans 375 minutes. At one 20-second alarm per orchestrator, this is approximately **1,125 alarms per trading day**, before bootstrap, retries, REST, dashboard access, and storage calls. This is a **capacity estimate, not a field latency or success measurement**. Suppress alarms after session close, on NSE holidays, and when an unrecoverable data-integrity/credential gate fails.

**Python migration is possible but not drop-in.** Cloudflare supports Python Workers, FastAPI through an ASGI adapter, Python Durable Objects and Python alarms. The runtime uses Pyodide/WASM and supports only compatible pure-Python/PyEmscripten/Pyodide packages; the current repository pins CPython 3.12, Kite SDK, `requests`, `cryptography`, `uvicorn` and native durable SQLite. The exact dependency tree, memory footprint, asynchronous REST, crypto, cold starts and Python handler CPU costs are **untested**. New Python examples target Python >=3.13. Reuse pure indicator and paper-ledger logic only after compatibility and deterministic parity tests.

## Requirement fit

| Requirement | Current judgement | Proof before approval |
|---|---|---|
| ₹0; no card, hold or mandate | **Promising on advertised Free signup; actual account eligibility unverified** | User reviews their own signup, selects only Free; STOP on UPI/card/payment |
| Independent of laptop | **Architecturally yes** | A deployed, explicitly approved service still operates laptop-off |
| 20-second option premium checks | **Possible using DO alarms, timing not guaranteed** | Measured scheduled-vs-actual wakeup jitter on several live market sessions, including retried alarms |
| Fast Telegram notifications | **Unknown** | Real phone send+receipt latency, retries and durable dedupe |
| Two realistic paper portfolios | **Requires porting and durability review** | Fee/slippage/quotes/instrument/capital parity against CPython golden traces; atomic ledger |
| Python 3.12 code unchanged | **NO** | Split serverless-compatible computation from Linux-only runtime |
| Native SQLite/token vault backup | **NO** | New encrypted DO/D1 schema, backup and restore tested; NEVER transfer keys/tokens to GitHub |
| Broker API read-only | **Supported in principle** | Single Kite quote request <=1/sec and history <=3/sec; no broker order route, no order SDK use |
| Free custom domain and private dashboard | **Possible, unverified** | Authenticated, HTTPS-only deployment and domain control with explicit owner approval |
| Production-ready current build | **NO** | Full offline+cloud acceptance, cloud safety and exact ₹0 billing check |

## Alternatives screened

- **AWS Free (new India signup): BLOCKED ON THIS ACCOUNT.** The real flow displayed ₹2 verification and a ₹15,000 UPI AutoPay mandate. Approval of a revocable mandate would still violate the no-mandate rule; cancellation after signup cannot guarantee operation without billing configuration. Do not approve it or retry with false details. Account/project creation has **not been confirmed**.
- **Northflank Sandbox Free: BLOCKED.** The real user's account required payment verification after a 60-minute build window.
- **Oracle Cloud Always Free: BLOCKED** under the owner's no-card policy; Oracle generally requires a card during signup.
- **Deno Deploy Free: BLOCKED for normal quotas** pending a card. Official changelog states free organizations are restricted until credit-card verification. Scheduled cron is one-minute granularity, and it is not a drop-in Python supervisor.
- **Back4app Containers Free: BLOCKED** for persistent monitoring: its own 2026 experiment found Free containers destroyed after about one hour; Shared 24/7 is paid.
- **Koyeb Free: NOT SUITABLE unchanged**: fixed one-hour idle scale-to-zero and ephemeral storage.
- **Render Free: NOT SUITABLE unchanged**: sleeping web process and no persistent volume; static website alone can still host a non-sensitive dashboard but not the worker.
- **Cloudflare Containers: NOT FREE** (Workers Paid plan); don't confuse this with Workers Free + Durable Objects.

## Required fail-closed migration architecture (concept only)

1. Free-only HTTPS **Worker gateway**: accept signed single-use daily Kite-token handoff; privately authorize read-only dashboard; deny every broker-order route; redact every log.
2. **SQLite Durable Object** controls one market-session state machine, recurring ~20-second alarm, market calendar, token-age checks, heartbeat, idempotent paper event/outbox; evaluate a separate DO for append-only journal versus D1 and disaster recovery. Store secrets encrypted with a high-entropy key only in Cloudflare encrypted Workers secrets; never in source, public routes, or dashboards.
3. Use **REST-only Kite data** to begin; rate-limit and deduplicate requests. Reject stale quotes, invalid instruments, future timestamps, spread anomalies, and incomplete data. Existing 5/15-minute candle and option premium calculations must match golden local fixtures. Broker execution remains impossible by design.
4. **Telegram send** uses a persistent outbox and delivery status; retries must never duplicate user-visible signals without an explicit event id. Cloudflare alarms and external sends are at-least-once, so two-phase delivery semantics require fault-injection tests.
5. A **daily scheduled bootstrap** can re-arm the market-hour DO, with end-of-day reconciliation and independent encrypted backup/export. If credentials, storage, alarms or free quota fail, alert (if safe) and stop issuing new signals/trades.
6. Keep the existing Python 3.12 Linux runtime intact on GitHub as a tested reference; port only after offline compatibility and deterministic paper parity checks. This alternative is **not** evidence that the old monolith is online.

## Approval and acceptance gates

**Current state: RESEARCH ONLY.** The following are not authorized by the existing AWS-only signup approval: creating a Cloudflare account/Worker/DO/D1, moving DNS, storing token/secrets, making network calls to Kite, subscribing to Kite, sending phone alerts, or opening any real trading route.

1. Ask the owner to authorize **Cloudflare Free signup with no payment method or mandate**, on their own local Chrome. A login alone is not proof of quota or free eligibility.
2. Ask again before exact Worker, Durable Object, D1/DNS or secret creation, even if apparently included.
3. First build and test a **network-free synthetic adapter** using fixture quotes and redacted data: check 128-MB startup and CPU constraints; alarm rescheduling, crash-restart, holiday and no-token cases; fail closed.
4. Measure actual jitter and API/Telegram latency only in a separately approved, zero-cost cloud sandbox with fake data before any real credentials.
5. Use the project's **5 separate real market-day, laptop-off acceptance gates** only after successful no-charge proofs and permission; otherwise keep cloud acceptance at **0/5**. A missing 20-second wakeup must never be silently counted as an observed quote, and paper trade counts cannot override safety.

## First-party references (checked 2026-10-23)

- https://www.cloudflare.com/products/workers/ (Workers Free, no credit card)
- https://developers.cloudflare.com/workers/platform/limits/ (Free HTTP/Cron 10 ms, 128 MB)
- https://developers.cloudflare.com/durable-objects/platform/pricing/ (Free alarm requests, duration, storage)
- https://developers.cloudflare.com/durable-objects/platform/limits/ (DO CPU, memory, wall limits)
- https://developers.cloudflare.com/durable-objects/api/alarms/ (programmatic alarms; at-least-once)
- https://developers.cloudflare.com/workers/languages/python/ (Python Worker)
- https://developers.cloudflare.com/workers/languages/python/packages/ (supported package types)
- https://developers.cloudflare.com/workers/languages/python/packages/fastapi/ (ASGI adapter)
- https://developers.cloudflare.com/workers/configuration/cron-triggers/ (bootstrapping)
- https://developers.cloudflare.com/containers/platform/pricing/ (Containers require Paid)
- https://docs.deno.com/deploy/changelog/ (credit-card verification restriction)
- https://www.back4app.com/blog/run-a-bot-webhook-or-cron-24-7-without-a-vps (Free 60-minute test)
- https://support.zerodha.com/category/trading-and-markets/general-kite/kite-api/articles/static-ip (fixed IP mandate for **order placement**, not read-only market data)
- https://kite.trade/docs/connect/v3/exceptions/ (request rate limits)

**Do not renew Kite subscription, approve UPI AutoPay, create cloud infrastructure, or claim live performance at this stage.**