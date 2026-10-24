# Phase29 — read-only NIFTY option discovery and executable quote evidence

Date: 24 October 2026. **Offline code/tests only; not deployed.**

## What changed

- Added `edge-cloudflare/option-readonly.mjs` as a pure, side-effect-free
  NIFTY CE/PE option contract and quote verifier. It parses a **same-day fetched**
  official-shaped NFO instrument CSV and selects one matching CE and PE for
  the closest eligible expiry **after** the current IST day, with equal strike
  and lot size. It chooses the nearest complete ATM strike to the validated
  futures price, subject to a conservative 250-index-point distance limit.
- Never guesses expiry, strike, instrument token or lot size. Rejects missing
  legs, duplicate tokens/contracts, inconsistent lot size, invalid master rows,
  unknown 2027 session, stale master fetch and out-of-session dates.
- Converts Kite's documented exchange-local `YYYY-MM-DD HH:mm:ss` full-quote
  timestamp explicitly using IST UTC+05:30 (not host timezone). Quote evidence
  must identify the selected instrument token, be no older than 15 seconds or
  over 3 seconds in the future, and provide positive executable best BID and
  ASK with one-lot quantities and maximum 2% spread.
- `market-readonly.mjs` now permits **exactly** a pair of one NIFTY CE plus
  one NIFTY PE through the existing GET-only `/quote` transport. A same-client
  local 1,100 ms quote-call guard prevents requests exceeding Kite's
  documented one-per-second quote limit. It converts unauthorized and rate
  limited HTTP responses into stable secret-free error codes, performs no
  automatic reattempts, and caps instrument CSV downloads at 16 MiB.
- Normalized quote objects pass the existing `paper-ledger.mjs` `checkQuote`
  shape. **This compatibility does not call `enterPaperBasket`, authorize
  paper entries, mutate storage, enable alerts, or issue live broker orders.**
  The evidence explicitly contains `paperEntryAuthorized:false`,
  `telegramAuthorized:false` and `realOrdersEnabled:false`.

## Verification and limitations

- Local `node --test market-readonly.test.mjs option-readonly.test.mjs`:
  14 passing tests, including paired GET only, unknown/expired session,
  instrument mismatch, full depth, stale price, duplicate rows, 403, 429,
  missing quote leg, transaction-route rejection and secret-safe errors.
- Full `npm test`: **186/186 passed**; native `npm run test:runtime`:
  **8/8 passed** with temporary-write permission, and
  `npm run preflight:offline` reports disabled service flags and no deployed
  resources. The first native attempt failed to create writable `/tmp` test
  fixtures in the default read-only execution sandbox; the approved rerun
  passed without changing source or deployed state.
- No live NFO CSV, live premium or Kite access token was used in tests. Kite's
  daily CSV source publication time cannot be inferred from its fetch time;
  an owner must verify freshness of the production upstream master.
- No Worker scheduler invokes option discovery yet. Two quote endpoints on
  one alarm would violate the local quote-call guard; a separately designed
  pacing strategy and persistent shared rate limit are still required for
  live data integration. The existing synthetic ledger remains isolated.
- No actual cloud service, broker session, Telegram delivery, paper fill,
  off-host backup, dashboard URL or cost-bearing resource was activated.
  Engineering fixed checklist remains **23/25 (92%)**; live acceptance **0/5**.

## Remaining gate to production-connected paper only

Implement a scheduled, durable, paced read-only contract refresh plus option
snapshot routine; enforce account-wide request pacing and auth-expiry alerts;
then connect a validated same-tick CE/PE decision to both paper portfolios
behind explicit owner approval, deployment credentials and observed live
dry-run acceptance. No live-money trade execution is approved or built.
