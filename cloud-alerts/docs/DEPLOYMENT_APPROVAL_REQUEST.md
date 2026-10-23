# Deployment gate — draft, prerequisites not satisfied

**IN DEVELOPMENT / PAPER ONLY. No provisioning approval requested yet.** Source development authorization does not authorize cloud resources, credential transfer or phone messages. The current Worker is scheduler-only.

Proposed later scope: one Free Worker, one SQLite Durable Object namespace/class and one singleton market-session object; provider HTTPS endpoint after private ingress review. No separate D1, R2, KV, custom domain, paid logging or paid plan is proposed. The example config disables workers.dev/preview URLs and scheduler by default; ingress must be designed before approval.

Required entitlement: Workers Free and SQLite DO Free, no card/UPI mandate/payment hold or automatic paid upgrade. Confirm all relevant account subscriptions and billing settings with the owner before creation. Published quotas are not a contractual guarantee of uninterrupted₹0 service.

Forecast:1,125 nominal alarms/session;≈6,000 dashboard requests for four calls/15s; local callback ceiling4,096/day. Conservatively≈2,880GB-s for a128MB object resident6.25h, plus other account activity. Full CPU, row operations, instrument download, outbox, storage and operational traffic are not measured yet. Free request/row/storage exhaustion must halt safely. See the [audit](../../audit/FULL_PROJECT_AUDIT_2026-10-23.md).

Secrets: current scheduler needs `SCHEDULER_ADMIN_KEY`. Future design needs Kite API key and daily access token, token-relay HMAC/encryption keys, Telegram bot token/chat destination, and private dashboard authentication secret. Exact bindings for these future secrets are not implemented. Never include values in approval records or GitHub.

Proposed outbound endpoints: approved read-only `https://api.kite.trade/instruments/NFO`, `/quote`, `/instruments/historical/{token}/{5minute|15minute}`; Telegram HTTPS Bot API sendMessage only after separate delivery authorization. Daily login stays in the legitimate owner-controlled workflow. No order/account mutation endpoints.

Security: deny-by-default HTTP routes; TLS; strong auth; replay-resistant token relay; secret redaction; structurally GET-only broker adapter; private dashboard; strict idempotency and calendar/data freshness checks. Current scheduler has no broker/Telegram egress at all.

Backup/rollback: retain prior immutable Worker version, disable scheduling before rollback, export versioned ledger/events with checksums, verify restoration to an isolated offline store, never rewind an idempotency watermark into duplicate fills. The scheduler-only state test is not a complete ledger export/restore implementation.

Before requesting approval: resolve high dependency findings, complete cloud market engine/ledger/outbox/relay/dashboard, demonstrate synthetic end-to-end behavior and restore, measure CPU/storage headroom and prepare a specific resource manifest and rollback. Then request explicit approval for each resource and credential/message action.

After authorization only: five independent gates—cloud read-only Kite data, real phone receipt/latency, session scheduling, dashboard/ledger recovery, and laptop-off operation. All are currently **0/5**. Multi-session proof remains additional work. No cloud resource, subscription, payment mandate, domain or live secret was created or transmitted in this audit.
