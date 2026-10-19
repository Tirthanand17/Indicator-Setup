# Phase 22 — private WAL-consistent state snapshots and restart rehearsal

**Status:** implemented and offline-tested; **NO live cloud deployment**. A snapshot is not a live-alert receipt, an authenticated broker record, proof of profits, or a substitute for a durable encrypted storage service.

## Why

SQLite may store recent commits in its `-wal` file rather than the main `alerts.sqlite3` file. Copying only the main database while a cloud worker is active can silently drop queued Telegram alerts, retry history, or quote evidence. The new `cloud_alerts.snapshot` CLI uses SQLite's native `backup()` API to take a consistent point-in-time view across WAL and main database, verifies SQLite integrity and required state tables, and publishes a **new** file atomically. Existing backups are never overwritten.

The snapshot includes SQLite alert message bodies and virtual paper-review records. It **does not** include the separate encrypted Kite access token vault (`token.enc`), `.env`, API keys or Telegram bot token. **A backup is sensitive and is NOT encrypted by this utility**. Use only operator-owned, `0700` directories on an encrypted-at-rest private volume. Do not copy the SQLite database to public GitHub, issue comments, CI artifacts, unsecured Drive locations or logs.

## Safe offline usage (after cloud deployment approval)

Run only on the **approved cloud VM** with a dedicated persistent encrypted volume; prepare the backup directory separately using a secure administrator command. The script itself does not create or change the live database or destination directories.

```bash
cd cloud-alerts
python -m cloud_alerts.snapshot --snapshot \
  --db /data/nifty-alerts/alerts.sqlite3 \
  --output /private-encrypted-backups/alerts-2026-10-19.sqlite3
python -m cloud_alerts.snapshot --verify \
  --db /private-encrypted-backups/alerts-2026-10-19.sqlite3
```

Both source and destination directories must be private (`0700`), local files private (`0600`), owned by the worker, and **different directories**. Source database and existing WAL/SHM siblings must be private regular files rather than symlinks. Output must not already exist. The snapshot is written to a private temporary file, checked, then atomically linked into its final name only if the integrity and expected-schema checks pass. On ordinary failures the temporary file is removed and the original DB is not modified by this command.

The CLI prints only counts of event, REST coverage, and option evidence rows; it does not print message bodies, file paths, tokens, or chat IDs. The result does **not** independently validate the truth of broker data. A missing token vault intentionally means the resumed worker still needs an independently valid daily Kite session token.

## Safe recovery approach

1. Stop the original worker. Verify that the single-worker lock is no longer held. **Never start two workers against separate restored DB copies.**
2. Verify the private backup with `--verify` and confirm snapshot date/currency externally. A valid snapshot may still be too old to restore useful live state.
3. Restore only to a separate, private, persistent directory on the **approved host** using an operator-reviewed process; do not overwrite a running SQLite DB or mix old WAL files with restored snapshots.
4. Run deployment preflight and inspect the sanitized health/readiness endpoints. In particular, expire queued BUY notices older than 180 seconds rather than sending them late.
5. Repeat daily Kite authentication and signed token handoff when required, then test Telegram via a TEST-only request before a paper-market session. This is still read-only; no real orders.

**No automatic restore command is provided:** restoring state is a destructive administrative action and must never be silently triggered by this research prototype.

## Offline evidence

Synthetic tests cover WAL commits without checkpoints, pending-alert restart recovery, correct existing data, rejected missing/broadly accessible/symlink source files, source WAL sidecar permissions, missing/insecure destination directories, no-overwrite safety, invalid/corrupt database, missing required schema, CLI privacy, non-destructive reads and separate backup directory enforcement. No broker calls or Telegram messages.

**Remaining deployment blockers:** obtain an explicitly approved zero-incremental-cost always-on host, durable encrypted storage, public HTTPS ingress plus restricted token route, and actual phone TEST validation. The five real-market paper sessions remain unperformed.
