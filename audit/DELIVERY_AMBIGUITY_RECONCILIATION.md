# Authenticated owner reconciliation of uncertain Telegram attempts

Implemented locally on 26 October 2026. No actual Telegram request, owner
decision about real records, deployment, feature activation or scheduler resume
was performed. All regression traffic uses synthetic records and fake replies.

## Available decision

The supported decision is **suppress resend while acknowledging unknown
delivery**. It consumes one uncertain event as `SUPPRESSED_UNCERTAIN`, retains
its attempt count and records a terminal receipt/cursor in the existing observed
delivery journal. It does not mark the event accepted by Telegram, received on
a phone, rejected, traded or safely retryable. No sender is called.

Only `CLAIMED_UNCONFIRMED` and `AMBIGUOUS` attempts are eligible. Rate-limit
`RETRY_AFTER` attempts and definitive terminal outcomes are not rewritten as
uncertain. The immutable ledger, balances, outbox IDs, positions and metrics are
unchanged. The existing archive already includes the delivery journal, so no
new record or archive schema is needed. The private read-only dashboard shows
the suppressed-unknown count separately from Bot API acceptance.

## Private routes and guards

`GET /internal/readonly-delivery/reconcile` inspects the observed journal without
claiming, expiring, settling, suppressing or sending anything. It returns the
active event ID/index, attempt, claim timestamp and journal-change timestamp,
plus sanitized counters, eligibility and blocking reason. Raw alert messages,
broker credentials, instrument tokens and bot tokens are excluded.

`POST` to the same route requires the exact inspection proof and decision:

```json
{
  "eventId": "the exact observed event ID from inspection",
  "index": 1,
  "attempt": 1,
  "claimedAtMs": 1,
  "journalChangedAtMs": 1,
  "decision": "OWNER_SUPPRESS_RESEND_ACKNOWLEDGING_UNKNOWN_DELIVERY"
}
```

The integers above illustrate field types, not a usable request. The server uses
its own clock. Before a new suppression, it verifies all proof fields against
the currently active attempt inside the same transaction that writes the
journal. Bodies have exactly these fields; free-form notes and extra fields
are refused. JSON is bounded to 4,096 UTF-8 bytes.

Both methods require HTTPS, an exact route with no query parameters, the existing
`SCHEDULER_ADMIN_KEY` bearer authorization, `OFFLINE_SCHEDULER_ENABLED=true` and
the new `OFFLINE_DELIVERY_RECONCILIATION_ENABLED=true` gate. Dashboard/viewing
cookies do not authorize this action. The new gate is false in the committed
template and forced false by the credential-isolated quality runner. Market
sampling and sender flags need not be enabled to inspect a stopped source.

New suppression also requires a valid halted scheduler with `scheduledAtMs=null`,
no actual alarm, no recovery quarantine, a compatible lifecycle manifest and at
least 30 seconds since the attempt was claimed. The quiet period is a conservative
operating guard, not proof that a remote request was never accepted. Missing or
corrupt journals, fabricated watermarks and clock rollback are blocked rather
than initialized or repaired.

Invalid bodies receive 400 (413 if oversized); stale/ineligible proof or source
guards receive 409. Corrupt/unavailable records or incompatible schemas receive
503. Recovered copies remain quarantined and cannot be modified by this route.
Errors are fixed status/code values; submitted bodies and secrets are not logged
or echoed.

## Retry, acknowledgement and crash behavior

Two concurrent copies of a valid request serialize to one suppression and one
`ALREADY_TERMINAL_NO_ACTION`; counters and cursor advance only once. Retrying a
lost response cannot consume the next event. If a definitive Bot API receipt
commits first, the response reports that existing terminal status and does not
overwrite it. An acknowledgement arriving after suppression cannot settle the
old event into the next cursor; the existing exact-event/attempt settlement
checks reject it. Suppression continues to mean unknown delivery.

Detailed terminal receipts retain only the last 128, while the durable prefix
cursor remains authoritative for no replay. If an old detailed receipt has been
pruned, a retry is rejected as `TERMINAL_RECEIPT_NOT_RETAINED`, without changing
the cursor or inventing an outcome. Do not automatically re-inspect and apply the
old decision to a different event.

The action never schedules an alarm or resumes the terminal emergency halt.
It resolves the recorded ambiguity without reopening service. Safe operational
resume, recovered-copy reconciliation and unverifiable positions remain separate
work. Phone receipt remains unverified even when the Bot API previously accepted
another event.

## Operator client

After separately authorized configuration, halt the intended source using its
existing emergency-halt procedure and allow the quiet period to pass. Keep the
administrator key in a private environment/secret store, not command arguments,
files in this public repository or chat. Then:

```powershell
node edge-cloudflare/delivery-reconciliation-cli.mjs
node edge-cloudflare/delivery-reconciliation-cli.mjs inspect https://private-worker.example.invalid inspection.reconciliation.json
node edge-cloudflare/delivery-reconciliation-cli.mjs suppress https://private-worker.example.invalid inspection.reconciliation.json --acknowledge-unknown-delivery
```

The first command prints help and makes no request. Inspect saves sanitized
metadata with exclusive creation (`wx`, mode 0600 where supported), never
overwrites an existing file and reports eligibility. Review the private inspection
file and its exact event/attempt before suppression. The command requires the
explicit acknowledgement flag; a blocked inspection cannot be submitted. The
server rechecks eligibility atomically, independently of the saved file.

The client accepts a bare HTTPS origin, never follows redirects, uses a
15-second request timeout, bounds input/output and never automatically retries.
It prints only sanitized operation results and delivery/resume disclaimers.
Files ending `.reconciliation.json` are ignored by Git but still contain private
trade identifiers; use a private directory and OS access controls. POSIX file
mode does not establish Windows ACL privacy. After a conflict or rejection,
stop and inspect current state rather than changing the event in an old request.

## Evidence and remaining acceptance

Pure tests cover exact proof validation, safe suppression, duplicate requests,
definitive acknowledgement races, missing/unsafe states, UTF-8/body bounds,
rate-limit ineligibility, stale attempts, client opt-in and exclusive writes.
Real paper-ledger/delivery transitions reach 132 terminal events to verify that
rotation of the receipt ring does not permit replay or fabricated idempotency.

Native SQLite tests call the authenticated production routes, reject invalid
proof/content type/size, submit concurrent decisions, compare all business
documents, restart the object, preserve accepted/unknown counters and confirm no
resume. Guard cases cover running/alarmed/recent/quarantined/incompatible sources.
A native late-receipt case settles through the actual delivery method before a
stale owner request and retains Bot API acceptance. All outbound requests are
forbidden by these tests.

This implements roadmap task 10. It is not live Telegram/phone acceptance or a
claim that all operator workflows and recovery are complete. Operational alerts,
unverifiable-position reconciliation, safe service continuation and hosted
acceptance still require their own evidence.
