"""Synthetic option paper accounts; no orders, Kite HTTP or personal credentials."""
from datetime import datetime,timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo
import sqlite3
import pytest
from cloud_alerts.paper_book import PaperBook,money
IST=ZoneInfo('Asia/Kolkata')
NOW=datetime(2026,10,21,10,0,0,tzinfo=IST)

def quote(bid=99,ask=100,at=NOW,qty=195,sym='NIFTY26OCT23000CE'):
    contract=SimpleNamespace(symbol=sym,kind='CE',token=777,lot_size=65,expiry='2026-10-27')
    return SimpleNamespace(contract=contract,bid=bid,ask=ask,bid_quantity=qty,ask_quantity=qty,updated=at)

def book(tmp_path):return PaperBook(str(tmp_path/'test.sqlite'))

def test_default_accounts_and_no_reset(tmp_path):
    b=book(tmp_path)
    d=b.dashboard()
    assert [x['initial_rs'] for x in d['accounts']]==[50000,100000]
    assert all(x['open_positions']==0 for x in d['accounts'])
    assert book(tmp_path).dashboard()==d

def test_lot_sizing_depth_and_cash(tmp_path):
    b=book(tmp_path)
    a=b.enter('signal-1',quote(qty=195),NOW,account_id='PAPER_50K')
    c=b.enter('signal-1',quote(qty=195),NOW,account_id='PAPER_100K')
    assert a['status']=='OPEN' and a['lots']==1
    assert c['status']=='OPEN' and c['lots']==2
    assert a['available_cash_rs']>0
    assert len(b.open_positions())==2

def test_duplicate_and_restart_no_double_debit(tmp_path):
    b=book(tmp_path);a=b.enter('signal-1',quote(),NOW,account_id='PAPER_50K')
    cash=b.dashboard()['accounts'][0]['available_cash_rs']
    assert book(tmp_path).enter('signal-1',quote(),NOW,account_id='PAPER_50K')['status']=='DUPLICATE'
    assert book(tmp_path).dashboard()['accounts'][0]['available_cash_rs']==cash

def test_close_target_and_exact_charges(tmp_path):
    b=book(tmp_path);a=b.enter('signal-1',quote(),NOW,account_id='PAPER_50K')
    t=NOW+timedelta(minutes=21)
    result=b.exit(a['trade_id'],quote(bid=141,ask=142,at=t),t)
    assert result['status']=='CLOSED' and result['reason']=='TARGET'
    assert result['net_pnl_rs']>0
    assert b.exit(a['trade_id'],quote(bid=141,ask=142,at=t),t)['status']=='DUPLICATE'
    d=b.dashboard()['accounts'][0]
    assert d['available_cash_rs']==50000+result['net_pnl_rs']
    assert d['equity_rs']==d['available_cash_rs']

def test_stop_loss_uses_bid_slip_and_fees(tmp_path):
    b=book(tmp_path);a=b.enter('signal-1',quote(),NOW,account_id='PAPER_50K',slippage_bps=10,roundtrip_fee_rs=68)
    t=NOW+timedelta(minutes=21)
    result=b.exit(a['trade_id'],quote(bid=79,ask=80,at=t),t)
    assert result['reason']=='STOP' and result['net_pnl_rs']<0
    row=b.open_positions();assert not row
    db=sqlite3.connect(b.path)
    x=db.execute('select entry_fee_paise,exit_fee_paise,slippage_bps from paper_positions').fetchone()
    assert x==(3400,3400,10)

def test_time_exit_at_1515(tmp_path):
    b=book(tmp_path);a=b.enter('signal-1',quote(),NOW,account_id='PAPER_50K')
    t=NOW.replace(hour=15,minute=16)
    result=b.exit(a['trade_id'],quote(bid=95,ask=96,at=t),t)
    assert result['reason']=='TIME' and result['status']=='CLOSED'

def test_missing_or_stale_quote_never_fabricates_exit(tmp_path):
    b=book(tmp_path);a=b.enter('signal-1',quote(),NOW,account_id='PAPER_50K')
    t=NOW+timedelta(minutes=20)
    with pytest.raises(ValueError, match='stale'):b.exit(a['trade_id'],quote(at=NOW),t)
    assert b.dashboard()['accounts'][0]['equity_rs'] is None
    assert len(b.open_positions())==1
    assert b.dashboard()['accounts'][0]['realized_pnl_rs']==0

def test_depth_insufficient_blocks_exit(tmp_path):
    b=book(tmp_path);a=b.enter('signal-1',quote(),NOW,account_id='PAPER_50K')
    t=NOW+timedelta(minutes=20)
    a2=b.enter('signal-2',quote(qty=195),NOW,account_id='PAPER_100K')
    assert a2['lots']==2
    q=quote(bid=142,ask=143,at=t,qty=65)
    assert b.exit(a2['trade_id'],q,t)['status']=='WAIT_DEPTH'
    assert len(b.open_positions())==2

def test_market_cutoffs(tmp_path):
    b=book(tmp_path)
    for hour,minute in ((9,29),(15,0),(16,0)):
        t=NOW.replace(hour=hour,minute=minute)
        with pytest.raises(ValueError):b.enter('signal-'+str(hour)+str(minute),quote(at=t),t,account_id='PAPER_50K')

def test_reject_underfunded_small_account(tmp_path):
    b=PaperBook(str(tmp_path/'small.sqlite'),{'PAPER_3K':3000})
    out=b.enter('signal-1',quote(),NOW,account_id='PAPER_3K')
    assert out['status']=='REJECTED'
    assert b.dashboard()['accounts'][0]['available_cash_rs']==3000
    assert b.enter('signal-1',quote(),NOW,account_id='PAPER_3K')==out

def test_no_fake_equality_if_active_position(tmp_path):
    b=book(tmp_path)
    assert b.enter('signal-1',quote(),NOW,account_id='PAPER_50K')['status']=='OPEN'
    assert b.enter('signal-2',quote(),NOW,account_id='PAPER_50K')['reason']=='POSITION_ALREADY_OPEN'
    assert b.dashboard()['accounts'][0]['open_positions']==1

def test_quote_mismatch_and_noncausal_exit(tmp_path):
    b=book(tmp_path);a=b.enter('signal-1',quote(),NOW,account_id='PAPER_50K')
    t=NOW+timedelta(minutes=5)
    with pytest.raises(ValueError):b.exit(a['trade_id'],quote(sym='NIFTY26OCT23050CE',at=t),t)
    with pytest.raises(ValueError):b.exit(a['trade_id'],quote(at=NOW),NOW)

def test_money_rejects_nan_negative_and_infinite():
    for x in ('NaN','Infinity',-0.01):
        with pytest.raises(ValueError):money(x)

def test_history_presents_paper_only_and_no_private_credentials(tmp_path):
    b=book(tmp_path)
    a=b.enter('signal-1',quote(),NOW,account_id='PAPER_50K')
    history=b.trade_history()
    assert len(history)==1
    row=history[0]
    assert row['status']=='OPEN' and row['actual_fill_verified'] is False
    assert row['entry_ask_rs']==100.0 and row['option_token']==777
    assert 'access_token' not in repr(history) and 'apikey' not in repr(history).lower()
    t=NOW+timedelta(minutes=21)
    b.exit(a['trade_id'],quote(bid=141,ask=142,at=t),t)
    assert b.trade_history()[0]['net_pnl_rs']>0
    with pytest.raises(ValueError):b.trade_history(limit=10000)

def test_existing_telegram_outbox_is_atomic_with_cash_change(tmp_path):
    b=book(tmp_path)
    db=sqlite3.connect(b.path)
    db.execute('CREATE TABLE events(event_id TEXT PRIMARY KEY,status TEXT NOT NULL,at TEXT NOT NULL,payload TEXT NOT NULL,delivered INTEGER NOT NULL DEFAULT 0)')
    db.commit();db.close()
    a=b.enter('signal-1',quote(),NOW,account_id='PAPER_50K')
    t=NOW+timedelta(minutes=21)
    b.exit(a['trade_id'],quote(bid=141,ask=142,at=t),t)
    db=sqlite3.connect(b.path)
    rows=db.execute('SELECT event_id,payload FROM events ORDER BY event_id').fetchall()
    assert len(rows)==2 and rows[0][0].startswith('PAPER_ENTRY:')
    assert rows[1][0].startswith('PAPER_EXIT:')
    assert all('No real order placed' in r[1] for r in rows)
    assert b.dashboard()['accounts'][0]['closed_trades']==1

def test_unverifiable_end_of_session_never_invents_exit(tmp_path):
    b=book(tmp_path);a=b.enter('signal-1',quote(),NOW,account_id='PAPER_50K')
    with pytest.raises(ValueError):b.finish_session(NOW.replace(hour=15,minute=25))
    cash=b.dashboard()['accounts'][0]['available_cash_rs']
    assert b.finish_session(NOW.replace(hour=15,minute=27))==1
    assert b.finish_session(NOW.replace(hour=15,minute=30))==0
    assert b.dashboard()['accounts'][0]['available_cash_rs']==cash
    assert b.trade_history()[0]['status']=='EXIT_UNVERIFIABLE'
    assert b.trade_history()[0]['net_pnl_rs'] is None
    assert b.enter('another-signal',quote(at=NOW+timedelta(days=1)),NOW+timedelta(days=1),account_id='PAPER_50K')['reason']=='POSITION_ALREADY_OPEN'

def test_daily_report_reconciles_only_closed_and_rejected(tmp_path):
    b=book(tmp_path)
    first=b.enter('signal-1',quote(),NOW,account_id='PAPER_50K')
    b.exit(first['trade_id'],quote(bid=141,ask=142,at=NOW+timedelta(minutes=25)),NOW+timedelta(minutes=25))
    report=b.daily_report(NOW.replace(hour=15,minute=30))
    acct=report['accounts'][0]
    assert acct['closed']==1 and acct['wins']==1 and acct['net_realized_rs']>0
    assert acct['unresolved']==0 and report['actual_fills_verified'] is False
    assert report['accounts'][1]['closed']==0
