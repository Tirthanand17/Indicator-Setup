# Owner reconciliation of unverifiable paper positions

Implemented 26 October 2026. No actual account decision, write-off, archive
export, provider request, notification, deployment or scheduler resume was run.
Native tests use synthetic accounts and forbid all outbound provider traffic.

## Decision and accounting

The supported decision is an explicit **zero-credit paper write-off of an
unknown exit**. Missing historical BID/fill evidence cannot be reconstructed
from a later price, OHLC candle or owner-supplied number. This endpoint does not
accept any price, credit, fee or profit fields and cannot certify a market exit.

An eligible `EXIT_UNVERIFIABLE` position becomes `EXIT_WRITTEN_OFF`. An `OPEN`
position whose original entry-day 15:26 IST cutoff has passed may also be selected,
covering missed EOD finalization or carried-day open records. Early intraday
positions and verified `CLOSED` trades cannot be written off. For a carried OPEN,
the missing `PAPER_UNVERIFIABLE` event is appended before the decision; existing
outbox IDs/order and delivery cursor/receipts are retained.

Cash remains **exactly unchanged**: the original entry debit, including its fees,
was already spent and is not refunded or charged again. No exit credit, sale
premium, exit fee, exit time or strategy net P&L is manufactured. Original entry
and contract identity remain intact. Per-position owner-resolution metadata stores
the policy acknowledgement, decision time and verified baseline archive ID.
This is a conservative paper-accounting choice, not proof of an actual trading
loss, broker settlement or phone delivery.

Strategy closed-trade wins/losses, average outcomes, expectancy and profit factor
continue to use verified modeled `CLOSED` exits only. Separate lifetime/daily/
monthly owner-write-off counts and negative accounting adjustments reconcile
capital. Flat account equity becomes its retained cash; total accounting P&L
includes the write-off debit while strategy realized P&L excludes it. Equity
history/drawdown is explicitly labelled as including owner accounting adjustments,
and future strategy profits do not create a fictitious peak from ignoring those
adjustments. Historical price/mark gaps remain incomplete.

Daily risk admission conservatively counts full write-off debits on the owner
decision day against the existing 6% daily loss budget. Signal dedupe and record
caps remain intact, balances never reset, and the resolution does not grant
fresh entry permission or undo the terminal scheduler halt. Pure-ledger tests
also verify normal next-day admission from the reduced capital when otherwise
eligible; this is not a runtime resume command.

## Authentication, baseline and transaction

`GET /internal/readonly-paper/reconcile` requires the existing administrator bearer
key, HTTPS, no query parameters, `OFFLINE_SCHEDULER_ENABLED=true` and the new
`OFFLINE_POSITION_RECONCILIATION_ENABLED=true` gate. The committed gate and quality
runner default are false. Viewing/health credentials do not authorize it.
It returns sanitized identities, quantities, entry debits, eligibility and an
exact request proof, without tokens or alert bodies.

`POST` to that same route takes exactly `request` and `sealedArchive`. The request
contains selected `tradeIds` (one or both accounts), the inspected
`ledgerMutationAtMs`, and this exact acknowledgement:

`OWNER_ACCEPTS_UNKNOWN_EXIT_ZERO_CREDIT_NO_STRATEGY_FILL`

The signed/encrypted baseline is authenticated before accounting is trusted.
Inside one storage transaction the source must have a valid halted scheduler,
no actual alarm, no recovery quarantine and at least 30 seconds since ledger
mutation. The current complete observed snapshot must match the baseline. Active,
stale, corrupt, early or mismatched inputs fail closed. Caller-provided price or
credit fields are refused. Bodies use the existing bounded archive JSON reader.

The transaction updates the ledger, protocol manifest and rebound portfolio
metrics together. A failure rolls all three back. It never changes the delivery
journal or scheduler; a newly appended carried-position uncertainty event is
audited against the existing delivery prefix. Repeating the same baseline/decision
for already-resolved positions returns `POSITIONS_ALREADY_RECONCILED_NO_ACTION`,
with no second debit, credit, event or sample. A different stale decision cannot
silently overwrite an earlier resolution. Recovery copies remain immutable and
quarantined through these routes.

## Ledger, reader and archive versions

Legacy ledgers remain schema 1. The first write-off upgrades the observed ledger
to schema 2 and its lifecycle manifest to writer/minimum-reader protocol 2.
The manifest references the verified pre-decision snapshot, preserving access to
the previous ledger/manifest through that rollback artifact. Current readers
support protocols 1 and 2; unknown versions remain blocked. Synthetic archives
and valuation reject the observed schema-2 ledger rather than misinterpreting it.

Exports containing ledger schema 2 use authenticated payload schema 3, with the
same sealed envelope/domain version and existing record set. Payload versions
1/2 remain readable for legacy ledger schema 1; payload/ledger/lifecycle mismatches
are rejected. Older binaries reject the new ledger/manifest/payload instead of
silently treating a write-off as an active or profitable trade. Use compatible
binaries for any deployment or data recovery.

Rollback restores a verified pre-decision archive only to a separate empty,
quarantined target. The original unresolved positions and cash return in that
copy; the resolved source is not overwritten. A current schema-3 archive likewise
restores the exact owner decisions and delivery history in quarantine. No real
deployment rollback or operational resumption is claimed.

## Operator procedure

After separately authorized deployment/secret configuration:

1. Halt the intended source, retain any uncertain delivery state and wait for
   the quiet period. Do not use a baseline taken before the halt.
2. Export and verify the current private baseline using the archive client.
3. Inspect the eligible positions and review the original contract/debit. Leave
   the position unresolved if zero-credit accounting is not the desired policy.
4. Apply the explicitly acknowledged decision with that exact baseline.

```powershell
node edge-cloudflare/observed-archive-cli.mjs export https://private-worker.example.invalid before-position-resolution.enc
node edge-cloudflare/observed-archive-cli.mjs verify before-position-resolution.enc
node edge-cloudflare/position-reconciliation-cli.mjs inspect https://private-worker.example.invalid position.reconciliation.json
node edge-cloudflare/position-reconciliation-cli.mjs writeoff https://private-worker.example.invalid position.reconciliation.json before-position-resolution.enc --acknowledge-unknown-exit-zero-credit
```

No arguments prints help without a request. Keys are read from the existing
private environment variables (`SCHEDULER_ADMIN_KEY`, `OBSERVED_ARCHIVE_HMAC_KEY`,
`OBSERVED_ARCHIVE_AES_KEY`), never command arguments or logs. The client verifies
the baseline before posting, uses a bare HTTPS origin, refuses redirects and
applies a timeout. Inspections are exclusively created with private mode where
supported; `.reconciliation.json` and `.enc` files are ignored by Git. Keep both
in a private directory with actual OS access controls and independent key custody.
Do not treat POSIX mode bits as verified Windows ACL privacy.

If desired, selecting a subset means retaining only the reviewed trade IDs in
the inspection request; no amount or price may be added. The server still
rechecks the entire baseline and each selected position. After success, inspect
the private dashboard's owner-adjustment counts and unknown-exit rows, and keep
a new verified export as well as the original rollback artifact. A second,
different decision needs a fresh current archive. The client does not retry,
resume processing or contact a broker/Telegram.

## Evidence and limits

Tests cover exact cash conservation, both accounts, missed OPEN exits, eligibility
cutoff, source halt/quiet/quarantine, stale archives, forged financial fields,
atomic rollback, repeated/concurrent decisions, same-day risk-budget protection,
signal dedupe, strategy/accounting separation and future equity peaks. Private
projection/rendering tests label owner write-offs and retain unknown trade P&L.

Native SQLite tests exercise the authenticated production routes, forced
transaction abort, concurrent requests, restart, private dashboard reporting,
new-version archive recovery and unsafe-input rejection. Delivery watermarks and
all original journal rows remain preserved. Existing legacy/golden archives and
unknown-version guards remain tested. This is a local accounting/recovery drill,
not real position evidence, verified historical execution, unlimited journal
rollover, live cloud acceptance or a service-resume mechanism. Current session
year restrictions remain until the next calendar-maintenance task.
