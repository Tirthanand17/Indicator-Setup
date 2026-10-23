# Phase 48 — OCI Always Free: direct route around Azure academic-domain rejection

**Decision date:** 2026-10-23. **State:** a reviewed deployment bootstrap exists in GitHub; Oracle account activation, free capacity and production deployment have NOT happened.

## The choice

Use **Oracle Cloud Infrastructure Always Free only**, with a single **Ubuntu 24.04 ARM64 Ampere A1 Flex** VM (candidate request: **1 OCPU, 4 GiB RAM, 50 GiB boot disk**) in the actual tenancy **home region**, **only if** that VM and its image, volume, public IP and network show explicit Free-eligible status. Real quotas must be checked against existing resources; the [offline OCI quota policy gate](../cloud_alerts/oci_plan_guard.py) is a mandatory preliminary safeguard, not proof of actual billing or capacity.

Oracle's official documentation currently permits Always Free A1 capacity up to **2 OCPUs and 12 GiB** for a Free-only tenancy, with **200 GiB aggregate boot/block storage**. Free A1 capacity may be unavailable and **idle instances can be reclaimed** based on 7-day low CPU/network/memory conditions. Do not artificially drive utilization to evade that rule. The provider can also require a small temporary payment-card verification authorization; this is **not** an explicit paid account upgrade. **Do NOT upgrade to Pay As You Go.**

The verified GitHub Student Pack **Heroku** alternative offers **$13 per month for 24 months**, but **requires a credit/debit card** and will charge for usage above the credit. The officially listed **always-on Basic dyno $7/month + Essential-0 Postgres $5/month** is nominally $12/month before extras; migrating Indicator's current SQLite paper ledger and vault to a hosted Postgres architecture would be a major application change, so it is **fallback only**. The old DigitalOcean student credit offer was removed from the Pack in July 2026 (official GitHub Student Pack changelog).

## A. Human verification needed BEFORE any infrastructure action

1. On the user's own browser, sign up for an **Oracle Cloud Free Tier**, or sign in to an existing tenancy: https://signup.oraclecloud.com/ . This page may require real contact information, phone and payment-card verification. **Only the account holder should enter/approve these details.** Do not enter payment data or one-time codes into ChatGPT, a GitHub issue, or a terminal shared log. Do not create duplicate trial accounts.
2. Confirm in the OCI console that the account remains **Free Tier**, record the actual home region, and check the Always Free label for the candidate shape **VM.Standard.A1.Flex** and the chosen ARM64 **Ubuntu 24.04** image. Confirm current existing A1 CPU/RAM use and boot/block volumes across the tenancy. **If there is an “out of host capacity” response, DO NOT select a paid shape.** Availability is not guaranteed.
3. Confirm no-cost status for networking, public IP, data transfer, DNS choice, volume/backups, log retention and tenancy quota. Restrict SSH TCP 22 to an approved operator IP only; permit TCP 443 to the signed handoff proxy *only once HTTPS is configured*. Do not expose the Python HTTP server on port 8080 publicly.
4. Verify an actual $0/₹0 additional-charge configuration in the cloud console and approve THAT precise configuration before creating a VM. Passing the offline review is not approval and does not verify provider balances.
5. After successful creation, preserve SSH keys privately. The VM should have a persistent 50 GiB boot block volume, and private Docker state must survive an actual reboot (it will **not necessarily** survive instance termination/reclamation).

## B. No-secret VM bootstrapping already prepared

OCI Create Instance -> Advanced Options -> Cloud-init initialization script -> paste ONLY the committed [ubuntu24-a1-cloud-init.yaml](../deploy/oci/ubuntu24-a1-cloud-init.yaml) **after** the host offer and cost plan are verified. The script installs Ubuntu's published `docker.io`, `docker-compose-v2`, `git`, `ca-certificates` packages and creates root-owned directories:

- `/private/nifty-alerts` mode **0700** (operator-generated `worker.env` goes here later; **never** GitHub);
- `/srv/nifty-alerts` mode **0750** (reviewed checkout);
- `/etc/indicator-deployment-disabled` safety marker; the worker, public TLS and broker stay OFF.

It does not read secrets, add repo checkout, deploy any container, create Terraform resources, install an agent, activate Telegram, or enable paper trading. The only automatic service enabled is the Docker daemon, necessary for later reviewed Compose deployment. The cloud-init does not imply permission to create a VM.

On the approved VM, inspect the setup without secrets or network:

```bash
# After manually fetching a reviewed GitHub revision to /srv/nifty-alerts:
bash /srv/nifty-alerts/cloud-alerts/deploy/oci/verify-host.sh
# Expected only on an actual prepared ARM64 Ubuntu VM:
# OCI_HOST_SOFTWARE=PREPARED_ONLY
# CLOUD_TENANCY_ELIGIBILITY=NOT_CHECKED
# FREE_BILLING=NOT_VERIFIED
# DEPLOYMENT_APPROVAL=NOT_GRANTED
```

The script deliberately rejects WSL/x86_64. It proves only prerequisites, NOT provider billing, account access, real deployment, IP, DNS, TLS or disk recovery.

## C. After the VM exists and separate go-live gates pass

1. Clone only the **reviewed GitHub main commit** into `/srv/nifty-alerts` and build `cloud-alerts/Dockerfile` using the existing `deploy/compose.yml`. Start with a private `/private/nifty-alerts/worker.env` with all activation toggles `false`. Deploy exactly **one** worker. The existing Compose binds container port 8080 to host **127.0.0.1**.
2. Configure the reviewed `deploy/Caddyfile.example` **on host**, with a real controlled domain/FQDN, official HTTPS and ONLY the signed `POST /internal/token` public route. Do not make /paper, /dashboard, /healthz or private APIs publicly accessible. Audit firewall/OCI NSG, TLS and rate limiting.
3. Validate on a real host: encrypted token-state persisted across VM reboot, fail-closed session when token missing, replay rejection, and an HTTPS public signed-token request. **No broker account trading**.
4. Ask the user to complete their existing legitimate daily Zerodha login on Nirala; approved Windows relay reads only the protected trading folder's daily token and securely POSTs it to cloud. The remote VM can then run while Nirala is OFF until that token expires. No automated broker login or bypass.
5. Verify an actual marked Telegram TEST alert reaches the **user's phone while Nirala is OFF**, followed by read-only live option depth and **five real NSE paper-only sessions**. Only then declare cloud acceptance gates passed.

## Testing and limitations

Phase 48 adds a stage-1 cloud-init and explicit host prerequisite checker. On an offline Linux container, **cloud-init YAML parsed successfully**, `bash -n` succeeded, and the checker explicitly returned **BLOCKED** with exit 2 outside its intended OCI ARM/Ubuntu host. Full Indicator 616-test regression **has not been rerun for Phase 48** since this phase changes only deployment staging and tests, not the strategy engine. The previous 616 tests refer to Phase 47 merged main.

**Project engineering index stays 53%**; 0/5 live acceptance gates. No OCI tenancy connected, VM created, charges authorized, SQLite ledger migrated, live orders placed or phone alerts received.

## Primary source links

- [Oracle Always Free limits, idle reclamation and OCI A1 capacity](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [Oracle Free Tier card verification FAQ](https://www.oracle.com/in/cloud/free/faq/)
- [Oracle Free Tier signup](https://signup.oraclecloud.com/)
- [Ubuntu 24.04 docker-compose-v2 arm64 availability](https://packages.ubuntu.com/noble/docker-compose-v2)
- [GitHub Student Pack changelog — DigitalOcean ended July 2026](https://github.com/github-education-resources/Student-Developer-Pack-Current-Partners-FAQ/blob/main/SDP-changelog.md)
- [Heroku GitHub student offer and mandatory card](https://www.heroku.com/github-students/)
