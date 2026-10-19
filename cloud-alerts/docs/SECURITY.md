# Security model and protected trading folder boundary

## Permissions

The existing folder `C:\...\Automation Day Trading` belongs to the user's trading research project. The user granted **read-only access** for inspection and to read the latest access token from its existing `.env`. Do not edit, delete, rename, move, reformat, chmod, rewrite, run formatters within, create logs within, initialize code within, or install dependencies into this folder. This GitHub project is the only target for new source and docs. All cloud state is stored in its OWN volume; any optional Nirala helper runs from a different folder.

The inspection only collected **environment variable NAMES**, confirming `ZERODHA_KITE_API_KEY`, `ZERODHA_KITE_API_SECRET`, `ZERODHA_KITE_ACCESS_TOKEN`; no values have been copied into this repository. The cloud requires the API KEY and already generated access token, never the API SECRET.

## Threat model

| Threat | Controls | Remaining risk |
|---|---|---|
| Public repo leaks key | `.gitignore`, environment placeholders only, CI tests never use real creds | Developer may accidentally commit elsewhere; enforce external secret scanning |
| Unauthorized token push | Strong HMAC-SHA256 signed raw bytes, ±90-second timestamp, unique nonce stored durably and compared securely | Shared relay key compromise permits unauthorized token changes |
| Token intercepted | Require HTTPS endpoint, reject HTTP/redirects, terminate TLS on cloud provider | Trust provider and TLS config; host/agent compromise still possible |
| Cloud disk copied | Fernet-encrypted daily token on persistent volume, stable separate `TOKEN_VAULT_KEY`, restrictive file mode | Host env or process compromise could decrypt |
| Cloud server offline / free tier sleeping | Explicit `WAIT_DATA` / `WAIT_TOKEN`, choose always-on host, monitor health | Missed entries during outages, historical REST delay |
| Kite token invalid/expired | Daily access token normally expires at 06:00 IST next day, no renewal bypass; no token → `WAIT_TOKEN` | Manual authorized daily login still required |
| Browser/Telegram bot credentials | Cloud secret storage only; no public pairing route in cloud; API requests via TLS; messages only contain research price and strategy context | Bot token or chat ID exposed to hosting-provider operators |
| Replay/duplicates | SQLite unique event keys, signed nonce table, outbox | Delivery semantics are at-least-once; rare duplicates remain possible |
| Bad market data triggers false signal | Completed candle safety delay, price/volume/timezone, 15m confirmation, quote freshness/depth, fail-closed | Exchange/provider anomalies still possible |
| Broker trade loss from automation | **No order endpoints or Kite order calls in application**, only paper-review messages | User can still act on unproven signals; never guarantee accuracy |

## Credentials boundaries

- `ZERODHA_KITE_API_SECRET` stays in protected trading project. Never relay, print or persist it in this repository.
- Daily `ZERODHA_KITE_ACCESS_TOKEN` originates in protected `.env`, read-only by `token_sender`. Its bytes travel only in an explicitly approved HTTPS POST to one authenticated cloud host.
- Cloud `token.enc` is encrypted with `TOKEN_VAULT_KEY`; rotate carefully: changing the key without re-encrypting invalidates stored token (desirable fail-closed).
- `TOKEN_RELAY_HMAC_KEY` MUST be independent from `TOKEN_VAULT_KEY`, unique, random, strong, and configured only in trusted host and local OS environment. HMAC key and Telegram bot token do not belong in `.env` of protected trading project unless user independently changes their own project.
- `TELEGRAM_BOT_TOKEN` and private chat ID are configured separately in hosting secrets; never reuse the Chrome extension's local storage by scraping browser session or injecting page scripts.
- Public `/healthz` contains only statuses/UTC+IST timestamps and no personal/secret data; a dedicated protected health channel is needed for sensitive details.

## Restricted deployment

- Inbound public cloud access must enforce TLS/HSTS and coarse rate limiting at host reverse proxy. Protected `/internal/token` uses HMAC but should not be placed behind loggers that dump request body or Authorization-like headers.
- Cloud worker must use a unique OS user, private mounted data volume, one worker process, no shell exposed to Internet, minimal egress destinations (Kite and Telegram).
- Pin dependencies and scan CVEs before enabling production; the present `requirements.txt` uses bounded major ranges for portability, NOT a reviewed lock file.
- Never auto-update dependencies during a live trading session without rollback and out-of-sample verification.
- Do not send Kite API access tokens through Telegram direct messages; even a private chat is not a dedicated secret vault.

## Explicit activation controls

1. `ALERTS_ENABLED=false` by default. No market calls or phone trade-review alerts until approved host credentials are configured and enabled.
2. Daily `token_sender` defaults to **non-network `--check-only`** unless explicitly asked for `--push` or `--watch`.
3. No broker execution credentials/permissions for order placement are needed. The code itself does not call place/modify/cancel order endpoints.
4. No hosting connection, charging action, or publishing of real tokens occurs as a side effect of adding GitHub source.

**Last updated:** 2026-10-19.
