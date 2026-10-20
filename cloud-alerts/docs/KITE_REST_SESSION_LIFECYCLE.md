# Phase 39 — reviewed Kite SDK pin and complete REST session lifecycle

**2026-10-20 | Offline code and tests only.** No real broker HTTP, Telegram phone notification, Oracle resource, paid service, real trading, or Windows protected-folder access occurred.

## Findings

1. `requirements.txt` previously accepted **any** KiteConnect major v5 SDK. However the Phase 37 direct-HTTPS security guard explicitly depends on the current SDK's internal attributes (`root`, `disable_ssl`, `debug`, `proxies`, and `reqsession`). A future v5 release could silently change those details.
2. The Phase 38 change closed the two parallel historical SDK sessions but did not close the original per-poll NFO instruments/option-depth session.
3. When optional `PAPER_PREMIUM_TRACKING_ENABLED=true`, a new Kite SDK was also created for every 20-second premium review without explicit HTTP session cleanup. This could accumulate connection resources during an unattended market session.

## Implementation committed

- Pin `kiteconnect==5.2.2`, the official reviewed v5.2.2 release, rather than permitting arbitrary new v5 SDKs. Other dependencies remain version-ranged, so the full image is **not fully reproducibly locked**. Revalidate and explicitly update this pin when upstream changes require it. References: [official releases](https://github.com/zerodha/pykiteconnect/releases), [reviewed client implementation](https://github.com/zerodha/pykiteconnect/blob/master/kiteconnect/connect.py).
- Add an owning `Engine._collect_once` wrapper that releases the original per-poll Kite SDK in a `finally` block, including broker errors, missing data, strategy NO_TRADE and eligible paper review.
- Keep Phase 38's independent 5-minute and 15-minute historical clients, already closed in their worker threads. The optional premium watcher now creates its own SDK inside the HTTP worker thread, closes it in `finally` on success/failure, and preserves the preexisting 8-second asyncio timeout and response-time quote checks.
- Continue fail-closed behavior, market closures, token expiration, current option-depth validation and 180-second Telegram expiry. The SDK wrapper exposes only read-only market data. No broker order methods added or used.

## Tests and evidence

- Added **six synthetic regression cases**: four for base REST client cleanup on valid paper candidate, instrument-master failure, option quote failure and NO_TRADE; two for optional premium watcher cleanup on STOP and API failure.
- Reproduced and executed **12/12** focused offline Kite transport/close tests in an isolated Linux Python fixture from the previous source snapshot; this directly validated `KiteReadOnly.close()` and the pre-existing Phase 37 guard, not the full `Engine` regressions.
- The **six newly committed Engine lifecycle tests were not executed** in this environment. Full repository checkout was blocked by GitHub DNS and no GitHub Actions credits or user laptop access were used. Do not claim them passed. Phase 34's last documented whole-suite **451/451** remains historical evidence.
- Phases 35, 36, 37, 38 and 39 introduced 10 + 18 + 11 + 4 + 6 = **49 additional nominal collected cases**, yielding **500 expected cases** assuming no other collection changes. **500/500 is NOT verified.**
- GitHub connector read-back verifies the implementation and test sources were committed; that alone does not prove production runtime compatibility.

## Remaining genuine blockers

**No approved host or production trial:** user-specific OCI account eligibility, capacity and no-charge networking remain unverified; OCI Always Free may reclaim idle compute. Render Free's sleeping/nonpersistent behavior remains inappropriate for this workload.

After explicit host approval, require Docker/HTTPS preflight, live read-only Kite authentication, authenticated daily HMAC relay, TEST-only Telegram bot API call and observed handset receipt, Nirala-off operation, five real NSE F&O sessions and strategy cost/latency audit. Keep `ALERTS_ENABLED=false` until gates pass and **never place a real order**.

**Engineering milestone estimate stays 80%; P9 multi-day live-paper acceptance stays 0%.**
