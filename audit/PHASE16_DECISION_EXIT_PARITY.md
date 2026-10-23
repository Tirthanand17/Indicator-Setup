# Phase 16 — Python/JavaScript paper decisions and exits (23 October 2026)

Status: **Verified offline source-rule parity only. Never deployed.** The Worker
still has `marketRuntimeImplemented:false` and cannot fetch market data, hold
cash, execute broker orders, publish a dashboard or send Telegram alerts.

## Covered Python reference behavior

| Python source | Undeployed JavaScript source | Offline oracle |
|---|---|---|
| `cloud_alerts.signals.decide` | `edge-cloudflare/decision-core.mjs` | 30 Python-generated cases: rising ADX, qualified CE/PE reviews, mismatch, wide stops, 2026 holiday/weekend/2027, session boundaries, candle gaps, incomplete/stale bars |
| `cloud_alerts.premium.reference_from_quote`, `parse_reference` | `edge-cloudflare/exit-core.mjs` | 5 recorded hypothetical ASK references; invalid/overnight references rejected |
| `cloud_alerts.premium.evaluate_bid` | `edge-cloudflare/exit-core.mjs` | 3 Python BID decisions: STOP, HOLD, TARGET; stale/missing BID blocks review |
| `cloud_alerts.paper_book.PaperBook.exit` | `edge-cloudflare/exit-core.mjs` | 8 standalone temporary-SQLite oracle cases: STOP, TARGET, HOLD, TIME, insufficient depth, duplicate, unverifiable, negative-credit refusal |
| `cloud_alerts.engine.Engine._check_virtual_exit` | `edge-cloudflare/exit-core.mjs` | Underlying candle touch, simultaneous STOP/TARGET risk-first ambiguity, strict time cutoff; no Telegram/SQLite side effects |

The JavaScript modules consume JSON epoch-millisecond IST-aware timestamps and
plain value objects. Python fixtures are produced from synthetic candles, quotes
and disposable local SQLite accounts; they contain no account keys, user
holdings, broker orders or performance history. Numeric indicator comparisons
use tolerance `1e-8`; paper exit results match expected status, rupee values
and fields exactly. Fee calculations use versioned integer paise.

## Reproduce

```sh
python edge-cloudflare/generate_decision_parity.py
python edge-cloudflare/generate_exit_parity.py
node --test edge-cloudflare/*.test.mjs extension/tests/*.test.cjs
cd cloud-alerts && python -m pytest -q -p no:cacheprovider
cd ../edge-cloudflare && npm run test:runtime
```

**Validated results:** 113/113 combined Node tests; 777 Python tests passed,
1 skipped, 1 third-party Starlette warning; 1 native local workerd SQLite
runtime test passed. Fixture generation was run solely with synthetic inputs.
No cloud deployment, financial transaction, credential transmission, Telegram
message, private user file change, or paid resource was involved.

## Explicit scope boundary / next work

1. This proves **offline pure rule parity against sampled reference paths**,
   not mathematical equivalence of every input, broker quote or runtime state.
   The underlying exit rule's notification acceptance gate and data persistence
   remain governed by the Python worker; integration is future cloud work.
2. The JavaScript modules **do not authorize a simulated trade** by themselves.
   Market-data selection/freshness at the HTTP boundary, daily signed token
   handoff, durable position/outbox state and recovery must be implemented and
   verified separately under checklist items17–19.
3. Future year/exceptional sessions remain blocked by the pinned2026 calendar;
   annual verified release/override belongs to item25.
4. Paper ASK/BID are **model references, not exchange-confirmed fills**.
   Neither the oracle fixtures nor the local DO test establish profit,
   delivery to a phone or laptop-off continuity.

Remaining engineering: 8 checklist items. Live acceptance: 0 of5 gates.
