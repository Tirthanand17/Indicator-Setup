"""Phase 43 integration with the actual alert and paper SQLite schemas.

Synthetic NIFTY option books only; no Kite orders, network, real credentials.
"""
from datetime import timedelta
from zoneinfo import ZoneInfo
import sqlite3
import pytest

from cloud_alerts.paper_book import PaperBook
from cloud_alerts.paper_integrity import (
    initialize_activation,audit_entry_coverage,recover_missing_outcomes,audit_cash_reconciliation)
from cloud_alerts.state import State
from cloud_alerts.models import Contract,OptionQuote
from test_simulated_broker_pipeline import engine as create_engine,NOW

SIGNAL='NIFTY26OCTFUT:2026-10-19T11:55:00+05:30:REVIEW_CE'

def quote(at):
    contract=Contract(token=779,symbol='NIFTY26OCT23000CE',expiry='2026-10-27',
                      lot_size=65,strike=23000,kind='CE')
    return OptionQuote(contract,99.0,100.0,65,65,at)


def test_actual_state_and_book_detect_partial_review_and_recover(tmp_path):
    path=str(tmp_path/'state.db')
    state=State(path)
    book=PaperBook(path)
    initialize_activation(path,NOW-timedelta(minutes=10))
    state.claim_event(SIGNAL,'REVIEW_CE',NOW,'SIMULATED REVIEW')
    first=book.enter(SIGNAL,quote(NOW),NOW,account_id='PAPER_50K')
    assert first['status']=='OPEN'
    before=book.dashboard()['accounts'][0]['available_cash_rs']
    assert audit_entry_coverage(path)['missing_account_outcomes']==1
    # Simulate crash and completely new process-level objects on the same WAL.
    del state,book
    State(path)
    resumed=PaperBook(path)
    repair=recover_missing_outcomes(path,NOW+timedelta(minutes=4))
    assert repair['recovered']==1 and repair['new_entries_permitted']
    assert audit_entry_coverage(path)['status']=='COMPLETE'
    assert resumed.dashboard()['accounts'][0]['available_cash_rs']==before
    assert resumed.dashboard()['accounts'][1]['available_cash_rs']==100000
    assert len(resumed.open_positions())==1
    with sqlite3.connect(path) as db:
        row=db.execute('SELECT reason FROM paper_rejections WHERE account_id=?',
                       ('PAPER_100K',)).fetchone()
        assert row==('CRASH_GAP_NO_SIMULATED_FILL',)
        assert db.execute("SELECT COUNT(*) FROM events WHERE status='PAPER_RECOVERY'").fetchone()[0]==1


@pytest.mark.asyncio
async def test_worker_blocks_new_signal_until_old_review_is_reconciled(tmp_path,monkeypatch):
    worker=create_engine(tmp_path,monkeypatch)
    worker.paper_book=PaperBook(worker.db.path)
    worker.paper_integrity_enforced=True
    initialize_activation(worker.db.path,NOW-timedelta(minutes=10))
    worker.db.claim_event('SYNTHETIC_CRASH_20261019_REVIEW','REVIEW_CE',
                          NOW-timedelta(seconds=20),'PAPER ONLY')
    await worker.run_once(NOW)
    assert worker.paper_status=='WAIT_PAPER_RECONCILIATION'
    assert worker.status=='WAIT_DATA'
    assert worker.paper_book.open_positions()==[]
    audit=audit_entry_coverage(worker.db.path)
    assert audit['status']=='PARTIAL_BASKET'
    # Only after the no-backdating grace expires can new paper monitoring resume.
    await worker.run_once(NOW+timedelta(minutes=4))
    repaired=audit_entry_coverage(worker.db.path)
    assert repaired['status']=='COMPLETE'
    assert worker.paper_book.open_positions()==[]
    with sqlite3.connect(worker.db.path) as db:
        assert db.execute("SELECT COUNT(*) FROM paper_rejections WHERE reason='CRASH_GAP_NO_SIMULATED_FILL'").fetchone()[0]==2

@pytest.mark.asyncio
async def test_local_crash_recovery_runs_even_without_today_kite_token(tmp_path,monkeypatch):
    worker=create_engine(tmp_path,monkeypatch)
    worker.paper_book=PaperBook(worker.db.path)
    worker.paper_integrity_enforced=True
    initialize_activation(worker.db.path,NOW-timedelta(minutes=10))
    worker.db.claim_event('SYNTHETIC_OLD_REVIEW','REVIEW_PE',
                          NOW-timedelta(minutes=4),'PAPER ONLY TEST')
    monkeypatch.setattr(worker.vault,'get',lambda observed:None)
    await worker.run_once(NOW)
    assert worker.status=='WAIT_TOKEN'
    assert audit_entry_coverage(worker.db.path)['status']=='COMPLETE'
    assert worker.paper_book.open_positions()==[]
    with sqlite3.connect(worker.db.path) as db:
        assert db.execute("SELECT COUNT(*) FROM paper_rejections WHERE reason='CRASH_GAP_NO_SIMULATED_FILL'").fetchone()[0]==2

def test_after_hours_crash_recovery_uses_no_broker_or_fabricated_fill(tmp_path,monkeypatch):
    worker=create_engine(tmp_path,monkeypatch)
    worker.paper_book=PaperBook(worker.db.path)
    worker.paper_integrity_enforced=True
    initialize_activation(worker.db.path,NOW-timedelta(minutes=10))
    source='SYNTHETIC_REVIEW_NEAR_CLOSE'
    worker.db.claim_event(source,'REVIEW_CE',NOW-timedelta(minutes=3),'PAPER ONLY')
    def broker_forbidden(*_args,**_kwargs):
        raise AssertionError('after-hours recovery must not access a Kite token')
    monkeypatch.setattr(worker.vault,'get',broker_forbidden)
    after_close=NOW.replace(hour=16,minute=0)
    assert worker.reconcile_paper_journal(after_close) is True
    assert audit_entry_coverage(worker.db.path)['status']=='COMPLETE'
    assert worker.paper_book.open_positions()==[]
    assert all(a['available_cash_rs']==a['initial_rs']
               for a in worker.paper_book.dashboard()['accounts'])
    with sqlite3.connect(worker.db.path) as db:
        assert db.execute("SELECT COUNT(*) FROM paper_rejections WHERE reason='CRASH_GAP_NO_SIMULATED_FILL'").fetchone()[0]==2


def test_after_hours_grace_blocks_summary_until_reconciled(tmp_path,monkeypatch):
    worker=create_engine(tmp_path,monkeypatch)
    worker.paper_book=PaperBook(worker.db.path)
    worker.paper_integrity_enforced=True
    initialize_activation(worker.db.path,NOW-timedelta(minutes=10))
    near_close=NOW.replace(hour=15,minute=29,second=0)
    worker.db.claim_event('SIMULATED_LATE_REVIEW','REVIEW_PE',near_close,'PAPER ONLY')
    assert worker.reconcile_paper_journal(near_close+timedelta(seconds=45)) is False
    assert worker.paper_status=='WAIT_PAPER_RECONCILIATION'
    assert audit_entry_coverage(worker.db.path)['missing_account_outcomes']==2
    # The minute loop requires reconcile_paper_journal() success before
    # report_paper_session(), so no premature summary may be queued.
    later=near_close+timedelta(minutes=4)
    assert worker.reconcile_paper_journal(later) is True
    assert audit_entry_coverage(worker.db.path)['status']=='COMPLETE'

def test_real_paperbook_entry_and_exit_cash_conserve_integer_paise(tmp_path):
    path=str(tmp_path/'reconcile.db')
    State(path)
    book=PaperBook(path)
    initialize_activation(path,NOW-timedelta(minutes=20))
    assert audit_cash_reconciliation(path)['positions_checked']==0
    trade=book.enter('NIFTY:VALID_SIGNAL_123',quote(NOW),NOW,
                     account_id='PAPER_50K')
    assert trade['status']=='OPEN'
    open_status=audit_cash_reconciliation(path)
    assert open_status['status']=='BALANCED'
    assert open_status['unresolved_positions']==1
    exit_at=NOW+timedelta(minutes=15)
    entry_quote=quote(exit_at)
    market_bid=OptionQuote(entry_quote.contract,142.0,143.0,65,65,exit_at)
    close=book.exit(trade['trade_id'],market_bid,exit_at)
    assert close['status']=='CLOSED'
    settled=audit_cash_reconciliation(path)
    assert settled['positions_checked']==1 and settled['unresolved_positions']==0


@pytest.mark.asyncio
async def test_tampered_paper_cash_blocks_market_before_kite_reads(tmp_path,monkeypatch):
    worker=create_engine(tmp_path,monkeypatch)
    worker.paper_book=PaperBook(worker.db.path)
    worker.paper_integrity_enforced=True
    initialize_activation(worker.db.path,NOW-timedelta(minutes=10))
    with sqlite3.connect(worker.db.path) as db:
        db.execute("UPDATE paper_accounts SET cash_paise=cash_paise+1 WHERE account_id='PAPER_100K'")
    await worker.run_once(NOW)
    assert worker.status=='WAIT_DATA'
    assert worker.paper_status=='WAIT_PAPER_RECONCILIATION'
    assert worker.paper_book.open_positions()==[]
    assert worker.telegram.sent==[]
    from test_simulated_broker_pipeline import FakeKite
    assert FakeKite.records==[]
