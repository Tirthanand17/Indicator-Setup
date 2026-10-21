"""Phase 42: versioned actual-rate estimates and conservative remaining daily risk.

All market prices and broker responses here are synthetic; no real orders.
"""
from datetime import timedelta
import sqlite3
import pytest
from cloud_alerts.paper_charges import POLICY,estimate_nse_option_leg
from cloud_alerts.paper_book import PaperBook, money
from test_paper_book import NOW,quote,book


def test_new_paper_trade_uses_dated_fee_schedule_and_persists_version(tmp_path):
    worker=book(tmp_path)
    entry=worker.enter('signal-fee-1',quote(),NOW,account_id='PAPER_50K')
    assert entry['status']=='OPEN'
    rows=worker.trade_history()
    assert rows[0]['fee_model_version']==POLICY
    q=rows[0]['lot_size']*rows[0]['lots']
    expected=estimate_nse_option_leg(rows[0]['entry_fill_rs'],q,'BUY')
    assert rows[0]['entry_fee_rs']==expected.total_paise/100
    assert rows[0]['fee_estimate_audited'] is False
    assert rows[0]['modeled_charges_rs'] is None


def test_sell_stt_and_actual_sell_side_fees_deducted_from_paper_pnl(tmp_path):
    worker=book(tmp_path)
    entry=worker.enter('signal-fee-2',quote(),NOW,account_id='PAPER_50K')
    t=NOW+timedelta(minutes=25)
    result=worker.exit(entry['trade_id'],quote(bid=142,ask=143,at=t),t)
    assert result['status']=='CLOSED'
    row=worker.trade_history()[0]
    qty=row['lots']*row['lot_size']
    fees=estimate_nse_option_leg(row['exit_fill_rs'],qty,'SELL')
    assert row['exit_fee_rs']==fees.total_paise/100
    assert row['modeled_charges_rs'] == round(row['entry_fee_rs']+row['exit_fee_rs'],2)
    assert row['net_pnl_rs']==round(qty*row['exit_fill_rs']-row['exit_fee_rs']-row['entry_debit_rs'],2)
    assert worker.dashboard()['accounts'][0]['available_cash_rs']==round(50000+row['net_pnl_rs'],2)


def test_existing_fixed_roundtrip_fee_mode_remains_compatible(tmp_path):
    worker=book(tmp_path)
    entry=worker.enter('signal-fixed-1',quote(),NOW,account_id='PAPER_50K',
                       roundtrip_fee_rs=68)
    assert entry['status']=='OPEN'
    row=worker.trade_history()[0]
    assert row['fee_model_version']=='FIXED_RS_V1'
    assert row['entry_fee_rs']==34
    t=NOW+timedelta(minutes=25)
    worker.exit(entry['trade_id'],quote(bid=142,ask=143,at=t),t)
    closed=worker.trade_history()[0]
    assert closed['exit_fee_rs']==34
    assert closed['modeled_charges_rs']==68


def test_paper_budget_includes_previous_realized_losses(tmp_path):
    worker=book(tmp_path)
    for i in range(2):
        now=NOW+timedelta(minutes=i*15)
        entry=worker.enter('signal-daily-'+str(i),quote(at=now),now,account_id='PAPER_50K')
        assert entry['status']=='OPEN'
        end=now+timedelta(minutes=2)
        result=worker.exit(entry['trade_id'],quote(bid=79,ask=80,at=end),end)
        assert result['status']=='CLOSED' and result['net_pnl_rs']<0
    later=NOW+timedelta(minutes=40)
    third=worker.enter('signal-daily-2',quote(at=later),later,account_id='PAPER_50K')
    assert third['status']=='REJECTED'
    assert worker.dashboard()['accounts'][0]['open_positions']==0
    assert worker.dashboard()['accounts'][0]['closed_trades']==2


def test_no_duplicate_cash_debit_with_fee_version_after_restart(tmp_path):
    worker=book(tmp_path)
    signal='signal-replay-fee'
    first=worker.enter(signal,quote(),NOW,account_id='PAPER_100K')
    cash=worker.dashboard()['accounts'][1]['available_cash_rs']
    second=PaperBook(worker.path).enter(signal,quote(),NOW,account_id='PAPER_100K')
    assert second['status']=='DUPLICATE'
    assert PaperBook(worker.path).dashboard()['accounts'][1]['available_cash_rs']==cash
    assert PaperBook(worker.path).trade_history()[0]['fee_model_version']==POLICY


def test_cost_policy_does_not_insert_actual_trade_status_or_order_record(tmp_path):
    worker=book(tmp_path)
    worker.enter('signal-safety-fee',quote(),NOW,account_id='PAPER_50K')
    assert worker.dashboard()['actual_orders'] is False
    assert all(not t['actual_fill_verified'] for t in worker.trade_history())
    with sqlite3.connect(worker.path) as db:
        assert not any('order' in row[0].lower() for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"))
