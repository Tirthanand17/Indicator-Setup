# Canonical engineering progress — 23 October 2026

**Dependency follow-up:** default REST SDK dependency chain removed; fresh Linux suite774 passed/1 skipped, REST contract suite15 passed, pip check clean and advisory scan reports no known vulnerabilities. Live WebSocket shadow is explicitly disabled pending review. [Evidence](../../audit/DEPENDENCY_REMEDIATION_2026-10-23.md). Engineering remains15/25 (60%) because type-checking/reproducibility work remains. Earlier round counts below are historical snapshots.


**IN DEVELOPMENT / PAPER ONLY. Not deployed. Live acceptance 0/5.**

Engineering checklist v1: **15/25 completed = 60%**. Each item has equal4% weight and is binary; no partial credit. This replaces the historical53% expanded/80% alerts/43% paper estimates for current reporting. It is a rebaseline, not a measured seven-point productivity gain. Keep these25 items stable across future rounds; any scope change must version the checklist. Completion means the stated offline deliverable exists with evidence, not that the full product is finished.

```text
Offline engineering [###############----------] 60% (15/25)
Live acceptance     [-----]                      0/5
```

| # | Fixed checklist deliverable | Complete? | Evidence or remaining work |
|---|---|---|---|
|1|Repository inventory and reproducible baseline|Yes|Audit inventory; baseline744 passed/1 skipped|
|2|Read-only Python HTTP boundary|Yes|Allowed GET paths/TLS/pacing regressions|
|3|Python signed daily-token relay and encrypted vault|Yes|Synthetic relay/restart tests; no live handoff|
|4|Python indicator and completed-candle integrity gates|Yes|Full suite; alignment/session-volume fixes|
|5|Python dynamic contracts and quote validation|Yes|Synthetic instrument/quote tests|
|6|Python independent paper account transaction core|Yes|Ledger tests; display/MTM remains item22|
|7|Versioned fee/slippage model|Yes|Official schedule review and36 exact fee parity cases|
|8|Python restart/idempotency core|Yes|Synthetic replay/ledger tests|
|9|Python durable Telegram outbox core|Yes|Atomic event/outbox tests; reliability completion item24|
|10|Python private dashboard/report foundation|Yes|Existing synthetic route/report tests; cloud views item20|
|11|Python offline snapshot verification|Yes|Existing snapshot tests; cloud restore item23|
|12|Transactional local DO scheduler|Yes|10 handler tests + native workerd transaction/restart test|
|13|JS indicator/fee numerical port|Yes|Five parity tests; full decisions item16|
|14|Repository safety regressions and script repair|Yes|771 passed/1 skipped; PowerShell parse clean|
|15|Audit/register/verification and deployment gate docs|Yes|audit/ and this checklist|
|16|Complete Python/JS decision/exit parity|No|Numerical functions only ported|
|17|Cloud read-only market-data and daily-token integration|No|Scheduler has no external HTTP or token relay|
|18|Cloud transactional two-account ledger/outbox|No|Not implemented|
|19|Full cloud synthetic market-session end-to-end|No|Scheduler-only simulation exists|
|20|Private mobile cloud dashboard and daily reporting|No|Not implemented|
|21|Dependency remediation, reproducible lock/type baseline|No|A11/A17 open|
|22|Complete portfolio MTM, capital and health views|No|A14 open|
|23|Cloud retention, export/restore and capacity measurements|No|A13/A18 open|
|24|Telegram ambiguous delivery/retry_after/retention handling|No|A15 open|
|25|Annual/exceptional-session and operational release controls|No|A16 open;2027 fail closed|

Latest local evidence: **771 Python passed,1 skipped,1 third-party warning;63 Node passed;1 native local workerd test passed**. No static type-check clearance. Python dependency advisories remain open; npm audit reported0 known vulnerabilities after overrides. See [verification](../../audit/FIX_VERIFICATION_MATRIX.md), [findings](../../audit/ISSUE_REGISTER.md) and [full audit](../../audit/FULL_PROJECT_AUDIT_2026-10-23.md).

Five live gates are individually unverified: cloud Kite data, phone Telegram receipt, real session scheduling, dashboard/ledger recovery, laptop-off continuation. No broker orders, live credentials, phone messages, cloud resources or billing changes in this round.

## Historical phase log (not current status)

All percentages/test counts below are dated historical records superseded by the checklist above. Statements about future actions in these historical entries are not current authorization.

## Phase 54 — offline Cloudflare alarm scheduling gate (2026-10-23; NO CLOUD ACTION)

- Added `edge-cloudflare/alarm-core.mjs` pure JS candidate scheduler and `edge-cloudflare/alarm-core.test.mjs`. It checks pinned 2026 NSE F&O holidays/weekends, 09:15–15:30 IST regular session, 20-second slot alignment, alarm duplication and lateness, invalid clock/calendar, and next-day re-arm across holidays/weekends. It never places broker orders or contacts Kite/Telegram.
- **9 new offline Node tests passed (0 failed)**; all **16 holiday dates match** the existing Python pinned calendar. This is a source-level synthetic unit test, **not** a live Durable Objects handler, accurate real-world polling, or any trading signal-performance validation.
- See `edge-cloudflare/README.md` for critical future tasks: transactional alarm-claim persistence, porting Kite/Telegram/paper engine with Free tier limitations, account no-card qualification, and **fresh user approval** before any cloud resource creation.
- No Cloudflare account/project/Worker/DO/domain, billing method, UPI mandate, DNS or secrets created; no laptop-hosting deployment. **Engineering estimate still 53%**, real cloud acceptance **0/5**. Previous **744 passed/1 skipped Python suite** is from Phase 52 and was not rerun in this filesystem-read-only environment.

## Phase 53 — next no-card candidate: Cloudflare Workers Free + Durable Objects alarms (2026-10-23; RESEARCH ONLY)

- New user evidence overrides AWS's earlier theoretical eligibility: the actual AWS India signup demanded a **₹2 verification and ₹15,000 UPI AutoPay mandate**. This breaches the no-mandate/no-hold restriction. **AWS Free is BLOCKED** on this attempt; no authorization for an AWS paid/mandated flow, EC2, project or other cloud service.
- Reviewed authoritative Cloudflare Workers and Durable Objects docs: **no-card Workers Free signup advertised**, 100k requests/day and 128-MB/10-ms Free Worker limits. SQLite Durable Objects on Free add persistent SQL storage and **programmatic alarms fine-grained enough to request ~20-second wakeups** (not guaranteed punctual delivery). Free quota includes 100k DO request/alarm invocations/day, 13k GB-s/day, and 5 GB total SQLite storage; exhaustion fails closed.
- Inference: a single market-session orchestrator would schedule about **1,125 premium-check alarms in a full 375-minute NSE session**, not counting retries/bootstraps/storage. The Python 3.12 FastAPI/Kite SDK/cryptography/native SQLite monolith cannot be deployed unchanged; Cloudflare does support Python FastAPI via ASGI, Python DOs and alarms, but exact packages, memory, CPU, auth and read-only REST performance require **offline and field validation**.
- Also checked Deno Deploy: official changelog confirms card verification to unlock regular Free organization limits; Back4app's own 2026 Free container test lasted only about one hour. No truly free no-card **drop-in always-on Linux VPS** has been qualified. See [Phase 53 comparison and fail-closed feasibility](PHASE53_CLOUDFLARE_DURABLE_OBJECTS_FREE_FEASIBILITY.md).
- **No Cloudflare account, Worker, DO, database, domain/DNS, secret, Kite renewal or resource created.** Ask before all host creation. Existing project code, sample safety flags, **53% engineering estimate**, and **0/5 real cloud-market acceptance gates** are unchanged. Most recent verified full isolated Linux test suite remains the Phase 52 result of **744 passed, 1 skipped**; Phase 53 is documentation-only.

## Phase 52 — AWS new Free signup is conditionally no-card, India fixed to Sydney (2026-10-23; NO ACCOUNT OR DEPLOYMENT)

- User approved **AWS Free as a temporary ₹0/no-card hosting candidate only**, explicitly requiring consent **before creation of any account/project/cloud resource**. Existing PR #8 Phase 51 safety changes are merged.
- AWS current primary docs distinguish `Sign up for AWS (new)` (Google/GitHub sign-in, no payment method for most eligible new users, account-dependent USD $1 hold) from `Sign up for AWS (advanced)` (Indian account demands a payment method and ₹2 verification). Strictly **STOP on any payment/card hold or paid upgrade**. New signup is in limited rollout and automatically provisions its first project. No signup attempt made.
- For genuine Indian contact addresses AWS currently assigns new projects to **Sydney `ap-southeast-2`**, not Mumbai; requires owner's informed acceptance of latency/performance implications and account screenshot verification after authorized signup. Officially listed eligible Free features include EC2/EBS/VPC/S3/Route53/Secrets Manager but no credit spending proof. T3/T4g's default unlimited CPU mode can incur surplus credits; require `standard` mode for a candidate.
- Added strict India/signup/region/first-project-consent/payment-hold/T-instance CPU gates and synthetic tests, keeping shipping example BLOCKED and every result `approved_to_provision_or_deploy=false`. See [Phase 52 AWS India eligibility research](PHASE52_AWS_INDIA_NEW_SIGNUP_ELIGIBILITY.md).
- **Full isolated Ubuntu Python 3.12 suite: 744 passed, 0 failed, 1 skipped, one third-party Starlette deprecation warning; exit 0.** No cloud project, charges, DNS, real credentials, Kite subscription or phone alerts. **53% engineering estimate unchanged; cloud acceptance 0/5.** Next: get separate owner authorization for new AWS signup's automatic project, stop if card/hold, then inspect actual Free entitlement/credit and estimate a one-worker service before asking again about resources.

## Phase 51 — AWS Free time-limit + cost + data-retention fail-closed preflight (2026-10-23; NOT DEPLOYED)

- Added `cloud_alerts.aws_free_preflight`, a **network-free, no-credentials** qualification worksheet/gate for the new AWS Free plan. It checks no-card/no-paid-plan declarations, six-calendar-month expiration, conservative monthly EC2/EBS/IPv4/egress estimates, ≥20% credit reserve, an independently recoverable off-AWS backup, and a migration cutover ≥14 days ahead of AWS closure. **Even if all declarations pass, it never authorizes deployment.** Shipping JSON sample is intentionally BLOCKED.
- AWS first-party billing says an expired Free plan account **automatically closes, with resource/data access lost**: this is a temporary six-month-or-credit-limited candidate, NOT permanent free hosting. The user has not yet selected it or supplied actual account/billing/backup evidence. No AWS signup, card, EC2, keys, DNS, billing changes, Kite renewal, telegram send or broker orders.
- Added regression tests and [Phase 51 safeguard runbook](PHASE51_AWS_FREE_NO_CARD_EXPIRY_PREFLIGHT.md); the generic host gate also forces AWS Free into this dedicated review. **Final full Linux Python 3.12 suite: 715 passed, 0 failed, 1 skipped, 1 third-party Starlette deprecation warning (exit 0). Engineering index stays 53%; verified cloud delivery remains 0/5.**

## Phase 50 — mandatory Northflank card-block and safer no-card replan (2026-10-23)

- The user's actual **Northflank Developer Sandbox Free** signup screenshots state that the first build/deployment starts a **60-minute window**, and a payment card must then verify the account to keep workloads running. The user has no card. **Northflank is conclusively unsuitable for laptop-off 24/7 use under this account**, despite its general Free/Sandbox marketing. No Northflank resources, payment, secrets, DNS or deployments were created.
- Added an unconditional host qualification blocker `NORTHFLANK_SANDBOX_NO_CARD_60_MINUTE_WINDOW` even when a Northflank plan's operator declaration fields are all green; added three direct regression cases. Marked Phase 48 as **superseded/do not deploy** and documented alternatives in [Phase 50 no-card host re-assessment](PHASE50_CARD_FREE_HOST_REASSESSMENT.md).
- Research from primary sources: AWS's **new** Free plan advertises $100 credit and no card for *most* eligible new sign-ups, EC2 support, a hard no-charge cutoff, and a strict **six-month or credit-depletion expiration**; best fit with current Python code if user qualifies, NOT a forever-free server. Deno Deploy Free + KV/cron is a potential **minute-scheduled JS migration**, subject to unverified no-card quota; Cloudflare Workers Free + D1 has a **10 ms CPU cap per Cron** and cannot run this Python worker unchanged. No card-only forever-free general VPS is verified.
- **Pending:** safely qualify a different card-free account before proposing resource creation; never use an old signed-in Chrome session through cloud browser. Keep Kite unrenewed until the synthetic cloud system is qualified. Engineering estimate **53%** and cloud acceptance **0/5** remain unchanged. Full updated Linux Python 3.12 suite **650 passed, 0 failed, 1 skipped, 1 third-party deprecation warning**, exit 0, after these Phase 50 changes.

## Phase 49 — Caddy validation and safe public-gateway probe (2026-10-23; NOT DEPLOYED)

- A checksum-verified official Caddy v2.11.7 CLI **validated** the exact Northflank gateway Caddyfile on Ubuntu WSL (`Valid configuration`, exit 0). A harmless formatting warning remains. This was **not** a live reverse-proxy request, Docker build, HTTPS check or deployment.
- Added `cloud_alerts.gateway_acceptance`, a deliberately opt-in synthetic HTTPS probe designed for a **future approved** public host. It enforces real TLS/443, no redirects, no secret headers/tokens, denied diagnostic/private routes, GET-only dashboard rules, separate dashboard-enabled shell behavior, 401 for unsigned handoff, and 413 for bodies above 2 KiB. Strictly no network calls before explicit confirmation. Recorded in [Phase 49 runbook](PHASE49_GATEWAY_EDGE_ACCEPTANCE.md).
- Twenty-five new offline tests pass. The **entire isolated Linux Python 3.12 test suite: 647 passed, 0 failed, 1 skipped**, exit 0 (one third-party Starlette deprecation warning). No actual cloud account, persistent volume, private network, TLS gateway, Android/Telegram phone receipt, or daily Kite login tested. **Engineering estimate stays 53%; live acceptance stays 0/5.** User has already signed into Northflank in a *local Chrome tab*, which is not a remotely connected session; don't open cloud browser or create resources absent proven ₹0 entitlements and user approval.

## Phase 48 — no-card free cloud edge preparation (2026-10-23; NOT DEPLOYED)

- Investigated Northflank Sandbox Free as a possible 24/7 alternative to an idle-sleeping host; its current pricing advertises **no card, 2 services, always-on compute and up to $20/mo in resources**. Older first-party billing documentation states a payment method is required. **Actual no-card account creation, explicit overage cutoff, persistence eligibility and ₹0 cost are UNVERIFIED**, therefore no account/resources were created and this is not hosting approval.
- In the isolated `feature/phase48-northflank-sandbox-prep` branch, prepared a separate Caddy gateway with a strict allowlist: signed 2 KB daily Kite-token handoff; GET-only HTML paper dashboard; four GET-only paper-account JSON APIs that individually demand a high-entropy backend key; public gateway liveness (not worker health); and 404 for all unrelated paths. Worker port 8080 must remain private. No order routes.
- Added six static policy tests and reran the **entire Python 3.12 Linux suite in a fresh separate WSL checkout: 622 passed, 0 failed, 1 skipped, exit 0**. The pre-existing WSL QA worktree showed local modifications and was deliberately left untouched. **No live Caddy binary validation, Docker build, TLS, mounted volume, laptop-off test or phone receipt has run**.
- Kite subscription renewal is postponed until after the strictly free host is qualified and synthetic integration checks pass. Never activate real market data credentials, Telegram delivery or autonomous paper entries before the operator approves an exact no-charge host. Expanded engineering estimate **53%**, actual live acceptance **0/5** remain unchanged.

## Phase 47 — verified Student Pack, Microsoft academic-domain blocker (2026-10-23)

- On the authorized Nirala Chrome browser, inspected the actual Microsoft Azure for Students academic verification form with the user's permission. The form displayed an **unrecognized institution academic email domain** error and provided no functional alternative verification selector. Do not store the student's DOB, email address, name or device verification codes in this repository. The account **is NOT Azure for Students activated**.
- Confirmed the existing **GitHub Student Developer Pack status is verified**, and its Microsoft Azure partner offer is shown under claimed offers. Following the partner activation link simply returns to Azure for Students signup; GitHub verification alone did **not** bypass Microsoft's academic-domain recognition.
- Attempted the official Azure Support portal: the account's support extension fails with **AADSTS16000** and cannot retrieve access tokens, so no support ticket was filed. No paid offer selected and no payment card entered.
- **Unblocking dependency:** Microsoft Education / Azure subscription support or the institution's IT administration must enable recognition of the legitimate academic email domain, or provide another official academic verification route. Only the student can approve identity proof or account verification if requested. Do not retry by inventing a different school, school email, verification code or paid account.
- Full Linux tests remain **616 passed, 0 failed, 1 skipped** on the previously merged source; no source implementation changed. Engineering estimate **53%**, actual live host/token/phone/five-session acceptance **0/5** unchanged.

## Phase 47 source merge checkpoint (no cloud deployment)

- GitHub [PR #3](https://github.com/Tirthanand17/Indicator-Setup/pull/3) merged into `main` with merge commit `ff22dabd234acd36f15497658c7ec4a88d23b18e`, after full offline Ubuntu Python 3.12 **616 passed, 0 failed, 1 skipped**, exit 0. The new code is read-only Azure subscription inspection.
- Azure CLI software installed; student offer registration and valid CLI account authorization remain unverified. **No Azure VM, disk, IP, resource group, cloud secret or deployment created**, and no real Kite/Telegram integration activated. Users must complete their own academic verification; no passwords or one-time codes belong in repository or chat.
- Actual live acceptance `0/5`; weighted engineering estimate **53% unchanged** until a verified covered host and live phone/data/session evidence exist.

## Phase 47 — Azure Student subscription discovery (connection awaits user academic verification)

1. Nirala Ubuntu 24.04 WSL2 now has official **Azure CLI 2.91.0** installed successfully; the [Azure for Students](https://azure.microsoft.com/en-in/free/students/) academic activation page and official device-login page were opened in the browser. No payment card, public cloud instance, credentials in repo, billable plan, or Azure role was created/modified.
2. Azure CLI sign-in was initiated, but `az account list` showed **no accessible subscription**, and a tenant query requested authentication. **Azure for Students active subscription not yet verified**; the user's eligible academic verification and Microsoft authorization are the actual human-only blockers.
3. Added `cloud_alerts.azure_student_audit`, which supports read-only Azure subscription offer inspection with sanitized output, safe malformed-account handling and a strict no-deploy result. **8/8 synthetic tests passed**; the **whole Linux Python 3.12 suite: 616 passed, 0 failed, 1 skipped**, exit 0.
4. See [Phase 47 exact account verification and cost-safety runbook](PHASE47_AZURE_STUDENT_CONNECTION.md). After human activation and authenticated CLI sign-in, verify student quota ID, sponsorship balance, expiration, covered persistent disk/IP/network and VM availability before asking for a particular host approval.
5. Overall expanded engineering estimate **53% unchanged**, actual live cloud acceptance **0/5**. No real orders and no production paper alerts have been enabled.

## Phase 46 final — post-merge Python 3.12 verification

- Synced post-merge GitHub `main` commit `f0c17a055eb56ab888b4213a7d51a4de5f777f77` to Nirala's disposable Windows TEMP clone and WSL Ubuntu ext4 checkout (non-root `indicatorqa`). Ran the checked-in full Linux regression again, with empty inherited credentials and paper/live activation disabled: **608 passed, 0 failed, 1 skipped, exit 0**, 29.03 seconds. Local JUnit/logs remain under `/home/indicatorqa/work/reports/`.
- Existing Render workspace contains only sleeping Free web services or other unrelated services, and its Free Postgres is suspended; **no approved eligible durable always-on ₹0 host exists in this connection**. Azure/OCI infrastructure management account is not connected. Hosting, daily real Kite token relay, actual phone receipt, and five separate market sessions remain open. The new local host-plan review is NOT deployment authorization. No real orders.

## Phase 46 merge checkpoint — verified local gate, NOT live activation

- [PR #2](https://github.com/Tirthanand17/Indicator-Setup/pull/2) **merged into main** at `118a5b5c37018a50a6da1c86e1838c308292c436`. The diff is limited to the host qualification CLI, blocked host example, strict regression tests, and documentation. The Ubuntu Linux Python 3.12 full suite passed **608/608 runnable tests (plus 1 skipped)**, exit 0, before merge.
- Render workspace reviewed read-only; there is NO eligible always-on durable ₹0 service for the worker among the existing unrelated Free web services. No service created, no secrets read, no budget/plan changes, no real orders. **Actual cloud acceptance remains 0/5; expanded engineering estimate remains 53%.**

## Phase 46 — no-cost cloud host safety and local rehearsal (NOT DEPLOYED)

1. Inspected the already-connected Render account read-only. Existing Free sleeping web services and suspended Free PostgreSQL cannot support an unattended SQLite/token-vault worker; no unrelated services were changed and no new resources/billing enabled. See [Phase 46 hosting evidence](PHASE46_HOST_QUALIFICATION.md).
2. Added an offline `cloud_alerts.host_qualification` CLI and an intentionally **blocked** host-plan template. The gate hard-rejects Render Free; requires recently reviewed explicit no-incremental-cost, spend protection, unslept worker and durable storage declarations; refuses unrecognized or secret-like input fields. **Self-reported passing plans do not approve provisioning or attest live host checks.**
3. In Nirala's non-root WSL Ubuntu 24.04 / Python 3.12 environment, ran the real-process localhost [loopback rehearsal](LOOPBACK_LIFECYCLE_REHEARSAL.md): **all 12 synthetic HTTP/restart/encryption/replay checks PASSED**, without real broker, Telegram, production TLS or a host.
4. Final complete Linux Python 3.12 suite including blocked Render Free example: **608 PASSED, 0 FAILED, 1 SKIPPED**, exit **0**, 27.64 seconds, on `d30fecf`. The CLI was also invoked against the example: `BLOCKED`, `RENDER_FREE_SLEEP_AND_EPHEMERAL_STATE`, no provisioning.
5. **Expanded engineering index remains 53%**, live host/token/phone/five-market-session acceptance **0/5**. Next material blocker is an authorized, demonstrably no-incremental-charge **persistent always-on Linux host** distinct from Nirala. No real orders.

## Phase 45 completion — verified merge into main (October 23, 2026)

- Also fetched **post-merge `main` `86c208a12f2efa508352a27382211ad82530264a`** into the Linux ext4 checkout and ran the checked-in full suite again: **585 passed, 0 failed, 1 skipped, exit 0**. This independently verifies merged source, not merely a draft branch. The local log/JUnit remain on Nirala under `/home/indicatorqa/work/reports/`.
- GitHub [PR #1](https://github.com/Tirthanand17/Indicator-Setup/pull/1) was marked ready after two complete, isolated local **Ubuntu 24.04 WSL 2 / Python 3.12** green runs (both **585 passed / 0 failed / 1 skipped**), then merged with **merge commit `536e27422505a956f469dded28c115ba7b529345`**. The full GitHub commit history was retained.
- Confirmed on merged `main`: `ALERTS_ENABLED=false`, `PAPER_AUTOTRADE_ENABLED=false`, `PAPER_DASHBOARD_ENABLED=false` and `KITE_SHADOW_ENABLED=false` in the example environment. Source merge **does not** turn on worker/cloud/phone monitoring or submit broker orders.
- This clears the **local full Linux regression and branch merge** subphases. **Actual live cloud acceptance remains 0/5.** Future development must use merged main as the current source of truth; historic draft-branch instructions below are retained only as prior audit records.

## Phase 45 — verified Ubuntu WSL 2 and full Linux Python 3.12 regression GREEN (October 23, 2026)

1. Installed **Microsoft WSL 3.0.3.0 + Ubuntu 24.04.5 LTS on WSL 2** on the existing Nirala Windows 11 laptop using normal UAC elevation; installer exit **0**, with no forced Windows restart, no change to the protected Desktop trading folder, and no cloud/CI usage. Ubuntu default user is dedicated non-root `indicatorqa`, and existing `[boot] systemd=true` configuration is preserved. `python3 --version` is **3.12.3**, with Ubuntu `python3.12-venv` installed.
2. Copied the exact GitHub source into Ubuntu native ext4, not NTFS, at `/home/indicatorqa/work/indicator-setup`; virtualenv `/home/indicatorqa/work/.venv` includes repository and pytest dependencies. Ran the **entire** `cloud-alerts` suite with `env -i` and all broker alert/paper activation flags false.
3. First actual Linux run: **584 passed, 1 failed, 1 skipped**. Root cause: a synthetic concurrent Kite SDK lifecycle test improperly expected only two historical connections to be closed, while the engine correctly closed **three clients** (the metadata/quote client plus each history thread). Corrected the test to assert that ALL created SDK sessions are closed, and maintained separate 5m and 15m identities. Fix commit `a449165`.
4. Second complete Linux Python 3.12 run on corrected source `a449165`: **585 passed, 0 failed, 1 skipped, 1 deprecation warning**, exit **0**. Added [reusable safe test script](../scripts/Run-Local-WSL-Py312-Regression.sh) to the feature branch. After syncing script commit `c96703f` into WSL and normalizing Windows Git CRLF to LF, **reran the CHECKED-IN runner**: again **585 passed, 0 failed, 1 skipped, exit 0**. JUnit XML and output logs stay in `/home/indicatorqa/work/reports/`.
5. **The prior "full Linux test blocker" is now resolved through actual execution evidence**, not CircleCI, Codespaces or GitHub Actions. Codespaces remained blocked under the user's $0 budget; no new external resources were created. The GitHub PR is mergeable by GitHub CLI, but no CI status is attached. Full test success does NOT imply real Kite data, Telegram handset receipt, durable cloud hosting or five live market sessions: **0/5 actual acceptance gates** verified.
6. **Overall expanded-goal estimate remains 53%** pending real deployment/evidence milestones; the major Linux regression gate is complete. Detailed installation, run commands and logs: [Phase 45 WSL evidence](PHASE45_WSL_LINUX_REGRESSION.md). No real broker orders or production flags were enabled.

## Linux Python 3.12 CircleCI regression path

The existing user's alternative CI provider is **CircleCI**, previously used for other trading-research repositories. In this Indicator-Setup draft branch, added a branch-filtered `.circleci/config.yml` using `cimg/python:3.12`, a small Docker resource, offline test-only environment flags, explicit unsetting of live Kite/Telegram secrets, and a JUnit test artifact. It targets **only** `feature/phase43-paper-recovery-audit`; there is no deploy/publish job or GitHub Actions use.

**Run status:** GitHub commit-status API returned `statuses: []`, and GitHub workflow-runs returned `[]` after the config commit. This does not prove CircleCI project registration or an executed Linux job. CircleCI is not exposed as a connected action in this ChatGPT tool context, so a successful CircleCI job **has not been verified**. Do not merge pending all-green Linux evidence. Docs: https://circleci.com/docs/guides/getting-started/language-python/


## Phase 44 continuation — zero-cost QA after Codespaces HTTP402

1. User's GitHub screenshots confirm five **$0 budgets**, including Codespaces marked **Usage blocked**. A guarded 2-core Codespace creation attempt definitively returned `HTTP 402 Usage not allowed ... free usage or budget exceeded`. Rechecked `gh codespace list`: **0 Codespaces**. No spending limit changed, no new resource created, no further Codespaces attempts.
2. Audited cloud-only `TokenVault.put`: on `os.fchmod` failure its raw `mkstemp` file descriptor was not explicitly closed, masking the real error under Windows. Patched descriptor transfer/cleanup while preserving **mandatory Linux 0600 enforcement**. Added 4 synthetic permission/sync/replace failure regressions; all **4/4 PASS on Nirala**.
3. Added reusable `cloud-alerts/scripts/Invoke-WindowsPaperSmoke.ps1`: selected *offline only* trade/accounting/security tests under existing Nirala temporary checkout and venv, broker/Telegram environment variables temporarily cleared, with syntax compilation. Executed on latest checked-out code: **72/72 tests PASS, 0 failed**, followed by compilation success. Separately, isolated Linux Python 3.13 recovery/accounting set: **29/29 PASS**.
4. Windows whole-suite baseline remains **458 pass, 120 fail, 4 skip** (pre-patch), primarily intentional POSIX-only OS requirements; **full Linux Python 3.12 suite still NOT EXECUTED**. These targeted green tests are not evidence of a green full suite. Keep draft PR #1 unmerged; all real broker orders disabled and hosting OFF.
5. `.devcontainer/Run-Linux-QA.ps1` was hardened to handle benign `gh` stderr notices and preserve an actionable Codespaces HTTP failure result, but its full launch/cleanup path cannot be tested while budget is blocked. See [Phase 44 cost block and real QA proof](PHASE44_CODESPACES_OFFLINE_QA.md).
6. **Expanded-goal engineering progress 53% unchanged, actual live acceptance 0/5**. The next valid ways to complete Linux-only tests are an approved already-funded Linux Python 3.12 runner, a future included quota reset with user approval, or a user-approved reversible Linux environment on their computer. Do not bypass cloud budget limits, OS security checks or user restrictions.

## Phase 44 — Replace exhausted CircleCI with no-cost-gated GitHub Codespaces Linux QA

1. **CircleCI monthly limit exhausted per user**; disabled its branch pipeline by deleting `.circleci/config.yml`. No new CI subscription, GitHub Actions usage, spending commitments or deployments.
2. Prepared `.devcontainer/devcontainer.json` (Debian Linux, Python 3.12) and `.devcontainer/run-linux-qa.sh` (automatic full pytest within 10-minute timeout, local JUnit/logs, **`env -i` secret isolation**, monitoring/paper flags disabled). GitHub personal Codespaces has a **separate** included quota from Actions and CircleCI, but actual remaining free hours/storage could not be confirmed: **no Codespace was created** to avoid potentially billable usage.
3. Read-only Nirala GitHub CLI verified `gh codespace list` returned **0** existing Codespaces, and repository supports a **2-core `basicLinux32gb`** machine. Pulled the branch into its already authorized temporary clone; checked devcontainer JSON parses and shell script passes `bash -n`. These are **configuration validation**, not a full Linux test.
4. Separately ran the recovered Phase 43 **29 isolated recovery/cash integrity unit tests on Linux Python 3.13: 29/29 PASSED**, but complete Linux Python 3.12 application suite is **NOT RUN**. Earlier actual Nirala Windows full suite remains **458 passed, 120 failed, 4 skipped**; targeted full-repo paper tests **68/68 passed**.
5. The exact **budget-guarded** one-command Codespace launch and cleanup, test artifact locations and safety limitations are saved in [Phase 44 Codespaces Linux QA instructions](PHASE44_CODESPACES_OFFLINE_QA.md). Creation requires confirmation that Codespaces is within user's **remaining free allocation and $0 spending controls**. PR #1 remains draft and unmerged, paper autopilot OFF, live acceptance **0/5**, engineering estimate **53% unchanged**.

## Phase 43 — actual Nirala checkout and full Windows suite (RED; 53% retained)

1. Connected to **Nirala online** through the linked Desktop Commander Personal account. Cloned real Phase 43 branch into `%TEMP%\indicator-phase43-qa-20261021`, with isolated Python venv. No Desktop or protected Kite trading-folder mutations, no production services.
2. Ran `python -m compileall -q cloud_alerts tests` — PASS. Windows Python **3.11** (production Docker targets **Linux Python 3.12**). Added conditional `tzdata` to project requirements so Windows can load `Asia/Kolkata`.
3. **Full GitHub checkout pytest executed: 458 PASSED, 120 FAILED, 4 SKIPPED; red.** Failure signatures are dominated by Linux-only `os.fchmod`, `os.geteuid`, deliberate Linux/POSIX lock requirement, Windows symlink/file-lock constraints and local loopback smoke; do NOT fake POSIX security to force Windows green. No verified all-green Linux suite.
4. Independently ran the paper research subset against actual source: **68/68 PASSED**, including new journal, fees, quote audit and realized-only analytics. **Two real State/PaperBook recovery integration tests PASSED** (5 in same integration file deselected); these overlap the full-suite pass total and are not additive.
5. No merge, GitHub CI, paid host, real Kite key, phone send or real order. See [Full Windows QA results, failure classification and next Linux runner command](PHASE43_NIRALA_WINDOWS_QA_20261021.md).
6. Expanded engineering estimate **53%**, original alert preparation **80%**, paper subsystem historical estimate **43%**; **live acceptance remains 0/5**. Next: authorized isolated Linux Python 3.12 full pytest, patch legitimate failures, merge then cloud acceptance.

## Phase 43 addition — protect research P&L against corrupt journal (53% retained)

1. Private FastAPI paper summary now removes potentially incorrect cash/P&L/trade counts if exact journal reconciliation fails. The authenticated trade-history and analytics APIs reject invalid balances with 503 instead of publishing results that look trustworthy. The phone-friendly page fetches/reconciles summary before drawing equity charts; on failure it shows a cash-integrity warning and no trade performance.
2. Added/extended API and UI integration regressions to prove fail-closed behavior. **10 Phase 43 full-app integration cases committed but not executed**, including the 7 State/Engine tests. Existing Python 3.12 production-target suite is still unverified; no CI workflows or runs exist.
3. **29/29 focused isolated Python 3.13 recovery/accounting cases passed**, including 1-paise and negative-cash corruption, wrong P&L, orphan accounts, and after-hours crash recovery. Main/default branch and all live-cloud activation toggles remain unchanged; zero broker orders, zero user-folder mutations or new cloud charges.
4. Expanded objective estimate **53% unchanged**, original alerts engineering **80%**, new paper subsystem previously estimated **43%**, five real host/token/handset/market acceptance gates **0/5**. Details: [Phase 43 recovery evidence](PAPER_RECOVERY_PHASE43.md).

## Phase 43 extension — paper cash-conservation integrity (DRAFT PR; 53% retained)

1. Added read-only `audit_cash_reconciliation`: for each independent ₹50,000/₹100,000 account, recompute exact paise cash from original starting capital, every entry debit, and every completed exit credit; verify CLOSED P&L arithmetic; refuse noninteger/negative cash, unknown accounts, orphan positions, duplicate forbidden states, or artificial credits for unresolved exits. On any discrepancy, halt further paper processing rather than changing recorded cash.
2. Connected cash reconciliation to the Engine's *pre-broker* market gate and to authenticated dashboard summary. An invalid REVIEW history or cash journal produces sanitized FAIL_CLOSED metadata and a distinct visible private dashboard warning; market worker will not fetch new trade quotes or take simulated positions while blocked.
3. **29/29 focused isolated Python 3.13 tests passed**, comprising previous 19 crash-recovery cases plus 10 new accounting-integrity tests. Compileall of the local test subset passed. **9 new Phase 43 real worker/State/PaperBook/API integration tests have been committed but not run; the full repository suite is still unverified**, and target Docker Python is 3.12.
4. All changes remain on draft PR #1; do NOT merge or activate solely from isolated testing. Updated [Phase 43 continuation and recovery evidence](PAPER_RECOVERY_PHASE43.md). Original alerts-only preparation **80%**, expanded engineering **53% unchanged**, paper subsystem previously estimated **43%**, actual hosting/Telegram/Nirala-off/five-session acceptance **0/5**. Real orders disabled and no cloud charges.

## Phase 43 — crash-consistent paper account outcomes (DRAFT PR, 53% retained)

1. Found a real two-portfolio write-gap: the source five-indicator REVIEW and virtual candidate are committed before the independent ₹50k and ₹100k paper account results. A worker crash can leave a partial pair; retry may be suppressed by the persisted review candidate. Never backfill a simulated option purchase using stale quotes.
2. On `feature/phase43-paper-recovery-audit`, added an immutable UTC paper-automation activation watermark, append-only REVIEW-to-account coverage checks, and automatic **180-second grace then CRASH_GAP_NO_SIMULATED_FILL** reconciliation in one SQLite exclusive transaction. Missing account outcomes become explicit rejections, not invented trades; existing account cash/positions remain unchanged. A single durable PAPER_RECOVERY operational alert is queued.
3. Production FastAPI enables this integrity gate only for explicitly opted-in PAPER_AUTOTRADE, before subsequent REST-driven decisions. The new gate also runs before token lookup, so an absent daily Kite token cannot prevent *local* crash-gap reconciliation. Conflicting or unknown-account outcomes now fail closed rather than being treated as a complete basket. The private paper summary and dashboard expose sanitized coverage/blocked-state counts. Original alert-only mode remains unchanged and live broker order methods remain absent.
4. **Executed 29/29 focused isolated recovery/accounting unit tests — PASS** (including unknown-account/conflicting-outcome checks and atomic rollback failure injection). Added **ten Phase 43 worker/schema/API/frontend integration tests** but they and the combined suite remain **UNRUN** because the tool container cannot clone GitHub and there is no existing GitHub CI workflow. The branch is for review and is not deployed; a draft PR must not be merged without validation.
5. Original alerts-only engineering **80%**; expanded engineering **53% unchanged** (Phase 43 unmerged/integrated verification pending); new paper research engineering **43%**, cloud/phone/five-session acceptance **0/5**. No user Nirala protected-file reads/writes, cloud charges, real Kite access token transfers, Telegram phone sends or real trades.
6. Minute-level offline recovery now also runs **after market close, on nontrading days and while Kite login is unavailable**, and end-of-day paper summaries are withheld during an unfinished grace period. Two additional local tests cover these clock windows (19/19 passed); the added Engine integration tests remain unrun. Detailed phase ledger: [Phase 43 crash recovery and exact continuation](PAPER_RECOVERY_PHASE43.md). Next: full pytest on an approved runner; fix test/integration findings; then merge, complete data quality/fee validation, and activate approved host and real five-session paper tests.

## Phase 42 — dated NSE option fee model, daily-loss risk, causal missed signals and advanced research analytics

1. Updated new simulated trades to use a **versioned April 2026 NSE options cost policy**: Zerodha flat brokerage per buy/sell leg, NSE transaction fees, SEBI turnover fees, GST, buy stamp and sell STT (with official rounding); exact per-leg estimated charges use simulated ASK/BID fills and contract quantity. Existing fixed-charge paper records remain backwards compatible through an additive SQLite column migration. These are *estimated broker costs*, NOT verified contract notes.
2. Updated sizing to check **remaining daily risk after earlier realized losses**, taking adverse entry/stop-exit slippage and both fees into account. Prevent a third entry from exceeding the 6%-of-starting-capital daily modeled-loss budget even when each individual trade passes its 3% rule.
3. Created append-only signal audit and wired it into completed 5-minute strategy evaluations, validated option liquidity, existing-position suppression and separate ₹50k/₹100k paper acceptance or risk rejections. The private dashboard shows missed qualifying signals distinctly from nonqualifying setups, preserving full indicator readings and sanitized reason codes. Date filtering works after correcting the JavaScript expression; P&L of unobserved missed option fills is never invented.
4. Added separate-account realized analytics: win rate with denominator, realized equity-change curves, day/week/month return on initial paper capital, CE/PE breakouts, drawdowns, profit factor, expectancy, streaks and unresolved-trade counts. The earlier combined-account chart was replaced by **two separately identified comparison curves**. Added protected `/paper/api/analytics` and `/paper/api/opportunities`, both requiring the existing private key; daily Telegram summaries can include same-day qualified/rejected signal counts.
5. Added a static forbidden-order-call AST regression and broker-wrapper surface test, plus new synthetic cross-module regressions. **Executed 13/13 focused local pure-module tests** (costs 4, audit 5, analytics 4); **full repository integrated test suite NOT RUN**, and the new cross-module tests also remain unverified. No GitHub Actions credits, protected Nirala reads/writes, Kite tokens, real orders, hosting charges or phone messages.
6. Expanded-scope **paper subsystem engineering 35% → 43%** based on concrete fee/audit/analytics code and focused tests, although production reliability is still unverified. Weighted expanded engineering index **51% → 53%** (50% × old alert prep80 + 30% × paper43 + 20% × live0); **original alert-bot preparation remains 80%**; cloud/Telegram/Nirala-OFF/five-session live gates remain **0/5 verified**. See [Phase 42 audit and limitations](AUTOMATED_PAPER_PORTFOLIO_PHASE42.md).

## Phase 41 — fully automatic PAPER options simulator, v1, not yet activated

1. Audited existing five-indicator trading logic, current-month NIFTY contract selection, exchange-timestamped Kite bid/ask validation, one-at-a-time virtual candidate, premium watcher, SQLite outbox, crash recovery, FastAPI endpoints, CLI and hosting constraints. **Reused** all of these; did not create another broker client, credential source, or executable-order path.
2. Added a **persistent two-portfolio cash/position journal** for ₹50,000 and ₹1,00,000 paper accounts in the current SQLite database. Simulated ASK buys, observed-BID sales, lot sizing, slippage, modeled costs, per-trade/daily risk, cash reservation, duplicate rejection, restart durability, audit history and **atomic paper-entry/exit + Telegram outbox rows** are implemented in paper_book.py. Optional ₹3,000 affordability comparison can be constructed in isolated tests; no minimum daily trade count.
3. Integrated opt-in PAPER_AUTOTRADE_ENABLED within the existing verified REST-decision worker: eligible CE/PE REVIEW with fresh depth produces independent paper entries; a **20-second read-only quote watcher** can simulate STOP/TARGET/TIME exits. Missing or stale BID leaves no fabricated cash credit. After 15:26, unclosed positions are flagged **EXIT_UNVERIFIABLE**; overnight quotes cannot be used retroactively. Per-session 15:30 daily summary is queued by the existing Telegram outbox.
4. Added secure mobile-responsive paper UI (/paper/dashboard), 15-second refresh, private header-authenticated JSON APIs (/paper/api/summary and /paper/api/trades), cash/P&L cards, basic equity-change visualization and simulated trade history. These endpoints are inaccessible unless PAPER_DASHBOARD_ENABLED is explicitly enabled with a strong secret; no key is saved in browser storage or URLs.
5. **Executed 18/18 focused local synthetic ledger tests: PASS.** Committed **9 additional end-to-end API/Engine integration tests**, but they and the full existing repository suite remain **NOT EXECUTED**. No real Zerodha market calls, order endpoints, protected desktop files, cloud host, payments or Telegram phone messages. New simulator activation remains OFF. Full modeled taxation and advanced analytics/missed-trade coverage still incomplete.
6. **Rebased progress for expanded objective** rather than misleadingly leaving 80%: earlier alerts-only engineering estimate **80%**; NEW paper subsystem **35%** (main ledger tested in isolation, full runtime unverified); actual cloud/phone/multi-session verification **0%**; weighted expanded-goal implementation **51%** (50% legacy + 30% simulator + 20% live, rounded). Profitability and trading accuracy have NOT been measured. See [Phase 41 details](AUTOMATED_PAPER_PORTFOLIO_PHASE41.md).

## Phase 40 — block code-only percentage inflation; prioritize approved host (80% retained)

1. **Acknowledged stalled 80%**: Phase 35–39 improvements did not prove that the laptop-independent Telegram bot is working. Added a distinct **0/5 actual live acceptance gates** metric for host/TLS, signed token, actual Kite market data, handset delivery with Nirala OFF, and five NSE F&O sessions. Engineering 80% is unchanged rather than artificially increasing the figure.
2. Verified the connected GitHub repository and a Render connection exposing **one workspace named `Ai finance agents`**. Workspace-specific inspection requires the user's explicit confirmation of that workspace, and no services were inspected or changed. Official Render Free is unsuitable for durable unattended Python state because of 15-minute sleep and ephemeral storage.
3. Verified alternate architecture constraints: OCI Always Free supports existing Docker/Python under eligible tenancy/capacity (which remain unknown), subject to possible idle reclamation; Cloudflare Workers Free has free cron, D1 and $0 usage within limits but requires a substantial port of the Python worker, with 10ms CPU per invocation. No cloud signup, public endpoint, DNS configuration or charges.
4. Re-ran two available focused isolated suites in the current runner: **12/12 SDK transport cases** and **10/10 OCI plan cases** passed. These are **22 focused tests**, not the full repository's approximately 500 tests. The container cannot resolve GitHub directly, and no Actions credits or private Nirala laptop access were used.
5. Published [Phase 40 hosting decision and live acceptance gates](PHASE40_HOST_ACTIVATION_TRUTH.md). **No cloud deployment, real Kite token relay, real phone receipt, off-laptop continuity or five real sessions exists yet.** Next host action requires user approval of a specific existing workspace/service or tenancy; actual broker order execution stays disabled.

## Phase 39 — pin reviewed Kite SDK and release all REST sessions (80% retained)

1. Verified Phase 38 GitHub head `b15c618` and the historical **451/451** full-suite baseline from Phase 34. Rechecked upstream KiteConnect source and latest version. `requirements.txt` previously permitted arbitrary new SDK v5 releases despite Phase 37's reviewed private transport attributes; now pinned to official `kiteconnect==5.2.2` (other dependencies still not fully locked).
2. Closed **every** read-only market SDK HTTP session: the original per-poll instruments/quote client now closes in `Engine._collect_once` even on exceptions/NO_TRADE; Phase 38's independent concurrent historical clients remain separately closed; optional 20-second virtual-premium quote SDK now opens and closes inside its own thread. Read-only policy unchanged, no order execution.
3. Added **six synthetic lifecycle regressions**: four main-worker paths and two premium-watcher paths. Executed **12/12 isolated transport/close tests** locally, including a new SDK-close test. **The six newly committed Engine tests and the complete suite have NOT been run**; no source clone available because this runner cannot resolve GitHub, and GitHub Actions credits/laptop were not used. Assuming stable collection, **500** is an expected case count, **not 500 passed**.
4. Published [Kite REST session lifecycle and version pin](KITE_REST_SESSION_LIFECYCLE.md). No real Kite/Telegram messages, protected Nirala file reads, hosting changes, or charges.
5. Overall implementation estimate remains **80% engineering / 20% unfinished** until an approved ₹0 host, real TLS daily token relay, read-only Kite/Telegram live verification, laptop-OFF continuous alerts and five actual paper-market sessions establish operation. P9 remains **0% live-tested**.

## Phase 38 — isolated concurrent official Kite history SDK sessions (80% retained)

1. Verified GitHub Phase 37 head `b6a338f`, audited live `Engine._collect_once` and the upstream official Kite SDK request implementation. Confirmed parallel 5m and 15m history reads were dispatched via `asyncio.to_thread` **on the same SDK/Requests Session**. This was a thread-safety risk for authoritative OHLCV feeds.
2. Updated the single worker to create **separate read-only KiteConnect sessions inside each history thread**, preserving parallel 5m/15m fetch latency, Phase 37's direct HTTPS policy, existing option quote path, 24-second overall budget and no order methods. A historical failure continues to fail closed with `WAIT_DATA`.
3. Added **4 offline regression tests** for distinct 5m/15m SDK sessions, quote-client separation, synthetic broker-history error suppression and subsequent-poll session freshness. Added explicit HTTP session cleanup via `KiteReadOnly.close()`, called in each isolated historical worker's `finally` block; regression fixtures check cleanup on both success and failure. The tests and updated engine code were committed and read back from GitHub, but the full suite was **NOT executed** because the repository cannot be cloned in the current container (GitHub DNS blocked) and GitHub Actions credits must not be spent. With Phase 35–38 additions, 494 is a **possible collected-test count**, not **494/494 passed**.
4. Published [independent Kite REST sessions report](INDEPENDENT_KITE_REST_SESSIONS.md). No real token, brokerage request, public cloud host, Telegram message, user's Nirala laptop, protected trading folder or paid resource was accessed or modified.
5. **80% engineering estimate retained**. Blockers: user-specific approved ₹0 persistent always-on VM, live TLS signed token relay, real Kite authentication, confirmed Telegram phone receipt, laptop-off continuity and five real market sessions. Cloud worker OFF; execution of actual trades DISABLED.

## Phase 37 — fail-closed official Kite SDK REST HTTPS transport (80% retained)

1. Verified current GitHub Phase 36 head `bbedcd8c` and inspected Kite REST wrapper plus the officially documented pykiteconnect v5 source. Confirmed Phase 36 isolated token/Telegram HTTPS requests, but the **Kite market-data SDK** maintained a separate Requests session with environment-inherited proxy/CA defaults and redirect following.
2. Enhanced only the new cloud project's `KiteReadOnly`: before setting the broker bearer token, require official `https://api.kite.trade` root, SSL enabled, debug OFF, SDK proxies empty and reviewed Requests session; enforce **trust_env=False** and **max_redirects=0**, failing closed if the SDK transport is unsupported. No trade methods, calls, credentials or protected folder operations added.
3. Added **11 synthetic offline Kite SDK transport tests** and exercised all 11 successfully in a small isolated local Python pytest environment. Separate Requests redirect control check passed. The full GitHub repository **was not cloned locally** due to DNS/network restrictions, so the **combined 490-test regression suite remains UNVERIFIED**. Last fully documented suite: **451/451 in Phase 34**; P35 +10, P36 +18, P37 +11.
4. Published [Kite SDK outbound REST security evidence](KITE_SDK_DIRECT_TLS.md), documenting v5 upstream coupling, proxy/TLS failure behavior and required tests before actual deployment. Optional KiteTicker WebSocket remains separate and disabled by default. No GitHub Actions credits consumed.
5. **Progress stays 80% engineering estimate** because no approved live cloud VM, HTTPS ingress, secure token relay to a production host, confirmed Telegram phone receipt, Nirala-OFF continuity or P9 five-session market evidence exists. Real-money execution remains OFF.

## Phase 36 — credential-bearing outbound HTTPS transport isolation (80% retained)

1. Inspected GitHub Phase 35 head `8e5ccebb` and existing sender/test paths, with **no new cloud, Windows, phone, broker or GitHub Actions activity**. Found that outbound token and Telegram sends inherited environment proxy/CA variables and that token-sender URL validation was weaker than the strict HTTPS ingress probe.
2. Updated the daily Kite token sender to reuse the strict **public HTTPS port 443 /internal/token FQDN** validator; rejected custom ports, localhost/IP/private suffixes, URL credentials and query/fragment-bearing destinations. This is a *structural URL rule*, not proof that the operator actually owns the hostname.
3. Replaced ambient requests.post for the token handoff and Telegram sends with temporary requests.Session transports configured **trust_env=False**, **verify=True**, **allow_redirects=False**, and bounded timeouts. Broker data SDK HTTP transport is separately pending inspection.
4. Updated signed ASGI handoff test mocks and added **18 synthetic pytest cases** for hostile proxy/CA settings, TLS rejection, redirect refusal, private/custom endpoints, read-only source and credential-sanitized errors. Tests are **committed but not executed in the full repository environment**; do not claim **479/479 passed**. Historical verified 451/451 is from Phase 34, and Phase 35 focused-test claims remain separate.
5. Published [direct TLS isolation and limitations](OUTBOUND_TLS_ISOLATION.md). Uninterrupted laptop-off alerts still require approved non-sleeping hosting, persistence, real Kite authentication, Telegram handset receipt, five actual sessions and cost verification. **Engineering completion stays 80%; actual cloud deployment remains OFF; live orders remain DISABLED**.

## Phase 35 — OCI Free-only resource plan gate and real-host dependency (80% retained)

1. Inspected the newer Phase 34 GitHub head `0faa40e5`; **451/451** was the documented Phase 34 offline test result, rather than this session's full re-run. Rechecked the Docker/HTTPS, preflight, token, Telegram and privacy boundaries. No approved VM exists.
2. Added a standalone, offline `cloud_alerts.oci_plan_guard` JSON CLI that rejects Free-only A1 plan overages, wrong home region, unverified chargeable network/DNS/IP components, non-Free account modes, unexpected/secret fields and unacknowledged 7-day idle reclamation risk. Its success result explicitly **never** certifies real cost, quota, account ownership, capacity or provisioning.
3. Added **10 focused synthetic tests**, all passed on the isolated local code; an end-to-end **461/461** regression run is **NOT VERIFIED** because the full historical repository/dependencies were unavailable to this runner. No GitHub Actions credits were spent.
4. Cross-checked official Oracle Free-only limits: **2 A1 OCPUs/12 GB RAM and 200 GB combined boot/block storage**, subject to home region and existing usage. Oracle **may reclaim idle Always Free instances**, so a lightweight bot has a genuine continuity risk; don't treat this as a production uptime guarantee. Added [OCI operator gate](OCI_ALWAYS_FREE_OPERATOR_GATE.md). Render Free still fails storage/idle requirements.
5. Host activation, real HTTPS/daily token handoff, Telegram handset receipt, laptop-off stability and P9 five real market sessions remain **0% live-verified**. **Engineering progress stays 80%**. The next required action is a user-controlled check of an existing OCI Free-only tenancy or a separately approved free-tier signup, *without disclosing credentials or card details*. No cloud accounts or billable resources were created.

## Phase 34 — planned Windows user-logon token watch without protected-file edits (80% retained)

1. Verified GitHub Phase 33 head `6d5ca3f` and reproduced **443/443** Python tests. Reconfirmed the cloud remained disabled and no account-approved always-on host had been provisioned.
2. Added `deploy/windows/Install-DailyTokenRelay.ps1` and `Watch-DailyToken.ps1`: an operator-only, current-user scheduled task starts the already-tested Python `.env --watch` sender at login. Installer validates the exact approved HTTPS endpoint and refuses to register unless both explicit approval switches are given. It writes only into Windows `LOCALAPPDATA`; original trading folder is used as a read-only `.env` source.
3. Relay HMAC key is requested interactively and encrypted under the Windows user's DPAPI key; the task action contains only paths, no credentials. It does not log in to Zerodha, start any cloud service or send a token at installation time. It requires Windows to remain on through handoff.
4. Added eight Linux-based safety and synthetic sender tests; **451/451 Python tests PASS**. **Windows PowerShell syntax, Task Scheduler registration and DPAPI execution remain untested on Windows** pending a separately authorized deployment. No live broker, phone or hosting activity.
5. P2/P5 operational adoption is still pending, so the milestone-weighted **engineering completion remains 80%** and live host + phone acceptance P9 remains 0%. See [Windows operator runbook](WINDOWS_AUTOMATIC_DAILY_TOKEN_RELAY.md).


## Phase 33 — missing-token phone warning and HTTPS ingress acceptance tool (80% retained)

1. Verified published Phase 32 GitHub head `6af77a9` and reran the **421-test baseline**. Found missing daily Kite tokens left the worker in `WAIT_TOKEN` without a dedicated phone warning, so users could mistake an alert-free day for a quiet market.
2. Added a single, explicitly non-trading `SESSION_WAIT_TOKEN:YYYY-MM-DD` alert on open NSE F&O monitoring days. The same SQLite outbox prevents duplicate warning sends across retries and restarts; 180-second expiry and telemetry remain unchanged. Holidays/weekends/disabled workers/premarket do not notify. Failed Telegram sends cannot mask the primary `WAIT_TOKEN` status.
3. Added an **explicitly opt-in** HTTPS public ingress acceptance probe, with certificate validation, no redirects/proxy environment, private-endpoint blocking checks and one unsigned `{}` request to confirm HMAC rejection. It uses **zero credentials**; the operator must provide an already-approved HTTPS domain. No real network probes were performed in development.
4. Twenty-two additional offline regression cases: **443/443 tests passed**, module compilation passed. No real tokens, Kite calls, Telegram phone messages, broker orders, protected folder access, hosting account, or charges involved.
5. P4 **97 → 98%**, P5 preparatory scaffolding **77 → 79%**; ten-phase mean **79.7% → 80.0%**, reported **80%** unchanged. Live deployment and multi-session real paper results are still unverified. See [daily token warning + HTTPS acceptance](SESSION_TOKEN_WARNING_AND_HTTPS_PROBE.md).


## Phase 32 — signed-token ordering and host approval gate (80% engineering estimate)

1. Verified remote GitHub Phase 31 head `fe1f140` and **414/414** baseline local tests. Investigated two correctly HMAC-authenticated daily token transfers arriving in the wrong order. Previously, a distinct older signed submission could overwrite the newer encrypted Kite access token even though nonce replay checks passed.
2. Persist the signed relay Unix timestamp inside the Fernet-encrypted vault; reject older and ambiguous same-second distinct tokens with HTTP `409`. Equal-time duplicate payload with a different valid nonce is idempotent. The server does not reveal credentials or claim the token works with Kite.
3. Reject near-06:00 IST requests signed before the expiry boundary that arrive after it. Permit new-day sessions after previous token expiry. Keep compatibility for existing encrypted vaults without the new metadata; reject corrupted metadata.
4. Added seven unit/integration regressions plus a real two-process localhost rehearsal that verifies a newer token rotates, an older signed token is rejected after restart, and the latest token survives encrypted. **421/421 offline tests passed**, localhost smoke passed, source compiled. No real broker, Telegram, external host or protected-folder access occurred.
5. Verified official hosting limits: Render Free sleeps and loses local state; OCI Always Free VM can be suitable **only if** the user's tenancy, available shape, quota and all cost components are separately verified and the host is approved. No service or billable resource was created. See [host activation decision](HOST_ACTIVATION_DECISION.md).
6. P2 engineering **90% → 95%**, ten-phase mean **79.2% → 79.7%, rounded to 80%**. This is still NOT cloud availability or a trading win rate. P9 remains 0%. See [signed handoff reliability](SIGNED_TOKEN_ROLLBACK_GUARD.md).

## Phase 31 — bounded phone delivery and market-data-first scheduling (79% retained)

1. Verified the 402-test v79 local baseline and existing published GitHub source. Identified that sending ten consecutive Telegram notifications with up to seven seconds of network delay each could monopolize the same worker loop that schedules five-minute market-data collection.
2. Bounded each `_deliver_outbox` pass to **at most two outbound attempts**, preserving SQLite FIFO, expiry, acceptance-time records and durable retry status. Failed sends stop the batch, and expired events cannot be sent.
3. Reordered the unattended loop so **a due five-minute REST candle gets first priority** over queued phone messages and the optional premium watcher; these never authorize real orders.
4. Added twelve offline regression test cases. **414/414 local tests passed**; compilation completed. No real Kite/Telegram API call, private data, cloud service or trading order was involved.
5. P4 engineering estimate **95 → 97%** and P5 preparatory estimate **72 → 77%**. New ten-phase mean is **79.2%, displayed as 79%**. Keeping the visible score flat is intentional: host deployment and full paper-market trial evidence remain missing. See [bounded outbox scheduling](BOUNDED_TELEGRAM_DISPATCH.md).

## Phase 30 — private localhost HTTP and process restart rehearsal (79%)

1. Reproduced GitHub Phase 29 head `110d5e0` and **396/396** baseline tests. Docker/Caddy were unavailable locally, so no container or public TLS claims were made.
2. Added `cloud_alerts.loopback_smoke`: it starts actual separate Uvicorn processes on `127.0.0.1` only, with synthetic/generated API/HMAC/Fernet credentials and monitoring disabled; it tests signed token ingress, rejection of HMAC tampering/replays, encrypted state at rest, process restart, and replay rejection **again after restart**.
3. Uses an explicit child-process environment allow-list and bypasses HTTP proxy settings; private state/SQLite permissions are checked. Real credentials, public networks, Kite requests, Telegram sends and broker orders are absent.
4. Six new tests, including inherited-secret isolation, HTTPS-only production sender restriction and failure-log redaction. Full suite **402/402 passed**; the manual real-loopback command also passed. See [loopback rehearsal](LOOPBACK_LIFECYCLE_REHEARSAL.md).
5. P5 **62% → 72% preparation only**; 10-phase mean 77.5 → 78.5, displayed as **79%**. **No approved VM, durable cloud volume, real HTTPS/token handoff, phone receipts or five real paper sessions exist yet**.

## Phase 28 — atomic recovery before each in-process worker restart (77%)

1. Reproduced published Phase 27 commit `8851770` and **359/359** existing local tests. Found that the supervised worker can restart within the same FastAPI lifespan without rerunning `State.reconcile_startup`, leaving persisted Telegram outbox and virtual-entry state unchecked after a crash.
2. The supervisor's failure callback now invalidates stale REST freshness, **atomically reconciles SQLite state before a replacement coroutine starts**, expires old pending alerts and clears unsafe associated virtual candidates. Correctly linked current-day accepted/pending candidates survive.
3. Corrupt or unlinked persisted state causes the supervisor to fail closed with generic FATAL shutdown instead of restarting a potentially unsafe worker. During termination FastAPI completes cleanup without repeating the sanitized fatal exception.
4. `/healthz` exposes only whitelisted reconciliation counts and no message text or Kite/Telegram secrets.
5. Four new synthetic integration regressions, including after-startup crash, protected current-day entry, pending retry and corrupt-state fatal handling. Full suite **363/363 passed**, compilation passed. No broker, Telegram or cloud network calls in tests.
6. Preparatory phase P5 **52% → 62%**, ten-phase estimate **75.5% → 76.5%, rounded to 77%**. Live cloud host activation, real TLS token relay, handset receipt and five full paper sessions remain **unverified**. See [in-process restart reconciliation](IN_PROCESS_RESTART_RECONCILIATION.md).

## Phase 27 — bounded crash supervision and safe green-state reset (76%)

1. Reproduced GitHub commit `57e207d` and **352/352** baseline tests. Fixed an unattended-worker failure mode: the market-monitoring coroutine could crash while Uvicorn stayed alive, and Docker does not restart containers merely because the health check says unhealthy.
2. Introduced a single-background-worker supervisor: bounded, increasing restart backoffs; no simultaneous duplicate workers; clean cancellation; repeated early failures transition to FATAL and trigger a generic SIGTERM-driven container restart via the existing `restart: unless-stopped` policy.
3. `/healthz`, `/readyz` and `/operationalz` refuse to report monitoring as healthy while the supervisor is in backoff. A failure clears the previous worker's REST freshness evidence and marks `WORKER_RECOVERING`, ensuring a fresh market evaluation is needed before operational readiness can become green again.
4. Added seven synthetic tests to demonstrate bounded restarts, cancellation, sanitized errors, HTTP response safety and real simulated worker recovery. **359/359 offline tests pass** with no broker or Telegram network requests. This is NOT a production VM/phone test.
5. P5 preparatory readiness **42% → 52%**, ten-phase mean **74.5% → 75.5%, displayed as 76%**. P5 real activation, TLS relay to real cloud and P9 full-market sessions remain **unverified or zero**. See [background-worker supervision design](BACKGROUND_WORKER_SUPERVISION.md).

## Phase 26 — premium BID watcher response clock and cutoff (75%)

1. Reproduced GitHub commit `c106fd3` and its **346/346** local tests. Found the optional premium watcher still accepted a timestamp captured **before** a slow option quote request, despite the Phase 25 five-minute entry path having been fixed.
2. Changed unattended `run_forever()` to call `poll_virtual_premium()` without a timestamp, preserving an explicit offline simulation clock for tests. Premium quote freshness, risk evaluation, SQLite quote observation and Telegram event timestamps now reflect the actual quote **response** time in live mode.
3. A request crossing 15:15 IST produces an explicit **TIME review without a claimed quote BID**, and a response reaching 15:26 IST is suppressed. A stale or future quote cannot create a STOP/TARGET review. Task-local live clock mode is always restored.
4. Added six synthetic regression tests; **352/352 local tests passed**. No broker requests, Telegram sends or cloud activation. **P7 85 → 90%, 10-phase mean 74.0 → 74.5%, displayed as 75%**. See [premium response clock design](PREMIUM_RESPONSE_CLOCK.md).

## Phase 25 — real send-time and quote-response clocks (74%)

1. Reproduced the 339/339-test GitHub baseline. Found that live `run_forever()` passed the initial scheduler timestamp to `run_once(now=...)`, and that subsequent Telegram dispatch reused that earlier time after blocking Kite HTTP reads. In a delayed response this could authorize an alert older than the 180-second TTL.
2. The real worker now invokes `run_once()` without a synthetic timestamp. A task-local context ensures live send attempts and Telegram API acceptance are timed **at the actual send/response**, while explicitly supplied `run_once(now=...)` test clocks remain deterministic. Context is safely restored after exceptions.
3. A separately sampled option quote **response time** is used for broker quote freshness, entry claim, hypothetical premium reference, and entry evidence timestamp. A market-data request cannot treat a fresh exchange quote as future dated or treat an already stale quote as fresh merely because the candle poll began earlier. A quote returned after 15:00 IST does not create a new paper BUY review.
4. Added seven offline regressions using a synthetic wall clock and simulated slow REST and Telegram transport, including response-time quote checks, wrong-side expiry, and post-cutoff suppression. **346/346 local tests passed** and source compiled. No real Kite or Telegram requests in these tests.
5. P3 **85 → 90%**, P7 **80 → 85%**, mean **73 → 74%**. Approved hosting P5 remains only preparation and real paper sessions P9 remain zero. See [live response-clock safety](LIVE_CLOCK_AND_QUOTE_FRESHNESS.md).

## Phase 22 continuation — private SQLite WAL recovery snapshots (19 Oct)

1. Introduced `cloud_alerts/snapshot.py` for a WAL-consistent SQLite `backup()` snapshot, protected source/WAL/SHM ownership and permissions, private separate output directories and atomic no-overwrite publication. A raw main-database file copy is **not** a safe active-WAL backup.
2. Added read-only verification (`PRAGMA integrity_check` and required schema), private temporary cleanup, sanitized row counts and a deliberately non-destructive CLI. The snapshot includes sensitive Telegram alert text, **is not encrypted by the tool**, and excludes the separate daily Kite token vault.
3. Simulated a live WAL commit, took a point-in-time snapshot and reopened it in a new `State` instance, preserving queued review and retry state. Also tested invalid/corrupt schemas, path/symlink/permissions, existing backup refusal and absence of message contents in command output.
4. **309/309 local synthetic tests passed.** No cloud service, phone receipt, broker call or protected trading folder access in these tests. **P5 preparation 25 → 35%**, ten-phase mean **70 → 71%**; actual hosting/handset proof remains **0%**.
5. See [private state recovery guide](STATE_SNAPSHOT_RECOVERY.md). This is strictly offline recovery tooling, not a live deployment.

## Phase 21 continuation — restart-safe Telegram API acceptance telemetry (19 Oct)

1. Migrated the existing SQLite `events` table in place, preserving all previously saved reviews, with sanitized first/last send-attempt UTC timestamps, retry counter, and first Bot API acceptance UTC timestamp. No credentials, chat IDs or extra message bodies were stored.
2. Record each attempted send **before** contacting Telegram. Queued/expired/accepted transitions are fail-closed, preserving accepted timestamps across restarts and rejecting resurrection of expired alerts.
3. Added `delivery_audit.py` and an offline read-only `delivery_audit_cli.py` to calculate per-session acceptance coverage, retries, median/p95/max API latency and accepted-after-180-second counts; legacy timing gaps are explicitly reported. Dates require deliberate session selection; holidays are not inferred.
4. Replayed outage/restart and migration cases with synthetic Telegram transports. **297/297 local tests passed** after this implementation. No network calls to Kite/Telegram; no live cloud service or phone receipt was tested.
5. See [TELEGRAM_DELIVERY_AUDIT.md](TELEGRAM_DELIVERY_AUDIT.md). Telegram API success **does not** equal handset delivery and no trade was placed.

## Completed in this continuation

1. Audited existing public GitHub architecture and inspected protected trading `.env` **only for key names**. No secrets copied, printed or published.
2. Confirmed current code baseline with 33 Python tests passing; cloud account only inspected in read-only mode.
3. Created the read-only KiteTicker shadow module with strict timestamp, instrument, volume and reconnect safeguards; fixed a first-partial-bar leakage uncovered by unit tests.
4. Created an idempotent 5-minute REST polling schedule with at most three scheduled attempts per boundary, and no burst after a delayed wake.
5. Added durable unsent-alert expiry after 180 seconds; queued BUY messages cannot arrive many minutes late after an outage.
6. **96 Python tests passed** after these changes, with no live Kite API calls or Telegram messages sent by the tests.

## Read-only live API evidence (19 October 2026)

- Authorized Nirala `.env` variable names verified with no secret values disclosed; original file was not changed.
- Paid Kite Connect returned HTTP 200 for **NFO instruments**, **NIFTY futures quote+depth**, and **5-minute / 15-minute history**.
- Verified active future `NIFTY26OCTFUT`, expiry 27 Oct 2026, listed lot size **65**, 78 recent 5-minute candles and 26 recent 15-minute candles. See [LIVE_API_SMOKE_2026-10-19.md](LIVE_API_SMOKE_2026-10-19.md).
- Added **four synthetic full pipeline tests** from fake broker market-data through paper option quote checks and Telegram message formatting; these do not contact Kite or Telegram.

## Completion of this continuation — P6 integrated offline

1. Introduced a `ShadowSupervisor` owning one optional read-only KiteTicker diagnostic connection (disabled by default), with asynchronous callback marshaling, token/instrument rollover, stale-callback fencing and end-of-session socket cleanup.
2. Introduced bounded `StreamEvidence` comparisons of shadow five-minute bars with completed REST candles; exposes sanitized matched/mismatched/unavailable counters from `/healthz` without changing REST decision authority.
3. Added mock-transport tests and synthetic broker integration tests: **96/96 passed**. No real Kite WebSocket message, real cloud Telegram alert or new hosting charge used for this phase.
4. Added a 45-day SQLite reconciliation ledger with strict sanitized values, duplicate suppression and summary endpoints; no tokens, raw ticks, account identifiers or broker orders are stored.
5. Checked connected Render workspace (existing free web services only) and official Always Free VM alternatives. No service was created, modified or redeployed. See [hosting evaluation](HOSTING_EVALUATION.md).

## P7 continuation — optional virtual premium tracking (offline)

1. Added [`premium.py`](../cloud_alerts/premium.py), observing the original NIFTY CE/PE contract's **fresh BID**, using the signal-time quoted ASK only as a hypothetical reference — never a claimed order fill.
2. Added an explicitly opt-in (`PAPER_PREMIUM_TRACKING_ENABLED=false` by default) 20-second read-only option quote checker, no orders/holdings calls, and fail-closed stale/depth checks.
3. Added durable STOP / TARGET / TIME virtual exit reviews through the existing Telegram outbox; at most one active virtual candidate, with no carryover across days.
4. Unit and synthetic integrated tests now pass **96/96**. Real bid/ask feed, real phone alerts, and timing on an approved cloud host are **unverified**.
5. See [Premium exit monitor technical design](PREMIUM_EXIT_MONITOR.md). Cloud deployment remains **not active**. Original read-only trading folder remains unchanged.

## P3/P4 continuation — atomic entry + recoverable option quotes (19 Oct)

1. Fixed a real loss-of-alert window: if the selected option quote is temporarily stale at a completed candle, do **not** mark that candle processed. The bounded scheduled follow-up can retry with a fresher quote; no additional unbounded API polling.
2. Added a transactional SQLite `claim_entry_with_candidate` that atomically persists the Telegram outbox message and corresponding paper-only candidate **before attempting external delivery**. Crashes cannot leave a newly queued BUY without its virtual exit reference.
3. Rejected malformed prior positions, duplicates and concurrent same-day virtual entries. A new day may clear/replace a previously expired paper candidate.
4. Telegram failures keep entry events queued; the engine reports `PHONE_DELIVERY_FAILED` rather than misrepresenting a queued event as successfully sent. The existing 180-second delivery expiry still applies.
5. Added payload-free public health counts (`phone_outbox`) for queued/accepted/expired messages; this does **not** prove mobile receipt.
6. Validated **96/96 offline tests** including restart-after-send-failure, stale-quote retry, bad stored state and outbox privacy. No real phone messages, broker orders or service provisioning occurred in this continuation.

## Next highest-priority actions

1. Live-validate the disabled-by-default shadow streamer on a properly authorized always-on host; collect five-session REST-vs-shadow quality evidence and securely persist diagnostic counters.
2. Choose and explicitly authorize a suitable always-on host and secret store, without additional charges until approved.
3. Securely hand off daily Kite access tokens from the protected `.env` (read-only) to the approved host and test expiry/restart paths.
4. Validate live paid Kite REST, option bid/ask and Telegram TEST end-to-end; then paper-test five full sessions, collect delivery delay/missed-signal statistics, and compare option backtests.

**Update rule:** after every future development pass, revise this file and report the progress percentage **and** the status of live cloud alerts separately. This file is a status ledger, not a market signal.

## October 19 follow-up — cloud lifecycle and ingress hardening (55%)

1. Added Linux/POSIX single-worker advisory lock in `STATE_DIR`: rejects a second running FastAPI worker sharing the volume; deliberate fail-closed startup on symlink attacks and releases cleanly. This does **not** replace the requirement for exactly one hosted replica.
2. Bounded daily token-handoff request bodies to 2048 bytes *before* allocating the payload, including misleading Content-Length headers. Existing HMAC signature, 90-second clock skew and durable nonce replay guard remain enforced.
3. Added `/readyz` showing only enabled/token-present configuration; **not** a broker/phone quality assertion. `/healthz` now fails 503 when its background engine dies. Docker liveness checks use `/healthz` rather than daily-token readiness.
4. Added startup and dual-process protection tests, for **106/106 offline tests passing**. No actual cloud deployment, broker order, phone message or subscription charge was initiated.
5. The previous P4 offline-completion estimate rises from 55% to 65%, moving overall from 54% to **55%**; P5 (always-on host), P8 (option backtesting) and P9 (five-session trials) remain 0%. See [reliable cloud startup](RELIABLE_CLOUD_STARTUP.md).

## October 19 follow-up — honest option-level paper evidence (56%)

1. Added a pure paper quote-pair validator and after-cost scoring module with explicit post-signal quote timestamps, listed option contract, expiry, top-of-book BID/ASK and sufficient available depth.
2. Gross and net reference estimates use ASK on entry and BID on exit, bounded pessimistic slippage on both legs and mandatory positive per-roundtrip charges. **No actual fill or market profitability is claimed.**
3. Invalid, over-delayed, weekend, expired, reversed, wide-spread or liquidity-insufficient quote observations fail closed.
4. The summary refuses any sample under 30 paired observations over at least 5 days; synthetic/unverified inputs get an explicit `UNVERIFIED_SOURCE` label even when counts are high. Captured-quote tags alone are **not independently verified**.
5. Offline test suite now **116/116 passed**. P8 research-evidence scaffolding moves from 0% to **10%**; overall 55% to **56%**. Actual option depth archive, independent provenance validation, chronological walk-forward split and multi-day trial remain pending. See [paper-evidence technical design](PAPER_EVIDENCE_EVALUATION.md).

## October 19 follow-up — operational health that cannot fake readiness (57%)

1. Added [`operational.py`](../cloud_alerts/operational.py) and `/operationalz` to separate worker liveness, daily token presence, and **fresh completed REST decision data**.
2. The operational gate fails closed for disabled worker, market closure, no daily token, pending Telegram outbox, erroneous state, absent/stale/future REST observations, or missing broker decisions.
3. The response explicitly says `phone_receipt_verified=false` and `real_orders_enabled=false`; a successful API call **cannot prove** delivery on the physical phone.
4. Preserved `/healthz` for Docker liveness and `/readyz` for token availability; neither is a substitute for full market-trial evidence.
5. Ran **129/129 offline tests** after preserving the signed `/internal/token` route and its auth/replay/size protection tests. See [operational readiness details](OPERATIONAL_READINESS.md). No live cloud host was created and no account credentials entered.
6. P4 offline completion moves **65% → 75%**; P5 and P9 remain **0%** until genuinely deployed and tested. Overall estimated scope **57% implemented, 43% remaining**.

## October 19 follow-up — chronological paper walk-forward (58%)

1. Added [`walkforward.py`](../cloud_alerts/walkforward.py) for non-overlapping training/embargo/test sessions and strictly chronological evaluations. No strategy parameters are automatically fitted to future observations.
2. Fails closed on duplicate event IDs, insufficient session history, invalid bid/ask or provenance, timestamps that reverse causality, and illegal partition sizes.
3. Reuses the existing conservative quote-pair cost scorer: **entry ASK, exit BID, depth, slippage and charges**, with simulated source explicitly marked **NOT verified trading performance**.
4. Added seven tests for embargo and walk-forward ordering, data shuffling, invalid costs/quotes, insufficient evidence, duplicates and synthetic-truth flags. **136/136 tests passed**.
5. P8 offline research plumbing moves **10% → 20%**; the actual quote-pair dataset, real walk-forward profitability and five-session phone trials are absent. Overall estimate **58% complete, 42% remaining**. See [walk-forward paper validation](WALK_FORWARD_PAPER_VALIDATION.md).


## October 19 continuation — secure daily-token transfer and truthful CLI exit (60%)

1. Fixed a **false-success exit bug**: one-shot `--push` now exits nonzero if cloud receipt cannot be verified, including network timeout and wrong endpoint, instead of quietly succeeding.
2. Sender extracts only Kite API key and daily access token from an existing bounded read-only `.env`; it never loads Kite API secret or unrelated env variables.
3. Strict URL preflight refuses non-HTTPS/URL-credential/redirect-prone handoff targets and invalid endpoint forms.
4. Added seven end-to-end synthetic tests through real signed sender payload, actual FastAPI handoff route, encrypted token vault, nonce replay and tamper rejection; confirms protected mock `.env` stays unmodified.
5. Offline suite **143/143 passed**. No actual credentials, external host, broker calls or Telegram messages were used. **Daily broker validity and cloud delivery still require live tests**.
6. P2 offline readiness moves **70% → 90%**, raising the ten-phase mean from 57.5% to **59.5%, rounded to 60%**. P5 and P9 remain 0%. See [daily handoff validation](DAILY_TOKEN_HANDOFF_VALIDATION.md).

## October 19 Phase 12 — fail-closed cloud deployment preflight (61%)

1. Implemented `cloud_alerts/preflight.py` to reject absent/invalid essential secret settings without logging any value; reject missing, non-owned or too-permissive dedicated cloud state directories.
2. Reject container overlay/tmpfs/root mounts in place of a private persistent volume and require at least 100 MiB free; test temporary local write/fsync/delete before startup. **A detected mount is not proof of long-term host-level persistence**.
3. Docker now executes the preflight before starting a **single** Uvicorn worker; added operator-reviewed `deploy/compose.yml` with localhost-only port binding, private named volume, read-only root, dropped Linux capabilities, restricted process count and bounded logs. No HTTPS ingress is provisioned by this code.
4. Added eight synthetic preflight tests; complete suite **151/151 passed** locally. Existing protected Windows trading folder remains read-only and was not used in these tests. No broker or Telegram calls.
5. P5 implementation plan rises **0% to 10%** because a deployment template and preflight exist, but **host activation and laptop-off testing remain 0%**. Overall phase mean becomes **60.5%, rounded to 61%**. Existing P0–P9 figures unchanged otherwise. **Live cloud alerts are NOT enabled**.


## October 19 Phase 13 — reject placeholder secrets and secure persistent files (62%)

1. Added `cloud_alerts/config_guard.py`: a shared, **secret-redacting** configuration validator, used by both the fail-closed cloud preflight and direct ASGI runtime setup. A direct Uvicorn startup cannot silently bypass placeholder checks.
2. Rejects `.env.example` placeholder keys, invalid boolean values and bad Fernet keys. When alerts are enabled, rejects malformed Kite API-key format, Telegram bot/chat formats and trivially repeated HMAC strings. This is only format validation, **not proof that credentials work**.
3. Existing sensitive state files (`token.enc`, SQLite database, WAL, SHM and single-worker lock) must be regular, worker-owned and private. Symlinks and world/group-readable sensitive files block startup; they are **not** silently rewritten or deleted.
4. Docker startup explicitly sets `umask 077` before the preflight and Uvicorn execution. Offline static checks enforce a single worker, localhost-bound ingress, a mounted private state volume and no credential COPY instructions.
5. Full **168/168 offline tests** pass. No cloud infrastructure, broker requests, Telegram messages or real trades were used. The original protected Windows trading directory was not accessed or changed in this phase.
6. Only **P5 preparatory infrastructure scope 10% → 20%**, bringing ten-phase mean to **61.5%, rounded to 62%**. The continuously running host, live token handoff and phone receipt remain **not verified**. See [fail-closed configuration and state guide](FAIL_CLOSED_CONFIG.md).


## October 19 Phase 14 — HTTPS ingress blueprint and explicit Telegram TEST (63%)

1. Added a Caddy HTTPS reverse-proxy example that forwards **only signed `POST /internal/token`** to the localhost-bound application and responds 404 to public health, readiness and all other routes. Its 2 KB request limit complements the existing receiver-side HMAC, nonce replay and 2048-byte checks. This is a **static example, not a deployed TLS endpoint or a certificate test**.
2. Added `python -m cloud_alerts.telegram_probe --check-only` for offline sanitized Telegram environment validation and an explicitly confirmed `--send-test --confirm-send` TEST-only command. The command cannot send a signal/order and does not call Kite.
3. Telegram's HTTP API acceptance is reported separately from **physical-phone receipt, which remains unverified**. All exceptions produce safe codes with no secret values in output.
4. New offline tests for endpoint route restrictions and Telegram fake transports bring the complete suite to **177/177 tests passed**. No live Telegram calls, cloud deployments, DNS/TLS operations, protected trading-folder modifications or orders occurred.
5. P4 engineering estimate **75 → 80%**; P5 preparation **20 → 25%**. Ten-phase average **62.5%, rounded to 63%**. P5 host provisioning and real cloud operation remain **0% observed**; P9 market sessions remain **0%**. See [Phase 14 HTTPS ingress and phone test](HTTPS_INGRESS_AND_PHONE_TEST.md).


## October 19 Phase 15 — no virtual exits for unseen entry notifications (64%)

1. Each new virtual CE/PE candidate now carries its original `entry_event_id`, enforced in the SQLite transaction even when a caller omits it; mismatched IDs fail closed; this points to the existing durable Telegram outbox row, **not** to a real Kite order or holding.
2. Both underlying-futures and optional actual-option-BID virtual exit monitors **wait** while the entry review is queued, and issue **no EXIT review** if the entry review never receives Telegram Bot API acceptance. This avoids confusing an unseen BUY review with a subsequent orphan EXIT.
3. If the entry review expires after 180 seconds, the associated virtual candidate is cleared before it can generate an EXIT. Corrupt/missing linked events fail closed without exposing message payloads.
4. Pre-existing legacy virtual candidates without an `entry_event_id` retain research-only compatibility; no host has been deployed to contain legacy real entries. New candidates always use the linked safety gate.
5. Added **9 tests** for queued/expired/accepted entries, optional premium watcher network avoidance, crash/restart persistence, automatic SQLite event linkage and foreign event-ID rejection; **186/186 offline tests pass**. No real broker/Telegram requests or cloud deployment.
6. P7 engineering estimate **65% → 75%**. Overall estimated engineering scope **63% → 64%**; live host activation and five-session proof remain **0%**. See [entry-notice gate](ENTRY_NOTICE_EXIT_SAFETY.md).


## October 19 Phase 16 — fail-closed option quotes and 15-minute context (65%)

1. Reject non-finite (`NaN`, positive/negative infinity) option BID/ASK before Telegram formatting, virtual premium monitoring, or performance calculations. Reject an optional Kite `instrument_token` that disagrees with the selected option; quotes missing this optional field remain compatible.
2. Interpret naive Kite exchange quote timestamps explicitly in **Asia/Kolkata**, even if the cloud worker's supplied clock uses UTC; reject a naive validation clock. Stale/future-dated checks remain enforced.
3. Validate **every** independent 15-minute confirmation candle's OHLC and timestamp ordering, and check recent same-session bars for gaps and invalid 15-minute session boundaries. The 15-minute EMA must not be based on missing/duplicate/corrupt intraday history.
4. Added 17 new offline regression tests including synthetic full broker→option quote→Telegram suppression of `NaN` option prices. **203/203 local tests passed**. No real Kite, Telegram or hosting actions were used.
5. P1 increases **80% → 90%**, P3 **80% → 85%**; the ten-phase mean is now **65% implemented, 35% remaining**. P5 hosting and P9 multi-day observed operations remain unchanged.
6. See [market-data integrity gate](MARKET_DATA_INTEGRITY.md) for explicit scope and remaining live validation.


## October 19 Phase 17 — causal historical replay and restart proof (66%)

1. Introduced [deterministic historical replay](HISTORICAL_REPLAY.md) using broker futures 5-minute history and independently completed 15-minute confirmation bars at each historical observation time. **No data from future candles may influence past decisions**.
2. Built a SHA-256 decision chain binding all five-minute warmup history, each replayed candle, the available 15-minute prefix and decision status. Changed input history fails a resume-checkpoint comparison; consistent restart returns identical subsequent decisions. Hashes are tamper-*evident* for accidental changes, not signed broker provenance.
3. Reject missing/duplicate/reversed candles, out-of-session bars, timestamp misalignment, nonfinite OHLCV and invalid replay JSON. The offline CLI accepts no secrets and performs no Kite, Telegram or trading API requests.
4. Added 21 offline replay/CLI tests, including a test-discovered warmup-chain omission that was repaired. Full suite **224/224 passed**, and Python bytecode compilation passed. Synthetic futures decisions **do not establish any option win rate**.
5. P8 research/evaluation scaffolding **20% → 30%**. Overall ten-phase estimate **65% → 66%**, leaving **34%**. Always-on hosting and five live market sessions remain unstarted. No protected desktop folder was accessed.


## October 19 Phase 18 — paired option quote observation evidence (67%)

1. Added an allowlisted, paper-only option BID/ASK snapshot schema carrying distinct exchange and worker-observed timestamps, listed contract identity, liquidity and local SHA-256 consistency hash. Neither schema validation nor a hash authenticates a provider observation.
2. Stores the `ENTRY` quote **atomically** with the SQLite virtual paper candidate and Telegram outbox record; records a later `EXIT` quote only when the optional premium BID watcher actually receives a fresh option quote. No time-cutoff or futures-only exit is presumed to have an executable option BID.
3. Added append-only, conflict-rejecting evidence persistence and verified non-mutating report access. The offline CLI accepts a private SQLite snapshot and caller-supplied **nonzero fees** and bounded slippage; evaluates ASK-in/BID-out using the existing hypothetical option scorer. Missing/mismatched/corrupt pairs are reported, never invented.
4. Fixed the evaluator's event-ID validation, which previously rejected the actual `+05:30` timezone suffix in paper entry event IDs. Added a regression test for that case and full synthetic entry→virtual exit→P&L evidence integration.
5. **251/251 local offline tests passed**, modules compile; no real broker quote data, Telegram phone receipt, live host, quote-origin audit, trades or profit edge was proven. Source hashes are not signatures and synthetic wins are not verified accuracy.
6. P8 offline research/evidence tooling moves **30% → 40%**; overall phase-weighted estimate **66% → 67%**, with 33% estimated scope remaining. Cloud host and five-session operational validation remain outstanding. See [option quote ledger documentation](OPTION_QUOTE_EVIDENCE_LEDGER.md).


## October 19 Phase 19 — complete-case / survivorship-bias guard (68%)

1. Corrected an evidence-selection risk: a report based on one profitable paired quote could previously display a 100% `net_win_rate_pct` while omitting nine entry notices with no recorded exit/option quote. This is **not** a demonstrated strategy win rate.
2. The quote report now explicitly separates a **descriptive `complete_case_win_rate_pct`** (conditional on scorable paired quotes) from `rankable_win_rate_pct` and the ordinary summary `net_win_rate_pct`, which remain **null** without independently authenticated, complete, sufficient samples.
3. Added an opt-in `--reconcile-entry-outbox` switch that counts every original SQLite `REVIEW_CE` / `REVIEW_PE` event, including events without any quote observations; strict reconciliation rejects orphan option records. Only aggregate counts and safe review states are printed, never alert text or identifiers.
4. Adds `scorable_event_coverage_pct`, `entry_events_missing_all_quotes`, `incomplete_quote_pairs`, `rejected_quote_pairs`, and explicit `ranking_blockers`. None are model accuracy claims; no signals are issued by this offline CLI.
5. Full offline suite **264/264 passed**; tests include one win out of ten claimed entries, no observations, conflicting quote contracts, unsafe unregistered quote observations and read-only SQLite audits. No live market sampling, hosting, Telegram receipt or order execution.
6. P8 synthetic tooling estimated **40% → 50%**, ten-phase average **67% → 68%**, **32% remaining**. P5 host activation and P9 market-session evidence remain **0% observed**. See [coverage audit](QUOTE_COVERAGE_AUDIT.md).

## October 19 Phase 20 — exact polling window and durable REST coverage (69%)

1. Reconciled two contradictory time gates: the scheduler formerly polled 09:20 though `Engine.run_once` refused until 09:25, and the engine used an inclusive cutoff at exactly 15:25:00, which prevented the scheduled 15:25:08/23/43 checks. The active strategy monitoring window is now 09:25–15:25:59 IST on configured weekdays (**73 five-minute polling boundaries**). This is not the entire NSE trading day.
2. A durable, privacy-limited SQLite `rest_poll_coverage` table tracks each scheduled boundary's attempts and best outcome (`REST_VALID`, `WAIT_DATA`, `WAIT_TOKEN`, `API_ERROR`) without recording quotes, account identifiers, payloads or credentials. Retry failure cannot overwrite a previously valid REST candle decision.
3. New offline `session_audit_cli` reads SQLite strictly read-only and accounts for unobserved boundaries instead of silently counting only successes. The operator must explicitly supply actual open NSE session days. The tool **does not independently verify holidays, market-data provenance, phone receipts, or actual paper returns**.
4. Added **19 offline regression tests** covering first/last boundaries, UTC/IST conversion, durable restarts, missing tokens, failed broker requests, retry outcomes, unobserved whole days, malformed stored timestamps, CLI privacy and read-only behavior. Full suite **283/283** passed; no broker or Telegram network calls were performed.
5. P4 monitoring diagnostics **80% → 85%**, P8 evidence-completeness tools **50% → 55%**, moving the 10-phase weighted mean from 68% to **69%**. Phase P9 remains at **zero real observed market sessions**; live hosting, real HTTPS token handoff and phone receipt proof remain unavailable. See [REST session coverage guide](REST_SESSION_COVERAGE.md).


## October 19 Phase 23 — fail-closed startup reconciliation (72%)

1. Fixed timezone-unsafe string comparisons in `expire_events_before`: pending Telegram alerts now expire by absolute instant using SQLite `julianday()` with an aware cutoff. Old UTC and IST records behave identically.
2. Added atomic `State.reconcile_startup`: before the worker starts, expire stale queued reviews, clear old-day/expired virtual paper candidates, preserve today's accepted/recent-pending positions, and fail closed on corrupt or unlinked same-day candidate state. There are no network requests, orders, or token reads in reconciliation.
3. Wired reconciliation under the existing single-worker lock in FastAPI lifespan. An invalid current-day candidate aborts startup before any notification worker launches rather than silently permitting a misleading virtual EXIT. This intentionally requires manual assessment of same-day legacy candidates without event links.
4. Added 13 synthetic regression tests: mixed UTC/IST, stale vs future entries, accepted/new queued entries, prior-day expiry, atomic failure, idempotence and actual app startup. The full offline suite passes **322/322**. No cloud host, broker authorization, Telegram physical-phone delivery or real trade has been tested.
5. P4 engineering readiness **87% → 90%**, P5 preparatory operational reliability **35% → 42%**, ten-phase mean **71% → 72%**. P5 live deployment and P9 observed market sessions remain at zero. See [startup reconciliation](STARTUP_RECONCILIATION.md).


## Phase 24 — atomically freshness-gated phone dispatch (73%)

1. The worker now checks each queued notification against an aware, real send-time timestamp **inside the same SQLite transaction that records an attempt**. This fixes stale messages that cross the 180-second TTL while preceding queued HTTP calls consume time. Malformed timestamps and significantly future-dated rows fail closed.
2. A late API acceptance can still happen after network transmission starts (the Telegram call is not reversible). Its actual delay is retained for audit but **does not authorize a virtual EXIT**. Historic accepted rows missing an acceptance timestamp also cannot authorize new virtual exit notices.
3. Startup reconciliation removes current-day paper candidates linked to late, expired or unverified entry notices. A current-day candidate tied to timely accepted or still-queued entry notifications is preserved.
4. Added 17 offline regressions (including timestamp offsets, 180-second boundary, deliberately slow batch, late or missing API timing, and virtual exit suppression). **339/339 Python tests pass**. No broker API, Telegram network delivery, cloud host or actual trading involved.
5. P4 **90% → 95%** and P7 **75% → 80%** implementation estimates; ten-phase mean **72% → 73%**. P5 remains prep-only and P9 remains zero live-market sessions. See [dispatch freshness design](DISPATCH_FRESHNESS.md).


## Phase 29 — official NSE F&O holiday guards (2026-10-20)

1. Pin the **2026 NSE equity Futures & Options holiday calendar** to official NSE circulars [FAOP/71777](https://nsearchives.nseindia.com/content/circulars/FAOP71777.pdf) and [FAOP/72262](https://nsearchives.nseindia.com/content/circulars/FAOP72262.pdf). The second notice adds 15 January 2026 to the original annual list. **20 October 2026 is an F&O holiday for Dussehra.**
2. The five-minute REST scheduler, engine, optional 20-second premium watcher, shadow WebSocket closeout, direct indicator decision gate, historical replay, `/operationalz`, and 73-boundary daily audit now refuse regular-session activity on known closed days.
3. A closed date is **not** counted as 73 missing REST polls or a failed five-minute monitoring session. Offline session-audit CLI refuses holidays; legitimate open date 21 October remains 73 scheduled boundaries. Expired prior-day paper positions can still be cleared on a holiday without broker requests.
4. Introduced `python -m cloud_alerts.calendar_cli --date 2026-10-20` to print an offline, credential-free, secret-free status with circular IDs. The status is from a **pinned local calendar, NOT live exchange availability**. If the year is unsupported (including 2027), all live regular-session polls **fail closed** pending an operator-reviewed official annual calendar update. Special Muhurat / ad hoc sessions are not assumed to follow normal hours.
5. **396/396 offline tests passed**, including January amendment, Dussehra, 21 October open-day checks, UTC/IST equivalence, restart cleanup, replay rejection and unknown-year blocking. No broker, Telegram, orders or cloud deployment involved.
6. P8 research/monitoring audit maturity estimate **63% → 73%**; phase-weighted total **77% → 78%**, **22% remaining**. P5 has **0 actual cloud host activation** and P9 has **0 real paper sessions**.

**Calendar operational limitation:** A static calendar may become stale if NSE announces an emergency closure, newly declared holiday or revised timings. Recheck NSE circulars before actual cloud activation and after updates. A correctly parsed calendar is not proof of market data availability or Telegram phone receipt.
