# Operational health and independent watchdog alerts

Implemented locally on 26 October 2026. No deployment, watchdog service,
notification bot, scheduled job or actual notification was activated. Tests
use simulated records/responses; native health tests forbid provider traffic.

## Read-only source health

`GET /internal/operations` requires HTTPS, no query parameters,
`OFFLINE_SCHEDULER_ENABLED=true`, `OFFLINE_OPERATIONAL_HEALTH_ENABLED=true` and
the separate `OPS_HEALTH_VIEW_KEY` bearer key. The committed health flag is
false. The viewing key must be 32–256 characters with at least eight distinct
characters and must not reuse the administrator, broker, token-vault/relay,
Telegram, archive or dashboard key. Administrator credentials do not substitute for the
health key; the health key cannot authorize owner write routes.

The endpoint takes one transactional read of the existing scheduler, market,
quote-pacing, ledger, delivery, lifecycle, recovery and token records plus alarm
metadata. It decrypts an eligible daily token locally to check handoff usability,
then discards the plaintext. It never contacts Kite or Telegram, claims an event,
updates a heartbeat, writes account state, resets quotas or schedules an alarm.
The response contains static issue codes/severities and sanitized metadata, not
credentials, ciphertext, token fingerprints, trades or alert bodies.

Conditions include:

| Area | Evidence and policy |
|---|---|
| Token | Missing, expired/not-today, unusable/future-dated handoff, or within 20 minutes of expiry during the expected preparation/session window |
| Provider authentication | Current-day sticky read-only 403/auth block, separately from locally decryptable handoff |
| Scheduler | Not initialized, halted, missing alarm, or more than 90 seconds without an observed callback during an expected session |
| Market data | Recent blocked/partial reports or observation age greater than 90 seconds after opening grace |
| Quotas | At least 90% of the local 1,125-request or 4,096-callback guard; exhausted callback or prematurely exhausted quote budgets are critical; these are not measured account-wide Cloudflare quotas |
| Journals | Audited 75%/90% pressure or full financial capacity, unverifiable paper exits and uncertain delivery attempts |
| Integrity | Corrupt/incompatible state, quarantine, disabled runtime, unverified future calendar or exceptional session |

Expected automatic activity uses the existing pinned IST calendar: token
preparation alerts start at 09:00 on regular days; ordinary session checks run
09:15–15:30. Weekend/holiday/overnight inactivity does not create token/heartbeat
or market-outage alerts. Opening grace prevents old bootstrap timestamps from
immediately becoming stale at 09:15. A due alarm has a short grace because
`getAlarm()` can be null while its handler starts. Special/unknown calendars are
reported explicitly, never promoted to normal sessions. Integrity, capacity and
unresolved-account conditions can remain actionable outside the session.

`HANDOFF_DECRYPTABLE` is not proof of current broker authentication. The report
expressly leaves provider authentication, phone receipt and cloud usage
unverified. A sample describes current retained evidence, not every outage that
may have occurred between probes.

## Independent monitor

A worker that does not run cannot notify about its own missing heartbeat.
`operations-monitor-cli.mjs` therefore runs on a separately supervised machine
or service and polls the source endpoint. The default command only prints help.
No installation, supervisor or cloud resource is created by this repository task.

Provision the source viewing key and protect the same key on the monitor host
as `OPS_HEALTH_VIEW_KEY`. Use a private local directory whose parent exists:

```powershell
node edge-cloudflare/operations-monitor-cli.mjs
node edge-cloudflare/operations-monitor-cli.mjs check https://private-worker.example.invalid private-state.ops-monitor.json
node edge-cloudflare/operations-monitor-cli.mjs watch https://private-worker.example.invalid private-state.ops-monitor.json
```

`check` performs one probe; `watch` repeats 60 seconds after each completed cycle
and stops on SIGINT/SIGTERM. Probes use GET only, a bare HTTPS origin, no redirects,
no ambient credentials and a ten-second timeout. Responses are bounded and
validated against known issue codes/severities and a 30-second clock-skew window.
Endpoint timeout, bad credentials/configuration, disabled route, malformed output
or unreachable service become `ENDPOINT_UNAVAILABLE`. While the endpoint is
unavailable, previous source incidents remain active/unknown; they are not falsely
resolved. A subsequent fresh report can resolve them. Exit code 2 means active
critical conditions (including an unavailable endpoint), 1 means a local/config/
state failure, and 0 means no active critical condition or help—not proof of live
acceptance or actual delivery.

The private versioned state file binds to a hash of the target origin and stores
condition transitions, sequence counters, notification claims and the last 128
events. It contains no provider credentials, viewing key, raw server response or
paper account data. Single-writer directory locking, exclusive temporary files,
file sync and atomic rename protect the last committed state. Corrupt, foreign,
unknown-version or oversized files are rejected without reset; clocks cannot move
backwards. Stable conditions do not create new events after restart.

State files and their locks/temp files are ignored by Git. Use private filesystem
access controls and local durable storage; POSIX 0600/0700 mode arguments do not
establish Windows ACL privacy. Keep the same state path across restarts and back
it up privately. Losing it also loses dedupe history. A killed process may leave
a lock: verify no writer is running, inspect any uncertain notification claim,
then remove only that stale empty lock directory manually. The program never
steals a lock or resets state automatically.

## Optional operational notifications

Console/state monitoring works without Telegram. Notification sending additionally
requires the explicit `--notify` argument, `OPS_ALERT_NOTIFICATIONS_ENABLED=true`,
and separately provisioned `OPS_TELEGRAM_BOT_TOKEN` plus
`OPS_TELEGRAM_PRIVATE_CHAT_ID`. Use a dedicated operational bot, not the trading
sender's token; no bot was created or configured by this implementation. Keep
all keys in a private secret store/environment, never command arguments or Git.

```powershell
node edge-cloudflare/operations-monitor-cli.mjs watch https://private-worker.example.invalid private-state.ops-monitor.json --notify
```

The client sends at most one grouped notification per check for new/recovered
conditions, using the existing fixed-host, pinned-private-chat, bounded Telegram
transport. Messages contain static codes/phases and a timestamp, not provider
errors, tokens, account positions or the source URL. Per-condition five-minute
cooldowns suppress rapid flapping; stable conditions remain quiet. A recovery
message means the condition is no longer reported by a fresh probe, not that all
operations or phone delivery have been verified.

All selected notification claims are durably written **before** any request.
Timeout, unreadable response, crash-unconfirmed claim or transport uncertainty is
never automatically retried. Definitive rejections/429 also remain recorded with
no automatic retry. A successful pinned Bot API acknowledgement records
`API_ACCEPTED`, never phone receipt. If the process dies between claim and send,
the operator must inspect the uncertain state; the monitor prefers a visible
possible missed notification to an automatic duplicate. Cooldown-suppressed
transitions are not resent later merely because the condition persists.

This watchdog uses its own external journal and notification credentials. It does
not claim, block, suppress or reuse the paper-trade outbox or delivery cursor.
Notification outcomes do not alter source account state or restart the scheduler.

## Evidence, traffic and remaining acceptance

Pure tests cover session-aware thresholds, token/auth distinctions, integrity,
source budgets, stale heartbeat/data, sanitization and credential isolation.
Watchdog tests cover grouped durable claims, no resend after crash/uncertainty,
endpoint outages without false recovery, cooldowns, 128-event retention, atomic
file persistence, lock conflicts, corrupt/foreign state, explicit notification
configuration and watch-loop cancellation. A failed durable claim prevents any
notification call. Native SQLite tests prove read-only source behavior across
restart and local token decryption without credential/ciphertext disclosure or
provider contact, including malformed and future-dated handoff records.

The preflight accepts optional `healthProbeRequests` and a conservative read
allowance; 24-hour one-minute monitoring is 1,440 planned probes, with actual
cycle timing affected by requests/notifications. The default is zero because
the feature is disabled. Source budgets, disk bytes and forecasts are not
Cloudflare billing/quota telemetry. Add monitoring traffic and measure actual
CPU, duration and rows before any cost acceptance. Monitor-host availability,
its own supervisor/heartbeat, connectivity, bot access and any hosting cost are
separate operational requirements. The monitor cannot alert if the monitor host
itself is entirely down. No precise wakeup/detection/notification SLA is claimed.

Task 11 is implemented in the repository, with live alert/phone acceptance still
unverified. Safe resume, unverifiable-position reconciliation, future calendar
maintenance and actual cloud identity/cost acceptance remain separate work.
