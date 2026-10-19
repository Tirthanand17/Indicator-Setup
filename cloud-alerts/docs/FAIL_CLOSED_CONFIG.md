# Fail-closed cloud configuration and private state — Phase 13

**Status:** offline implementation and tests only. No cloud deployment, paid bill, real Kite request or phone delivery is implied.

## Threats addressed

1. Operator inadvertently copies example `REPLACE_WITH_...` strings into cloud secret storage; the previous preflight accepted certain nonempty placeholder strings.
2. A direct ASGI startup skips the Docker preflight; the application previously had weaker runtime configuration checks than the container preflight.
3. A previously created SQLite DB/WAL/SHM, encrypted token or worker lock is group/world-readable or points to a symlink.
4. Newly created files inherit a permissive default shell `umask` even on a private mount.

## Controls implemented

- Shared `configuration_blockers()` produces **codes only**, never credential values. It rejects missing/placeholder settings, too-short relay keys, invalid Fernet keys, and malformed flags. When enabled, it additionally checks Kite key and Telegram bot/chat syntax and rules out single-character repeated relay keys. **These are syntactic checks**, not live authentication or proof of adequate entropy.
- `AppSettings.validate` invokes the same guard as `preflight`. Invalid configurations fail before constructing live state, Kite or Telegram connections.
- `preflight` rejects sensitive files that are symlinks, not regular files, owned by another UID or group/world accessible. It does not repair or delete them; the operator must verify custody and correct permissions separately.
- Docker `CMD` sets `umask 077` before preflight and Uvicorn. The container remains a **single worker**, with localhost-only ingress, no public raw token endpoint, dropped capabilities and a private mounted volume.

## How to validate offline (no broker or phone calls)

```bash
cd cloud-alerts
python -m pytest -q
python -m cloud_alerts.preflight --json  # expected to report BLOCKED on ordinary dev hosts
```

Inspect only the safe blocker-code output. Never paste values from protected `.env`, your cloud secret manager or Telegram/Kite tokens into chat or GitHub.

## Critical limitations

- Neither `/healthz`, `/readyz` nor passing preflight proves phone receipt or a profitable trade.
- The single-worker file lock coordinates only processes sharing the **same** volume. It does not prevent two cloud hosts with different volumes from operating simultaneously.
- The source repo and tests do not provision, verify or finance an Always Free VM. Hosting approval, HTTPS reverse proxy, encrypted token transfer, access-control verification, persistence restart testing and market-session evidence remain separate prerequisites.
- The original `Automation Day Trading` folder is exclusively read-only. No copy of its `.env` should be added to GitHub.
