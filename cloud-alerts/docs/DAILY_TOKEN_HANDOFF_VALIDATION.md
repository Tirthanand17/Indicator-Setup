# Daily Kite token handoff — end-to-end offline validation

**Date:** 19 October 2026. **Environment:** offline test environment; NOT an actual hosted cloud server. **Mode:** broker read-only, Telegram signal-review only, no orders.

## Security boundary

The operator's existing `C:\Users\Dell\Desktop\Automation Day Trading` folder is **READ ONLY** for this project. Never edit or copy its `.env` into the public repository. The local sender now retains ONLY `ZERODHA_KITE_API_KEY` and `ZERODHA_KITE_ACCESS_TOKEN` from that file; it never loads the API secret, unrelated application secrets, or account holdings. The user performs daily normal Zerodha login separately.

An operator-approved HTTPS endpoint ending **exactly** in `/internal/token` is required for any real transfer. The relay signs the request with HMAC-SHA256, nonce and timestamp. Server-side replay protection, strict 2048-byte body limit and encrypted Fernet vault already exist. The sender follows **no redirects** and uses a 10-second timeout. A confirmation means the server accepted and stored a *submitted token string*; it does **not** prove Kite will authorize that token, that broker market data is fresh, or that a Telegram message arrived.

## Verification performed

- Read-only fake `.env` unchanged byte for byte after parsing and transfer.
- Parser ignores unrelated settings and `ZERODHA_KITE_API_SECRET`; returns only the two required variables.
- Exact HTTPS endpoint validation rejects HTTP, embedded URL credentials, query strings, fragments, wrong paths and invalid ports.
- Synthetic sender signed request reached the actual FastAPI `/internal/token` handler through an in-process test client.
- Cloud returned `TOKEN_ACCEPTED`; replay of the same signed nonce returned HTTP 409; tampered body returned HTTP 401.
- Cloud wrote encrypted `token.enc`, not raw token bytes. A disabled market worker remained unready, even with a valid-looking test token.
- `--push` exits **nonzero** on timeout/rejection, logs a generic failure without exception content, and retains the source `.env` unchanged.
- `--check-only` performs **zero network calls** and exits nonzero when required keys are absent.
- `--watch` retries an unchanged token after transient failure rather than falsely marking the attempt as accepted.
- Python regression suite **143/143 passed**, including 7 new relay tests. No real Kite token, Telegram bot secret, live HTTPS host or account identity was used for tests.

## Morning routine after cloud hosting is explicitly approved

1. Finish authorized Kite login using the existing trading project's normal workflow. Confirm its `.env` was updated by that project; this bot does **not** edit it.
2. Install the **cloud-alerts** code separately from the protected trading directory. Verify Python dependencies and ensure an explicitly approved TLS host is configured.
3. Configure `KITE_API_KEY`, `KITE_ALERT_TOKEN_ENDPOINT`, and `TOKEN_RELAY_HMAC_KEY` as private **local** environment variables, not public GitHub content. The remote host separately needs the matching relay key, its own vault key, Telegram bot/chat settings and an encrypted persistent volume.
4. Run from the separate cloud-alerts checkout:

   ```powershell
   python -m cloud_alerts.token_sender --env-file "C:\Users\Dell\Desktop\Automation Day Trading\.env" --check-only
   python -m cloud_alerts.token_sender --env-file "C:\Users\Dell\Desktop\Automation Day Trading\.env" --push
   if ($LASTEXITCODE -ne 0) { throw "Kite token handoff NOT confirmed; do not shut down Nirala" }
   ```

5. Check private operator dashboard `/readyz` and `/operationalz` separately. **Do not interpret `/readyz` as verified Kite authentication** or `/operationalz` as phone receipt. A real API GET and a physical Telegram TEST receipt still need to be validated before relying on cloud alerts.
6. Only after a successful real daily handoff and operational verification may Nirala be switched off. At 06:00 IST next day the cloud token expires, so repeat login and transfer on the next trading day.

## Remaining acceptance tests (NOT complete)

- Provision an expressly approved, measured-cost always-on server with persistent storage, HTTPS and private secrets.
- Validate actual paid Kite API credentials using read-only quote/history; reject genuinely expired tokens.
- Test real one-way token handoff, broker session rollover, and restart persistence while laptop is offline.
- Send clearly labelled Telegram TEST, verify receipt on the physical phone, and record latency.
- Collect five real trading sessions and out-of-sample after-cost option evidence. Until then do not treat synthetic 143/143 as accuracy or production readiness.
