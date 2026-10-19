# Offline REST-monitoring session coverage audit — Phase 20

**Status: offline-tested implementation, not an operating cloud system.** The application still requires an approved always-on host, a securely handed-off daily Kite token, proven Telegram receipt, and independent market evidence. No real trades can be placed through this repository.

## Monitoring boundaries

The project now documents one consistent exchange-local schedule for the existing polling strategy: **09:25 through 15:25 IST**, inclusive, every five minutes on configured trading weekdays. At each eligible boundary the worker normally checks a REST candle on :08, :23 and :43 seconds at most. This is **73 boundary opportunities per selected weekday**. The engine previously rejected requests at 15:25:08 because its stop condition was `time()>15:25:00`; the scheduler also permitted a 09:20 boundary even though the engine refused it. Both mismatches are corrected.

This is **not** a full NSE exchange-day capture (the market opens at 09:15 and ordinarily ends at 15:30). It is the bot's configured REST review window. Trading holidays, early closures, exchange incidents and individual Kite historical publication delays **are not** inferred from the weekday. The operator selects genuinely open session dates to audit.

## Persistent sanitized observations

A new `rest_poll_coverage` SQLite table stores `boundary_utc`, `last_observed_utc`, `attempts`, and an allowlisted best outcome. The four outcomes are `REST_VALID`, `WAIT_DATA`, `WAIT_TOKEN`, and `API_ERROR`. `REST_VALID` means the bot obtained completed expected REST candles and ran or had already deduplicated a terminal signal decision, **not** that Kite independently attested the feed or that the option/phone was correct. The latter stages can fail without erasing valid five-minute REST monitoring evidence.

Attempts are upserted by normalized five-minute boundary. An unsuccessful retry cannot downgrade a prior `REST_VALID`. The ledger contains **no token, credentials, phone/chat IDs, futures prices, raw quote payloads, orders or account information**. It exists only on the worker's private persistent state volume. Existing SQLite files are migrated additively on startup.

## Read-only audit command

On a private copy of the bot state directory, with Python dependencies installed:

```bash
python -m cloud_alerts.session_audit_cli \
  --state-db /private/bot/alerts.sqlite3 \
  --session-date 2026-10-19 \
  --session-date 2026-10-20
```

**Check the official exchange holiday calendar before selecting those dates**. The command never writes to the database, uses SQLite `mode=ro`, and emits only aggregate numbers by explicit session date: expected boundaries, successful REST decision boundaries, attempted-but-unsuccessful boundaries and completely unobserved boundaries. It rejects duplicate dates, malformed/off-boundary observations and unexpected outcome codes. Its error output never echoes the database path or credential values.

Missing boundaries always reduce coverage. **For example, 1 successful boundary / 73 expected = 1.37% monitoring coverage**, not a complete session. Fifty percent coverage across two selected days cannot be described as two successful sessions. A complete count does not establish Kite origin, actual phone receipt, signal profitability or independent validation. A test fixture can produce a 100% count.

## Operational acceptance remains pending

To graduate Phase 9 beyond **zero observed sessions**, run the bot with an operator-approved non-sleeping host, independent Kite quote verification, daily token handoff, and proof of phone alert receipt (or no-alert explanation). Examine this ledger together with the existing `option_quote_observations`, Telegram outbox and stream reconciliation after **at least five fully observed exchange sessions**. This new code alone provides no such sessions.

No order methods, live position reads, hosting resources, payment methods, or broker credentials are used by this audit.
