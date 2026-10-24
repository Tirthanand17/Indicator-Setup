# Phase 33 — isolated read-only paper Telegram delivery rehearsal

Date: 24 October 2026. **Offline source development only, not Telegram delivery.**

## Implemented

- Added `OFFLINE_READONLY_DELIVERY_REHEARSAL_ENABLED=false` in the disabled Cloudflare example and strict offline preflight whitelist. The new opt-in has no effect unless the scheduler, Kite read-only market sampler, five-minute futures review, option snapshot and read-only paper bridge are *all* independently active.
- `readonly-delivery.mjs` uses a dedicated `readonly-paper-delivery-v1` cursor, which is never merged with the existing synthetic `paper-delivery-v1` or either paper account's cash. In a single Durable Object SQLite transaction, the observed-market paper ledger is updated together with its delivery journal on an option tick and on 15:26 IST unresolved exits.
- The existing Phase24 offline delivery state machine provides durable claim-before-send, no automatic retry on uncertain delivery, owner-acknowledged suppression of uncertain events, explicit Bot API `retry_after` cooldown, at most three attempts and event time-to-live checks. A missing delivery journal with historical outbox events blocks initialization, so reconnecting a partial backup cannot replay old phone alerts.
- Protected `GET /internal/readonly-delivery` exposes only sanitized counts, journal position, API acknowledgement and blocking status to the owner. It is not a sender. Production exposes **no** claim, settle, suppress, broker-order or Telegram network endpoint. All test-only methods/routes live in `runtime/harness.mjs`, which is excluded from deployment configuration.
- Bot API acknowledgement `ACCEPTED_API_ONLY` is intentionally different from a **verified phone push receipt**. The latter is not available. The private account dashboard remains read-only and does not show or send the raw message text.

## Offline verification

- `npm test`: 206/206 passed.
- `npm run test:runtime`: 13/13 native SQLite tests passed. Includes a new atomic observed-paper outbox and separate delivery journal; protected owner-only GET; independent synthetic ledger; unconfirmed attempt preserved across restart; retry-after cooldown; simulated Bot API acknowledgement; and 15:26 unresolved positions appending events without changing the settled cursor. All outbound requests are blocked in this fixture.
- `npm run preflight:offline`: unchanged SAFE_DISABLED_TEMPLATE_ONLY, zero runtime flags enabled and no deployment.

## Important remaining blockers

1. **No Telegram Bot API sender exists in production.** No device received a notification. The whole phase is a dry run, not a working external alert system.
2. If an owner later opts in after historical paper alerts exist but before a matching journal was established, journal initialization will refuse to replay them; an explicitly designed one-time migration/owner acknowledgement is required. Never simply reset the cursor to zero.
3. A real cloud Free-tier CPU/duration/storage benchmark, valid daily Kite handoff, verified live five-session paper trial, reliable private backup/restore and the official 2027 F&O calendar are still missing. Cloud deployment requires separate authorization, even if charges appear to be zero.

Fixed offline engineering checklist remains **23/25 = 92%** and real live acceptance remains **0/5**. No real orders, external messages, new connections, resource creation or charges.
