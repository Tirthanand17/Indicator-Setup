# Phase 18 — offline Cloudflare two-account ledger and transactional outbox

23 October 2026 — **implementation and tests only; not deployed or activated**.

## What exists

- `edge-cloudflare/paper-ledger.mjs` has a pure, deterministic, schema-versioned ledger for `PAPER_50K` (₹50,000) and `PAPER_100K` (₹1,00,000). They are independent hypothetical accounts, not an aggregated market order or evidence of achievable execution.
- Each simulated option buy uses a recent NIFTY CE/PE exchange quote, ASK + adverse slippage, whole lots, the versioned fee engine, a 3%-of-initial-capital modeled stop-loss budget, 30% capital exposure cap, 6% realized daily-loss budget, at most three entries/account/IST day, and top-of-book size. Quotes fail closed on missing timestamps, >15 seconds of age, excessive spread, instrument mismatch, expired contract, or unsupported 2026 exchange calendar.
- Entries and exits are idempotent. Exits use a fresh executable BID less adverse slippage and modeled SELL fees, with STOP/TARGET/15:15 time rules and contract/causality/depth checks. Missing executable exit evidence never creates a profit or cash credit; post-15:26 unresolved positions are marked `EXIT_UNVERIFIABLE`, and their account remains blocked.
- `MarketSession` persists **both accounts, positions, rejections, and pending outbox messages in one SQLite Durable Object storage transaction**. There are no outbound notifications in that transaction. Journal integrity reconstructs balances and requires matching entry/exit/recovery outbox records. Corrupt state aborts writes rather than resetting capital. An explicit upper record bound blocks further writes when reached; complete retention/export is checklist item 23.
- `GET /internal/paper-ledger` returns only authenticated, non-sensitive aggregate cash and settled P&L, only if scheduler and ledger flags are on. It does not expose raw events, quote data, credentials, or a public trade-write endpoint. The deployment example sets `OFFLINE_PAPER_LEDGER_ENABLED=false`; no cloud or broker resource was created.
- A **local-test-only** harness accepts fabricated entries/exits, verifies native transaction rollback, retries/duplicate races, and persists both accounts plus outbox across a native workerd restart. Outbound network traffic is deliberately rejected.

## Evidence and limitations

The pure module has synthetic cases for independent sizing, exact integer-paise fee-inclusive cash debits, replay, BAD quotes, holidays/time boundaries, open-position/rejected-signal dedupe, risk/depth, STOP/TARGET/TIME exits, partial closes, daily trade limits, daily loss accounting, unverified exit, and corrupt ledger fail-closed behavior. The 36 pre-existing Python/JavaScript fee cases remain part of the regression suite.

Run from the repository root:

```sh
node --test edge-cloudflare/*.test.mjs
cd edge-cloudflare && npm run test:runtime
```

The production alarm's read-only futures observations **are not yet wired** to option contract discovery, five-minute decision gates, simulated orders, or automatic session finalization. This integration belongs to checklist item 19. Live Kite options liquidity/freshness, cloud storage latency/limits, accurate exchange charge changes, physical Telegram delivery, overnight restoration and always-on availability remain unverified. The outbox is **pending only**: no delivery, retry or de-duplication across uncertain network outcomes (item 24). The summary is **realized P&L only**, not mark-to-market or historical return analysis (items 20 and 22). No actual trade, market data, credential, phone message, cloud deployment, billing change or profit claim is made.

## Safety boundary

Never treat this as live execution authorization. There is no broker order endpoint; all flows are synthetic paper records. New deployments, flags, DNS, hosting, credentials and real API handoffs still require separate approval and independently verified ₹0 costs. The 2027 NSE calendar is deliberately unsupported and fails closed.
