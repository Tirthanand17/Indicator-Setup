# Phase 32 — private read-only Kite-observed paper dashboard (offline only)

Date: 24 October 2026. Repo: `Tirthanand17/Indicator-Setup`.

## Implemented

- `edge-cloudflare/readonly-dashboard.mjs` audits both the read-only review/option bridge and its **separate** paper ledger before constructing an explicitly labeled source report. It exposes two independent paper accounts, cash, realized profits/losses, filtered trades, expiry, IST-day report, win/loss counts, pending **count** of Telegram events, option-tick freshness and sanitized scheduler status.
- The existing `/paper/dashboard` HTTPS, separate-strong-key login, short-lived signed HttpOnly cookie, strict CSP and no-store controls also protect the new view. The read-only Kite paper view takes precedence only when **all** bridge, option snapshot, read-only review and market runtime flags are explicitly enabled alongside the dashboard and scheduler gates. The old synthetic mode remains available when those are disabled, and data is never combined.
- Cookie-authenticated `GET /paper/api/readonly?date=2026-10-23&account=ALL&limit=50` gives sanitized paper-only results. No raw Kite quotes, authentication tokens, broker instrument tokens, order commands or Telegram message bodies leave this endpoint. Unknown/duplicate query parameters, methods, corrupt ledgers, mismatched zero-tick state, and absent state fail closed. The new responsive browser script uses `textContent`, not user data as HTML.
- Freshness is labeled explicitly: no option ticks, observed in the last 30 seconds, or stale/historic. Because a confirmed independent mark-to-market snapshot has not been implemented for this market-observed ledger, **marked equity and unrealized P&L are null** whenever requested; cash is never misrepresented as equity. Realized P&L is counted only on paper exits backed by a modeled BID decision, not on unresolved exits. They are not actual exchange fills.
- Unit tests cover account separation, private session, absent individual activation flags, malformed requests, corrupt state, snapshot privacy and unsupported year. A native SQLite workerd test checks feature isolation and authenticated snapshot persistence across worker restart with external outbound calls forbidden.

## Verification (local only)

| Check | Result |
| --- | --- |
| `npm test` | 202/202 passed |
| `npm run test:runtime` | 12/12 passed (temporary test-fixture write access) |
| `npm run preflight:offline` | Run before merging; unchanged deployment template must remain disabled |

## Not yet delivered

- No deployed URL/domain, populated cloud session, user-facing working external dashboard, real market-day account history, or measured Workers/DO CPU/storage. The GitHub source change alone does not launch a service.
- No Telegram Bot API sender or delivery receipt is connected to the new read-only ledger. The existing Phase24 journal remains an offline simulator and the read-only paper outbox is pending-only.
- Actual Kite data/token use and a full five-session live paper audit remain to be authorized and proven; the 2027 trading calendar is not verified. No market orders or expenses were generated.

**Progress unchanged:** fixed offline checklist 23/25 = 92%; live acceptance 0/5. All deployment/runtime example flags stay off. ₹0 new spend.
