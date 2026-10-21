"""Adversarial crash-recovery journal tests; no HTTP, broker orders or secrets."""
from datetime import datetime,timedelta,timezone
import sqlite3
import pytest
from cloud_alerts.paper_integrity import (
    initialize_activation,audit_entry_coverage,recover_missing_outcomes)

NOW=datetime(2026,10,21,10,tzinfo=timezone.utc)


def setup_journal(tmp_path):
    path=str(tmp_path/'journal.db')
    with sqlite3.connect(path) as db:
        db.executescript('''CREATE TABLE runtime(key TEXT PRIMARY KEY,value TEXT);
            CREATE TABLE events(event_id TEXT PRIMARY KEY,status TEXT,at TEXT,payload TEXT DEFAULT '');
            CREATE TABLE paper_positions(account_id TEXT,signal_id TEXT);
            CREATE TABLE paper_rejections(account_id TEXT,signal_id TEXT,at TEXT,reason TEXT);''')
    initialize_activation(path,NOW-timedelta(minutes=10))
    with sqlite3.connect(path) as db:
        db.execute('INSERT INTO events(event_id,status,at) VALUES(?,?,?)',
                   ('NIFTY-REVIEW','REVIEW_CE',(NOW-timedelta(minutes=5)).isoformat()))
    return path


def test_position_and_rejection_for_same_account_fails_closed(tmp_path):
    path=setup_journal(tmp_path)
    with sqlite3.connect(path) as db:
        db.execute('INSERT INTO paper_positions VALUES(?,?)',('PAPER_50K','NIFTY-REVIEW'))
        db.execute('INSERT INTO paper_rejections VALUES(?,?,?,?)',
                   ('PAPER_50K','NIFTY-REVIEW',NOW.isoformat(),'CONFLICT'))
    with pytest.raises(RuntimeError,match='Contradictory'):
        audit_entry_coverage(path)
    with pytest.raises(RuntimeError,match='Contradictory'):
        recover_missing_outcomes(path,NOW)


def test_unknown_account_on_review_blocks_automated_recovery(tmp_path):
    path=setup_journal(tmp_path)
    with sqlite3.connect(path) as db:
        db.execute('INSERT INTO paper_positions VALUES(?,?)',('PAPER_OTHER','NIFTY-REVIEW'))
    with pytest.raises(RuntimeError,match='Unknown'):
        audit_entry_coverage(path)
    with pytest.raises(RuntimeError,match='Unknown'):
        recover_missing_outcomes(path,NOW)


def test_recovery_sqlite_failure_rolls_back_all_affected_accounts(tmp_path):
    path=setup_journal(tmp_path)
    with sqlite3.connect(path) as db:
        db.execute("""CREATE TRIGGER fail_second BEFORE INSERT ON paper_rejections
             WHEN NEW.account_id='PAPER_100K'
             BEGIN SELECT RAISE(ABORT,'injected-error'); END;""")
    with pytest.raises(sqlite3.DatabaseError):
        recover_missing_outcomes(path,NOW)
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT COUNT(*) FROM paper_rejections').fetchone()[0]==0
        assert db.execute("SELECT COUNT(*) FROM events WHERE status='PAPER_RECOVERY'").fetchone()[0]==0
