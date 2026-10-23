# Cloudflare alarm prototype — offline only (Phase 54)

**Deployment status:** NOT DEPLOYED. This folder does **not** create a Cloudflare account, Worker, Durable Object, database, API token, custom domain, payment mandate, or production alert. It does **not** fetch Kite data, send Telegram messages, or place real broker orders.

## What is implemented

- `alarm-core.mjs` is a deterministic, dependency-free JS module for a potential Cloudflare Durable Objects alarm handler. Given observed/scheduled epoch milliseconds, a pinned calendar version, and the previous claimed tick ID, it returns a frozen synthetic eligibility decision. No I/O or side effects.
- Uses fixed **Asia/Kolkata UTC+05:30** clock conversion and pinned **2026 NSE F&O regular-session** weekday/holiday list matching `cloud-alerts/cloud_alerts/trading_calendar.py`.
- Eligible regular session: **09:15:00 through 15:29:59.999 IST**, nominal 20-second anchored ticks. Alarm callbacks **may be late or duplicated**; lateness of 20 seconds or more is dropped rather than replayed. A repeated previously claimed tick is dropped.
- When the market closes or a weekend/known holiday intervenes, returns the **next verified 09:15 opening** to re-arm. No 2027 schedule is guessed; annual calendar updates and exchange exceptional-session announcements require a new checked release.
- Always returns `realOrdersEnabled: false`. `shouldPoll: true` means only that an **offline synthetic tick is eligible for downstream freshness checks**. It does **not** permit a trade, even on paper, without the main engine's verified data/portfolio logic.

## Offline verification

From repository root on Node 20+:

```sh
node --test edge-cloudflare/alarm-core.test.mjs
```

The suite covers market open/cutoff, 20-second alignment and late wakeups, weekends, pinned holiday, next-day re-arming, duplicate claims, unsupported year, invalid inputs and immutable no-real-orders results. No credentials or external network required.

## Critical work NOT completed

1. Implement and offline-test an actual **Cloudflare Worker + SQLite-backed Durable Object** handler. It must read and atomically commit `lastClaimedTickId` and `nextAlarmAtMs` in transactional durable storage **before** side effects, so simultaneous or retried alarms cannot double-send. Alarm scheduling must survive restarts.
2. Port the existing Python Kite quote freshness gates, alerts outbox, complete options paper portfolios, market history and authentication to a runtime that meets Workers/Durable Objects Free CPU, memory, request, storage and outbound network limits. The Python FastAPI/Kite SDK process is **not a drop-in deployment**.
3. Validate hosting's genuine **no-card/no-UPI-AutoPay/₹0** eligibility for this user's account, quotas, operational latencies, custom domain and restore/export plan. An advertised free tier is not a contractual hard zero-cost guarantee.
4. Obtain **fresh explicit user approval** before any signup/project/Worker/DO/domain/secret/payment action. No card, UPI mandate, payment verification hold or paid upgrade is allowed.
5. Run five independent live acceptance gates after separate approved provisioning: actual Kite read-only quote/candle flow, phone Telegram delivery, uninterrupted session alarms, paper dashboard persistence/recovery, and laptop-off operation. Keep **broker execution disabled**.

**Today:** expanded engineering scope **53% estimated**, live-cloud acceptance **0/5**, production/paper autonomy **not live**. This prototype changes neither figure.

See `cloud-alerts/docs/PHASE53_CLOUDFLARE_DURABLE_OBJECTS_FREE_FEASIBILITY.md` for eligibility limitations.
