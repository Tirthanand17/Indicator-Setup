# Phase 20 — private mobile cloud dashboard and daily paper reports

Date: 2026-10-23. **Offline implementation only. NOT DEPLOYED.**

## Implemented

- `edge-cloudflare/private-dashboard.mjs` serves the mobile-responsive, read-only `/paper/dashboard` shell, isolated same-origin CSS/JS, and protected JSON reads: `/paper/api/summary`, `/paper/api/trades?account=...&limit=...`, and `/paper/api/daily?date=2026-MM-DD`.
- The private **viewing** key is separately configured as `PAPER_DASHBOARD_VIEW_KEY`; at least 32 characters and 8 distinct characters, maximum 256, and prohibited from equaling `SCHEDULER_ADMIN_KEY`. No key appears in URLs, browser storage, response bodies, JavaScript assets or cookies.
- HTTPS-only login POST accepts at most 1,024 bytes of form-encoded input with one key field. Successful login issues an expiring 15-minute HMAC-SHA256 authenticated `__Host-paper_session` cookie, scoped to Secure/HttpOnly/SameSite=Strict/Path=/. Cookie signature and expiry are verified by the Durable Object on every data read. Cookie fails closed on tamper, missing key or key rotation; sign-out clears it. CSP, no-cache, no-frame, no-referrer and nosniff headers apply.
- The top-level Worker and Durable Object independently enforce opt-in flags `OFFLINE_SCHEDULER_ENABLED`, `OFFLINE_PAPER_LEDGER_ENABLED` and `OFFLINE_PRIVATE_DASHBOARD_ENABLED`, with the last `false` in the undeployed example. Legacy admin endpoints remain Bearer-only. No new paper/broker write API exists.
- Reports are generated only from transactionally persisted, fully audited paper ledger state. ₹50,000/₹1,00,000 accounts are separate. The responsive UI displays **cash, not marked-to-market equity**. Only closed, priced simulated exits contribute to realized P&L or win rate; open/unverifiable positions remain unvalued and labeled. Trade journal is capped at 50 displayed rows per request; full export/history and current MTM are separate future milestones (#22–23).
- Day reports are derived from **IST entry/exit dates**; an exit is counted on its observed exit day. No trades yields `null` win rate (displayed N/A), never 100%. Frontend escapes dynamic trade text via `textContent` and shows an explicit synthetic-only/no-live-connection banner. It polls same-origin every 15 seconds while visible, without browser-held keys.

## Verification and limits

- `node --test edge-cloudflare/*.test.mjs`: **128 passed**, including 13 new dashboard tests. These cover configuration gates, weak/identical keys, cookie tampering/expiry, cross-origin rejection, oversized login, query/method controls, integrity failures, filtered trades, unresolved P&L and day accounting.
- `npm run test:runtime` in `edge-cloudflare`: **5 native workerd/SQLite tests passed**, adding real local login/session, account journal read, unauthorized POST rejection and persistence/restart probe with outbound network forbidden.
- Extension suite **39 passed**; full offline Python **777 passed, 1 skipped, one third-party warning**.
- No browser visual QA on an actual phone, no public HTTPS host, no cloud Worker or Durable Object, no production domain/TLS, no actual phone notification or authenticated live user session was exercised. **Live acceptance remains 0/5**.
- Do not activate flags or create/bill cloud resources without owner authorization. No Zerodha order or live Kite trade is placed.

## Remaining milestones

22: portfolio mark-to-market with fresh, verified option BID and capital/health states (never fabricate unrealized P&L). 23: retention, verifiable export/restore and measured capacity. 24: Telegram ambiguous delivery and retries. 25: exceptional session/2027 calendar and operational release gates. Separately, real market data-to-ledger integration and five live acceptance gates remain unverified.
