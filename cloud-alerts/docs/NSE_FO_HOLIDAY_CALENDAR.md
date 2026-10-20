# NSE F&O 2026 holiday-aware paper monitoring (Phase 29)

**Status:** implemented and offline-tested; cloud alerts are NOT deployed. **Reviewed:** 20 October 2026.

## Official exchange sources

- NSE Futures & Options circular **NSE/FAOP/71777**, 12 December 2025, lists regular F&O trading holidays for 2026: https://nsearchives.nseindia.com/content/circulars/FAOP71777.pdf
- Supplementary official F&O circular **NSE/FAOP/72262**, 12 January 2026, adds **15 January 2026** for the Maharashtra municipal corporation election: https://nsearchives.nseindia.com/content/circulars/FAOP72262.pdf
- The pinned list has 16 dates including **Tuesday, 20 October 2026 (Dussehra)**. Weekend closure is checked separately. Muhurat/special-session times are NOT regular 09:15–15:30 sessions.

## What changed

`cloud_alerts.trading_calendar` is a **pinned offline holiday snapshot**, not a live NSE query, and does not claim to validate current exchange operations. It produces `REGULAR`, `HOLIDAY`, or `WEEKEND` for 2026 and raises `CalendarUnavailable` for every other year. The bot refuses unsupported-year market monitoring rather than silently treat every weekday as open.

The worker checks the official regular-session calendar before any Kite history or quote requests. The five-minute schedule, 20-second paper premium watcher and optional shadow WebSocket are likewise closed on official holidays. Private old-day position cleanup remains possible even on a holiday. `/operationalz` reports `EXCHANGE_HOLIDAY` or `CALENDAR_UNAVAILABLE` without tokens or account details.

The offline historical replay rejects futures candles on known F&O holidays; `session_audit_cli` rejects a holiday selected as a live paper session. This prevents a holiday from being counted as **73 missing REST boundaries**. The 73-boundary requirement remains for an actual normal open trading day, for example **21 October 2026**, subject to any subsequent exchange announcement.

## Credential-free status check

```bash
python -m cloud_alerts.calendar_cli --date 2026-10-20
python -m cloud_alerts.calendar_cli --date 2026-10-21
```

The JSON response explicitly contains `calendar_is_live: false`, no broker calls or phone messages. Unsupported years use a non-zero exit code; a regular NSE F&O calendar for **2027** must be reviewed and added before unattended operation crosses that year boundary.

## Safety boundaries

- Calendars may be amended, and extraordinary emergency closures can occur. **Reverify official NSE holiday and special-session circulars before going live, and maintain a process for future amendments**. The 2026 snapshot is not a universal exchange calendar.
- Normal entry cutoff, quote freshness, bot single-worker guarantees, no real orders, limited live Kite API checks, and no verified Telegram handset receipts all remain unchanged.
- The holiday check does **not** provide Kite authentication or prove an individual paper signal is profitable.
- An exchange holiday is not a failed paper monitoring session. At least **five actual open full sessions** with independent evidence are still required to assess performance.

## Offline regression evidence

**396 of 396 Python tests passed** with no broker/Telegram API/network calls. Test coverage includes all 16 holidays, the separate January F&O circular, 20 October Dussehra, 21 October regular schedule, clock timezone conversion, unknown 2027 fail-closed behavior, disabled holiday poll paths, aged paper position cleanup, historical replay data rejection, shadow shutdown and CLI privacy. No cloud host was deployed or charged.
