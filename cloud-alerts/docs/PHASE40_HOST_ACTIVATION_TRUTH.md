# Phase 40 — actual-cloud activation gate and truthful completion criteria

**20 October 2026. No cloud host created or approved. No user files, broker secrets or live Telegram messages accessed.**

## Reason the visible engineering estimate has not advanced

The previous 80% is the *mean of ten engineering phase percentages*, but **P9 (five live paper trading sessions) is 0%**, and the actual host deployment, daily real token transfer, handset delivery and Nirala-off acceptance are unverified. Repeated library/session fixes (Phases 35–39) increase resilience but cannot establish whether any alert reaches a user's phone. **Do not increase the overall 80% merely for commits**; explicitly track live gates separately.

## Verified limits of the connected tooling

- GitHub repository **Tirthanand17/Indicator-Setup** is connected for source reads/writes. It has no GitHub Actions or other automated test workflow in its tree. The current execution container cannot resolve GitHub via direct network access; the connector permits source reads but not execution. Prior confirmed 451/451 suite is from Phase 34. Full approximately 500-case suite (unverified estimate) still needs running on a provisioned trusted execution host, not GitHub Actions paid credits.
- One Render workspace exists, display name **Ai finance agents**. Its provider requires user selection/confirmation before any workspace-specific actions. **No services were inspected or modified.** Free Render web services are **not suitable**: according to [official Render free docs](https://render.com/docs/free), they sleep after 15 minutes with no inbound traffic and have ephemeral filesystem. Free Postgres expires after 30 days, and persistent disks are for paid service tiers. Never route the bot's actual broker access token to a demonstration service or try to defeat service sleep restrictions.
- [OCI Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) could run existing Docker/Python with persistent storage if an eligible tenancy and actual capacity exist; Always Free Ampere quota is limited, and low-use instances can be reclaimed after a 7-day idle evaluation. No credentials/account billing evidence is present, so **not approved or $0 guaranteed**.
- [Cloudflare Workers Free](https://developers.cloudflare.com/workers/platform/limits/) advertises $0, 100,000 requests/day, 10ms CPU per invocation, free cron triggers; [D1 free](https://developers.cloudflare.com/d1/platform/pricing/) includes limited persistent SQL. Workers can avoid sleeping VM state, but **do not run this repository's existing Python FastAPI/Docker runtime unchanged**. Adopting Workers would require porting the signed token relay, persistence, schedules, broker data adapters and trading signal logic, plus proving CPU/runtime budget and real broker compatibility. This is a separate major architecture and should not be claimed as deployed.

## Explicit five-gate live progress

| Gate | Current acceptance evidence |
|---|---|
| 1. Approved no-incremental-charge, persistent host and DNS/TLS | BLOCKED — no approved host tenancy/service |
| 2. Fresh read-only Kite access token accepted by real signed HTTPS relay | BLOCKED — no live host |
| 3. Real Kite 5m/15m futures and option depth proven current | BLOCKED — no live host/auth smoke |
| 4. Explicit Telegram TEST-only send **observed on user's phone** with Nirala off | BLOCKED — no live host/handset observation |
| 5. Five complete regular F&O market sessions with latency and paper after-cost P&L | BLOCKED — requires 5 sessions |

**Actual live acceptance: 0/5 gates verified. Engineering estimate: 80% unchanged.**

## Next non-destructive action requiring user approval

The connected Render workspace `Ai finance agents` can be **inspected read-only only after the user explicitly confirms this workspace**, to determine if a suitable *already-provisioned* persistent service exists with no incremental fees. Do not create or upgrade Render resources based on inspection alone.

If none exists, the fastest code-reuse route is operator-approved OCI Always Free (or another already owned, persistent host). A full Cloudflare Workers Free port is an alternative only if the user prefers a no-card serverless rebuild and accepts the technical scope.

After host approval, run 100% project regression suite and accepted signed relay/phone smoke, then multi-day session trial. No actual broker order placement is authorized.
