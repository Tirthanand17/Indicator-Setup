# Phase 52 — AWS new Free signup eligibility for an Indian owner (READ-ONLY / NOT DEPLOYED)

> **Post-Phase-52 outcome (2026-10-23; supersedes its eligibility checklist):** The owner subsequently authorized the *new AWS Free signup and its automatically created Sydney project only if no payment method/hold was required*. In the actual Indian AWS flow the user encountered a **₹2 verification and a ₹15,000 UPI AutoPay/e-mandate request**. This fails the owner's absolute no-card/no-hold/no-mandate restriction. AWS is now **BLOCKED**, not a temporary eligible host. Do **not** approve the mandate on the theory it can be revoked immediately; cancelling a payment mandate does not establish that the service stays usable at ₹0. No AWS project or resource creation has been confirmed. See [Phase 53 provider reassessment](PHASE53_CLOUDFLARE_DURABLE_OBJECTS_FREE_FEASIBILITY.md).

**Research:** 2026-10-23. **Owner decision:** AWS is approved as a **temporary candidate at ₹0 without any payment method**; the owner explicitly requires approval **before any AWS account/project/EC2 creation**. All cloud resource and credential operations remain forbidden until that distinct approval.

## Decisive updates from AWS first-party documentation

1. **Two materially different AWS signup experiences.** Only **Sign up for AWS (new)** may admit a new, genuinely eligible person without a credit card. AWS advertises no card for *most* new customers, not all. Existing AWS customer history can make the person ineligible. The **advanced** AWS India signup path explicitly requests a payment method and a ₹2 validation transaction. Never substitute a false residence, billing address, eligibility claim, new email identity or account to evade verification.
2. **A card request or verification hold is a hard STOP.** AWS documents that some new signups require a USD $1-equivalent temporary verification hold. This user will not provide payment cards or a hold. No account creation if that becomes mandatory.
3. **The new AWS signup provisions the first AWS project automatically.** Therefore even signup requires **separate informed permission** under the owner's restriction against creating cloud resources without asking. No local Chrome takeover or cloud-browser login is authorized.
4. **Region: India maps to Sydney (`ap-southeast-2`) in the current new AWS experience**, NOT Mumbai (`ap-south-1`). The account cannot freely change its project region, and changing contact details later does not change it. This is a performance and possible residency tradeoff: do not falsify the address to force Mumbai. Confirm actual provisioned region from AWS Settings; estimate additional market-feed/network roundtrip before activation.
5. **Services in the new Free experience include** Amazon EC2, EBS, VPC, S3, Route 53, Secrets Manager, and CloudWatch; this does **not** mean they all have unlimited zero-credit usage. Each eligible monthly cost consumes or is covered by actual account allowances/credits. The Free plan remains six months or credit depletion, with automatic account closure and loss of resource access.
6. **T3/T4g CPU-credit risk:** EC2 launch defaults for T3/T4g may choose `unlimited`, which can bill extra CPU surplus credits under sustained load. A proposed burstable worker should declare `standard` and be performance-tested for any throttling. The generic official Free-Tier eligible instance list is not an entitlement quote. EC2 hardware, OS and region compatibility must be confirmed in the user's real project.

Official sources:
- https://aws.amazon.com/start-here/
- https://docs.aws.amazon.com/accounts/latest/reference/sign-up-for-aws.html
- https://docs.aws.amazon.com/accounts/latest/reference/sign-in-new.html
- https://docs.aws.amazon.com/accounts/latest/reference/project-regions.html
- https://docs.aws.amazon.com/accounts/latest/reference/managing-accounts-india.html
- https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html
- https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/LaunchingAndUsingInstances.html
- https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-performance-instances.html
- https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-performance-instances-unlimited-mode.html

## Current audit status

| Requirement | Verified? | Next proof |
|---|---|---|
| Existing AWS eligibility; no previous AWS Free account | **Unknown** | User's own signup path, no identity leakage |
| New signup offered with Google and no card/hold | **NO on user's actual Indian flow** | ₹2 verification plus ₹15,000 UPI AutoPay demand; hard STOP |
| Temporary hosting approved in principle | **YES** | This conversation, no resources permitted yet |
| First project creation explicitly authorized | **Conditional approval was given later; conditions failed** | No created project confirmed; no further AWS signup attempts |
| Region is Sydney and risk accepted | **Research supports Sydney; user acceptance pending** | User acceptance and AWS Settings nonsecret Region after signup |
| Free plan and $100-or-current account credit verified | **NO** | AWS Settings/Billing Free plan and credit balance |
| EC2 / EBS / IPv4 / bandwidth / DNS exact credit quote | **NO** | Region-specific cost estimate with all running services, no invented prices |
| `t3.small` (2 GiB, x86_64) or cheaper 1 GiB candidate | **Suggested only** | Confirm Free eligibility, measured app memory and quote |
| Off-account encrypted backup and 14-day migration | **NO** | Demonstrated independent restore, destination and cutoff |
| Laptop-off Telegram and Kite paper-trade operation | **NO (0/5 live gates)** | Future approved host and real market days |

No billing details, cards, personal contacts, passwords, MFA data, AWS project/account identifiers, Telegram bot secrets or Kite tokens should be copied to GitHub or sent in screenshots. Screenshots of plan, Region and credit can have identity information redacted.

## Phase 52 offline safeguard

From `cloud-alerts/`:

```bash
python -m cloud_alerts.aws_free_preflight --plan deploy/aws-free-preflight.example.json --json
python -m pytest -q tests/test_aws_free_preflight.py
```

The shipping worksheet remains deliberately **BLOCKED**. New mandatory checks require explicit AWS `new` signup, authentic `IN` contact country, assigned `ap-southeast-2` region under current published mapping, no card verification hold, no advanced-feature/paid activation, a user's separate approval for the automatically created first project and for the Sydney performance tradeoff, and `standard` CPU-credit mode for T3/T4g.

Every result, including hypothetical complete declarations, says `approved_to_provision_or_deploy=false` and `hosting_resource_created=false`. This is a safe eligibility gate, **not a tool to sign up or a permit to deploy**.

## Safe next human checkpoint

**CLOSED: user authorized the conditional signup, but the real AWS screen required UPI AutoPay.** Do not ask the user to approve or revoke a mandate, retry identity variants, continue the signup, create the automatic project, or provision EC2/EBS. Shift to Phase 53 no-card research and seek fresh consent only for a genuinely eligible different provider.

**Do not** renew Kite, update domain DNS, create IAM access keys, deploy resources, pay ₹2/$1, enable auto-billing, or call the service live before the separate gates.
