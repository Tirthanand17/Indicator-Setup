# Phase23 checkpoint — offline signed archive and capacity boundary

**24 October 2026. NOT DEPLOYED. Engineering checklist #23 remains OPEN.**

## Implemented without new permissions

`edge-cloudflare/paper-archive.mjs` offers local/offline primitives only:

- `makePaperArchive()` serializes a fully audited `paper-ledger-v1`, optional `synthetic-session-v1`, and matching optional `synthetic-portfolio-marks-v1`. No scheduler alarm, broker token vault, market observation, API credential, relay nonce or signing key is included.
- `verifyPaperArchive()` verifies a distinct 32–256-character secret's **HMAC-SHA256** tag *before* trusting any contained ledger, session or quote document. It rejects tampering, wrong keys, unsupported schemas, inconsistent timestamps and oversize archives. HMAC authenticates but **does not encrypt**; the signed JSON must stay private.
- `restorePaperArchiveToEmpty()` requires an isolated transactional storage object with no pre-existing account, synthetic, marks, scheduler, token or observation records. It restores the audited account, session and quote documents atomically; it never schedules a job, activates live processing or restores trading credentials. Duplicate restore is rejected, no overwrite mode exists.
- `paperArchiveCapacity()` audits each complete ledger and reports exact current journal record counts, configured maximums, free slots and 75%/90%/100% warning thresholds. Positions, rejections and pending outbox entries are **never silently pruned**. Synthetic `events` intentionally keeps only the last 128; that history is not represented as complete.
- No production HTTP route or cloud job has been added for exporting these sensitive journals. An offline routing regression explicitly checks `/internal/paper-archive`, `/internal/paper-capacity`, and `/internal/paper-restore` remain inaccessible even with an admin bearer key. Nothing sent to GitHub, cloud, phone, Kite or Telegram beyond ordinary source-code review.

## Empirical offline test profile

| Test property | Verified result |
|---|---|
| Synthetic trade signals | 256, across 2026 NSE regular days (fee schedule effective April 2026) |
| Preserved paper positions | 512 / 512, all 512 closed |
| Preserved pending alert messages | 1,024 / 1,024; **none** claimed delivered |
| State document JSON size | **668,161 bytes** |
| Signed archive JSON size | **668,356 bytes** |
| Hard archive payload ceiling | **4,000,000 bytes** (tested also with 1,200-character messages) |
| At capacity | Further entry blocked with `PAPER_LEDGER_RECORD_CAPACITY`; old history preserved |
| HMAC tamper/wrong key | Rejected, restore target untouched |
| Restore to active storage | Rejected with `TARGET_NOT_EMPTY` |
| Restore to empty simulated transactional storage | Exact ledger/outbox restored once, no scheduler or token restored |

This is a **deterministic memory/JSON stress test**, not a Cloudflare resource quota, network-throughput, performance SLA or paid usage measurement. At six positions per full session, 512 records last at most 85 whole sessions plus part of one; account constraints can reduce real volume, while rejections may exhaust their 1,024-slot cap much earlier. A full trade journal fails closed upon reaching configured hard limits until a separate, approved retention strategy exists. The 128-event rolling decision history is not an all-session audit trail.

## Approval boundary and remaining checklist #23 work

Exporting detailed positions and pending outbox messages through a remotely accessible HTTP endpoint crosses a private-data boundary. That change was **not approved** and was not made. The owner must select an authorized, private, securely stored recovery destination and explicitly approve the exposure/access model before a hosted backup delivery route or external archive write is implemented. A public GitHub repository is not an acceptable destination for unencrypted archives; GitHub-only storage would need an owner-authorized **private** destination and proper key and retention handling.

Still required for full #23 completion: privately authorized off-host export and verified restore into a fresh hosted target; backup freshness, rotation, retention/export scheduling, restore drill after loss/restart, real quota/CPU/disk observations under zero-cost tenancy and no-card terms. No cloud resources or payment verification were attempted here.

Next distinct engineering items: #24 Telegram ambiguous delivery and retention, #25 calendar/release controls. Live acceptance remains **0/5**.
