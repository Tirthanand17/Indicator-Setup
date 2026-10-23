# Phase22 — offline synthetic portfolio valuation, capital and health

**23 October 2026 — OFFLINE-ONLY implementation; no deployment, no real broker orders, no live NSE MTM.**

## Scope

- `edge-cloudflare/portfolio-valuation.mjs` snapshots an option BID/ASK only when synthetic provenance, price timestamp, exact open contract, 2% spread bound, relevant bid depth and entry timestamp all validate. At most CE and PE are retained; closed holdings have no saved market mark.
- A new synthetic market turn writes sanitized quote marks together with both paper accounts and the full synthetic tick journal inside one Durable Object transaction. Duplicate ticks leave all data unchanged. Missing quotes are **not** replaced by previous tick marks. A transaction exception preserves previous documents.
- `portfolioValuation` reconstructs position exit proceeds from fresh synthetic BID, adverse slippage, and the pinned strategy SELL fee model (broker charges included). Unrealized P&L is hypothetical exit credit minus modeled entry debit. Total indicative equity is audited cash plus that credit, never cash alone when an open holding lacks a quote.
- One output row per ₹50k/₹100k account: available cash, committed entry debit, single-entry cap, remaining trades and daily loss budget, realized net P&L, hypothetical open net P&L, indicative total P&L, and valuation status. Flat accounts show cash equity and unrealized 0. An `EXIT_UNVERIFIABLE` holding has no invented exit value; the account is blocked.
- An authenticated `/paper/api/portfolio` GET powers the phone-responsive private dashboard. The API and browser explicitly label the source `OFFLINE_SYNTHETIC_TEST_ONLY` and the price as **indicative**, not actual/live. Feature flags, HTTPS-only login, signed cookie, CSP and no-store protections carry over unchanged from Phase20. Production has **no synthetic feed POST endpoint** and no order execution path.

## Fail-closed checks

1. Latest bid or synthetic session older than 15s: open equity/unrealized = `null` and health `MISSING_OR_STALE_QUOTE`.
2. Invalid depth/spread/contract/quote day or causal ordering: no mark saved; open equity/unrealized = `null`.
3. Last tick replay: no new valuation record. Next tick without price: previous mark not carried forward.
4. Invalid persisted mark or mismatch with session: authenticated valuation API returns 503; does not disclose partial account data.
5. Known flat paper account: audited cash is exact, without falsely marking it to market. A position flagged `EXIT_UNVERIFIABLE` stays unresolved.
6. Ledger cash conservation/closed proceeds validation is unchanged; no extra debit/credit, alert dispatch or broker request occurs in valuation.

## Offline verification

| Verification | Expected/result |
|---|---|
| Edge Node suite `npm test` | 137 pass, 0 fail |
| Extension Node suite | 39 pass, 0 fail |
| Native local workerd SQLite `npm run test:runtime` | 6 pass, 0 fail |
| Python full suite | 777 pass, 1 skipped on prior Phase20; not a Phase22 change |
| Hosted Kite/Telegram/dashboard | Not executed; live acceptance 0/5 |

The new native test covers synthetic quote snapshot, both accounts' fresh indicative equity, automatic expiry after 17s, authenticated read-only API, rollback invariance and durable restart recovery. All external calls in the native harness are rejected. No cloud project or charge created.

## Open follow-up

Checklist #23 restore/export/capacity; #24 Telegram ambiguous delivery/retry_after/retention; #25 annual session exceptions and release controls. No live market-input mapping or cloud qualification is implied by this simulated numerical model.
