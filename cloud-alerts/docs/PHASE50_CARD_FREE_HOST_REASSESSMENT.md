# Phase 50 — real no-card hosting cutoff and alternative decision (NO DEPLOYMENT)

**Evidence date:** 2026-10-23. **Status:** Northflank Sandbox **DISQUALIFIED** for this user's required 24/7 runtime; alternative architecture candidates **NOT ACCOUNT-VERIFIED**. No paid resources, secrets, DNS, broker orders or Kite subscription were changed.

## Decisive provider-specific signup evidence

The user's two Northflank signup screenshots show their actual team-creation plan selector with **Developer Sandbox / Free** selected. The expanded description says:

> No card needed to start. Your first build or deployment starts a 60-minute window. Add a card any time to verify your account and keep workloads running after that. You won't be charged while on the free plan.

This means signup itself is no-card, but the user's account **cannot be assumed to run unattended for longer than 60 minutes without payment-card verification**. User has explicitly said they have no credit card and requires laptop-off cloud service. Accordingly:

- Do not press Deploy/Build to use up the one-hour window, create a Northflank project, provision worker or gateway, attach volumes, add secrets, add a card, or select Pay as you go.
- The standalone Caddyfile and tests may remain in GitHub as validated **dormant artifacts**; no Northflank credentials or resource exists.
- `host_qualification.review_host` must always reject Northflank `sandbox_free` / `developer_sandbox` / `sandbox` with a nonsecret blocker code, even if someone checks every field true.
- This is **observed account behavior** and supersedes the provisional marketing interpretation in Phase 48.
- The screenshots should **not** be copied into a public repository: they include the user's team name. Only the nonsecret hosting rule is recorded here.

## Alternatives researched from first-party documentation

| Candidate | Card / cost status | Can run existing Python VPS/container? | Unattended frequency / persistence | Verdict |
| --- | --- | --- | --- | --- |
| **AWS new Free account experience** | Official AWS says **most eligible new customers need no card** and get **$100 upfront credits**, up to $200 if tasks are completed. Hard no-charge Free plan ends **after six months OR credits run out**; some users are asked for payment verification and existing accounts may not qualify. | **Potentially yes**: AWS lists EC2 on the new Free plan. Validate actual instance type, volume, public IP, region and projection before any provisioning. | A genuine Linux host would run the Python project directly if account eligibility/resources permit; **not free forever**. | **Best near-term compatibility** with existing 647+ tests, subject to a strictly no-card sign-up and six-month migration plan. |
| **Deno Deploy Free + Deno KV** | Official pricing: $0 monthly, up to 10 active CPU hours, 1 GiB Deno KV, 1M requests, 10 scheduled jobs per revision. Official changelog says **unverified no-card organizations have restricted Free plan quotas** (amount not published there); verify actual new account. | **No**: JavaScript/TypeScript runtime, not a persistent Python Docker worker. | `Deno.cron` can run **every minute** with retries and persisted KV, but no continuous KiteTicker WebSocket process. | **Potentially best long-term zero-card scheduled redesign** if no-card quota is usable; requires a verified TS strategy port and quote/latency limitations. |
| **Cloudflare Workers Free + D1** | Published Workers Free quotas and no-card onboarding; D1 free offers 5 GiB total storage, 5M rows read/day and 100k rows written/day. | **No** continuous Python container. | Scheduled handler at minute granularity, but **10 ms CPU per Free Cron invocation**, which can be exceeded by real strategy work; reliable seconds-level order-premium checks cannot be assumed. | **Strong secure dashboard/relay edge**, but not an adequate unmodified trading engine; benchmark a very small isolated proof before choosing. |
| **Supabase Free + pg_cron/Edge Functions** | Free DB/serverless features; verify actual no-card signup and cron capability. | **No** continuous Python worker. | A 1-minute API polling redesign may be feasible; Free projects are subject to 7-day inactivity pause. | Possible, but larger rebuild and account/reliability questions. |
| **Northflank Developer Sandbox** | Free to start, **card mandatory after the first deployment's 60-minute verification window** for continued workloads on user's screen. | Yes for an hour only under this account. | 24/7 requirement NOT met. | **BLOCKED** |
| **Render Free** | Web services sleep; ephemeral local filesystem; no durable single-writer SQLite/token vault. | No unattended original architecture. | N/A. | **BLOCKED** |
| **Azure for Students** | Card-free student plan possible in general; user's genuine academic email domain could not be verified by Microsoft. | Potentially. | Account not activated. | **BLOCKED until official verification is resolved** |

Primary sources reviewed on 2026-10-23:

- https://aws.amazon.com/start-here/
- https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier.html
- https://deno.com/deploy/pricing
- https://docs.deno.com/deploy/reference/cron/
- https://docs.deno.com/deploy/changelog/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://supabase.com/docs/guides/cron
- https://supabase.com/docs/guides/platform/free-project-pausing

## Revised operational order

1. **Do not renew Kite yet.** All live alert and autonomous paper-entry flags remain false. Never create real orders.
2. As the least disruptive next option, have the user open the **new AWS Free plan signup** in their own local Chrome, with an existing permitted account login if convenient. Do **not** use AWS Advanced/Paid signup. The agent must not open a new cloud browser to impersonate their existing Chrome session.
3. If account sign-up requests **any card/payment hold**, or the account is ineligible for the official hard-capped Free plan, **stop without creating anything**. No attempts to evade identity or payment verification.
4. If no-card Free plan is legitimately available, obtain nonsecret account evidence of exact EC2 quotas, eligible region, maximum time and hard budget cutoff. Propose a small Linux instance with 1 replica, restricted public gateway, single-writer encrypted durable volume, strong secrets, broker read-only credentials only **after** acceptance. Calculate storage/IP/egress against credits. Secure user approval BEFORE resource creation.
5. In parallel, prepare a provider-independent serverless runner prototype only if a full six-month VPS is unavailable or a true long-term free solution is required. Design **1-minute REST polling**, durable state, strict alert dedupe and paper quote slippage integrity; do not call 1-minute polling an equivalent 20-second KiteTicker watcher.
6. Do not silently reclassify source tests as online readiness: **engineering estimate still 53%; live acceptance 0/5. Updated entire Linux Python 3.12 suite **650 passed, 0 failed, 1 skipped**, exit 0**. Independent mobile Telegram receipt, 5 market sessions, real option BID/ASK evidence, and laptop-off test are pending.

**Cost authorization:** ₹0 additional charges; no card, payment hold, PAYG upgrade, service overage or personal laptop VPS. If a paid plan is ever the only option, present the amount and await separate user instructions instead of proceeding.
