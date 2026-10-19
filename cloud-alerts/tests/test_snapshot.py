"""Snapshot safety and restart recovery: no broker or Telegram traffic."""
from __future__ import annotations
from datetime import datetime
from pathlib import Path
import os
import sqlite3
from zoneinfo import ZoneInfo
import pytest

from cloud_alerts.snapshot import create_snapshot, verify_snapshot, SnapshotError, main
from cloud_alerts.state import State

IST = ZoneInfo('Asia/Kolkata')
WHEN = datetime(2026, 10, 19, 10, 5, tzinfo=IST)


def source(tmp_path):
    path = tmp_path / 'live.db'
    state = State(str(path))
    path.chmod(0o600)
    return state, path


def private_dir(tmp_path):
    folder = tmp_path / 'private-snapshots'
    folder.mkdir(mode=0o700)
    return folder


def test_wal_consistent_backup_preserves_queued_alert_after_restart(tmp_path):
    state, path = source(tmp_path)
    private = private_dir(tmp_path)
    # A second open SQLite writer commits to the WAL file, with no checkpoint.
    with sqlite3.connect(path) as conn:
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('PRAGMA wal_autocheckpoint=0')
        conn.execute('INSERT INTO events(event_id,status,at,payload) VALUES(?,?,?,?)',
                     ('evt', 'REVIEW_PE', WHEN.isoformat(), 'PRIVATE PAPER ALERT'))
        conn.commit()
        output = private / 'backup.sqlite3'
        result = create_snapshot(path, output)
        assert result['event_rows'] == 1
    assert output.stat().st_mode & 0o077 == 0
    backup_state = State(str(output))
    assert backup_state.event_delivery_status('evt') == 0
    assert backup_state.pending_events() == [('evt', 'PRIVATE PAPER ALERT')]
    assert verify_snapshot(output)['snapshot_verified'] is True


def test_existing_backup_never_overwritten(tmp_path):
    _state, src = source(tmp_path)
    dst = private_dir(tmp_path) / 'backup.db'
    create_snapshot(src, dst)
    original = dst.read_bytes()
    with pytest.raises(SnapshotError, match='ALREADY_EXISTS'):
        create_snapshot(src, dst)
    assert dst.read_bytes() == original


def test_rejects_missing_insecure_or_symlink_source(tmp_path):
    state, src = source(tmp_path)
    dst = private_dir(tmp_path) / 'new.db'
    src.chmod(0o644)
    with pytest.raises(SnapshotError, match='PERMISSIONS_TOO_OPEN'):
        create_snapshot(src, dst)
    src.chmod(0o600)
    link = tmp_path / 'linked.db'
    link.symlink_to(src)
    with pytest.raises(SnapshotError, match='NOT_PRIVATE_REGULAR'):
        create_snapshot(link, dst)
    with pytest.raises(SnapshotError, match='SOURCE_MISSING'):
        verify_snapshot(tmp_path / 'nothing.db')


def test_rejects_insecure_symlink_missing_backup_directories(tmp_path):
    _state, src = source(tmp_path)
    folder = private_dir(tmp_path)
    folder.chmod(0o755)
    with pytest.raises(SnapshotError, match='DESTINATION_DIRECTORY_NOT_PRIVATE'):
        create_snapshot(src, folder / 'x.db')
    folder.chmod(0o700)
    link = tmp_path / 'alias'
    link.symlink_to(folder, target_is_directory=True)
    with pytest.raises(SnapshotError, match='DESTINATION_DIRECTORY_NOT_PRIVATE'):
        create_snapshot(src, link / 'x.db')
    with pytest.raises(SnapshotError, match='DESTINATION_DIRECTORY_MISSING'):
        create_snapshot(src, tmp_path / 'absent' / 'x.db')


def test_invalid_sqlite_backup_is_rejected_without_overwriting(tmp_path):
    _state, src = source(tmp_path)
    folder = private_dir(tmp_path)
    rogue = folder / 'fake.sqlite3'
    rogue.write_bytes(b'THIS IS NOT SQLITE')
    rogue.chmod(0o600)
    with pytest.raises(SnapshotError, match='SQLITE_SNAPSHOT_UNREADABLE'):
        verify_snapshot(rogue)
    with pytest.raises(SnapshotError, match='DESTINATION_ALREADY_EXISTS'):
        create_snapshot(src, rogue)


def test_empty_sqlite_db_lacks_required_tables(tmp_path):
    folder=private_dir(tmp_path)
    f=folder / 'empty.db'
    with sqlite3.connect(f):
        pass
    f.chmod(0o600)
    with pytest.raises(SnapshotError, match='REQUIRED_STATE_TABLES_MISSING'):
        verify_snapshot(f)


def test_invalid_destination_extension_rejected(tmp_path):
    _state, src = source(tmp_path)
    folder = private_dir(tmp_path)
    with pytest.raises(SnapshotError, match='DESTINATION_FILENAME_INVALID'):
        create_snapshot(src, folder / 'passwords.txt')


def test_cli_sanitizes_message_contents_and_verification(tmp_path, capsys):
    state, src = source(tmp_path)
    state.claim_event('id', 'REVIEW_CE', WHEN, 'DONT_EVER_PRINT_THIS_TEXT')
    dst = private_dir(tmp_path) / 'backup.db'
    assert main(['--snapshot', '--db', str(src), '--output', str(dst)]) == 0
    assert main(['--verify', '--db', str(dst)]) == 0
    stdout = capsys.readouterr().out
    assert 'DONT_EVER_PRINT_THIS_TEXT' not in stdout
    assert '"event_rows":1' in stdout
    assert '"broker_token_vault_copied":false' in stdout


def test_failed_command_does_not_log_private_paths(tmp_path,capsys):
    secret_name=tmp_path / 'PRIVATE_DIRECTORY_NOT_FOR_LOGS' / 'x.sqlite3'
    assert main(['--verify','--db',str(secret_name)]) == 2
    output=capsys.readouterr().out
    assert 'PRIVATE_DIRECTORY_NOT_FOR_LOGS' not in output
    assert 'SOURCE_MISSING_OR_UNREADABLE' in output


def test_db_not_modified_by_snapshot(tmp_path):
    state, src = source(tmp_path)
    folder=private_dir(tmp_path)
    state.claim_event('a','REVIEW_CE',WHEN,'message')
    original=src.read_bytes()
    create_snapshot(src,folder / 'snap.sqlite3')
    assert src.read_bytes()==original
    assert state.event_delivery_status('a') == 0


def test_source_directory_and_wal_sidecars_must_be_private(tmp_path):
    _state, src = source(tmp_path)
    target = private_dir(tmp_path) / 'backup.db'
    tmp_path.chmod(0o755)
    with pytest.raises(SnapshotError, match='SOURCE_DIRECTORY_NOT_PRIVATE'):
        create_snapshot(src, target)
    tmp_path.chmod(0o700)
    sidecar = Path(str(src)+'-wal')
    sidecar.write_text('stub',encoding='utf-8')
    sidecar.chmod(0o644)
    with pytest.raises(SnapshotError,match='SOURCE_SIDECAR_NOT_PRIVATE'):
        create_snapshot(src,target)
    sidecar.unlink()


def test_same_live_directory_not_accepted_as_backups(tmp_path):
    _state, src = source(tmp_path)
    with pytest.raises(SnapshotError,match='DESTINATION_MUST_USE_SEPARATE_PRIVATE_DIRECTORY'):
        create_snapshot(src,tmp_path / 'backup.sqlite3')
