"""Phase 43 integration with the actual alert and paper SQLite schemas.

Synthetic NIFTY option books only; no Kite orders, network, real credentials.
"""
from datetime import timedelta
from zoneinfo import ZoneInfo
import sqlite3
import pytest

from cloud_alerts.paper_book import PaperBook
from cloud_alerts.paper_integrity import (
    initialize_activation,audit_entry_coverage,recover_missing_outcomes)
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
