# Cloud HTTPS ingress and Telegram TEST-only readiness — Phase 14

**Status: OFFLINE TEMPLATE ONLY. Not deployed.** Nothing in this document authorizes charges, broker orders, automated logins or transferring the protected trading `.env` to GitHub.

## Boundary: laptop off after daily handoff

Once the user completes Kite's normal daily authentication, the local sender can **read only** the selected API key and fresh access token from the protected `.env`. It sends the signed payload to the approved `https://FQDN/internal/token` endpoint. The cloud service must **already be running on an approved, genuinely always-on host**. The cloud never reads the local filesystem and cannot refresh the Kite daily token by itself.

## Operator-reviewed HTTPS reverse-proxy template

[`deploy/Caddyfile.example`](../deploy/Caddyfile.example) is an example for **Caddy running on an approved VM host**. Its upstream is the existing Compose worker on `127.0.0.1:8080`. It:

- Requests an automatic TLS certificate for the operator's own approved and DNS-configured FQDN, using explicit `NIFTY_TOKEN_FQDN` and `NIFTY_TLS_EMAIL` environment variables. A real domain, DNS ownership, network policy and provisioning are prerequisites; no domain has been selected or purchased.
- Forwards **only `POST /internal/token`** to the local worker. All other Internet requests, including `/healthz`, `/readyz` and `/operationalz`, return `404`. The health probes remain local to the VM/container.
- Restricts request bodies to 2 KB in the proxy; the FastAPI receiver separately enforces its own 2048-byte limit and HMAC signature, freshness and nonce replay validation.
- Does **not** contain credentials, configure a broker token, send Telegram messages, or prove a host is reachable.

**Deployment checklist once a host is separately approved:**

1. Confirm that the hosting contract/credits do not add charges, and that the VM and volume remain available continuously; verify with the provider's cost/budget controls.
2. Provision an actual operator-owned FQDN; confirm the A/AAAA record points only to the approved VM. Configure inbound TCP 443; TCP 80 may be needed for certificate issuance. Restrict host port 8080 to the loopback interface, as in `deploy/compose.yml`.
3. Store `KITE_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TOKEN_VAULT_KEY` and `TOKEN_RELAY_HMAC_KEY` **only** in the host's private secret store. Keep the local HMAC and relay target outside the protected trading folder. Do not copy the broker API secret to the cloud.
4. Review and adapt `deploy/Caddyfile.example` *on that VM*, validate with a locally installed Caddy binary (`caddy validate --config /path/to/Caddyfile --adapter caddyfile`), test certificate issuance and authenticated POST behavior, and independently verify that non-token paths are 404. The source tree does **not** run Caddy for you.
5. Check server health **locally** (`curl -fsS http://127.0.0.1:8080/healthz`) without putting tokens in shell commands, URLs or logs. Do not expose the health path to the Internet.
6. Test a fabricated signed payload against the local ASGI handler first. Only when the HTTPS host is verified and the user approves transmission, push the **current day's** token from Nirala via the read-only sender and check the token exists in the encrypted persistent vault.
7. Confirm daily rollover, restart recovery, SSL validation, no redirect during handoff, broker API error states, and laptop-off operation. Continue with `ALERTS_ENABLED=false` until readiness conditions pass.

**Important limitation:** This template does not itself provide provider-side firewall rules, DDoS protection, certificate monitoring, rate limiting beyond the request size cap, or evidence of actual TLS correctness. Host-specific security must be reviewed separately; never claim that static tests validate deployed ingress.

## Operator-only Telegram TEST message

The cloud worker does **not** automatically reuse the existing Chrome extension's Telegram bot pairing. After the owner securely configures cloud environment variables (outside GitHub), run:

```bash
# Offline syntax check: no network traffic, no secrets printed.
python -m cloud_alerts.telegram_probe --check-only

# EXPLICITLY sends a test message to the configured private Telegram chat.
# Use only after the cloud host/connection has been approved.
python -m cloud_alerts.telegram_probe --send-test --confirm-send
```

The second command sends only a visibly labeled `TEST ONLY` message. It does **not** call Kite or claim a trading opportunity. JSON output shows whether Telegram's API accepted the request; it always returns `phone_receipt_verified: false`. The operator must separately confirm the physical phone received it, note times, and enable Android/iOS notifications.

Unexpected errors are reported as fixed safe codes, without echoing the Telegram token, chat identifier or the external provider's error text. Invalid settings or missing the extra confirmation flag cause a nonzero exit code without sending anything.

## Verified evidence and remaining work

- **177/177 offline automated tests passed**; new tests exercise the explicit Telegram send guard, fake successful/rejected transports, safe outputs and static template restrictions.
- No actual Caddy parser/binary or live TLS certificate test was performed here. No DNS, domain, account, host or cloud service was changed.
- No actual Kite token was uploaded; no cloud Telegram message or market signal was sent. No phone delivery latency or real paper performance has been measured.
- Original `C:\Users\Dell\Desktop\Automation Day Trading` remains outside the build and **read-only**.
