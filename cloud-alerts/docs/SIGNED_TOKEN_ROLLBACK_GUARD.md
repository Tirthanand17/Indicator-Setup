# Phase 32 — Monotonic signed Kite token handoffs

**Status:** Code and offline localhost-restart validation only, 20 October 2026. **No host was provisioned; no credentials were transmitted.** The original trading project's `.env` remains outside this repository and read-only. The worker cannot place broker orders.

## Problem

A valid HMAC proves a token submission came from someone holding the local relay secret. It does **not** mean multiple valid requests reach the cloud in order. If the same user refreshes their Kite token twice and network attempts are delayed, an older signed request can arrive after a newer one. A replay nonce blocks identical signed requests but does not stop two *distinct* signed requests arriving out of order.

## Guarantee within one daily session

- The relay request's **HMAC-authenticated `X-Relay-Timestamp`**, not receive time, is recorded *inside the encrypted token vault* as `relay_at` (Unix seconds). Older signed timestamps cannot replace a more recent accepted token.
- Two distinct access tokens with an identical signed second are ambiguous: the later request gets HTTP `409`, preserving the already stored credential. A same-second, same-token submission with a fresh valid nonce is an idempotent `200` without rewriting the encrypted file.
- Across process restarts, the persisted signed timestamp remains associated with the ciphertext. A new service instance reloads it before handling any handoff. Older encrypted files without `relay_at` remain readable for migration; the first accepted authenticated relay establishes the floor.
- A token sent just **before 06:00 IST** and received immediately **after 06:00** is rejected even if the 90-second HMAC clock-skew check passes. Expiry derives from the signed timestamp, so the previous session cannot be silently extended to a new day.
- After the prior encrypted token genuinely expires at 06:00 IST, the next valid session starts with a clean ordering floor.
- The server returns generic `409` responses without token values or message contents. The sender's one-shot command treats non-200 responses as failures; its watch mode can retry after the timestamp advances.

**Limitation:** Unix timestamps provide one-second ordering and can conflict for two legitimate token changes occurring within the *same* second; retry the newest token a second later. These guards cannot prove that a token is currently authorized by Kite (a live read-only broker call is required for that). They are not a substitute for HTTPS, HMAC confidentiality, a trusted local clock or single-replica deployment. The encrypted vault must stay on the approved persistent cloud volume.

## Safe verification

```bash
python -m pytest -q tests/test_token_relay_monotonic.py tests/test_token_handoff_end_to_end.py
python -m cloud_alerts.loopback_smoke --json
python -m pytest -q
```

**Evidence:** Seven new synthetic regression tests plus a separate localhost two-process rehearsal for newer-token rotation, attempted older-token rollback after restart, ciphertext persistence, and nonce replay. **421/421 tests passed**. Actual public HTTPS, Zerodha and Telegram delivery remain untested.

## Production acceptance still pending

1. An **approved** always-on ₹0-incremental-cost VM, private persistent state mount and TLS-only ingress; no free plan or student credit may be assumed without checking its live limits.
2. Real signed handoff from the read-only Windows token sender after regular daily user Kite authentication, without printing or committing credentials.
3. Verify the accepted token with Kite's official read-only API and confirm the user's phone receives a labeled Telegram TEST alert; no orders.
4. Run at least five full market sessions and independently measure monitoring coverage, quote freshness, API acceptance and handset receipts.
