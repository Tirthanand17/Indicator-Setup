# Full-project audit — implementation round 55

**IN DEVELOPMENT / PAPER ONLY. Not deployed. Live acceptance 0/5.** This is a repository-wide inventory and targeted source audit with implemented safety fixes, not a proof that every code path is correct. Findings and verification are maintained in [ISSUE_REGISTER.md](ISSUE_REGISTER.md) and [FIX_VERIFICATION_MATRIX.md](FIX_VERIFICATION_MATRIX.md), not duplicated here.

## Scope and baseline

Reviewed main `05df18881160b52ecbbd1c118d439b0f9db5ea2e` and recent merged PRs7–11. PR11 was an offline pure alarm gate. Baseline inventory:227 tracked files,122 Python files; `repository-inventory.json` records hashes of the tracked baseline paths as inspected, including local modifications, not a pristine baseline hash manifest. No configured GitHub Actions workflow was found and the queried baseline workflow-run list was empty. No CI workflow enabled or billed. Local gh authentication was unavailable; connected GitHub access is used for persistence.

`cloud-alerts/cloud_alerts` owns the Python application; `tests` its synthetic regressions; `deploy` Linux/container templates; `edge-cloudflare` the migration; `extension` the separate legacy chart reader. The extension is not a dependency of the new API application. Existing Python/FastAPI/SQLite/Kite dependencies cannot be deployed unchanged into this JS Worker.

## Audit coverage A–L

**A, repository:** parsed the Python inventory, inspected critical runtime, configuration and tests, and checked relative imports. No local-module cycles found in that limited graph. This does not establish that every critical branch is reachable or tested. Contradictory current status is replaced by a canonical checklist; historical phase records retained as history.

**B–C, Cloudflare:** implemented an undeployed Worker and SQLite-backed Durable Object class. Initialization requires a strong administrator bearer secret and explicit enable flag. Only bootstrap/status routes exist; constructor does not arm alarms. A transaction claims a tick and persists the next alarm together. State corruption, clock rollback, unsupported calendar and local callback quota stop polling. Late callbacks are dropped rather than historical trades replayed. A128-event diagnostic ring bounds scheduler history; it is not the paper ledger. Native local workerd verifies real SQLite restart and rollback, but no hosted timing guarantee follows.

**D–E, market data and authentication:** strengthened final Requests transport to official GET-only endpoints, TLS/no-proxy/no-redirect policy and shared pacing. Contract data remains dynamic from official instrument responses; synthetic quotes must never be relabeled live. Completed 5m/15m candles now require aligned contiguous current-session history and volume. Quote freshness must use broker timestamps and actual receipt time, not a fabricated application timestamp. Existing Python daily relay has signed timestamps/nonces and atomic encrypted-vault replacement. Owner still performs legitimate daily Kite login/MFA and hands off token before powering off. Ordinary access tokens expire6AM next day; automatic password/MFA bypass is not a solution. An interrupted handoff preserves an older valid vault, which still expires normally. Python can warn about missing tokens, but its first warning is around09:25, not a verified pre-open cloud check. Cloud token relay/warnings do not yet exist.

**F, strategy:** reviewed VWAP, EMA9/21, Wilder DMI/ADX14 and ATR14, data gates, independent15m confirmation and historical evaluation. The JS numerical port matches three synthetic indicator sequences and36 fee examples; complete entry/exit decision parity remains open. Newly reproduced holiday scoring and incomplete-session defects are fixed. No real out-of-sample quote archive or validated profitability claim exists. Test success, market-data validity, strategy accuracy and trade win rate are different measures. Never force three trades per day.

**G, portfolios:** Python supports separate50,000/100,000 accounts, conservative ASK entries/BID exits, charges/slippage and transactional ledger guards. Missing/invalid quotes, duplicate events and insufficient cash have regression coverage. Portfolio basket operations are separate transactions; recovery records missed opportunities instead of inventing historical fills. Explicit strike storage, MTM/unrealized equity and complete capital-usage display remain incomplete. Do not present realized-only drawdown as full marked equity drawdown.

**H, Telegram:** Python durable outbox is committed with paper events; delivery failure cannot roll back cash into a false fill. Batches/timeouts/expiry are bounded. Acceptance followed by a crash before commit can duplicate delivery; phone receipt is separate from API acceptance. Dedicated429 retry_after treatment, ambiguous acceptance state and long-term retention remain open. No message sent during this audit.

**I, dashboard:** existing private Python views and daily report are synthetic-tested. Full mobile visual QA, health coverage, cloud dashboard and live refresh latency remain unverified. Unknown equity stays unknown rather than claiming real profits. Authentication tests do not establish deployed TLS or authorization configuration.

**J–K, recovery/security:** reviewed transaction boundaries, HMAC/nonce ordering, private vault/file assumptions, snapshots and input guards. Added artifact ignore rules; these do not prove history has never contained a secret. SDK still exists internally, but its normal session cannot transmit transaction endpoints. Python is not a hostile-code sandbox. Dependency audit has unresolved findings; no claim of security clearance. Cloud export/restore, schema migration and total-account quota monitoring remain missing.

**L, verification:** baseline744/1 reproduced, final771/1, Node63 and local workerd1 pass. Static compilation/AST and PowerShell parsing passed. Full static type checking is outstanding. No new paid CI enabled. See verification matrix for exact limitations and commands.

## Free-tier forecast, not measured service capacity

Current [Workers limits](https://developers.cloudflare.com/workers/platform/limits/): Free100,000 requests/day,10ms HTTP CPU,128MB memory,50 subrequests and6 simultaneous outgoing connections. DO CPU is separately governed; see [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/). Default DO CPU30s is not permission to exceed the outer Worker10ms allowance.

[SQLite DO Free pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/):100,000 daily requests including alarms,13,000GB-s/day,5million rows read/day,100,000 rows written/day,5GB total storage;1GB per object on Free. KV operations also incur underlying SQLite row accounting; setAlarm writes a row. Exhaustion fails requests until reset, not guaranteed availability.

375minutes/20seconds =1,125 nominal ticks/session. Four dashboard reads every15seconds during the session add6,000 requests. Six retries per tick could raise alarm callbacks to7,875; the local4,096 UTC-day callback cap deliberately halts sooner. Budget a conservative three writes/callback, plus all ledger, outbox, dashboard and retry work. The current ring is small; paper history is not yet sized. At128MB charged residency,6.25h≈2,880GB-s and24h≈11,059GB-s; this conservative forecast is not a billing measurement and other objects share quotas. Instrument CSV parsing/full engine CPU and memory still need benchmarks.

[Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/) are at least once with retry backoff, not a20-second SLA. [Storage transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) support atomic state/alarm changes. Use [secrets](https://developers.cloudflare.com/workers/configuration/secrets/) only after approval. Free-plan screenshot confirms the displayed plan, not all account subscriptions. No qualified no-card always-on Linux replacement has been proven. If full runtime exceeds Free CPU/quotas, stop and reduce workload or revisit requirements; do not silently upgrade.

## Authentication and financial reference checks

[Kite authentication](https://kite.trade/docs/connect/v3/user/) requires legitimate daily involvement; supported refresh privileges are not universal. [Kite limits/errors](https://kite.trade/docs/connect/v3/exceptions/) document quote1/s and historical3/s limits, expiry and429 responses. New local pacing stays below these nominal rates, but other processes/account traffic still matter.

Fee version `ZERODHA_NSE_OPTIONS_2026_04_V1` is checked against [Zerodha charges](https://zerodha.com/charges) and [NSE STT](https://www.nseindia.com/static/products-services/equity-derivatives-securities-transaction-tax): options brokerage20/order, exchange0.03553% premium turnover, SEBI10/crore, GST18% on applicable fees, buy stamp0.003%, sell STT0.15% effective April2026. These are modeled fills/rounding, not broker contract-note reconciliation.

## Hosting failure record

| Provider | Evidence category | Blocker |
|---|---|---|
| AWS | Owner-observed signup | ₹2 verification and₹15,000 UPI mandate conflict with restrictions |
| Northflank | Prior owner-recorded attempt | Payment verification after sandbox window |
| Azure Students | Prior owner-recorded attempt | Academic activation blocked |
| Google / Oracle | Policy compatibility assumption, not new attempt | Payment/card verification conflicts; no signup attempted here |
| Render Free | Architecture limitation | Sleep and ephemeral storage incompatible with current unattended monolith |
| JioAICloud | Product mismatch | Consumer storage is not always-on compute |
| Jio Business | Published pay-as-you-go offering | [Business compute](https://www.jio.com/business/services/jio-cloud/datacenter-transformation/compute/) provides no verified₹0 entitlement for this workload; no quote/account created |
| Cloudflare | Owner screenshot + provider docs | Free plan displayed; runtime, quota, account billing and live acceptance unproven |

## Next implementation sequence

Resolve A11 in an isolated environment: separate optional websocket SDK dependencies or replace REST SDK use with a tightly scoped official HTTP client and compatibility tests. Then complete decision parity, transactional cloud paper ledger/outbox/token relay and private dashboard. Run full synthetic market-session scenarios including credential absence, timeouts, CE/PE, conservative fills, restart, close and quota failure. Only after those prerequisites should the owner be asked to approve a concrete deployment. No approval is requested by this report.
