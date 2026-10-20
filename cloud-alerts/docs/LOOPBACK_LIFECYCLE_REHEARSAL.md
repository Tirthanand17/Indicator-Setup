# Phase 30 — real HTTP loopback token and process-restart rehearsal

**Status:** performed offline, on a private localhost test service, using *only synthetically generated* credentials and a temporary SQLite directory. **NOT** a cloud VM, production TLS validation, live Kite market-data call, or Telegram handset receipt.

## Run the rehearsal

From `cloud-alerts/` with its pinned Python dependencies installed:

```bash
python -m cloud_alerts.loopback_smoke --json
python -m pytest -q
```

It starts actual Uvicorn worker processes bound exclusively to `127.0.0.1`, rather than an in-memory FastAPI TestClient. The script creates its own **short-lived synthetic** Kite-shaped API key and access token, HMAC relay key, Telegram-shaped mock strings, Fernet vault key and private temporary state directory. It explicitly refuses to copy existing operator credentials or inherited broker/Telegram environment variables into the subprocess. All subprocess stdout/stderr is suppressed to avoid accidentally echoing request data; the program emits only safe boolean/test-status fields.

Rehearsal assertions:

1. First Uvicorn worker starts and serves `/healthz` on loopback.
2. Monitoring remains disabled; `/readyz` responds 503. No broker or Telegram API client is invoked.
3. Actual HTTP `POST /internal/token` with a signed synthetic token is accepted.
4. Reusing the signed nonce returns 409. Altering the nonce without recomputing HMAC returns 401.
5. The disk vault contains encrypted ciphertext, not the bearer token; private token/SQLite file modes are enforced on POSIX.
6. The first server stops; a **separate new OS process** starts with the same transient private directory.
7. Encrypted token remains readable with the synthetic test key after restart. Reusing the previously claimed HMAC nonce still returns 409 because replay protection persisted in SQLite.
8. The second server responds to `/healthz`; everything is removed when the temporary directory is destroyed.

The loopback HTTP client disables proxies, so inherited `HTTP_PROXY`/`HTTPS_PROXY` settings cannot send synthetic data to an outside intermediary. The ordinary token-sender still **requires HTTPS** and intentionally refuses `http://127.0.0.1/...` as a real handoff target.

## Deliberately not validated

- The host preflight's private durable mount requirement is **not bypassed in production**. Temporary local storage is used for this smoke test only.
- Docker image/Compose build, Caddy routing, DNS, public certificate, reverse-proxy policy, egress networking and host shutdown/restart are **not tested**. Docker is unavailable in this development environment.
- Live paid Kite Connect credentials or futures/option market data, Telegram API acceptance or real phone delivery are **not tested**.
- No cloud service was created or activated; no charges were made. A provider-hosted VM, private durable volume, host eligibility verification and operator approval remain necessary.
- This test does not establish a profitable signal, latency guarantee, production service-level availability, or suitability for real-money trading.

**Acceptance gate:** operator must separately verify an approved always-on host, private persistent volume, valid TLS certificate, signed real daily token transfer, read-only paid Kite API data, actual Telegram TEST phone receipt, and five complete market sessions before claiming laptop-independent operation.
