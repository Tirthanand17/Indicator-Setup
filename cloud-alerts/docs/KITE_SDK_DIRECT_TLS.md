# Phase 37 — official Kite REST SDK direct HTTPS policy

**Status:** source committed and 11 focused tests passed in an isolated local test environment. **No real Kite REST call, real access token, Telegram message, Windows access, cloud VM or order was used.** Production host, zero-cost account approval and real phone alerts remain pending.

## Finding

The [official PyKiteConnect client](https://github.com/zerodha/pykiteconnect/blob/master/kiteconnect/connect.py) (reviewed 2026-10-20, v5) constructs its own `requests.Session`, exposes `reqsession`, `root`, `proxies`, `debug` and `disable_ssl`, and its HTTP request implementation uses `allow_redirects=True`. A normal Requests session inherits HTTP(S)/ALL_PROXY and custom CA bundle environment configuration. The earlier Phase 36 hardening only addressed the **token handoff** and **Telegram notification** senders; official REST market-data requests were not covered.

## Source changes

The existing `KiteReadOnly` wrapper now checks the SDK's actual configuration **before calling `set_access_token`**:

- Requires the official URL `https://api.kite.trade`, `disable_ssl=False`, `debug=False`, and an empty SDK proxy map.
- Requires a reviewed `requests.Session` at `reqsession`; unsupported SDK layouts fail with generic `RuntimeError`.
- Sets `reqsession.trust_env=False` to disable implicit proxy and CA override environment variables, and `reqsession.max_redirects=0` to prevent following a 3xx response carrying an Authorization header.
- Leaves the existing read-only NFO instruments, 5/15-minute historical candles and NFO option quote calls unchanged. Never exposes an order method through the wrapper.
- Does not modify the original Nirala `Automation Day Trading` folder, its env file or browser.

**Limitations:** The SDK itself is not vendored or pinned to an exact audited patch release yet. A future SDK with a changed HTTP transport may fail closed, preventing alerts; its behavior must be revalidated when updating dependencies. The optional shadow WebSocket connection is separate and defaults OFF. This patch does not prove DNS, HTTPS availability, data quality, broker authentication, or handset receipt. Direct HTTPS also requires outbound network access without an enterprise HTTP proxy.

## Focused checks

Eleven pytest cases were run using a fake SDK and test-only tokens, including synthetic hostile proxy and CA environment variables, unapproved URL, disabled TLS, debug mode, explicit proxy settings, unsupported SDK request sessions, invalid credentials, valid read-only calls and wrong intervals. Result: **11 passed** in the isolated local environment, Python module compilation successful. A separate Requests redirect behavior check confirmed max_redirects=0 prevents redirect following.

The local copy has only the Kite wrapper and small stubs, **not the entire repo**. The last full regression result in GitHub history is **451/451 from Phase 34**. Phase 35 added 10, Phase 36 added 18, and Phase 37 adds 11, for **490 expected collected cases** if prior test counts remain stable; **490/490 is not a verified result**. No GitHub Actions minutes were spent. Run `python -m pytest -q` from `cloud-alerts/` on an allowed machine before deployment.

## Remaining critical milestones

1. Choose and independently confirm an approved ₹0 all-in host and persistent volume; user-specific OCI tenancy, capacity and billing settings are unknown. OCI may reclaim idle Always Free instances.
2. Validate Docker/HTTPS/public ingress, read-only official Kite requests and the current day's legitimate token relay.
3. Send an explicitly TEST-only Telegram notification and confirm receipt on the user's phone.
4. Verify operation with Nirala OFF for five real NSE F&O sessions, recording missed data, latency and hypothetical **after-cost** option P&L.
5. Final security/deployment and real-time reliability audit. Paper trading only; **live orders permanently disabled unless separately scoped and authorized**.

**Overall engineering estimate stays 80%; live deployment stays OFF.**
