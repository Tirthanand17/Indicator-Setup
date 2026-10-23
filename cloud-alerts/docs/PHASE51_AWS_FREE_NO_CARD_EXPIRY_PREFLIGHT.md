# Phase 51 — AWS Free preflight and account-expiration protection (NO DEPLOYMENT)

**Reviewed:** 2026-10-23. **Status:** PREPARATION ONLY. Never create resources, sign up, use a payment card, change DNS, buy Kite, or start a cloud service from this document without a new approval and verified nonsecret provider evidence.

## Decision boundary

The owner's requirements are **₹0, no card and no payment hold, no laptop as a host, private persistent paper trading, phone Telegram alerts, a full-session intraday worker, and no real broker orders**. AWS's new Free plan is **a conditional temporary trial**, not a permanent free VPS. AWS advertises no credit card **for most eligible new customers**; eligibility can differ on actual account signup. If a payment card, paid account, charge authorization or verification hold is requested, **STOP**. Do not bypass verification, open a second account, or provision a service.

AWS says eligible Free accounts automatically close when the first of **six calendar months** or **credit depletion** occurs. Crucially, that can remove access to EC2 and app data. The code must therefore have a separately tested migration and backup path before treating this as qualified hosting. AWS free-plan protection is not an uptime, quote-feed, trading accuracy, data-retention or perpetual-hosting guarantee.

Official primary references:
- https://aws.amazon.com/start-here/
- https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html
- https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-free-tier-usage.html
- https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-FAQ.html

## Mandatory human / account evidence (not yet obtained)

1. The user, **in their own local Chrome**, may choose the AWS **Free** signup only if they separately elect to try a temporary six-month host. The signup can be abandoned safely if a card or verification hold is requested. We will not interact with their already-open local Chrome through a cloud browser.
2. From their actual signed-in AWS console, record only **nonsecret** facts: account plan = Free, initial date, six-month/credit remaining cutoff, credit balance, eligible EC2 options in intended region, anticipated free-credit application, and payment-card status. **Never paste account IDs, access keys, passwords, cookies, MFA recovery codes, AWS root credentials, broker tokens, Telegram bot tokens or identifiable billing fields into GitHub.**
3. Confirm exact projected credit consumption including EC2 instance type and hours (24 hours/day), gp3 EBS, public IPv4 or NAT, egress, DNS, snapshots and monitoring. Pricing depends on selected region, image, volume, traffic and usage; there is **no verified per-month price yet**. A cost alert is useful but is not a spending block. Only the actual hard-capped **Free plan** is eligible under this project's zero-spend requirement.
4. Require a durable **off-account** (not same expiring AWS account) encrypted backup destination, successful test export/restore of database *and encryption-key strategy*, documented token-vault recovery, and verified post-cutover host. Losing the account must not destroy the only paper-trade history. **Never send Kite access tokens or Telegram secrets inside backups shared to the public repo.**
5. Allow **at least 14 days** for cutover before the provider expiration. Schedule a shorter initial run interval, check credits daily, and plan early migration if credits decline more rapidly than forecast. After six months no AWS Free extension can be assumed.
6. Seek **fresh user authorization for exact resources** once the cost, account, recoverability and privacy evidence is complete. An offline preflight declaration is never deploy approval.

## Safe offline preflight (Python 3.12; no cloud SDK or network)

From `cloud-alerts/`:

```bash
python -m cloud_alerts.aws_free_preflight --plan deploy/aws-free-preflight.example.json --json
python -m pytest -q tests/test_aws_free_preflight.py
```

The shipping sample deliberately contains **null price/account fields and false/unknown confirmations**. It must return exit code `2` and `BLOCKED`. Never edit the sample to invent figures or claim verification. A privately held completed worksheet may return `DECLARATIONS_COMPLETE_ONLY`, but **still** reports `approved_to_provision_or_deploy=false`, `hosting_resource_created=false`, `credit_and_prices_independently_verified=false`.

The validator rejects:
- missing/extra top-level fields (including accidentally pasted secrets), any payment/paid-plan ambiguity, no owner acceptance of this *temporary* limit;
- unknown EC2-eligible region/instance, missing personal account Free-plan evidence;
- stale review (14 days) or pricing (3 days), naive timestamps, account expiry more than six calendar months, expiry already elapsed;
- migration cutover later than 14 days before account expiry, or trial interval extending beyond cutover;
- missing cost line items, non-decimal/negative/non-finite prices, implausible all-zero running estimate, missing credits;
- projected spend above **80% of current credit balance**, leaving a **20% credit reserve**. Projection uses 30 days/month as a conservative estimate, not a cloud quote.

## Intended architecture *only after an approved host*

```text
Public domain + TLS/Caddy GET-only dashboard and auth-protected token relay
                           |
                  private Linux host
            one persistent Python worker
       read-only Kite REST / no order APIs
    SQLite journal + encrypted secret vault
        Telegram phone alert outbox
                           |
       encrypted off-account backup and
       independently tested restore/cutover
```

Public dashboard must not disclose credentials, private diagnostics, internal metrics or full personal trading data without authentication. Use IAM least privilege, disable root API keys, restrict SSH at firewall and require TLS; **never commit real env/secrets**. The free plan cannot guarantee the target is always online indefinitely; any promise about laptop-off delivery must wait for deployment and actual full-session/phone testing.

## Current verdict and fallback

**AWS Free: NOT QUALIFIED / NOT DEPLOYED**. Unknown no-card account eligibility, instance/region prices, actual credits, off-account backup, migration host, and owner approval. Northflank no-card Developer Sandbox was separately disqualified due to actual 60-minute verification cutoff. Do not use a sleeping/ephemeral Render Free worker for durable private SQLite. The longer-term alternative is an explicitly scoped **Deno or other scheduled-serverless rewrite** with durable state, acknowledging 1-minute scheduled polling is **not** a replacement for the 20-second premium/WebSocket monitor.

**Engineering progress 53%; cloud acceptance 0/5; real broker orders impossible; Kite subscription unrenewed.**
