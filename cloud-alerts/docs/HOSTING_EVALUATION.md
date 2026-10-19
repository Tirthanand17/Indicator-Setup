# Always-on hosting evaluation — ₹0 incremental-spend rule

**Date:** 2026-10-19. **Decision:** NO HOST DEPLOYED. The cloud alert worker remains OFF. The user's instruction permits considering an existing free-credit or always-free host but does NOT authorize a payment, billing method, risky quota, or unsupported guarantee of reliability.

## Current connected Render workspace

The connected Render workspace has existing free web services. We did **not** change, deploy to, attach secrets to, or repurpose any of them. According to [Render Free Docs](https://render.com/docs/free), a free web service spins down without inbound HTTP or WebSocket traffic for 15 minutes; it also has ephemeral local filesystem storage and no persistent disk. These properties conflict with this service's need for a persistent encrypted Kite token and scheduled execution. **Not suitable for always-on live alerts.** A workaround based on synthetic keep-alive requests is not acceptable as a reliability guarantee and may consume bandwidth/instance quotas.

## Better prospective hosts (not provisioned)

| Hosting route | What provider currently documents | Main blockers | Decision |
|---|---|---|---|
| OCI Always Free VM | Selected compute shapes and block storage included under Always Free; availability depends on tenancy home region and host capacity. [Official limits](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) | User-specific account eligibility, no confirmed capacity/SSH/HTTPS, setup/billing risk, provider may reclaim idle resources | **Candidate only** |
| Google Compute Engine e2-micro Always Free | One equivalent free e2-micro in listed US regions and standard disk/egress limits. [Official quotas](https://docs.cloud.google.com/free/docs/free-cloud-features) | User account/billing eligibility, static public IPv4 and outbound-bandwidth costs may apply, no account connector currently verified | **Candidate only** |
| Existing Render free web service | Spins down after 15 minutes without inbound traffic; ephemeral files, no persistent disk. [Official limitations](https://render.com/docs/free) | Cannot guarantee timely candle polling, persist SQLite token or avoid cold starts | **Reject for live alerts** |
| GitHub Actions cron | Scheduled workflow timing is not deterministic, runner does not maintain market WebSocket | GitHub Actions credits, cold starts, missed boundaries, secret handling | **Reject for primary real-time worker** |

## Required proof before any cloud activation

1. Provider account belongs to user, relevant service already connected or explicitly authorized; no new charge or credit-card authorization. Confirm actual *current* billing eligibility, not a marketing headline.
2. Dedicated single instance survives 5+ market sessions, reboots safely, maintains encrypted storage across restart and has a stable TLS-enabled HTTPS endpoint for signed daily token handoff.
3. Secrets are configured only via the host private secret store. No confidential data in public GitHub, Build Logs, images, query parameters or Desktop Commander chat outputs.
4. Health checks, NTP clock synchronization, one-worker guard, logs and wakeup/power behavior verified; fallback `WAIT_DATA` and notification-delay handling tested.
5. Explicit user approval of the **specific host and verified all-in ₹0 cost ceiling**, including networking/IP charges and potential monthly overage, before provision.

**Conclusion:** Continue offline and GitHub implementation while hosting remains blocked. Unit tests alone cannot prove Kite market-data reliability or fast Telegram alerts when the laptop is off.
