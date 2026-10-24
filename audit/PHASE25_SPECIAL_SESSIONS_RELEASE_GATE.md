# Phase 25 checkpoint — exceptional session and controlled release (2026-10-24)

## Verified official exchange material

1. NSE F&O 2026 holidays: [NSE/FAOP/71777](https://nsearchives.nseindia.com/content/circulars/FAOP71777.pdf), amended by [NSE/FAOP/72262](https://nsearchives.nseindia.com/content/circulars/FAOP72262.pdf). These are a **pinned snapshot**, not automatic live NSE availability checks.
2. [NSE/FAOP/76940](https://nsearchives.nseindia.com/content/circulars/FAOP76940.pdf), dated 19 October 2026, announces Sunday 8 November Diwali Muhurat F&O trading: pre-open 14:05–14:20 and continuous trading **14:20–15:40 IST**. Market timing is exceptional. The normal strategy and 20-second scheduler must **never** auto-claim this session.
3. An official 2027 F&O annual holiday calendar has **not been independently verified** for this project as of 24 October 2026. `sessionStatus()` returns unavailable and Python raises `CalendarUnavailable` for every 2027 date. Do **not** add guessed 2027 holidays, fall back to weekdays, or enable annual cloud scheduling.

## Implemented source-only safety controls

- Both the JS and Python pinned calendars now classify 8 November as `SPECIAL`, distinct from an ordinary `WEEKEND`, while `regular_session()` remains false. The JS scheduler returns `CLOSED_SPECIAL_SESSION`, skips claims and re-arms for the next verified regular opening. Tick-ID validation and the next-open loop require `REGULAR` rather than guessing from weekday alone.
- Authenticated `POST /internal/emergency-halt` (requires scheduler enabled and the existing high-entropy admin bearer) atomically deletes a pending Durable Object alarm and persists `halted: true`, `scheduledAtMs: null` and an owner-stop event. It can be called **before** initialization; repeating it is idempotent, never discards the claims ledger or rewrites corrupt state, and `POST /internal/bootstrap` **cannot restart** a halted scheduler. The design intentionally has **no remotely exposed resume route**: reactivation requires a separately reviewed code/owner recovery procedure.
- Authenticated `GET /internal/release-readiness` returns sanitized operational blockers without exposing token values, fingerprints, encryption keys or plaintext. It detects unverified year, closed/special session, missing current-IST-day signed token handoff, missing scheduler, emergency halt and disabled read-only market sampling. It is **always** `BLOCKED_PRE_RELEASE`; passing an offline test cannot grant cloud approval or certify live acceptance.
- All routes are inert until the Worker is deployed with explicit owner authorization. The example configuration remains **disabled**; no remotely accessible host exists as a result of this phase.

## Strict operator release procedure — pending separate approval

1. Before the new year, obtain the authoritative **NSE F&O 2027 annual circular**, check any amendments and special/muhurat sessions against official NSE notices, have an owner review the date/times, update **both** language calendars, tests and version strings, and verify no 2027 date is accidentally treated as `REGULAR` before approval.
2. Check amended holidays, unexpected closure and exchange notices **every trading day before activation**; a pinned calendar is stale if NSE changes it. Unexpected closure requires halting immediately and reviewing a source patch; no ad hoc remote override to convert an exceptional session into regular hours.
3. Owner must approve a ₹0, no-card, private, persistent deployment and secure backup path **in a separate step**. Never assume an operator-only readiness report constitutes that approval.
4. Every IST trading day, manually sign in to the broker according to its required flow. Successful signed HMAC/AES-GCM daily token intake may be reflected as `dailyTokenHandoffAcknowledged: true`, but this is **not proof of a successful live quote**. Absent/expired/corrupt token prevents the read-only sampler from using Kite credentials. Do not circumvent broker authentication.
5. Only paper activity may be considered. Independently prove five acceptance gates: a real read-only Kite quote, an actual phone Telegram receipt, exact real-session slots, private backup+restore and dashboard, and a laptop-off host. Never perform a real broker order or enable trading writes.
6. In a suspected emergency, have an authorized operator call the stop endpoint and independently check scheduler status stays halted after restart. Recovery requires a fresh owner-approved rollout and full journal integrity review, not a bootstrap attempt.

## Verification and evidence limits

Unit and native Cloudflare SQLite regression tests exercise unauthorized requests, rejected bodies, pre-bootstrap stop, duplicate stop, stopped bootstrap, persistence after restart and secret-free readiness. Python tests verify non-regular Muhurat and 2027 blocking. **Verified locally: 164/164 JS unit tests; 8/8 native workerd SQLite tests; 778 passed, 1 skipped Python tests** (one third-party deprecation warning). **No production Worker, paid service, live credentials, Telegram messages, actual broker data or profit/accuracy tests were run.**

Checklist item 25 remains **incomplete** until the authoritative 2027 calendar has been verified, the release procedure approved and applicable acceptance evidence exists. Item 23 (owner-approved private backup/restore) also remains incomplete. Offline engineering **23/25 = 92%**; live acceptance **0/5**.
