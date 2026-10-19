# Phase 16 — Kite option quote and higher-timeframe integrity

**Date:** 2026-10-19  | **Mode:** Read-only paper research  | **Status:** Offline tested, NOT live cloud validated

## Why this matters

Floating point NaN passes `price <= 0` and `ask <= bid` checks because both comparisons return false. Previously such prices could contaminate an otherwise valid-looking option review, alert text and virtual option reference. The new quote validator rejects NaN and both infinities before spread and depth checks.

The optional `instrument_token` in a Kite full quote is compared with the selected NFO contract. Mismatched tokens now suppress the signal; no metadata field remains compatible with SDK responses that omit it.

When Kite's exchange timestamp is a naive datetime or string, it is interpreted as an IST exchange timestamp, *not* as the host process's timezone. This ensures a server using UTC does not incorrectly treat the quote as stale/future-dated. Only aware caller clocks are accepted.

The independent 15-minute confirmation series is now fully OHLC-validated and strictly increasing; recent current-session bars must be on actual 15-minute bar starts (09:15 + n×15m), with no recent intraday gaps. Bars carried from previous sessions remain allowed as EMA warmup history. The 5-minute REST candle remains the only source of actual signal decisions.

## Verification

- Synthetic nonfinite options: all NaN / +inf / -inf BID and ASK variants rejected.
- Optional token metadata mismatch rejected, absent metadata accepted.
- UTC host + naive IST exchange timestamp accepted correctly; naive validation clock rejected.
- Duplicate, missing, malformed and misaligned 15-minute context rejected before a trade-review decision.
- Existing valid 15-minute series represented as UTC still produces the same decision.
- Synthetic Kite→option quote→Telegram test proves corrupted quotes issue no alert or virtual position.
- Complete offline suite: **203/203 passed**; Python `compileall` passed.

**Not demonstrated:** live Kite option depth, independently matched reference chart calculations, genuine session latency, live Telegram acceptance or phone receipt, 24×7 cloud hosting, or after-cost trading accuracy. No broker orders exist in this project.
