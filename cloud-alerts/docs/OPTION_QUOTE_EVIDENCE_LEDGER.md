# Phase 18 — Broker quote observation ledger (read-only, paper-only)

**Status:** implemented and tested locally on 19 October 2026. **NOT a live Kite dataset, live cloud deployment, broker fill log, or measured trading edge.** It imports no Kite order/holding code and creates no additional HTTP requests.

## Data captured when the worker is eventually enabled

On a valid `REVIEW_CE` / `REVIEW_PE` candidate, the worker records the option's already-retrieved **top-of-book BID and ASK**, depth, listed contract token/symbol/expiry/lot, the signal's five-minute boundary, the exchange quote timestamp, and the time it was observed by the worker. A single SQLite transaction stores that `ENTRY` quote snapshot with the original paper Telegram event and virtual position. No new broker request is made and no order is sent.

If **optional** paper premium tracking is enabled and a later fresh BID triggers `STOP` or `TARGET`, a separate `EXIT` quote observation is appended for the *same entry event*. A time-cutoff review **without a fresh option BID does not create an EXIT quote**. Underlying-futures-only exits also cannot be scored as options without corresponding option exit BID evidence. Missing entries/exits, quote conflicts and malformed records are not replaced by invented fills.

A closed market with no signals results in **zero option quote observations**. The system has no archive of historical option market depth. Historical futures replay by itself does not create quote observations or profit records.

The ledger table is `option_quote_observations` in the already configured, private persistent SQLite state DB. The table stores only these **sanitized market observations**, not access tokens, chat identifiers, account holdings, personal data or any broker-order metadata. Its per-row SHA-256 helps detect accidentally inconsistent records, but **is not a broker signature, external attestation, or defense against an operator who can alter the database**.

## Offline, non-mutating evaluation

On a private snapshot or after stopping the worker (not on a live, write-active DB):

```bash
python -m cloud_alerts.evidence_cli \
  --state-db /private/snapshots/alerts.sqlite3 \
  --slippage-bps 8 \
  --roundtrip-charges-rs 50 \
  --min-trades 30 \
  --min-days 5
```

The example fees and slippage are **illustrative inputs only**; they are not verified current Zerodha charges, exchange taxes or quoted price impact. Before evaluating real observations use independently reviewed date-specific charges and a conservative market-impact model. The CLI opens SQLite **read-only**, never creates a missing DB, and emits a sanitized JSON report without event IDs, quote prices, secrets or filesystem paths. Only **one hypothetical lot** is counted per pair; the evaluator requires sufficient top-of-book quantity. The only considered paper reference is **entry ASK and later exit BID**, with an additional user-supplied per-side slippage assumption and nonzero roundtrip charges.

The report explicitly includes `quote_observations`, `incomplete_quote_pairs`, `rejected_quote_pairs`, `scorable_quote_pairs` and `summary.status`. It returns `INSUFFICIENT_EVIDENCE` for under 30 trades or under five distinct market days by default, and `UNVERIFIED_SOURCE` even for a larger recorded sample until the source is independently attested. A small sample can have a descriptive paper win percentage but is **not an established win rate**; the status and sample sizes must always be shown next to it. No report represents real Kite execution.

## Safeguards and limitations

1. Schema is allowlisted: unknown metadata, credentials, malformed timestamps, inverted/nonfinite spreads and depth below one lot are rejected.
2. Real-time quote and observation clocks are separate. Exchange quotes can be slightly old; the report cannot assume order-queue position or executable fills.
3. Repeated `(entry_event_id, phase)` observations are immutable; exact repeats are idempotent, altered repeats fail closed. An entry's market quote is persisted atomically with the candidate and Telegram outbox event.
4. Entry/exit contract token, expiry, side, lot and symbol must match. Observations on different days, post-expiry dates and impossible chronology cannot be scored.
5. Missing time-cutoff or futures-only option exit BID yields incomplete evidence, **not P&L 0, a win, or a loss**.
6. Signed provider capture, an NSE holiday calendar, actual cost schedules, historical depth reconstruction, five full phone sessions and independent out-of-sample evaluation still do not exist. A fabricated/synthetic quote can pass schema tests; testing does not establish authenticity.

## Test evidence

The full synthetic suite passes **251/251** local pytest tests, including replay and prior recovery tests. Phase 18 added schema, depth, provenance, duplicate, tamper, restart, no-filled-quote, and full synthetic broker→entry→premium-BID-exit tests. No market data was fetched from Kite during these tests, no Telegram message sent externally, and no actual order placed.


## Phase 19 caveat: avoid survivorship-biased win-rate reporting

A descriptive rate calculated from the valid **paired** quote subset must not be used to rank bots when missing original entry notices or absent EXIT quotes might bias the selection. Run `--reconcile-entry-outbox` on a private SQLite snapshot and review `entry_events_missing_all_quotes`, `scorable_event_coverage_pct` and `ranking_blockers`. The quote report intentionally withholds headline/rankable win percentages; `complete_case_win_rate_pct` remains explicitly conditional on scorable pairs and **does not** certify profitability. See [full coverage audit](QUOTE_COVERAGE_AUDIT.md).
