# Phase34 — Telegram sender source integration (disabled)

Date: 24 October 2026. **Source and local tests only.** No Worker
deployment, no Bot API request, no Telegram phone delivery, no Kite order,
no billing and no production credentials were used.

## Boundary and implementation

- New `edge-cloudflare/telegram-sender.mjs` submits a single HTTPS JSON
  `sendMessage` call **only** to Telegram's fixed Bot API host. It accepts
  only the intended positive numeric **private** chat ID and a syntactically
  plausible bot token. Group, channel, username and redirect targets are
  refused. No dynamic URL, broker order path or update-reading API exists.
- The sender requests a quiet-free, protected text message of no more than
  1,200 characters, sets a maximum 4-second abort timeout and reads no more
  than 4 KiB of JSON response. It drops all raw HTTP descriptions, thrown
  network errors, request objects, chat metadata and secrets from the result.
- A definite Bot API acceptance requires HTTP 200, JSON `ok:true`, a
  positive `message_id` **and the exact pinned numeric chat ID**. It records
  only `message_id` for durable reconciliation; *this proves API acceptance,
  not phone receipt or human reading*. A valid HTTP 429 and `retry_after`
  propagate a bounded cooldown. Definite 400/401/403/404 rejections are
  terminal. Timeouts, 5xx, bad/missing response or identity mismatch remain
  **ambiguous** and must never trigger an automatic resend.
- `MarketSession.dispatchReadOnlyTelegram` persists the Phase33 paper-alert
  claim in the **independent observed-paper SQLite delivery journal before**
  invoking the sender. It stores only sanitized Bot API outcome metadata in
  settlement. A crash or failed settlement leaves the attempt unconfirmed;
  the journal disallows another automatic send, including after restart.
- No production HTTP send endpoint is exposed; the only integration is the
  opt-in existing alarm. The normal alarm still never places broker orders.
  The test harness injects fake Bot API replies and blocks all outbound HTTP.

## Activation controls

`OFFLINE_TELEGRAM_SENDER_ENABLED=false` is now in the sample template and
strict free-tier preflight. Even changing that flag alone does **nothing**:
the read-only scheduler, market runtime, futures review, option sampler,
observed-paper bridge and isolated delivery journal must each also be
explicitly enabled. `TELEGRAM_BOT_TOKEN` and `TELEGRAM_PRIVATE_CHAT_ID` must
be provided as Worker **secrets**, never tracked source. These are not set.
This is a future supervised activation plan, **not permission to deploy**.

## Verification

| Check | Result |
| --- | --- |
| Cloudflare unit suite `npm test` | 211/211 passed |
| Native SQLite/workerd suite `npm run test:runtime` | 14/14 passed |
| Sender configuration, response and timeout simulations | Passed, mocked HTTP only |
| Native fake acceptance, ambiguous replay prevention, restart and no public send route | Passed |
| Real Telegram Bot API, phone and alert timing | **Not tested** |
| Cloud deployment, duration/CPU, actual Kite market samples | **Not tested** |

**Progress remains 23/25 = 92% for previously defined offline engineering,
live acceptance 0/5.** Outstanding: supervised real cloud infrastructure,
valid market-day token and current instruments, capacity and timetable
measurements, authorized private dashboard, Telegram recipient consent and
first verified phone delivery. ₹0 additional spend.
