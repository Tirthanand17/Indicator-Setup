# Phase 38 — independent SDK sessions for concurrent Kite history calls

**2026-10-20. Source committed; regression execution pending. No cloud or broker deployment.**

## High-impact reliability issue

The cloud worker previously executed its authoritative **5-minute and 15-minute futures history** REST requests concurrently through **one KiteReadOnly / KiteConnect object**:

```python
series5, series15 = await asyncio.gather(
    asyncio.to_thread(kite.historical, fut.token, '5minute', candle_from, now),
    asyncio.to_thread(kite.historical, fut.token, '15minute', candle_from, now))
```

That shares the same mutable `requests.Session` between two Python threads. Requests does not guarantee independent thread-safe session state; concurrent historical calls should not rely on safe shared mutations/cookie/connection handling. A malformed or mismatched response is explicitly hazardous for time-critical intraday research.

## Implemented fix

The two asynchronous worker threads now each instantiate an independent **read-only** `KiteReadOnly` SDK/session for their own historical GET, while retaining concurrent timing:

```python
def fetch_history(interval: str):
    isolated = KiteReadOnly(self.api_key, token)
    try:
        return isolated.historical(fut.token, interval, candle_from, now)
    finally:
        close = getattr(isolated, 'close', None)
        if callable(close):
            close()
series5, series15 = await asyncio.gather(
    asyncio.to_thread(fetch_history, '5minute'),
    asyncio.to_thread(fetch_history, '15minute'))
```

The original session remains exclusively for the day's NFO instrument read and a subsequent eligible option depth read. Each short-lived historical SDK now closes its HTTP session in a `finally` block after success or broker failure; the instrument/quote client lifetime is unchanged. All SDK sessions use Phase 37's official HTTPS, non-proxy, redirect-blocked, debug-off adapter. Broker GET results are still authoritative. Missing/malformed historical data or any provider error must fail closed to `WAIT_DATA`; no order methods are enabled.

**Performance tradeoff:** This creates two extra small SDK/session objects per REST monitoring poll. Two history reads still execute concurrently, rather than serializing 5m/15m and delaying the phone alert. This does not guarantee API latency, direct Internet availability, TLS chain trust, or an actual Kite response.

## Regression coverage committed

`tests/test_independent_kite_sessions.py` adds four offline cases:

1. 5-minute and 15-minute history are fetched by different Kite objects, and NO_TRADE suppresses a paper BUY.
2. The instrument/option quote Kite object is not reused by the concurrent history requests; valid synthetic option data still leads to a clearly hypothetical review message.
3. A simulated 15-minute broker outage leads to `WAIT_DATA`, with no Telegram BUY or virtual candidate.
4. A subsequent same-candle polling attempt gets fresh, independent history sessions rather than sharing old thread-bound objects. The tracked fake sessions are asserted closed after both normal history reads and a synthetic history exception.

**No real credentials or network requests are in these tests.** GitHub read-back/patch structure was checked. The full suite has **not** been executed here: Phase 34's documented passing suite was 451/451; Phase 35 +10, Phase 36 +18, Phase 37 +11 and Phase 38 +4 imply **494 potential tests**, assuming no other collected-test changes. **Do not report 494/494 passing.** The container cannot fetch the GitHub repo due to DNS/network restrictions, and no GitHub Actions credits or Nirala access were used.

## Rollout gates unchanged

Before real deployment: an explicitly authorized zero-cost persistent non-sleeping host, TLS/Docker verification, legitimate daily token relay, live read-only Kite quote smoke, TEST-only Telegram handset confirmation, laptop-OFF continuity, and five real NSE F&O sessions. The optional shadow WebSocket implementation has its own transport/supervision requirements. Oracle Always Free remains conditional on tenancy and capacity and may reclaim idle instances.

**Engineering milestone estimate remains 80%; live cloud availability remains unverified, live order execution disabled.**
