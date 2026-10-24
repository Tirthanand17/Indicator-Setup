# Phase31: controlled read-only source into separate dual paper portfolios

Date: 24 October 2026. **Code and offline tests only; undeployed.**

## Implemented

1. New pure `readonly-paper-bridge.mjs` accepts **only** the Phase28
   futures strategy review source and Phase29/30 matched CE+PE evidence.
   It validates a claimed NSE regular 20-second slot, 5-minute bar
   completeness, IST freshness, underlying identity, review-source label,
   option executable BID/ASK, contract/token/expiry consistency and no
   synthetic override. Candidate `REVIEW_CE` or `REVIEW_PE` survives at most
   one following option snapshot slot. A stale or mismatched quote never
   fabricates a fill.
2. A new `OFFLINE_PAPER_BRIDGE_ENABLED=false` switch, requiring four other
   independently disabled read-only scheduler/review/option gates, connects
   reviewed completed futures candles to a pending *read-only-only* signal.
   The following option-only alarm may atomically record risk-checked
   paper entries/exits. Neither alarm invokes a broker transaction API.
3. Distinct private SQLite keys (`readonly-paper-bridge-v1` and
   `readonly-paper-ledger-v1`) separate the research portfolios from the
   earlier `OFFLINE_SYNTHETIC_TEST_ONLY` ledger/session. The normal paper
   ledger core preserves **independent ₹50,000 and ₹1,00,000 balances**,
   atomic modeled fees/slippage, one-lot depth/risk gates, duplicate signal
   protection, BID exits and pending-only alert outbox records.
4. Native DO transaction combines accepted validated option snapshot,
   paper balance/position updates and read-only bridge journal. A simulated
   restart preserves balances and prevents a duplicate fill/credit.
5. After 15:26 IST, a special paper-only EOD alarm step marks open exits
   `EXIT_UNVERIFIABLE` **even without any incoming option price**. It does
   not credit sale proceeds and prevents a false profit claim. Duplicate
   EOD callbacks do not create duplicate outbox events.
6. Protected GET `/internal/readonly-paper` returns only a sanitized paper
   status and balances when all five opt-in prerequisites are satisfied.
   Public and unauthenticated requests remain blocked. This is **not yet**
   the mobile dashboard; historical fills and alerts are never publicly
   exposed. All flags remain disabled in `wrangler.example.jsonc` and in the
   executable offline deployment preflight.

## Offline verification

- JavaScript unit cases use Python-parity-generated bullish CE, bearish PE,
  sideways/no-trade and all-option-evidence freshness fixtures, plus duplicate
  entries, BID exits, EOD unverifiable exits and corrupted-source prevention.
- Native `workerd` SQLite tests cover two-capital account persistence,
  restart, replay, authenticated status and outage close while blocking all
  actual outbound network requests.
- Final `npm test`: **198/198 JS passing**; native SQLite
  `npm run test:runtime`: **11/11 passing**; disabled configuration
  `npm run preflight:offline`: **passed**. Native tests used temporary local
  writable fixtures with outbound network requests explicitly blocked. No
  real Kite market, Telegram send, cloud service or paid tool was contacted.

## Still not production-ready

- No actual live Kite candles/options, hosted Worker CPU/quota benchmark,
  five clean live-market sessions, real phone delivery or deployment.
- Both paper portfolios have their own authenticated status endpoint but are
  not yet included in the existing mobile dashboard. Their pending outbox
  events are durable **records, not sent Telegram notifications**.
- A daily option master is selected when first available; intraday moves
  more than 250 underlying points from that strike deliberately prevent
  entries rather than guessing a new ATM contract. Dynamic re-selection
  requires a separately verified implementation.
- The 2027 NSE F&O calendar remains unverified and blocked.
- Hosting, activating any feature, setting secrets or contacting external
  markets requires owner approval and a demonstrated ₹0 free-tier budget.

**Fixed offline engineering checklist: 23/25 = 92%. Live acceptance: 0/5.**
No original checklist item is newly closed by this opt-in connection.
