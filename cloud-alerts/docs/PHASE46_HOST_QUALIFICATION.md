# Phase 46 — host suitability gate and live deployment blocker audit

**Date:** 2026-10-23. **Status:** local implementation and synthetic end-to-end rehearsals only. No cloud host activated, no live credentials used, no real orders, no spending limits altered.

## What was verified without creating a cloud resource

1. Inspected the connected Render workspace read-only. Its existing Free web services are associated with **other repositories**, while the existing Free PostgreSQL instance is suspended. None is an approved persistent always-on host for this NIFTY project. No service or database was modified or repurposed.
2. Render's current official [Free service documentation](https://render.com/docs/free) says Free web instances spin down after 15 minutes without inbound HTTP/WebSocket activity and do not have durable local files; Free web services cannot attach persistent disks. The paper bot must independently collect 5m candles/quotes even with no incoming requests, and its encrypted daily token + SQLite account journal require durable storage. Therefore **Render Free is a HARD NO for the actual unattended worker**, not an option to keep awake using pings.
3. On authorized Nirala Ubuntu 24.04 WSL 2 / Python 3.12, ran the existing `python -m cloud_alerts.loopback_smoke --json` against real localhost Uvicorn processes. It **PASSED all 12 reported synthetic checks**: local HTTP signing, nonce replay/tamper rejection, encrypted token, private file mode, process restart, nonce persistence, newer token rotation and rollback refusal. It uses synthetic credentials and **does not test real public TLS, Telegram, Kite, or cloud restart**.
4. Implemented `cloud_alerts.host_qualification` with strict typed and fresh operator declarations and **blocker codes only**. It rejects sleeping/ephemeral Render Free even when every other declaration is marked true; it also refuses missing fields, extra secret-like fields, out-of-date or future evidence, nonliteral-boolean confirmations, static/sleeping service classes, and nonverified free cost/overspend controls.
5. The result `DECLARATIONS_COMPLETE_ONLY` **never** authorizes provisioning/deploying and never claims billing, TLS, restart durability, or phone reception were independently verified. That host acceptance remains separate from both developer code tests and contract/signal tests.
6. Added `deploy/host-plan.example.json` which **intentionally fails** with Render Free and unconfirmed free-spend and always-on declarations. Do not change it to pass without reviewing the actual host and receiving operator approval.
7. Final Phase 46 complete WSL Python 3.12 suite on branch commit **\`d30fecf\`**: **608 passed, 0 failed, 1 skipped**, 1 upstream TestClient deprecation warning, exit **0**, in 27.64 seconds. The default-blocked plan file and its regression test are included.

## Running the plan gate locally, never with broker secrets

```bash
cd cloud-alerts
python -m cloud_alerts.host_qualification --plan deploy/host-plan.example.json --json
# EXPECTED: exit 2, BLOCKED and RENDER_FREE_SLEEP_AND_EPHEMERAL_STATE
```

The JSON must contain **no cloud passwords, API keys, Kite token, Telegram credentials, bank card data or user identifiers**. The gate reads only the file passed explicitly and never calls a provider or changes resources. Passing self-reported fields is only structural and not a substitute for inspecting billing protections, persistent storage, secure HTTPS DNS, firewall ingress, provider uptime, and actual restarts.

## Why no real deployment happened this phase

- The only **connected** cloud provider is Render; the verified existing services are Free and/or for unrelated projects, so none meets the immutable persistent SQLite/vault + unattended 5m collection requirement.
- Azure for Students or OCI Always Free might be appropriate **after** an eligible subscription/tenancy and available quotas are verified. No such account, quota, hard spending guard, disk or DNS has been established via authorized connected provider tools, so there is no safe resource to provision. Creating or upgrading paid infrastructure or altering spending settings requires explicit approval.
- Real daily Zerodha token data remains exclusively in its protected Windows project; the Linux QA environment never reads it. Cloud remains disconnected; phone delivery with Nirala off and five sessions are **not verified**.

## Exact next actions

1. Identify an authorized existing Azure for Students/OCI tenancy with sufficient covered compute + public IP + durable block storage, independent of Nirala; check hard budget cap/provider eligibility and get specific host approval before creating resources.
2. Verify TLS-restricted inbound `POST /internal/token`, private persistent state surviving actual host reboot, one worker and a live host status probe. Continue to keep monitoring/paper flags OFF until these pass.
3. Handoff one valid same-day Kite token from Nirala through the reviewed HTTPS endpoint after legitimate daily user login. Verify actual REST 5m/15m candles and options depth (read-only).
4. Send a clearly marked Telegram TEST alert and confirm its **physical phone receipt while Nirala is OFF**. Then record five separate actual NSE sessions with real quotes, hypothetical fills and failure/latency metrics. No real orders at any phase.

**Progress measurement:** the prior expanded engineering index was 53%; provider activation / live acceptance **remain 0/5**. Completing local host-plan validation and localhost smoke does NOT justify claiming a running autonomous cloud trading service.
