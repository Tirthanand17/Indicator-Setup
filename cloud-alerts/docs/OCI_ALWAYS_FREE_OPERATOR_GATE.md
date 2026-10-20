# Phase 35 — Oracle Always Free plan gate, NOT a deployment

**20 October 2026 status: offline code only.** No Oracle account was connected and no VM, network, disk, domain, credential, subscription, broker call, or Telegram message was created.

## What Oracle's actual Free Tier policy means

Oracle's official resource documentation currently permits Always Free-only Ampere A1 capacity equivalent to **2 total OCPUs and 12 GB RAM**, plus **200 GB total combined boot/block storage**, across the tenancy in its home region. Existing resources consume these caps. Its broader price-list hour allowances should NOT be treated as approval to exceed the Free-only account limits. Always recheck current console labels and resource usage.

**Important:** Oracle states it may reclaim idle Always Free instances after a 7-day period of low CPU, network, and (for A1) memory use. A lightweight NIFTY bot could be affected, so OCI Always Free is a candidate for a monitored trial and **not a guaranteed 24/7 alert service**. Do not generate artificial background load to evade the policy. Capacity can also be unavailable in the user's home region.

Free-tier signup may require the user to submit their own payment-verification card; Oracle describes a possible temporary authorization hold. No payment method, paid upgrade, or cloud resource can be created by this project without explicit user approval. Do not sign up for multiple free accounts or repurpose someone else's card. Check DNS, IP, networking, operating system, backups, quotas and costs separately.

Official references:
- [Oracle Always Free limits, region, reclaim rules and block storage](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [Oracle Free Tier account and upgrade boundaries](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm)
- [Official free-tier signup requirements](https://docs.oracle.com/en-us/iaas/Content/GSG/Tasks/signingup_topic-Sign_Up_for_Free_Oracle_Cloud_Promotion.htm)

## Minimum user-controlled host eligibility step

1. If an Oracle tenancy already exists, sign into the [official console](https://cloud.oracle.com/) and check the account type, home region and Always Free A1 shape availability. Otherwise, [Oracle's signup](https://signup.oraclecloud.com/) is a separate **user action** with potential card verification; remain on the Free-only plan and do not upgrade.
2. Inspect the console's existing total A1 OCPUs/RAM, boot/block storage, shape/image free eligibility, and all-in ₹0 network/IP/DNS costs. Do not disclose passwords, tenancy IDs, keys, billing information, or cards.
3. Confirm whether a 1-OCPU/4-GB A1 VM and 50-GB boot volume **would fit actual remaining quotas**, subject to availability. This is an *example plan*, not verified allocation or cost.
4. Acknowledge possible reclamation and obtain approval for the **specific** host/region/zero-additional-charge configuration before provisioning.

## New offline no-spend review command

Create the following **nonsecret** proposed-plan JSON *outside* your protected Automation Day Trading folder. All false flags must stay false until the console has confirmed the specific claim. The example region is illustrative, not a detected user region.

~~~json
{
  "provider": "OCI",
  "account_mode": "ALWAYS_FREE_ONLY",
  "home_region": "ap-mumbai-1",
  "selected_region": "ap-mumbai-1",
  "shape": "VM.Standard.A1.Flex",
  "requested_ocpu": 1,
  "existing_a1_ocpu": 0,
  "requested_memory_gb": 4,
  "existing_a1_memory_gb": 0,
  "requested_boot_volume_gb": 50,
  "existing_boot_block_volume_gb": 0,
  "always_free_shape_badge_confirmed": false,
  "always_free_image_confirmed": false,
  "storage_free_eligibility_confirmed": false,
  "zero_cost_public_ipv4_confirmed": false,
  "zero_cost_network_confirmed": false,
  "zero_cost_dns_confirmed": false,
  "no_paid_addons_confirmed": false,
  "idle_reclamation_risk_acknowledged": false
}
~~~

Run from the existing cloud-alerts checkout:

~~~bash
python -m cloud_alerts.oci_plan_guard --plan /path/to/nonsecret-plan.json --json
~~~

This has no cloud/Internet access. It fails closed on wrong region, other shapes, numeric overages including existing usage, missing cost confirmations, invalid types, unexpected fields or unacknowledged idle-reclaim risk. It never logs input values.

Even if it reports STRUCTURAL_PLAN_REVIEW_PASS, its response still says that no account/quotas/capacity were independently checked, zero cost is not guaranteed, provisioning is NOT approved, and no cloud instance exists. Never treat a plan review as actual price verification.

## Real deployment after separate explicit user approval

Reuse [Docker Compose and TLS runbook](DEPLOYMENT.md), [mounted-storage preflight](CLOUD_DEPLOYMENT_PREFLIGHT.md), [public HTTPS acceptance probe](SESSION_TOKEN_WARNING_AND_HTTPS_PROBE.md) and [Windows daily token sender](WINDOWS_AUTOMATIC_DAILY_TOKEN_RELAY.md). Verify private persisted storage and single-worker safety on the *real host*. A Docker named volume on the boot disk can survive container restart but may not survive VM reclamation/deletion.

Next: real read-only Kite authentication, actual exchange-depth checks, explicitly TEST-only Telegram message and observed phone receipt, Nirala-powered-off operation, and five actual F&O sessions. Never invent those outcomes or enable real-money orders.

## Validation

The Phase 34 repository reports 451/451 offline tests. Phase 35's **10 additional focused synthetic tests passed in an isolated local environment**. The full prior suite was not rerun because the full repository could not be accessed locally and a GitHub Actions run would spend credits. **Do not claim 461/461 freshly validated.**

**Engineering progress remains 80%** and the first real cloud/phone launch remains blocked.
