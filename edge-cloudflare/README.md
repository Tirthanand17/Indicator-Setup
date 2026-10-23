# Offline Cloudflare migration — scheduler and numerical core

**IN DEVELOPMENT / PAPER ONLY. NOT DEPLOYED.** Checklist15/25 (60%), live acceptance0/5; [canonical progress](../cloud-alerts/docs/PROGRESS.md).

`worker.mjs` exports a Worker and `MarketSession` Durable Object. Only authenticated POST `/internal/bootstrap` with empty body and GET `/internal/scheduler` are supported. `SCHEDULER_ADMIN_KEY` must be32–256 characters with at least8 distinct characters; `OFFLINE_SCHEDULER_ENABLED` must explicitly be `true`. Authentication is checked before accessing the binding and again inside the object. The example disables scheduling and workers.dev/preview URLs.

SQLite-backed DO transactions persist claim and next alarm atomically. The constructor does not schedule. Duplicate ticks cannot claim twice across restart; delayed slots are dropped, not replayed. Corrupt state is preserved for diagnosis and alarms stopped; bootstrap cannot overwrite it. Clock rollback, unsupported year and4096 callbacks/UTC-day halt scheduling. Diagnostics retain128 events, not a complete paper ledger.

`alarm-core.mjs` uses verified2026 NSE F&O regular sessions09:15–15:30 IST with requested20-second slots. No callback SLA is claimed. `strategy-core.mjs` ports VWAP, EMA, Wilder DMI/ADX/ATR and versioned fees. Three synthetic indicator fixtures match Python within1e-8;36 fee cases match exactly in paise. Full strategy decisions/exits are not ported.

## Offline verification

```sh
node --test edge-cloudflare/*.test.mjs
cd edge-cloudflare
npm ci --ignore-scripts
npm run test:runtime
```

24 edge tests pass (9 alarm,10 worker,5 parity), plus1 native local workerd SQLite test. `runtime/harness.mjs` is LOCAL TEST ONLY with synthetic clock/test endpoints and outbound traffic rejected. Never deploy it. The native test verifies transaction rollback of values/alarms and persistence across Miniflare restart, not hosted scheduling. `generate_parity.py` regenerates Python reference fixtures; review changes explicitly.

## Remaining migration

Worker status explicitly reports `marketRuntimeImplemented:false`. It does not fetch Kite data, accept daily tokens, maintain portfolios, send Telegram, serve a mobile dashboard or export paper history. Those are required before full end-to-end/capacity verification. The Python monolith is not a drop-in Worker deployment.

`wrangler.example.jsonc` is an undeployed template. No deploy/migration command was run. See [audit](../audit/FULL_PROJECT_AUDIT_2026-10-23.md) for capacity forecast and dependency blockers. The [deployment gate](../cloud-alerts/docs/DEPLOYMENT_APPROVAL_REQUEST.md) is a draft awaiting prerequisites, not permission to create resources.
