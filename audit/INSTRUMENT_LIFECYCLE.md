# Daily instrument discovery and contract lifecycle

The observed-paper runtime now discovers the front NIFTY future from a daily
Kite NFO master, selects the entry option pair using a fresh futures quote,
and continues quoting exact open-position contracts after the entry pair moves.
This is offline/native-runtime implementation evidence; live acceptance is 0/5.

## Selection policy

- `instrument-catalog.mjs` parses the bounded CSV already allowed by the market
  transport. Only NIFTY futures and paired NIFTY CE/PE contracts are retained.
  Header/schema, identity, expiry, token, lot, tick size and duplicate checks
  fail closed. CSV `last_price` is ignored.
- Select the earliest future expiry **on or after** the current regular-session
  date. It remains eligible on its expiry day and rolls on the next regular
  day. Symbol/month and master expiry must agree. Futures quote tokens and both
  historical-candle request tokens come from this selection. Old configured
  `KITE_FUTURE_SYMBOL`/`KITE_FUTURE_INSTRUMENT_TOKEN` hints are not a fallback.
- Retain every complete strike for the earliest eligible option expiry
  **after** today. Expiry-day options remain excluded. The nearest listed
  strike wins, ties choose the lower strike, and distance must be <=250 points.
  Lot sizes and expiry are taken from the actual master, not inferred from a
  fixed weekly/monthly schedule.
- Contract expiry dates may extend into a later year. They are metadata, not
  authorization to trade an unsupported calendar year. Mixed long-dated master
  rows do not invalidate the current year's selection; trading dates still use
  the verified 2026 calendar and 2027 sessions remain disabled.
- Every successful futures observation can reselect the entry pair from the
  cache, including a 500-point move. Selection cannot replace an in-flight
  option snapshot or roll back the last observed option tick.
- Futures freshness is checked at receipt; reviewed candles are evaluated with
  the actual post-fetch clock. Network latency cannot make old data appear
  fresh by reusing an earlier alarm-start timestamp.

## Persistence and resource bounds

`readonly-instrument-catalog-v1` is a separate schema-1 daily cache. It stores
validated contracts, fetch state, attempt count and retry watermark, never CSV,
live prices or credentials. A ready daily cache is reused across restart.
Failures/crashed pending fetches permit at most three attempts/day with at least
30 minutes between attempts; each claim commits before HTTP. Day rotation drops
the previous catalogue, and unsupported years/clock rollback fail closed.

The cache accepts at most six unexpired futures and 1,000 option pairs, with a
1.5MB serialized-catalogue ceiling. Oversized catalogues fail closed rather than
silently clipping strike coverage. It must be fetched on the same IST day and
be <=12 hours old. This keeps the catalogue below the SQLite-backed KV combined
key/value limit with envelope headroom; it is not a measured cloud CPU, SQL-row
or Free-tier cost result. Large-master parsing remains an activation measurement
requirement. The observed-state archive/restore work must account for this new
cache key; the cache can be refetched, while portfolio and delivery state must
retain their independent recovery guarantees.

## Entry and exit evidence remain independent

One option request includes the entry CE/PE pair and up to two distinct held
contracts: **at most four unique NIFTY options**, with no mixed futures quote.
The transport still allows only the pinned market-data GET paths; arbitrary
symbols, duplicate symbols, bulk lists and broker transaction paths are blocked.
It makes one quote request per reserved alarm slot.

New positions persist their strike. Existing records without it remain
readable; exact symbol/token identity can recover the strike only from the
validated daily catalogue. Missing or conflicting legacy identity fails closed;
it is never guessed from the symbol. No balances or dedupe state are reset.

Paper exits use the held symbol/token/expiry/lot identity, not the newly selected
entry strike. Missing/stale/invalid entry legs block new entries while valid held
quotes can still close positions. Missing or mismatched held quotes leave exits
unverified; another strike's BID cannot be substituted. Account cash, exits and
delivery reconciliation remain in the same SQLite transaction. Lost delivery
watermarks still block processing rather than replaying historical messages.

The existing option cadence remains every third 20-second slot (60 seconds).
Changing/accepting that monitoring cadence is the next remediation item.

## Native transport compatibility regression

The new test that executes the actual workerd fetch boundary exposed an existing
transport defect: `redirect: 'error'` throws a TypeError before I/O in workerd.
Edge Kite, Telegram and metrics clients now use `redirect: 'manual'` and reject
redirect responses through their strict status checks. No Location is followed.
Native tests verify default Kite fetch and default Telegram fetch against local
synthetic outbound services, including rejection of a redirect to another host.
Temporary diagnostic hooks were removed.

Official references:

- [Kite instruments and market quotes](https://kite.trade/docs/connect/v3/market-quotes/)
  describes the daily CSV, non-live master prices, symbol-based identity and
  missing quote keys.
- [Cloudflare Request redirect modes](https://developers.cloudflare.com/workers/runtime-apis/request/)
  documents manual/follow support and the unsupported error mode.

## Regression evidence

Tests cover expiry-day future retention and post-expiry rollover; configured
hint rejection; same-day cache reuse and restart; bounded retries and late
results; duplicate/malformed masters; expiry-day option exclusion; deterministic
ATM ties and large moves; in-flight reselection exclusion; independently held
CE/PE contracts; legacy strike lookup and mismatch refusal; fresh-review new
entries with pinned strategy defaults; original-contract exits with missing
entry quotes; stale exits and delayed futures quotes; exact bounded quote
allowlisting; and no-follow redirects in the native runtime.

Tests are offline/synthetic. No real Kite request, Telegram notification,
deployment, owner credential transfer or actual resource-cost measurement was
performed. Profitability is not established by these tests.
