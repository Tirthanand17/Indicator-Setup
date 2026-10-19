# Phase 19 — Option evidence coverage and survivorship-bias audit

**Mode:** offline, read-only, paper-only. **No verified broker provenance, real orders, authenticated quote tape or claimed strategy edge.**

## Why an apparently perfect win rate can be wrong

The original quote-only scorer used only records with both ENTRY and EXIT top-of-book snapshots to compute hypothetical after-cost win percentages. Entries missing an EXIT were visibly counted, but an entry with **neither** snapshot was not even in the denominator. In a paper sample with 10 claimed entries, one completed winner and nine records without any quote evidence, the complete-case rate is 100% but the **scorable-event coverage is 10%**. The underlying win/loss rate of the other nine is **unknown**, not zero or 100%. They must not be silently ignored to rank strategies.

## CLI with outbox reconciliation

Run only on a **private SQLite snapshot**, not a live, write-active database. Supply caller-reviewed nonzero charges and per-side slippage:

```bash
python -m cloud_alerts.evidence_cli \
  --state-db /private/readonly-snapshot/alerts.sqlite3 \
  --slippage-bps 8 --roundtrip-charges-rs 50 \
  --min-trades 30 --min-days 5 --reconcile-entry-outbox
```

With the switch, only events originally claimed as `REVIEW_CE` or `REVIEW_PE` in the same snapshot count as source paper entries. Every quoted event must have an outbox entry. The CLI reads outbox IDs and delivery-state codes internally but returns only aggregate counts; it never returns event IDs, payloads, file paths or credentials. It opens SQLite with `mode=ro` and does not modify the source file. **Event delivery state 1 confirms only Telegram API acceptance, not receipt by the phone.**

Without `--reconcile-entry-outbox`, quote-only exports retain compatibility, but their entry denominator is **unknown**, and the report explicitly states that no source-entry reconciliation was performed. The CLI cannot infer zero missing entries merely because all *recorded* entries have an EXIT.

## Interpreting the report

- `reference_event_count`: number of claimed paper entries when the option is enabled; otherwise only the number with observed quote rows.
- `source_entry_events` and `entry_events_missing_all_quotes`: values available only with outbox reconciliation.
- `scorable_event_coverage_pct`: percentage of source entry events with valid, paired ENTRY/EXIT top-of-book observations; `null` if there are none.
- `incomplete_quote_pairs` and `rejected_quote_pairs`: observed records missing a stage or failing cross-stage coherence. These are **missing evidence**, not automatically losing trades.
- `complete_case_win_rate_pct`: descriptive fraction of *scorable pairs* with positive hypothetical ASK-in/BID-out after-cost return. A high value on a filtered sample may be misleading.
- `summary.net_win_rate_pct`, `rankable_win_rate_pct` and `eligible_for_strategy_ranking`: null, null and false until a separate independent quote-provenance and complete-sample review is implemented. `ranking_blockers` lists exactly what is missing.
- `entry_notice_delivery_counts`: queued, Telegram-API-accepted or expired entry notices; these **do not** prove user holdings or fills.

Even 100% evidence coverage or 30+ observations over 5+ sessions is **not** authenticated broker provenance, statistical superiority, execution liquidity or live trading profitability. This phase implements research-accounting safeguards only. Synthetic tests do not produce real trading accuracy.

## Evidence

Local Python suite: **264/264 passed**, including no-quote candidate omission, unregistered quotes, mismatched contracts, read-only CLI checks, and incomplete-data reporting. No hosted bot, real phone receipts, real Kite options tape, real trades or incremental cloud charges were used.
