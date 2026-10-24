# Phase 28 — read-only futures review and documented Kite timestamp repair

**24 October 2026.** Source-only, opt-in local implementation. No deployment,
broker authentication, money, orders, Telegram message or real market-data call.

## Defect confirmed against Kite's primary documentation

The official historical candle response examples show timezone suffix `+0530`.
The earlier JavaScript REST validator required a colon in the offset (`+05:30`),
so a valid Kite historical response was rejected before strategy evaluation.
Both the bounded GET transport and the separate review adapter now use the
same strict aware-time parser. It canonicalizes four-digit ISO offsets before
decoding into UTC milliseconds, rejects naive timestamps, and never adopts the
execution host's local timezone.

Official reference: https://kite.trade/docs/connect/v3/historical/

## Independent futures-only review

`market-review.mjs` takes the already authenticated read-only NIFTY futures
quote, 5-minute history, 15-minute independent history, and scheduler tick.
It demands an eligible pinned NSE session, same IST day, exact 20-second slot,
fresh 60-second futures timestamp, one futures symbol/token, plausible quote/
candle consistency, strictly increasing bounded historical timestamps, valid
OHLC/volume, NSE session alignment, and strictly completed candles (+8s).

The adapter then invokes the pinned five-indicator `decision-core.mjs` and
returns only `WAIT_DATA`, `NO_TRADE`, `REVIEW_CE`, or `REVIEW_PE`, a known
diagnostic reason, and timestamps of source bars. No raw historical data or
authorization token goes into its stored report. Every output explicitly says
`paperEntryAuthorized:false`, `telegramAuthorized:false`, and
`realOrdersEnabled:false`. It never calls the paper ledger, delivery journal
or an order route. The test-only review adapter can take an explicit bounded
strategy configuration to exercise existing Python parity fixtures. The Worker
does **not** pass one: actual future reports use the default ADX=25, ATR
buffer=0.5 settings.

The Worker only calls the review module when all preexisting sampler gates
pass **and** `OFFLINE_READONLY_REVIEW_ENABLED=true`. When this flag is enabled,
historical polling occurs one 20-second slot after each five-minute boundary,
allowing the just-closed 5-minute candle to satisfy the strategy's +8-second
completeness margin. Review results are sanitized into the existing
owner-authenticated `/internal/scheduler` observation record. When disabled,
the previous observational-only boundary timing is preserved. The historical
query's lookback changes from seven to six days to keep under the transport's
400-row cap for ordinary market weeks; missing warmup after unusual closures
must return `WAIT_DATA` and is not automatically backfilled.

## Fail-closed and unresolved

- At most one unfinished trailing bar per interval is ignored; malformed,
  misaligned, future-looking, duplicate or stale data cannot trigger review.
- No option instrument discovery, option BID/ASK depth, option lot evidence or
  expiry roll is present in this new bridge. A futures `REVIEW_CE/PE` is **not**
  an executable trade or even a completed options paper entry.
- The production Worker remains without a transaction-writing bridge from
  actual Kite inputs to `processSyntheticMarketTurn`; that separate module
  accepts only explicitly labeled synthetic test input.
- No live quote correctness, actual data frequency, Cloudflare CPU/billing,
  host continuity, phone notification or P&L accuracy is verified.
- Static annual-calendar verification for 2027 and private off-host restore
  still block the 25-item release checklist.

## Offline verification

`npm test` in `edge-cloudflare`: **178/178** pass, including five pure
read-only review scenarios and a documented `+0530` transport regression.
`npm run test:runtime`: **8/8** native local workerd/SQLite tests pass (no
outbound network). `npm run preflight:offline` still verifies every published
template feature flag, including the new review gate, is `false`.

This is a checkpoint outside the fixed 25-item checklist: engineering
**23/25 (92%)**, real-world acceptance **0/5**. Neither item23 nor item25 is
finished, and no live host was created.
