# Operational readiness: no false-green cloud monitoring

**Date:** 2026-10-19. **Status:** implemented and offline-tested; **NOT cloud deployed or end-to-end verified**.

The alert worker deliberately has three distinct read-only health checks. None places orders or verifies that an SMS/Telegram push appeared on the physical phone.

| Path | Returns HTTP 200 when | Critical limit |
|---|---|---|
| `GET /healthz` | FastAPI background worker task exists and has not crashed | A live process can still lack a Kite session or market data; this is the Docker liveness probe |
| `GET /readyz` | Alert evaluation is enabled and a daily Kite token is present in the in-memory vault | Token presence does **not** prove broker authorization, live REST updates, option liquidity, or Telegram reception |
| `GET /operationalz` | During the weekday monitoring session, exactly one local worker is alive, evaluation enabled, token present, last successful non-WAIT_DATA REST decision fresh within 420 seconds, no queued Telegram alerts, and state is `NO_TRADE` / `REVIEW_CE` / `REVIEW_PE` | **Does not prove Telegram delivery to a phone, cloud uptime, strategy accuracy or option execution** |

All three endpoints are diagnostics, **not trading signals**. `/operationalz` returns 503 and a bounded nonsecret reason code when its data-readiness checks fail; 503 on weekends/after hours is expected. The cloud provider's Docker liveness must remain `/healthz`, **not** `/operationalz`, so market closure, an expired daily token or a temporary Kite outage does not cause a restart loop.

## Example status (illustrative synthetic example, not live observations)

```json
{"monitoring_data_ready":false,"reason":"DAILY_TOKEN_MISSING","mode":"READ_ONLY_PAPER","phone_receipt_verified":false,"real_orders_enabled":false}
```

Reason codes: `WORKER_NOT_RUNNING`, `ALERTS_DISABLED`, `OUTSIDE_MONITORING_SESSION`, `DAILY_TOKEN_MISSING`, `PHONE_OUTBOX_PENDING`, `DATA_OR_DELIVERY_NOT_READY`, `NO_VERIFIED_REST_DECISION`, `DATA_FUTURE_TIMESTAMP`, `REST_DATA_STALE`, `FRESH_REST_DECISION`.

## Important safety conditions

- Do **not** treat a successful `/readyz` as permission to trade.
- `/operationalz` verifies only local application state and **recent completed Kite REST processing**, never real option fills or broker position data.
- An accepted Telegram API request is not confirmation that the operator's mobile notification was received. Record operator-confirmed receipts separately during paper sessions.
- Always mount **one persistent private SQLite state directory** on a single always-on server, enforce HTTPS for signed daily token handoff, and never expose token or Telegram credentials in public GitHub files.
- A 503 response is **not a reason to bypass** freshness, stop-loss or quote validation.
- Host/operator approval, real Kite quote checks, cloud Telegram TEST, laptop-off validation and at least five paper sessions remain outstanding.

## Tests

`python -m pytest -q` — offline-only suite including invalid timestamps, stale REST data, pending phone outbox, disabled monitoring, market hours and token handoff preservation.
