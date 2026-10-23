# Phase 48 — Northflank Sandbox card-free host preparation (NOT DEPLOYED)

> **SUPERSEDED 2026-10-23 by [Phase 50](PHASE50_CARD_FREE_HOST_REASSESSMENT.md): DO NOT DEPLOY NORTHFLANK SANDBOX FOR THIS USER.** Actual signup screenshots show that the first build/deployment starts a **60-minute no-card window**; continuing afterward requires a payment card, which this user does not have. This is a mandatory stop, not merely an unverified billing risk. The configuration below is an archived candidate, not an actionable deployment instruction.


**Date:** 2026-10-23. **Status:** prospective route only. No Northflank account, resource, charge, secrets, DNS change or broker/Telegram interaction is verified by this document. Both cloud alerting and autonomous paper-trade flags remain OFF.

## Why this option is now first to try

Microsoft Azure for Students activation remains blocked by academic-domain validation (see Phase 47). Oracle account creation requires payment-card verification. Connected Render Free services sleep and cannot persist the worker's private SQLite/token vault.

Northflank's current public pricing advertises a **Free Sandbox, no card needed**, with **always-on containers (no idle sleep), two services, one database, two jobs, up to $20/month of resources**. It also advertises free TLS subdomains, private project networking, GitHub builds, secret groups, and persistent volumes. Its older v1 billing guide still says a card may be required for all plans. **Treat the provider's signup screen and actual account entitlements as decisive**; if a card, paid conversion, or an overage obligation is demanded, STOP. This Sandbox is intended for development/testing and has no production uptime SLA.

Primary sources reviewed 2026-10-23:
- https://northflank.com/pricing
- https://northflank.com/docs/v1/application/billing/pricing-on-northflank
- https://northflank.com/docs/v1/application/network/configure-ports
- https://northflank.com/docs/v1/application/databases-and-persistence/add-a-volume
- https://northflank.com/docs/v1/application/getting-started/build-and-deploy-your-code

## Target topology (two services, neither uses Nirala as a server)

1. **`indicator-worker`** — existing Python 3.12 image in `cloud-alerts/Dockerfile`, **one** 0.5 vCPU/1 GB instance *if allowed by the actual Free Sandbox*, with port 8080 explicitly **PRIVATE** (both `public=false` and `vpcAccessible=false`), persistent single-writer volume mounted at `/data/nifty-alerts`, strict private secret variables. No inbound internet listener from this service.
2. **`indicator-relay-gateway`** — minimal Caddy image from `deploy/northflank-gateway/Dockerfile`, one small instance (indicative 0.1 vCPU/256 MB if Free Sandbox allows), public port 8081 with Northflank-managed HTTPS. Routes ONLY `POST /internal/token` with a 2 KB request limit, `GET /paper/dashboard` (static HTML), and the four explicit read-only JSON endpoints `GET /paper/api/{summary,analytics,opportunities,trades}` to `indicator-worker:8080`. The backend requires a separate high-entropy `X-Paper-Dashboard-Key` for each JSON request; the unauthenticated HTML contains no account information. `PAPER_DASHBOARD_ENABLED=false` remains the default, so even the HTML responds 404 until intentionally enabled. Public `GET /gateway-healthz` checks **gateway only**, not worker readiness. Every other path/method responds 404.
3. Northflank internal name `indicator-worker:8080` must resolve to the selected worker service. **Do not deploy before verifying the actual service name and private routing**. Any detected public port on the worker must be changed to private before real credentials are configured.
4. Existing domain is OPTIONAL at first; the provider's verified HTTPS `code.run` URL can be used for signed token handoff. Add the user's already-owned domain only after the registrar/hostname and DNS ownership are known. Never guess a hostname or point root records blindly.
5. The protected Windows trading directory is **read-only to the local relay**. It is NOT mounted to the cloud. An authorized daily Zerodha login creates a token on Nirala and the tested signed HTTPS relay sends the access token to cloud; laptop may then turn off. Kite daily authentication is still a human requirement. Never send Kite API secret or real-money order permission.

### Indicative monthly cost ceiling, NOT a verified quote

Published on the current Northflank website: 0.5 vCPU/1 GB container around **$12/month**, small 0.1 vCPU/256 MB container around **$2.70/month**, NVMe volume around **$0.11657 per GiB-month**, plus usage-dependent network/build/taxes where applicable. **Two services + 2 GiB disk ≈ $14.94/month of listed resource value before other charges**; Sandbox advertises up to $20/month free resources. An actual account may restrict sizes, free volumes or spending differently. Verify *all* entitlements, volumes, egress and overspend behavior in the billing UI before creating resources. Do not switch to Pay As You Go or add a card. If any required line item cannot be proved covered at ₹0 incremental cost, stop.

## Safe staged activation sequence (human account login only)

- [ ] User opens https://app.northflank.com/signup and selects **Sandbox Free** without a card. If not available, stop. A new account's final signup/authentication is completed by the user.
- [ ] Read-only inspect the plan, remaining $20/month allowance, compute shapes, persistent volume access, egress, automatic cutoff behavior, and no-card rules. Record nonsecret evidence and get the user's **specific** host/₹0 approval before resource creation.
- [ ] Create only the agreed project in a supported region; connect GitHub repo `Tirthanand17/Indicator-Setup` with minimal scoped permissions.
- [ ] Create a **blank** small persistent volume and attach to worker at `/data/nifty-alerts`; verify ownership UID/GID 10001 and `0700` directory/file privacy **before storing a token**. Northflank volumes can replace image directory ownership; the existing fail-closed preflight MUST remain active. Do not remove permissions checks to make a deployment pass. A one-time, separately reviewed empty-volume initialization may be needed if the mount is not owned by the `worker` user.
- [ ] Build worker from GitHub source context `cloud-alerts`, Dockerfile `cloud-alerts/Dockerfile`; one instance only, no auto-scaling. Set port 8080 PRIVATE even if Northflank auto-detects `EXPOSE 8080` as public.
- [ ] Build gateway from context `cloud-alerts/deploy/northflank-gateway`, using its Dockerfile and Caddyfile; public port 8081 with automatic HTTPS; verify allowlisted token POST, gateway health, read-only dashboard GET, and 404 for every other path/method. Ensure JSON routes return 404 WITHOUT the dashboard key. Do not publicly route health/readiness diagnostics or future API prefixes. Ensure Northflank service is named `indicator-worker` to match Caddy upstream or update the upstream after review.
- [ ] Keep `ALERTS_ENABLED=false`, `PAPER_AUTOTRADE_ENABLED=false`, `PAPER_DASHBOARD_ENABLED=false`, `KITE_SHADOW_ENABLED=false`, and `PAPER_PREMIUM_TRACKING_ENABLED=false` during cloud qualification. Do not use actual Kite/Telegram credentials until all ingress, private volume, no-charge and user-approval checks pass.
- [ ] Supply `KITE_API_KEY` (not secret), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TOKEN_RELAY_HMAC_KEY`, and `TOKEN_VAULT_KEY` through Northflank encrypted private secret settings **only after approved**. No real credentials in GitHub, environment templates, build args, logs, terminal output or this markdown file.
- [ ] Execute existing offline `python -m cloud_alerts.host_qualification --plan deploy/northflank-host-plan.example.json --json`: **BLOCKED is expected**; the template contains intentionally unapproved booleans and a stale review date. Create a separately reviewed nonsecret host plan only once the account and spend protections are actually verified; a structural success never authorizes a deploy.
- [ ] With synthetic credentials only, test gateway TLS, size limits, failed HMAC, replay rejection, keyed dashboard JSON access, denied methods, no public diagnostics, and restart persistence. Verify worker health via private networking, not public gateway health.
- [ ] After legitimate daily Kite login, perform signed token handoff, fresh 5/15-minute Kite read-only broker smoke, labeled Telegram TEST and independent physical phone receipt while Nirala is OFF. Enable any production paper monitoring only after gates pass; collect **five separate NSE sessions** to measure missed signals, latency, after-cost hypothetical option P&L and reliability.
- [ ] Keep automated real order placement impossible by design. Never change the protected Windows source folder.

## Unverified / safety limits

- **No Northflank account connection is exposed to the current agent.** No server, DNS, volume, gateway or secrets have been created.
- Sandbox is marketed for testing, not a trading-critical SLA. Even always-on does not guarantee subsecond notifications, Kite WebSocket delivery or outage-free market sessions.
- The gateway Caddyfile is a template; **no live Caddy binary validation, Docker build, network route, cloud health or volume ownership test has run**. The 6 new static edge assertions passed in a clean Linux checkout alongside **622 passed, 1 skipped** full Python tests (2026-10-23); these tests do not demonstrate live proxy behavior. The gateway health path does not establish that real Kite access or Telegram delivery is working.
- The same official Northflank site has contradictory old billing guidance; **actual card-free signup and no-overspend controls are gating facts**, not assumptions.
- For security, direct public access to the worker, public account-data APIs without a strong key, or broad reverse proxy routing is prohibited. The HTML login shell itself may be fetched anonymously, but contains no private portfolio data; every JSON API request must authenticate on the worker.

**Stage checkpoint:** GitHub deployment branch and keyed mobile dashboard ingress prepared; provider account activation **0%**, real-host acceptance **0/5**. Full Linux suite: **622 passed, 0 failed, 1 skipped**. The overall 53% expanded engineering estimate remains unchanged until actual integration evidence exists. **Do not renew Kite yet**: complete $0/no-card host qualification, private volume, synthetic end-to-end TLS and phone notification checks first.
