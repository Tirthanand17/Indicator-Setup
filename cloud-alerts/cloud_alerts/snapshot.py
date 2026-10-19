"""WAL-consistent, private SQLite paper-alert snapshot and offline verification.

A backup includes sensitive Telegram alert contents and market research records.
It deliberately does NOT copy the independent encrypted Kite token vault.
Only run on an operator-approved private host. No network or broker I/O.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sqlite3
import stat
import tempfile
from typing import Final

REQUIRED_TABLES: Final = frozenset({
    'events', 'runtime', 'nonces', 'rest_poll_coverage',
    'option_quote_observations', 'shadow_evidence',
})


class SnapshotError(ValueError):
    """Sanitized snapshot failure, never includes paths or SQLite internals."""


def _private_regular(path: Path) -> None:
    """Reject symlinks, unowned files and group/other access to private DBs."""
    try:
        entry = path.lstat()
    except OSError as exc:
        raise SnapshotError('SOURCE_MISSING_OR_UNREADABLE') from None
    if not stat.S_ISREG(entry.st_mode) or entry.st_uid != os.geteuid():
        raise SnapshotError('SOURCE_NOT_PRIVATE_REGULAR')
    if stat.S_IMODE(entry.st_mode) & 0o077:
        raise SnapshotError('SOURCE_PERMISSIONS_TOO_OPEN')


def _private_directory(path: Path) -> None:
    try:
        entry = path.lstat()
    except OSError:
        raise SnapshotError('DESTINATION_DIRECTORY_MISSING') from None
    if not stat.S_ISDIR(entry.st_mode) or entry.st_uid != os.geteuid():
        raise SnapshotError('DESTINATION_DIRECTORY_NOT_PRIVATE')
    if stat.S_IMODE(entry.st_mode) & 0o077 or not (entry.st_mode & stat.S_IWUSR):
        raise SnapshotError('DESTINATION_DIRECTORY_NOT_PRIVATE')


def _private_source(path: Path) -> None:
    _private_regular(path)
    try:
        _private_directory(path.parent)
    except SnapshotError:
        raise SnapshotError('SOURCE_DIRECTORY_NOT_PRIVATE') from None
    # SQLite may still have live WAL and SHM sidecars with message text.
    # The backup API reads them consistently; require private regular files.
    for suffix in ('-wal', '-shm'):
        sidecar = Path(str(path) + suffix)
        if sidecar.is_symlink() or sidecar.exists():
            try:
                _private_regular(sidecar)
            except SnapshotError:
                raise SnapshotError('SOURCE_SIDECAR_NOT_PRIVATE') from None


def _read_only(path: Path) -> sqlite3.Connection:
    # Path.as_uri handles URI encoding for spaces and reserved characters.
    # The DB path has already been verified regular and never a symlink.
    db = sqlite3.connect(f'{path.resolve().as_uri()}?mode=ro', uri=True, timeout=10)
    db.execute('PRAGMA query_only=ON')
    return db


def _verify_open(db: sqlite3.Connection) -> dict:
    integrity = db.execute('PRAGMA integrity_check').fetchone()
    if integrity != ('ok',):
        raise SnapshotError('SQLITE_INTEGRITY_CHECK_FAILED')
    names = {name for (name,) in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
    if not REQUIRED_TABLES.issubset(names):
        raise SnapshotError('REQUIRED_STATE_TABLES_MISSING')
    # Aggregated, privacy-limited row counts. Do not SELECT messages or tokens.
    return {
        'snapshot_verified': True,
        'integrity_check': 'PASS',
        'contains_sensitive_message_data': True,
        'broker_token_vault_copied': False,
        'market_data_or_phone_receipt_verified': False,
        'broker_orders_enabled': False,
        'event_rows': db.execute('SELECT COUNT(*) FROM events').fetchone()[0],
        'rest_boundary_rows': db.execute('SELECT COUNT(*) FROM rest_poll_coverage').fetchone()[0],
        'option_quote_rows': db.execute('SELECT COUNT(*) FROM option_quote_observations').fetchone()[0],
    }


def verify_snapshot(file: Path | str) -> dict:
    """Validate a private existing snapshot without writing or changing it."""
    src = Path(file)
    _private_source(src)
    try:
        with _read_only(src) as db:
            return _verify_open(db)
    except (sqlite3.Error, OSError):
        raise SnapshotError('SQLITE_SNAPSHOT_UNREADABLE') from None


def create_snapshot(source: Path | str, destination: Path | str) -> dict:
    """Copy a live WAL-mode SQLite DB via backup API, then publish atomically.

    Only a private 0700 operator-owned destination directory may receive the
    snapshot. Existing destinations are NEVER overwritten. The temporary file
    remains private and is removed on failure. Atomic hard link prevents a
    race with another process that creates the same destination name.
    """
    src, dest = Path(source), Path(destination)
    _private_source(src)
    _private_directory(dest.parent)
    if dest.name in ('', '.', '..') or dest.suffix not in ('.db', '.sqlite', '.sqlite3'):
        raise SnapshotError('DESTINATION_FILENAME_INVALID')
    if src.absolute() == dest.absolute():
        raise SnapshotError('SOURCE_AND_DESTINATION_SAME')
    if src.parent.resolve() == dest.parent.resolve():
        raise SnapshotError('DESTINATION_MUST_USE_SEPARATE_PRIVATE_DIRECTORY')
    if dest.is_symlink() or dest.exists():
        raise SnapshotError('DESTINATION_ALREADY_EXISTS')
    fd, temp_name = tempfile.mkstemp(prefix='.nifty-snapshot-', suffix='.sqlite3',
                                    dir=dest.parent)
    os.close(fd)
    temp = Path(temp_name)
    try:
        try:
            with _read_only(src) as inbound, sqlite3.connect(temp, timeout=15) as outgoing:
                inbound.backup(outgoing, pages=128, sleep=0.05)
            # Close first to ensure data is flushed and read from the actual snapshot.
            with _read_only(temp) as candidate:
                report = _verify_open(candidate)
            os.chmod(temp, 0o600)
            # POSIX link(2) is atomic & fails if destination already exists.
            # Both names live in the same directory/filesystem.
            os.link(temp, dest, follow_symlinks=False)
            return report
        except FileExistsError:
            raise SnapshotError('DESTINATION_ALREADY_EXISTS') from None
        except (sqlite3.Error, OSError):
            raise SnapshotError('SQLITE_SNAPSHOT_FAILED') from None
    finally:
        temp.unlink(missing_ok=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Offline, private WAL-consistent SQLite backup')
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--snapshot', action='store_true', help='create new backup; never overwrite')
    action.add_argument('--verify', action='store_true', help='read-only verification')
    parser.add_argument('--db', required=True, help='private source DB or backup to verify')
    parser.add_argument('--output', help='private new destination .sqlite3; only with --snapshot')
    args = parser.parse_args(argv)
    if (args.snapshot and not args.output) or (args.verify and args.output):
        parser.exit(2, 'Snapshot rejected: invalid command combination.\n')
    try:
        report = (create_snapshot(args.db, args.output) if args.snapshot
                  else verify_snapshot(args.db))
    except SnapshotError as exc:
        print(json.dumps({'snapshot_verified': False, 'reason': str(exc),
                          'contains_credentials_in_output': False}, sort_keys=True))
        return 2
    print(json.dumps(report, sort_keys=True, separators=(',', ':')))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
