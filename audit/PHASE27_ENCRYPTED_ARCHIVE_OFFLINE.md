# Phase 27 checkpoint — encrypted paper archive, offline only

**Date:** 24 October 2026. **Scope:** confidential paper research backup and isolated recovery primitive; source code only. No real archive was generated for the user, no private content uploaded, and no storage service or billed account was accessed.

## Why this phase is necessary

The existing Phase23 portable archive is an HMAC-signed JSON document. HMAC provides **authenticity and integrity**, not confidentiality. The document may include complete synthetic account positions and pending Telegram outbox text. A signed-but-plaintext archive must **not** be placed in a public GitHub repository or a publicly accessible object bucket.

The new `edge-cloudflare/paper-archive-sealed.mjs` protects that preverified, signed archive with AES-256-GCM before any storage or transport decision is made. The module is not reachable through a Worker route and uses no network or filesystem operations.

## Exact safety properties

1. The caller supplies two **distinct** secrets from a private source: an existing archive HMAC signing secret and a separate **32-byte random AES key**, encoded as canonical Base64. Keys are never generated from account names, never embedded in backup output, and never included in GitHub files.
2. A signed JSON archive is schema-checked, HMAC-verified and copied before encryption. Invalid accounting data or a forged signature fails before an encrypted backup envelope can be produced.
3. The envelope uses AES-256-GCM with a fresh random 96-bit nonce and 128-bit authentication tag plus a fixed domain-separating authenticated context. Only `format`, `schema`, `algorithm`, `iv` and `ciphertext` remain readable. No account cash, contract symbols, outbox message or signature is stored in plaintext fields.
4. Opening checks a strict schema, canonical URL-safe Base64, size limits, nonce length and GCM authenticity **before JSON parsing**; then separately HMAC-verifies and audits the signed ledger.
5. Restore delegates to the existing transactional empty-target-only restore. It does **not** replace an existing scheduler, authentication token, market observation, delivery cursor, ledger or archive on a running object. No broker order, paper alert resend or Telegram delivery is initiated.
6. Oversized, malformed, incomplete and wrong-key archives fail closed without exposing contents in error messages. Larger valid archives exercise chunked binary-to-Base64 conversion rather than unbounded JavaScript argument spreading.

## Offline verification

Synthetic tests confirm distinct ciphertext/IV on repeated export, no plaintext markers in the envelope, exact HMAC+AES round trip, tampering and wrong-key rejection, empty-only restore, no scheduler/vault/delivery recovery, and a >16 KB legitimate archive. No live account records were used. **172/172 Cloudflare JavaScript unit tests and 8/8 native workerd SQLite tests passed.** No Python module was changed; the previous full Python result remains **778 passed, 1 skipped**.

## What remains blocked

- **Private independent backup destination:** not selected or connected. Never commit an actual encrypted archive to a public repository without explicit user direction and privacy review. Source code may be stored on GitHub; no user data, keys or protected local-folder contents may be uploaded.
- **Key recovery/rotation:** a lost AES key makes encrypted backups unrecoverable. This code cannot guarantee that the operator has separately saved both keys, rotated them or can decrypt after losing access to a device. Never commit keys or backup codes.
- **Completeness:** scheduler alarm, Kite daily token, actual Telegram delivery state and broker data are intentionally excluded. A restored research ledger cannot safely resume pending delivery or trading automatically.
- **Real operations:** no live cloud host, quota observations, approved backup cadence, remote confidentiality review, off-host restore drill or five real paper sessions.

Thus **fixed checklist item23 remains incomplete**, and Phase25 annual release verification remains incomplete. Engineering checklist **23/25 (92%)**, live acceptance **0/5**. Phase27 is a security checkpoint outside the fixed 25-item checklist, not a claim of full autonomous deployment.
