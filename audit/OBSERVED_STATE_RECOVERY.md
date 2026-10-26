# Observed-state encrypted export and quarantined recovery

This implements remediation task 8 in the repository. Local workerd/SQLite
drills establish the recovery behavior below. No hosted backup, off-host
destination, real archive export, deployment or production restore was run.

## Snapshot scope

The versioned observed archive is distinct from the older synthetic research
archive. One read transaction captures these current records:

| Record | Included |
|---|---|
| Observed ledger | Both account balances, full retained positions, rejections and outbox |
| Observed bridge | Review/option tick watermarks, pending signal and retained events |
| Delivery journal | Terminal-prefix cursor, counters, receipt ring and active/uncertain/retry state |
| Portfolio metrics | Contract marks, sampled peaks/drawdown and bounded recent equity history |
| Scheduler | Calendar version, claim watermark, callback counters and retained events |
| Market observation | Current sanitized diagnostic report |
| Option runtime | Selected contracts, request claims and normalized option evidence |
| Quote pacing | Request budget, completion cooldown and sticky authentication block |
| Instrument catalogue | Daily contracts, selection inputs and fetch-attempt state |
| Recovery marker | Prior restore identity and documentary source scheduler, if present |
| Lifecycle manifest (payload schema 2) | Supported writer/reader versions, retention policy and baseline archive identity |

This is all retained observed application state, not an unlimited historical
event log. Existing last-128 rings remain last-128 rings. Raw broker responses,
transient candle arrays and data already discarded by the source are not
reconstructed. Daily broker tokens/nonces, API/bot/admin/viewing credentials,
runtime environment, running alarms and synthetic-account records are excluded.
Unknown application KV records or SQL tables stop export rather than silently
creating a partial backup of a future schema.

Every included document is audited; metrics and delivery state must match the
ledger/bridge. Missing legacy metrics or delivery records are explicitly null,
not fabricated. A missing historical delivery watermark is reported as
`MISSING_WATERMARK_QUARANTINE_REQUIRED`. Such an archive preserves available
evidence and cannot establish which prior messages were delivered. Invalid
existing records are rejected, not repaired by export.

## Authentication and operator client

`GET /internal/observed-archive` returns only an encrypted attachment with
`Cache-Control: no-store`. It requires HTTPS, the existing administrator bearer
key, `OFFLINE_SCHEDULER_ENABLED=true` and the separate
`OFFLINE_OBSERVED_ARCHIVE_ENABLED=true` gate. Viewing cookies/keys do not grant
archive access. Query parameters and unsupported methods are refused.

`POST /internal/observed-archive/restore` additionally requires
`OFFLINE_OBSERVED_RESTORE_ENABLED=true`, an `application/json` body, and the same
administrator authorization. Both new flags remain false in the checked-in
template and are forced false by the offline quality runner. No deployment or
flag activation is part of this implementation.

The server and operator client need independently provisioned
`OBSERVED_ARCHIVE_HMAC_KEY` (32–256 characters, at least eight distinct
characters) and `OBSERVED_ARCHIVE_AES_KEY` (canonical base64 of 32 random bytes).
Use distinct keys for signing, encryption and existing application credentials.
Keep keys in a private secret store/environment, outside this public repository
and chat; they are never command-line arguments or printed by this client.
Key custody and a safe destination remain the operator's responsibility.

After separately configuring an intended private deployment, the commands are:

```powershell
node edge-cloudflare/observed-archive-cli.mjs
node edge-cloudflare/observed-archive-cli.mjs export https://private-worker.example.invalid observed-paper.enc
node edge-cloudflare/observed-archive-cli.mjs verify observed-paper.enc
node edge-cloudflare/observed-archive-cli.mjs restore https://empty-recovery-worker.example.invalid observed-paper.enc --empty-quarantined
```

The first command only prints help. `verify` is offline. Network commands
additionally read `SCHEDULER_ADMIN_KEY` from the environment. The client accepts
only a bare HTTPS origin, never follows redirects, applies a 30-second request
timeout and bounds JSON reading. Export verifies the archive before writing an
encrypted file with exclusive creation (`wx`, mode 0600 where supported). It
never overwrites an existing file or writes decrypted account records. Keep
the directory private using OS access controls; Windows permissions are not
established by POSIX mode bits. Verify before relying on a saved artifact and
copy the encrypted file to an approved private off-host destination. A failed
write can leave an incomplete file; verification will reject it.

Envelopes retain format/domain version 1; legacy-ledger payloads use schema 2,
and owner-write-off ledger schema 2 uses payload schema 3. The
reader still authenticates original schema 1 archives before adding a null
legacy lifecycle field. [Migration and rollback policy](OBSERVED_JOURNAL_LIFECYCLE.md).
[Owner write-off accounting and version requirements](UNVERIFIABLE_POSITION_RECONCILIATION.md).
The whole signed
payload is encrypted with AES-256-GCM using a fresh random 96-bit nonce and
domain-bound additional authenticated data. Decryption/authentication and an
independent HMAC-SHA256 verification precede document validation. The archive ID
is SHA-256 of the verified plaintext payload, not a credential or decryption
key. Clear payloads are capped at 4,000,000 bytes and encrypted JSON bodies at
5,350,000 bytes. Oversized state is rejected without truncation.

## Restore safety and acceptance drill

Verification occurs before target writes. Inside one storage transaction,
restore refuses **any** existing application KV record (including an unrelated
or credential-only record), a scheduled alarm or user SQL tables. It preserves
the accounting/bridge/delivery/metric documents exactly, stores the original
scheduler as documentary recovery evidence, and creates a halted scheduler
with `scheduledAtMs=null` plus a durable quarantine marker. No actual alarm,
credential, environment flag, market request or message send is restored.

The marker fences claims and paper commits and blocks bootstrap/token uploads;
alarms remain inert through restart. Existing active delivery attempts stay
uncertain, and accepted prefixes retain their cursor. A snapshot may precede
later external sends, so even its apparently queued events must not be
automatically replayed. There is deliberately no resume/unquarantine endpoint.
Use the recovered copy for private inspection and reconciliation. Resuming an
operational account requires the later lifecycle/reconciliation work, current
contract/calendar checks and a new owner-controlled token handoff.

The native drill seeds distinct open/closed accounts, accepted plus uncertain
delivery state, marks, selected option evidence, quote quota and catalogue;
exports through the authenticated production route; verifies exact recovery;
forces a transaction abort; then restores to an empty SQLite target. It checks
that export does not mutate source state, vault data is excluded, accounting
and uncertainty persist, re-export works, restart preserves quarantine, and
bootstrap/alarm/dispatch cannot resume. Separate cases reject credential-only,
unknown-key, alarm-only and SQL-table targets without changing them.

Remaining work includes retention/schema migration/rollback policy, authenticated
operator reconciliation, key rotation/custody, a real private backup destination
and a hosted recovery drill. This task does not satisfy the combined audit
acceptance checks for recovery **and** retention/reconciliation by itself.
The preflight now budgets 60 reads/20 writes per alarm for planning, including
metric/quarantine checks. These remain assumptions, not billed measurements;
manual archive operations and their cryptographic CPU require additional
measurement before cloud cost acceptance.

The transaction and alarm handling follow the documented
[SQLite-backed Durable Object storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
and [alarm API](https://developers.cloudflare.com/durable-objects/api/alarms/).
