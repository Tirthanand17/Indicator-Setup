# Requested 20-second paper-option monitoring

The optional observed-paper alarm now requests one shared market snapshot on
every eligible 20-second regular-session tick. The former every-third-slot
restriction has been removed from both production dispatch and paper turns.
All activation flags remain false in the deployment template. This is verified
offline/native-runtime behavior, not a measured Cloudflare wake-up SLA.

## One request, independent entry and exit evidence

`pollReadOnlySession` prepares one bounded quote request containing the front
NIFTY future, the current entry CE/PE pair, and up to two distinct original held
contracts: at most five instruments. No extra quote call is made when futures
and options share the snapshot. Cold initialization may request only the future
before an entry pair has been selected; no existing data is invented.

Futures are checked and the ATM selection is refreshed. Held positions then
receive their paper exit review and atomic ledger/outbox commit **before** the
five-minute/independent fifteen-minute history requests begin. A newly staged
five-minute signal can enter only on its immediately following 20-second tick,
with the existing confirmation, spread, depth, freshness and risk checks.
It cannot open a position on its own review tick or catch up a skipped entry.

Missing/malformed futures or a quote older than the 30-second entry freshness
budget block new entries. Valid quotes for exact held contracts can still close
positions. Missing/stale held quotes leave exits unfilled; another instrument's
BID is never substituted. Missing entry legs do not hide valid held exits.

STOP/TARGET can therefore be evaluated at the next eligible 20-second sample,
and the TIME rule is eligible at 15:15:00 rather than waiting for the next old
option-only slot. At/after 15:26, unresolved exits still become unverifiable
without invented cash proceeds. Faster sampling is not a guaranteed stop price
or a maximum-loss guarantee.

## Request limits, failures and duplicates

- The daily quote-pace record accepts a `MARKET_BATCH` kind alongside existing
  kinds, preserving existing counters and dedupe keys. Each claim commits
  before HTTP. Duplicate/older ticks cannot consume another quote or fill.
- A response-completion watermark also enforces at least 1.1 seconds of pacing
  after a slow/failed request. A too-close next callback is skipped, not slept
  into a burst or backfilled. HTTP429's longer cooldown and HTTP403's sticky
  auth block remain in force. The callback never retries the HTTP request.
- The slot is checked after catalogue preparation and reservation. If setup
  already consumed its 20-second window, no old quote request is started.
- Abort timeouts, bounded payloads, strict GET/host/path allowlists and
  no-follow redirects remain. The five-instrument limit admits at most one
  future, at most four options, and requires both CE and PE when options are
  requested; duplicate symbols and arbitrary bulk requests are rejected.
- Halt checks still guard mutations and dispatch. Receipt/pacing settlement
  may finish for a request already sent, while paper mutations after halt are
  blocked.

The full regular-session source plan has at most **1,125 quote requests**,
**5,625 instrument observations**, **150 historical requests** and **three
master attempts**. Actual startup, holidays, missing tokens, throttling and
failures can reduce successful observations. Two parallel history requests stay
below Kite's documented three-per-second history limit; one quote per requested
20-second slot is below its documented one-per-second quote limit. These limits
apply to this runtime; unrelated clients sharing the same API key also consume
the broker's allowance.

`marketTrafficPlan` exposes these bounds in the offline preflight. Its state
operation envelope is now 40 reads/18 writes per alarm, replacing the old six/
six assumption to reflect the larger shared pipeline. The default arithmetic
forecast is 45,801 rows read and 20,251 written including owner traffic, but
these are **planning inputs**, not measured SQLite billing. SQL amplification,
real DO CPU/duration, payload costs and Free-plan eligibility remain unresolved.
No paid resource or actual cloud usage measurement is created by this change.

## Evidence

- A complete local synthetic regular session executes 1,125 alarms, exactly
  1,125 quote requests, one master fetch and 150 history requests. The bridge
  records 1,125 option turns, retains 128 recent events, and a duplicate alarm
  cannot issue another request.
- Deterministic tests close STOP/TARGET positions at the adjacent 20-second
  slot and TIME positions at 15:15:00; duplicate turns cannot credit cash twice.
- A native workerd/SQLite test drives consecutive real alarm handlers at
  10:05:00 and 10:05:20. It holds both history responses open and reads the
  already-committed exit/outbox state before releasing them. Restart preserves
  that result, continues the next tick and reuses the daily master.
- Tests cover missing/stale futures with valid held exits, delayed catalogue
  completion, 429 cooldown, completion pacing, bounded mixed quote allowlisting,
  halted in-flight snapshots and existing storage/restart regressions.

This checkpoint passes **288 JavaScript/extension/runner tests and 22 native
workerd/SQLite tests**. Live cloud acceptance remains **0/5**. Telegram receipt
is not established; on review ticks, optional dispatch still follows the bounded
history work even though paper exits commit first. Real monitoring latency,
gaps, token/provider outages and recovery remain live acceptance obligations.

Official behavior references: [Kite API rate limits](https://kite.trade/docs/connect/v3/exceptions/)
and [Cloudflare alarm delivery/retries](https://developers.cloudflare.com/durable-objects/api/alarms/).

## Progress accounting

Cadence is remediation item 5 and is complete with offline/native evidence.
It improves already-counted data-adapter and ledger checks, so it adds no new
point to the original 41-check rubric. **Overall remains 23/41 (56%)**;
**6/19 remediation rows** are complete. Next is the still-incomplete observed
portfolio metrics requirement. No new completion percentage is invented for
this subtask.
