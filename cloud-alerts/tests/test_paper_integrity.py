"""Synthetic paper restart recovery: no broker HTTP or live order placement."""
from datetime import datetime,timedelta,timezone
import sqlite3
import pytest
from cloud_alerts.paper_integrity import initialize_activation,audit_entry_coverage,recover_missing_outcomes

NOW=datetime(2026,10,21,10,0,tzinfo=timezone.utc)

@pytest.fixture
def ledger(tmp_path):
    path=str(tmp_path/'paper.db')
    with sqlite3.connect(path) as db:
        db.executescript('''CREATE TABLE runtime(key TEXT PRIMARY KEY,value TEXT);
            CREATE TABLE paper_positions(account_id TEXT,signal_id TEXT);
            CREATE TABLE paper_rejections(account_id TEXT,signal_id TEXT,at TEXT,reason TEXT);
            CREATE TABLE events(event_id TEXT PRIMARY KEY,at TEXT,status TEXT,payload TEXT DEFAULT '');''')
    return path

def event(path,name='NIFTY:2026-10-21:REVIEW_CE',*,offset=1,status='REVIEW_CE'):
    with sqlite3.connect(path) as db:
        db.execute('INSERT INTO events(event_id,at,status) VALUES(?,?,?)',
                   (name,(NOW+timedelta(seconds=offset)).isoformat(),status))
    return name

def result(path,account,name,*,rejected=False):
    table=('paper_rejections(account_id,signal_id)' if rejected else 'paper_positions')
    with sqlite3.connect(path) as db:
        db.execute('INSERT INTO '+table+' VALUES(?,?)',(account,name))

def test_not_activated_is_not_ready(ledger):
    assert audit_entry_coverage(ledger)['new_entries_permitted'] is False

def test_new_activation_is_immutable(ledger):
    marker=initialize_activation(ledger,NOW)
    assert marker==NOW.isoformat(timespec='microseconds')
    assert initialize_activation(ledger,NOW+timedelta(days=1))==marker
    assert audit_entry_coverage(ledger)['status']=='COMPLETE'

def test_old_review_only_alert_ignored_before_activation(ledger):
    event(ledger,offset=-10)
    initialize_activation(ledger,NOW)
    assert audit_entry_coverage(ledger)['reviews_checked']==0

def test_one_account_written_then_crash_blocks(ledger):
    initialize_activation(ledger,NOW)
    e=event(ledger);result(ledger,'PAPER_50K',e)
    a=audit_entry_coverage(ledger)
    assert a['status']=='PARTIAL_BASKET' and a['missing_account_outcomes']==1
    assert a['new_entries_permitted'] is False

def test_valid_rejection_counts_as_account_outcome(ledger):
    initialize_activation(ledger,NOW)
    e=event(ledger)
    result(ledger,'PAPER_50K',e)
    result(ledger,'PAPER_100K',e,rejected=True)
    assert audit_entry_coverage(ledger)['status']=='COMPLETE'

def test_claimed_review_without_simulated_outcome_blocks(ledger):
    initialize_activation(ledger,NOW)
    event(ledger)
    assert audit_entry_coverage(ledger)['missing_account_outcomes']==2

def test_existing_paper_trades_without_activation_epoch_rejected(ledger):
    result(ledger,'PAPER_50K','legacy')
    with pytest.raises(RuntimeError):
        initialize_activation(ledger,NOW)

def test_corrupt_review_clock_is_not_treated_as_success(ledger):
    initialize_activation(ledger,NOW)
    with sqlite3.connect(ledger) as db:
        db.execute('INSERT INTO events(event_id,at,status) VALUES(?,?,?)',
                   ('bad-time','invalid','REVIEW_CE'))
    with pytest.raises(RuntimeError):
        audit_entry_coverage(ledger)

def test_bounded_audit_counts_not_broker_secrets(ledger):
    initialize_activation(ledger,NOW)
    for i in range(6):event(ledger,'E'+str(i),offset=i+1)
    event(ledger,'SENT',status='PAPER_ENTRY')
    summary=audit_entry_coverage(ledger,max_examples=2)
    assert summary['missing_account_outcomes']==12 and summary['sample_count']==2
    with pytest.raises(ValueError):audit_entry_coverage(ledger,max_examples=50)

def test_timezone_equivalence_not_string_comparison(ledger):
    with sqlite3.connect(ledger) as db:
        db.execute('INSERT INTO events(event_id,at,status) VALUES(?,?,?)',
                   ('old','2026-10-21T15:29:00+05:30','REVIEW_CE'))
    initialize_activation(ledger,NOW)
    assert audit_entry_coverage(ledger)['reviews_checked']==0

def test_old_partial_entry_recovers_as_missed_without_moving_cash(ledger):
    initialize_activation(ledger,NOW)
    e=event(ledger);result(ledger,'PAPER_50K',e)
    recovered=recover_missing_outcomes(ledger,NOW+timedelta(minutes=4))
    assert recovered['recovered']==1 and recovered['new_entries_permitted']
    assert audit_entry_coverage(ledger)['status']=='COMPLETE'
    with sqlite3.connect(ledger) as db:
        assert db.execute('SELECT reason FROM paper_rejections').fetchone()==('CRASH_GAP_NO_SIMULATED_FILL',)
        assert db.execute('SELECT COUNT(*) FROM paper_positions').fetchone()[0]==1
        assert db.execute("SELECT COUNT(*) FROM events WHERE status='PAPER_RECOVERY'").fetchone()[0]==1

def test_grace_prevents_marking_an_active_review_as_missed(ledger):
    initialize_activation(ledger,NOW)
    event(ledger)
    value=recover_missing_outcomes(ledger,NOW+timedelta(seconds=20))
    assert value['status']=='WAIT_GRACE' and value['pending_grace']==2
    with sqlite3.connect(ledger) as db:
        assert db.execute('SELECT COUNT(*) FROM paper_rejections').fetchone()[0]==0

def test_repeat_restart_recovery_idempotent(ledger):
    initialize_activation(ledger,NOW)
    event(ledger)
    first=recover_missing_outcomes(ledger,NOW+timedelta(minutes=5))
    second=recover_missing_outcomes(ledger,NOW+timedelta(minutes=5))
    assert first['recovered']==2 and second['recovered']==0
    with sqlite3.connect(ledger) as db:
        assert db.execute('SELECT COUNT(*) FROM paper_rejections').fetchone()[0]==2
        assert db.execute("SELECT COUNT(*) FROM events WHERE status='PAPER_RECOVERY'").fetchone()[0]==1

def test_future_dated_review_fails_closed(ledger):
    initialize_activation(ledger,NOW)
    event(ledger,offset=1000)
    with pytest.raises(RuntimeError):
        recover_missing_outcomes(ledger,NOW)
