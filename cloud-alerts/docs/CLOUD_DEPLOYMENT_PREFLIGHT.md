# Cloud deployment preflight: secure, single-worker, no new charges

**Status (19 Oct 2026):** implementation and offline tests only. **Not deployed. No live cloud alerts.** This document never grants permission to activate billing, connect third-party accounts, or trade.

## Why this gate exists

The market bot must run **independently of Nirala** after a successful *same-day, authorized* Kite token transfer. A web service that sleeps, container overlay files that disappear during a restart, or leaked secrets can silently break alerts. Passing this check proves only that **local cloud configuration seems structurally safe**; it does not prove an SLA, market data, Telegram delivery, or live trading performance.

The worker remains strictly read-only. It must never import Kite order methods, act on account holdings, or claim option profit.

## Requirements before deploying

1. Explicit approval of the specific host, region and **₹0 incremental cost** configuration. Verify that eligible credits/Always Free limits cover the VM, public IPv4, disk, network and backup. The bot MUST NOT be deployed automatically to an existing unrelated Render service.
2. One always-on Linux VM/container, one worker/replica, NTP-correct clock, inbound HTTPS `443` with a trusted certificate, and outbound HTTPS access to Zerodha and Telegram. Expose container port 8080 on localhost only.
3. Private Docker named volume mounted at `/data/nifty-alerts`, owned by UID `10001`, permissions `0700`, with **at least 100 MiB free**. Volume survival across host/container restart must be separately demonstrated. Do not use ephemeral container overlay/tmpfs or an in-memory SQLite database. Keep volume backups encrypted if backups are enabled.
4. Create `/private/nifty-alerts/worker.env` **on the approved VM, outside this GitHub repo**, readable only by the operator/root; use chmod `0600`. Required variables: `KITE_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TOKEN_RELAY_HMAC_KEY` (random >=32 chars), `TOKEN_VAULT_KEY` (valid Fernet key). Use `ALERTS_ENABLED=false`, `KITE_SHADOW_ENABLED=false`, `PAPER_PREMIUM_TRACKING_ENABLED=false` until all live acceptance tests are complete. Never put a Kite API secret in this file; cloud only needs the public API key and daily **access token** via authenticated relay.
5. A public HTTPS ingress must route only `/internal/token` to the local worker, with a strict body limit and rate limiting. Do not expose `/healthz`, `/readyz` or `/operationalz` to the public if avoidable. The relay uses HMAC, 90-second freshness and nonce replay blocking, but HTTPS is still mandatory. The exact DNS name must be reviewed before any sender is configured.

## Runbook (do not execute until host approval)

```bash
# On the approved VM after operator separately installs Docker and Compose:
# compose.yml contains no credentials; environment file lives OUTSIDE repository
cd /srv/indicator-setup/cloud-alerts

docker compose -f deploy/compose.yml config --quiet
# Build only: no service starts, no token changes and no real alerts
docker compose -f deploy/compose.yml build
# Start only after hosting and cost approval, with alerts disabled
docker compose -f deploy/compose.yml up -d
# Inspect safe startup report. Avoid copying full container env into chat.
docker compose -f deploy/compose.yml logs --tail 50
```

The image now runs `python -m cloud_alerts.preflight --json` **before Uvicorn**. On failure, it exits nonzero and emits only blocker codes, such as `MISSING_TELEGRAM_BOT_TOKEN`, `STATE_DIR_PERMISSIONS_TOO_OPEN`, `PERSISTENT_NON_EPHEMERAL_MOUNT_NOT_VERIFIED` or `INSUFFICIENT_PERSISTENT_STORAGE`. It never prints secret values and makes no external network requests. Host volume proof is conservative but not sufficient to verify durability: independently restart the container/VM and verify encrypted state persists.

### Local dry checks (no network)

```bash
python -m pytest -q
python -m compileall -q cloud_alerts
# This is EXPECTED to return exit 2 on a laptop with no approved cloud mount/secrets:
python -m cloud_alerts.preflight --json
```

### Acceptance sequence

1. Independently verify VM cost coverage and uptime (with real billing controls and alerts); public code or tests cannot verify this.
2. Start **with `ALERTS_ENABLED=false`** and verify preflight, liveness, stop/restart and persistent volume. Confirm exactly one worker.
3. From a trusted local machine after valid Kite login, run the existing token sender **read-only** against the explicit HTTPS endpoint; no tokens in logs, GitHub or chat. Confirm the cloud vault survives restart, has next-day 06:00 IST expiry, and never contains the API secret.
4. Send a distinctly labeled TEST message from the cloud only after secure Telegram configuration and approval; verify **phone receipt** manually, log timestamps and lag. A Telegram HTTP 200 alone does not establish phone delivery.
5. Monitor completed 5-minute REST candles, option quote/depth freshness and `NO_TRADE` decisions during a real session. Do **not** enable paper BUY/SELL notifications until data quality and alerts are accepted.
6. Run at least five real market paper sessions and evaluate expired/missed/duplicated alerts, provider outages, candle timeliness and after-cost option-level evidence. Even then, no real orders.

## Rollback

Disable `ALERTS_ENABLED`, stop the worker, and **retain volume encrypted** for postmortem. If secrets were exposed, revoke the Kite access token via authorized logout, rotate Telegram token and relay secret, and rotate cloud vault key only after a documented secure re-encryption or intentional token reset. Never upload secrets or persistent volume to the **public** GitHub repository.

## Known limitations

- A Docker volume may appear persistent inside a running container but still be deleted by a misconfigured VM or infrastructure. The preflight cannot prove host-level retention or billing.
- This manifest binds application port only to `127.0.0.1`; it **does not provide an HTTPS reverse proxy, DNS, firewall policy, outbound network assurance or hosting account**.
- The Windows daily login and token-handoff process still requires the user's authorized action; the host cannot read the PC `.env` after shutdown.
- Free Render web services are not an assured always-on service. An Oracle or Google Always Free VM still requires verified eligibility, account setup and quota, and may have capacity limits.
