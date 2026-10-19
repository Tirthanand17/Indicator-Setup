# Operator runbook: cloud without Nirala staying on

**Current status:** blueprint and tested local code, **not connected to a cloud host**. No paid services, deployments, Kite API authentication, or broker orders were initiated. Host selection and connection require operator approval. These commands are for later operator-reviewed setup; do NOT run live without reviewing security, costs and logs.

## 1 — Choose the cloud host first

See [HOSTING_EVALUATION.md](HOSTING_EVALUATION.md) for verified current provider policy, OCI/Google Always Free candidates, specific account eligibility dependencies and zero-additional-charge rules. No cloud host has been approved and provisioned.

For reliable phone alerts **while Nirala is switched off**, use an **always-on cloud instance** with HTTPS and private persistent storage, either a suitable VM you already have/verified credits or a paid long-running worker behind a tiny HTTPS endpoint. A service that idles/sleeps can miss candle boundaries, and a free ephemeral disk can lose the encrypted daily token on restart.

**Do not use GitHub Actions scheduled every five minutes for an intraday WebSocket trading monitor:** schedulers can delay and quotas can exhaust; logs are not secret storage. **Do not assume Render's free web service is always-on**: it can spin down after 15 minutes without *inbound* traffic, restart, and lose local files. For this plan, do not enable billable services or attach payment methods without user approval and verified budget limits.

## 2 — Provision secrets ONLY in the host's protected secret store

| Name | Meaning | Where stored |
|---|---|---|
| `KITE_API_KEY` | API app key (the `.env` in protected trading folder contains it) | Cloud secret store AND local relay env |
| `TELEGRAM_BOT_TOKEN` | Telegram bot owned by the user; distinct from Kite API key | Cloud secret store |
| `TELEGRAM_CHAT_ID` | Paired private chat ID (not a public group) | Cloud secret store |
| `TOKEN_RELAY_HMAC_KEY` | Random >=32-character shared secret used to authenticate HTTPS daily token handoff | Cloud secret store AND Nirala **outside protected folder** |
| `TOKEN_VAULT_KEY` | Fernet encryption key for token ciphertext on persistent disk | Cloud secret store only |
| `STATE_DIR` | `/data/nifty-alerts` mounted persistent private volume | Hosting config |
| `ALERTS_ENABLED` | `false` until all gates pass, then `true` | Hosting config |
| `KITE_SHADOW_ENABLED` | `false` by default; optional diagnostic WebSocket, never entry authority | Hosting config |
| `PAPER_PREMIUM_TRACKING_ENABLED` | `false` by default; optional virtual BID stop/target review polling, **not holdings** | Hosting config |

Use local Python to generate two **separate** keys, and enter them directly in protected provider settings, **never a public GitHub file**:

```bash
python -c 'import secrets; print(secrets.token_hex(32))'          # HMAC shared secret
python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'  # vault key
```

The original `ZERODHA_KITE_API_SECRET` is NOT required by the worker: daily tokens are already generated in the user's trading project. Do not copy the API secret to cloud.

## 3 — Run the read-only cloud worker

```bash
# On an approved ALWAYS-ON cloud host, after setting protected environment variables,
# mounting persistent /data/nifty-alerts, and configuring HTTPS TLS termination:
docker build -t nifty-readonly-alerts ./cloud-alerts
# Example only. Configure port, access controls and the persistent storage correctly.
docker run --name nifty-alerts --restart unless-stopped --env-file /private/alerts.env \
  -v nifty_alert_state:/data/nifty-alerts -p 127.0.0.1:8080:8080 nifty-readonly-alerts
```

**Do not expose :8080 on the public Internet without an HTTPS reverse proxy.** `/internal/token` is signed and replay-protected but still carries a bearer token over HTTPS; rate-limit and secure that endpoint. Run only **ONE** worker. Check `/healthz` returns `DISABLED`, `WAIT_TOKEN`, or another safe state without secret values. Cloud deployment must be guarded behind cost approval.

## 4 — Daily token handoff after your usual Zerodha login

Zerodha retail Kite access tokens usually expire by **06:00 IST next day**, so on every trading morning you must complete normal broker login/authentication. Your already-existing trading project writes the newly generated `ZERODHA_KITE_ACCESS_TOKEN` to its local `.env`. This project has **READ-ONLY permission** for that folder and will not modify any file in it.

A human-approved local helper runs **outside** the protected trading folder with 3 environment variables already configured on Nirala: `KITE_API_KEY`, `KITE_ALERT_TOKEN_ENDPOINT` (the approved HTTPS endpoint ending `/internal/token`), and `TOKEN_RELAY_HMAC_KEY`. Example:

```powershell
# One-time local check: no token is printed, sent or changed.
python -m cloud_alerts.token_sender --env-file "<EXISTING_TRADING_FOLDER>\.env" --check-only

# After cloud HTTPS endpoint and relay secret are configured, one explicit handoff:
python -m cloud_alerts.token_sender --env-file "<EXISTING_TRADING_FOLDER>\.env" --push

# Optional: starts on Nirala, observes token changes every 45 seconds (READ-ONLY),
# uploads after the usual daily authenticated login; you may then turn Nirala OFF.
python -m cloud_alerts.token_sender --env-file "<EXISTING_TRADING_FOLDER>\.env" --watch
```

**Note:** `--watch` must actually be running when you update the `.env`. A cloud server cannot read your local `.env` after the PC is off. A future Windows Task Scheduler job may start `--watch` at login, using scripts located **outside** the trading folder. This is NOT enabled by the repository code.

**Confirmation:** local sender prints only `Token handoff accepted by cloud`; `/healthz` should progress from `WAIT_TOKEN` to `WAIT_DATA`, then `NO_TRADE` / `REVIEW_CE` / `REVIEW_PE` as valid market data arrives. On provider restart, cloud reloads ciphertext from persistent volume, as long as its vault key is unchanged and session valid.

## 5 — Telegram readiness

The existing Chrome extension already paired a Telegram bot, but the **cloud worker does not inherit the extension's credentials automatically**. Set the bot token and chat ID in **cloud secret settings** through an approved secure user action. Do **not** export them through GitHub commits, public code, Chrome debugging logs or chat screenshots.

First send a **TEST** message using a separate approved secure integration procedure, verify it reaches your own private phone chat, and capture server time → Telegram accepted time → phone observed time. The cloud prototype has no publicly accessible test message endpoint to prevent random users from sending messages.

## 6 — Trading-day gates and monitoring

**09:00–09:15**: verify token handoff (after legitimate login), correct dynamic futures/expiry, API subscription, cloud clock/NTP, Telegram chat, connection health and no stale position.

**09:15–09:30**: collect data and validate bars; by default do not send entries before 09:30.

**09:30–15:00**: every **completed** 5m candle (plus >=8s publication allowance), recompute VWAP/EMA/DMI/ADX/ATR, confirm separate 15m context, get actual option depth and decide `REVIEW_CE` / `REVIEW_PE` / `NO_TRADE` / `WAIT_DATA`.

**15:00–15:25**: no new entries. Track hypothetical exit review and summarise errors. Cloud status doesn't imply actual options have been sold.

**After market**: retain audit status and inspect failures. **No auto trades**.

## 7 — Shadow monitoring and faster-feed research

REST 5m history is dependable for candle-close research but may be slower than a live-tick stream. A synthetic-tested shadow KiteTicker monitor is **now integrated** behind `KITE_SHADOW_ENABLED=false`, with strict timestamp/volume checks, automatic socket lifecycle and REST candle reconciliation. It does **not** produce trading alerts. An actual paid Kite websocket connection, restart test, live reconciliation coverage, quote-based premium exits and latency metrics are **NOT YET VERIFIED**. Do not enable shadow capture until a reviewed host and secrets configuration are ready.

## 8 — Rollback and incidents

- If cloud feed is stale or quote depth cannot be verified → `WAIT_DATA`, **no candidate alert**.
- If Telegram API fails → keep outbox pending and retry. Crash after Telegram accepted may duplicate; review candle timestamp before acting.
- If secret exposed → revoke access token using broker logout, rotate HMAC shared secret, Telegram bot token as needed, and vault encryption key after securely re-encrypting or discarding ciphertext. No credentials in Git history.
- If container restarts without a persistent volume → `WAIT_TOKEN` until re-synced.
- If there is a billable host shortage or remaining credit uncertainty → STOP deployment, obtain explicit approval.
- Previous GUI extension may stay installed, but prevent **duplicate** cloud + Chrome market alerts during rollout by disabling one notifier once cloud validated.

## 9 — Acceptance checklist

- [ ] Cloud host chosen, cost approval documented, always-on proof and storage persistence tested.
- [ ] DNS + HTTPS + restricted ingress and health setup verified.
- [ ] No real credentials or API secret in GitHub public repo or logs.
- [ ] Daily local `.env` bridge works via one-way authenticated HTTPS and does not alter any protected file.
- [ ] Broker access token is accepted, expires/refreshes on schedule, and authentication failure is visible.
- [ ] REST historical 5m and 15m match exchange timestamps and Kite visual study outputs within documented tolerances.
- [ ] Contract selection, actual option quotes, lot size and spread rules checked with real market samples.
- [ ] Test Telegram message appears on phone; at least one **synthetic simulated candidate** checks message pipeline without misleading live trade labeling.
- [ ] At least five full live sessions tested with missed-bar and end-to-end latency metrics; completed-bar integrity verified.
- [ ] Separate out-of-sample OPTION backtest supports an economically meaningful, after-cost hypothesis. Until then **paper only**.

## Optional P7 premium review (no deployment yet)

See [PREMIUM_EXIT_MONITOR.md](PREMIUM_EXIT_MONITOR.md). It defaults to OFF and is strictly virtual: a signal-time ASK is not a purchase fill, and later BID observations are not realized P&L. Host operators should only enable `PAPER_PREMIUM_TRACKING_ENABLED=true` after real-data freshness, Telegram confirmation and acceptable polling quotas have been tested. It never places an order or reads holdings.

## Additional P4 operational monitoring (2026-10-19)

Use **`/operationalz`** as a nonsecret operator diagnostic only, never as the Docker restart/liveness probe. It returns HTTP 200 only after the evaluator is enabled, daily token is present, one worker is running, a valid REST `NO_TRADE`/`REVIEW` decision is newer than 420 seconds during the supported session, and no phone messages are queued. It reports `phone_receipt_verified=false` even on success. During weekends, before 09:30, after 15:25 or before the first successful REST decision, HTTP 503 is normal. See [operational readiness reference](OPERATIONAL_READINESS.md).
