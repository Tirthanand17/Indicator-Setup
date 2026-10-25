# Observed journal retention, schema migration and rollback

Implemented 26 October 2026. This is a local, tested lifecycle policy; no cloud
deployment, production migration, pruning or real-data rollback was performed.

## Retention policy

`PRESERVE_FINANCIAL_HALT_AT_CAP_V1` keeps every retained position, rejection,
outbox row, signal identity and delivery cursor. The current ledger reconstructs
cash from initial capital plus all positions, and delivery indexes reference
the original outbox. Deleting an old prefix without a new accounting/dedupe
model could change balances or replay alerts, so there is no automatic pruning
or rollover. Financial caps remain 512 positions, 1,024 rejections and 1,024
outbox rows. New entries stop at capacity. Closing an existing position does not
require rejection-journal space, and entry admission reserves one terminal event
per active position. Existing full books are never silently reset.

The reviewed diagnostics remain bounded independently: last 128 bridge events,
scheduler events and delivery receipts, and last 128 equity samples per account.
Delivery prefix counters/cursor and sampled peak/drawdown accumulators survive
their respective ring truncation. Their rings are not complete historical logs.

The authenticated `GET /internal/observed-lifecycle` reports actual journal
counts, remaining slots, warning at 75%, critical at 90%, full capacity, terminal
event headroom, diagnostic limits, manifest state and serialized snapshot bytes.
It uses one audited snapshot and exposes no message bodies or credentials.
It shares the disabled-by-default observed-archive gate and administrator/TLS
requirements. The report does not send a notification or measure billed rows.

This policy intentionally stops growth rather than deleting financial evidence.
Continued operation beyond the hard caps requires a separately reviewed new
epoch/chunked accounting model and archived-history reconciliation. No infinite
runtime or unattended journal rollover is claimed.

## Schema and migration contract

The optional `readonly-lifecycle-v1` manifest records writer/minimum-reader
protocol version 1, the retention policy, migration time and SHA-256 identity
of a verified baseline archive. Absent manifests are explicitly supported legacy
stores; unknown/corrupt manifests are never interpreted as a fresh store.
Critical paper/claim, delivery-settlement, bootstrap and token transactions
check compatibility. The alarm stops without polling and cancels its alarm on
an incompatible manifest while retaining accounting and version evidence.

`POST /internal/observed-lifecycle` is an explicit metadata-only migration. It
requires administrator authorization, HTTPS, both observed export/restore gates,
and an authenticated encrypted baseline archive. Inside the transaction it
requires a halted scheduler, no scheduled alarm and an exact current snapshot
match. The only new write is the lifecycle manifest. Account balances, contract
identities, positions, signal/outbox IDs, pending signals, marks, delivery
uncertainty/cursors and quota history are unchanged. A stale archive or active
source is rejected. Retrying the same baseline is idempotent; a conflicting
baseline or incompatible version is rejected. Failed transactions leave no
manifest. The endpoint never resumes a halted or quarantined scheduler.

Operator sequence after separately authorized deployment/configuration:

1. Halt the intended source using its existing administrator emergency-halt
   procedure and wait for any started external attempt to settle or remain
   explicitly uncertain. Preserve that uncertainty.
2. Export and verify a new encrypted baseline, and keep it in an approved
   private location with independent signing/encryption key custody.
3. Run the metadata migration against that same halted source:

```powershell
node edge-cloudflare/observed-archive-cli.mjs export https://private-worker.example.invalid baseline.enc
node edge-cloudflare/observed-archive-cli.mjs verify baseline.enc
node edge-cloudflare/observed-archive-cli.mjs migrate https://private-worker.example.invalid baseline.enc --halted-source
```

The client uses environment secrets as described in
[the recovery procedure](OBSERVED_STATE_RECOVERY.md); secrets are never CLI
arguments or logged. A matching uploaded archive proves possession of a valid
rollback artifact, not that off-host custody or key recovery has been verified.
The server retains only its archive ID, not another on-host copy of the bundle.

## Archive compatibility and rollback

New encrypted exports keep envelope/domain version 1 and use payload schema 2
with an eleventh `lifecycle` state field. The current reader also authenticates
payload schema 1 from the previous implementation. Only after authenticating
the original bytes does it add a null legacy manifest in memory. The archive ID
remains the hash of those original authenticated bytes. Unknown payload versions
or incomplete schema-specific record sets are refused; no delivery watermark or
metric history is invented during migration.

A public, entirely synthetic golden fixture was produced by commit `f1d40e4`
before changing the reader, so compatibility is tested against the previous
exporter rather than a reconstruction by the new implementation. Its fixture
keys protect no real account data and must never be reused in deployment.

Rollback restores a verified baseline into a **different empty target** using
the current compatible reader. The source is left intact, target accounting and
uncertainty match the baseline, and durable quarantine prevents automatic
processing or resend. In-place data downgrade/overwrite and automatic resume
are unsupported. A baseline may predate external sends, so restoring its queue
cannot establish safe replay. Operator reconciliation remains required.

Only binaries that implement this compatibility protocol may be considered for
code rollback. Older unmodified binaries cannot be forced to honor a manifest
they do not recognize. A real cloud version rollback, deployment identity,
private destination/key-recovery drill and safe operational resume remain
separate acceptance work.

## Validation

Tests cover the previous-exporter golden archive, current archive round trips,
active/stale/conflicting migration refusal, metadata-only changes, failed
transactions, unknown-version blocking, preservation of rejected/accepted and
uncertain history, and isolated quarantined rollback. The existing full-ledger
stress test now checks room for both final protective exits before reaching
512 preserved positions and 1,024 outbox events. A full rejection journal blocks
new entries while verified exits remain writable. The bridge explicitly retains
verified exits when re-entry on the same tick hits a capacity limit; this case
also has a native SQLite regression preserving its delivery watermark.
Native SQLite tests exercise
the authenticated migration route, retry, restart and future-writer rejection.

The broader recovery acceptance remains conservative until operator
reconciliation and operational recovery are complete. This implementation does
not establish a live backup, lossless unlimited history or a cloud cost result.
