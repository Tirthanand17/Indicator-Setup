"""Fail-closed deployment checks for the cloud-only read-only Kite alert worker.

No Kite or Telegram requests, and no secret values are ever reported.
A real persistent mount cannot be established merely by checking that a path
exists; container overlay/tmpfs storage must be rejected before activation.
This is not a substitute for an operator's explicit no-charge hosting approval.
"""
from __future__ import annotations

from dataclasses import dataclass
import argparse
import json
import os
from pathlib import Path
import stat
import tempfile
from typing import Mapping

from cryptography.fernet import Fernet


MIN_FREE_BYTES = 100 * 1024 * 1024
SENSITIVE_FILES = ('token.enc', 'alerts.sqlite3')


@dataclass(frozen=True)
class Result:
    ready: bool
    checks: tuple[str, ...]
    blockers: tuple[str, ...]

    def public_report(self) -> dict:
        return {
            'preflight': 'PASS' if self.ready else 'BLOCKED',
            'mode': 'READ_ONLY_PAPER',
            'broker_orders_enabled': False,
            'network_requests_made': False,
            'passed_checks': list(self.checks),
            'blockers': list(self.blockers),
            'secret_values_in_report': False,
            'cloud_host_approved_by_this_check': False,
        }


def persistent_mount(path: Path, mountinfo: str) -> bool:
    """True only for a non-overlay, non-tmpfs, non-root mount covering STATE_DIR.

    `mountinfo` is normally /proc/self/mountinfo; allow injected content in
    tests. Container writable image layers and /tmp are NOT durable volumes.
    """
    target = os.path.realpath(path)
    chosen = ('', '')
    for line in mountinfo.splitlines():
        if ' - ' not in line:
            continue
        front, back = line.split(' - ', 1)
        left, right = front.split(), back.split()
        if len(left) < 5 or not right:
            continue
        mount = left[4].replace('\\040', ' ').replace('\\011', '\t')
        mount = os.path.normpath(mount)
        if mount == target or target.startswith(mount.rstrip('/') + '/'):
            if len(mount) > len(chosen[0]):
                chosen = (mount, right[0])
    mount, fs = chosen
    return bool(mount and mount != '/' and fs not in {'overlay', 'tmpfs', 'ramfs', 'squashfs', 'aufs'})


def _valid_secrets(env: Mapping[str, str]) -> list[str]:
    problems: list[str] = []
    if not env.get('KITE_API_KEY', '').strip():
        problems.append('MISSING_KITE_API_KEY')
    if not env.get('TELEGRAM_BOT_TOKEN', '').strip():
        problems.append('MISSING_TELEGRAM_BOT_TOKEN')
    if not env.get('TELEGRAM_CHAT_ID', '').strip():
        problems.append('MISSING_TELEGRAM_CHAT_ID')
    if len(env.get('TOKEN_RELAY_HMAC_KEY', '')) < 32:
        problems.append('INVALID_TOKEN_RELAY_HMAC_KEY')
    try:
        Fernet(env.get('TOKEN_VAULT_KEY', '').encode('ascii'))
    except (ValueError, TypeError, UnicodeError):
        problems.append('INVALID_TOKEN_VAULT_KEY')
    for name in ('ALERTS_ENABLED', 'KITE_SHADOW_ENABLED', 'PAPER_PREMIUM_TRACKING_ENABLED'):
        if env.get(name, 'false').strip().lower() not in {'true', 'false'}:
            problems.append('INVALID_BOOLEAN_' + name)
    return problems


def check_deployment(env: Mapping[str, str], *, mountinfo: str | None = None,
                     min_free_bytes: int = MIN_FREE_BYTES,
                     probe_write: bool = True) -> Result:
    """Inspect a cloud host; only a temporary local mount probe may be written.

    NEVER pass the protected Windows trading project path as STATE_DIR. The
    expected STATE_DIR is the cloud worker's dedicated private volume.
    """
    blockers = _valid_secrets(env)
    passed: list[str] = []
    if not _valid_secrets(env):
        passed.append('SECRET_NAMES_AND_FORMATS')
    path = Path(env.get('STATE_DIR') or '/data/nifty-alerts')
    if not path.is_absolute():
        blockers.append('STATE_DIR_NOT_ABSOLUTE')
    if path.is_symlink():
        blockers.append('STATE_DIR_SYMLINK')
    if not path.is_dir():
        blockers.append('STATE_DIR_NOT_EXISTING_DIRECTORY')
        return Result(False, tuple(passed), tuple(dict.fromkeys(blockers)))
    try:
        s = path.stat()
        if not stat.S_ISDIR(s.st_mode):
            blockers.append('STATE_DIR_NOT_DIRECTORY')
        if os.geteuid() != s.st_uid:
            blockers.append('STATE_DIR_NOT_OWNED_BY_WORKER')
        if stat.S_IMODE(s.st_mode) & 0o077:
            blockers.append('STATE_DIR_PERMISSIONS_TOO_OPEN')
        if (s.st_mode & stat.S_IWUSR) == 0:
            blockers.append('STATE_DIR_NOT_OWNER_WRITABLE')
    except OSError:
        blockers.append('STATE_DIR_INACCESSIBLE')
    if not any(x.startswith('STATE_DIR_') for x in blockers):
        passed.append('PRIVATE_WORKER_OWNED_DIRECTORY')

    for filename in SENSITIVE_FILES:
        secret_path = path / filename
        if secret_path.is_symlink():
            blockers.append('SENSITIVE_FILE_SYMLINK_' + filename.upper().replace('.', '_'))
        elif secret_path.exists() and not secret_path.is_file():
            blockers.append('SENSITIVE_FILE_NOT_REGULAR_' + filename.upper().replace('.', '_'))

    if mountinfo is None:
        try:
            mountinfo = Path('/proc/self/mountinfo').read_text(encoding='utf-8')
        except OSError:
            mountinfo = ''
    if not persistent_mount(path, mountinfo):
        blockers.append('PERSISTENT_NON_EPHEMERAL_MOUNT_NOT_VERIFIED')
    else:
        passed.append('PERSISTENT_MOUNT_DETECTED')

    try:
        stats = os.statvfs(path)
        if stats.f_bavail * stats.f_frsize < min_free_bytes:
            blockers.append('INSUFFICIENT_PERSISTENT_STORAGE')
        else:
            passed.append('MINIMUM_FREE_STORAGE')
    except OSError:
        blockers.append('FREE_STORAGE_UNKNOWN')

    if probe_write and not blockers:
        # Only the dedicated cloud volume is probed. The protected Windows
        # source .env is never read or changed here.
        try:
            fd, probe = tempfile.mkstemp(prefix='.nifty-preflight-', dir=path)
            try:
                os.write(fd, b'cloud-volume-write-check\n')
                os.fsync(fd)
            finally:
                os.close(fd)
                os.unlink(probe)
            passed.append('WRITE_FSYNC_CLEANUP')
        except OSError:
            blockers.append('PERSISTENT_VOLUME_WRITE_FAILED')
    return Result(not blockers, tuple(passed), tuple(dict.fromkeys(blockers)))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Read-only broker cloud deployment preflight')
    parser.add_argument('--json', action='store_true', help='emit safe JSON with blocker codes only')
    args = parser.parse_args(argv)
    result = check_deployment(os.environ)
    if args.json:
        print(json.dumps(result.public_report(), sort_keys=True))
    else:
        print('NIFTY CLOUD PREFLIGHT: ' + ('PASS' if result.ready else 'BLOCKED'))
        for code in result.blockers:
            print('BLOCKER: ' + code)
        print('No broker calls, alerts, credentials or orders were processed')
    return 0 if result.ready else 2


if __name__ == '__main__':
    raise SystemExit(main())
