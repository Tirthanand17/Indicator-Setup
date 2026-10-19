# Single-worker and secure token-ingress readiness — Phase P4/P5 preparation

**Implementation dated 2026-10-19; 106 offline tests passing.** No cloud host was created, no live phone message was delivered, and the original `Automation Day Trading` folder was not changed.

## Deployment invariants

1. Deploy **exactly one** Linux Uvicorn process with `--workers 1`, **one** writable private persistent `STATE_DIR` mounted into the container, and **one** replica for this service. The Linux `fcntl` lock is deliberately fail-closed if two processes use the **same** directory. It cannot stop separate hosts with different volumes; disable horizontal scaling and duplicate platform deployments.
2. The singleton lock is an ordinary 0600 file in `STATE_DIR`, held for the full FastAPI lifecycle and released during shutdown. Symlinked root or lock path is rejected. Do not delete the lock file while running.
3. The `/internal/token` HTTPS handoff accepts signed JSON payloads of at most **2048 bytes**, enforced both against Content-Length and while reading the stream. Oversized/invalid requests never consume the replay nonce. Put a reverse-proxy size/rate limit, TLS and allowlisted ingress in front of it. Never send access tokens through GitHub, chats or URL query parameters.
4. Public `/healthz` is **liveness**. It returns 503 and `worker_running:false` if the background worker has died; it never returns tokens, phone IDs or message bodies. Use it for the container health check. `/readyz` is a **limited configuration check**, returns 503 until alerts are enabled *and* a daily token exists. It is **not** proof the token works against Kite or that Telegram can reach the user's phone; never use `/readyz` as an automatic container restart probe.
5. `ALERTS_ENABLED=false`, `KITE_SHADOW_ENABLED=false`, and `PAPER_PREMIUM_TRACKING_ENABLED=false` remain the safe startup defaults. Switch on only after explicit approved host, data, notification and paper controls pass. **The service contains no broker order methods.**
6. `Dockerfile` is a non-root worker with one process and a standard-library liveness probe. Docker health status alone does not establish end-to-end Telegram delivery or that the host will stay awake.

## Offline verification

From the standalone `cloud-alerts` directory run:

```bash
python -m pytest -q
```

New unit/integration tests include a second live FastAPI instance sharing `STATE_DIR` being refused, success on clean restart, rejected lock symlinks, 0600 permissions, bounded token request size, HMAC challenge, and a dead engine returning HTTP 503.

## Remaining approval and proof

- Obtain the owner's explicit permission for a specific **genuinely always-on** host and **verified ₹0 incremental-cost** setup. Never sign up, associate a payment method or enable billing without approval.
- Verify `STATE_DIR` is a persistent volume by forcibly restarting a *non-live* trial worker and checking encrypted vault, nonce and outbox persistence. Docker named volumes are not a guarantee of provider-level durability or backups.
- Confirm real Kite access tokens expire/rotate correctly, a real broker 5-minute close is available, and Telegram **TEST** reaches the phone. Measure exchange close → quote accepted → Telegram API accepted → device receipt with timestamps.
- Run five full paper market sessions and collect missed bars, stale quotes, outbox retries/expiry, shadow reconciliation and delivery latency. Do not claim strategy profitability from passing unit tests.
