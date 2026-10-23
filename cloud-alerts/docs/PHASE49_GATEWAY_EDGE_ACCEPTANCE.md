# Phase 49 — public gateway HTTPS acceptance probe (NOT DEPLOYED)

**Date:** 2026-10-23. **State:** source and local Linux validation only. Northflank account plan, billing cutoff, cloud network, disk, HTTPS hostname and phone delivery remain **UNVERIFIED**. No cloud resources, secrets, user-domain DNS records, broker orders or subscription changes have been made by this phase.

## New independent evidence

- After Phase 48 was merged, checked the committed Northflank gateway `Caddyfile` using official Caddy **v2.11.7** on Ubuntu 24.04 WSL. The tarball's SHA-512 matched the checksum published in the official Docker Hub `caddy:2-alpine` layer: `a7a433a1b133efc3c8d10eb0b99d52a24b5ef5c322dc77f5282182b1c0402139ab83f3a99f0c52409df77d20123fb0b523edad8a66d8f5e49136197bf61ef0e7`. `caddy validate --config ... --adapter caddyfile` returned **Valid configuration, exit 0**. A non-blocking indentation/formatting warning remains; this was not a Docker or functional routing test.
- Added a dedicated **opt-in unauthenticated HTTPS policy probe** in `cloud_alerts/gateway_acceptance.py`. Its offline mock tests run without network, DNS, Zerodha, Telegram, or browser sessions.
- The probe requires HTTPS port 443, a public hostname and exact `/internal/token` URL; refuses network execution without `--confirm-network-checks`; follows no redirects; verifies TLS; ignores proxy environment settings; reveals no full URLs in the result; never reads or sends real broker/dashboard credentials.
- For a future **approved** deployed gateway it will verify:
  1. `GET /gateway-healthz` returns `200 ok` with cache/safety headers. This is **gateway** liveness, not worker/data freshness.
  2. All worker diagnostics, admin-like paths, nonallowlisted public paths and unauthenticated GET requests to the four paper JSON APIs are denied.
  3. GET-only route policy rejects POST and HEAD on the wrong endpoints.
  4. A paper dashboard disabled at the worker returns 404, or an explicitly enabled HTML-only shell returns 200 with restrictive CSP, while JSON endpoints remain anonymous-denied.
  5. Harmless unsigned `POST /internal/token` returns 401; a synthetic 2049-byte POST returns 413, proving the 2 KiB cap.
- Neither a PASS nor a healthy gateway is proof of safe Northflank billing, private worker networking, cloud data persistence, actual Kite candles, Telegram phone delivery, unattended uptime, or profitable hypothetical trades.

## Run it only after specific no-charge host approval

From the repository's `cloud-alerts` directory:

```bash
python -m cloud_alerts.gateway_acceptance \
  --endpoint 'https://YOUR_REAL_APPROVED_HOST/internal/token' \
  --confirm-network-checks \
  --json
```

Add `--dashboard-enabled` **only if** `PAPER_DASHBOARD_ENABLED=true` was deliberately configured after the user approved the secure host, with the separate high-entropy dashboard secret already present in the private worker environment. Never put that secret on the command line or in GitHub. This probe deliberately sends no keys.

## Next blocking steps

1. User is already signed in to Northflank in a local Chrome tab. **Do not open a separate cloud browser or assume that session is exposed to the agent.** A nonsecret screenshot or a supported authenticated Northflank connection must establish: Sandbox Free selected; **no credit card; no paid conversion or overage obligations; compute + persistent volumes + network covered at ₹0**.
2. Confirm Northflank service shape quotas, persistent-volume mounting and private service connectivity for this exact two-service topology, and cost cutoff behavior. If an unavoidable paid resource appears, stop and present amount; never create it.
3. Get specific approval for any resource creation after the plan review. Keep worker port private, volume single-writer, all live/paper flags false, and secrets absent during initial deploy.
4. Run this external probe with synthetic/disabled services and run more complete private-volume, HMAC replay, network, restart tests before adding real Kite/Telegram secrets.
5. Renew the Kite subscription **only after** the platform passes synthetic cloud qualification. Five actual NSE session reports and independent phone receipts are still required for live monitoring acceptance. Never enable real broker order placement.

**Engineering estimate:** still 53%. **Actual cloud acceptance:** still 0/5. Linux targeted policy suite: **31 passed** including 25 newly added synthetic probe tests and the six static Phase 48 tests; full Python 3.12 Linux suite: **647 passed, 0 failed, 1 skipped, 1 third-party deprecation warning, exit 0** (2026-10-23) in an isolated clean QA checkout.
