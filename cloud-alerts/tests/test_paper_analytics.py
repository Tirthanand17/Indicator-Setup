"""Phase 42: realized-only, separate-portfolio performance with unresolved exits."""
import sqlite3
from datetime import datetime
from zoneinfo import ZoneInfo
import pytest
from cloud_alerts.paper_analytics import realized_analytics

NOW=datetime(2026,10,21,15,30,tzinfo=ZoneInfo('Asia/Kolkata'))


def fake_db(tmp_path):
    p=str(tmp_path/'state.sqlite3')
    with sqlite3.connect(p) as db:
        db.execute('CREATE TABLE paper_accounts(account_id TEXT PRIMARY KEY,initial_paise INTEGER)')
        db.execute('CREATE TABLE paper_positions(account_id TEXT,entry_at TEXT,exit_at TEXT,option_kind TEXT,status TEXT,net_pnl_paise INTEGER,trade_id TEXT)')
        db.execute('INSERT INTO paper_accounts VALUES(?,?)',('PAPER_50K',5000000))
        db.execute('INSERT INTO paper_accounts VALUES(?,?)',('PAPER_100K',10000000))
        day='2026-10-21'
        rows=[('PAPER_50K',f'{day}T10:00:00+05:30',f'{day}T10:20:00+05:30','CE','CLOSED',200000,'a'),
              ('PAPER_50K',f'{day}T10:30:00+05:30',f'{day}T10:50:00+05:30','PE','CLOSED',-150000,'b'),
              ('PAPER_50K',f'{day}T11:00:00+05:30',None,'CE','EXIT_UNVERIFIABLE',None,'c'),
              ('PAPER_100K',f'{day}T12:00:00+05:30',f'{day}T12:15:00+05:30','CE','CLOSED',100000,'d')]
        db.executemany('INSERT INTO paper_positions VALUES(?,?,?,?,?,?,?)',rows)
    return p


def test_separate_account_realized_only_metrics(tmp_path):
    x=realized_analytics(fake_db(tmp_path),NOW)
    a,b=x['accounts']
    assert a['net_realized_rs']==500 and b['net_realized_rs']==1000
    assert a['unverifiable']==1 and a['closed_trades']==2
    assert a['win_rate_pct']==50.0 and a['unrealized_pnl_rs'] is None
    assert a['gross_winning_rs']==2000 and a['gross_losing_rs']==1500
    assert x['strategy_profitability_validated'] is False


def test_realized_curve_drawdown_ce_vs_pe(tmp_path):
    a=realized_analytics(fake_db(tmp_path),NOW)['accounts'][0]
    assert a['max_realized_drawdown_rs']==1500
    assert a['pnl_by_option_kind']['CE']['net_realized_rs']==2000
    assert a['pnl_by_option_kind']['PE']['net_realized_rs']==-1500
    assert a['day_return_pct_on_initial']==1.0
    assert a['total_return_pct_on_initial']==1.0


def test_no_trades_produces_null_win_rate_not_fictitious_success(tmp_path):
    p=fake_db(tmp_path)
    with sqlite3.connect(p) as db:db.execute('DELETE FROM paper_positions')
    data=realized_analytics(p,NOW)
    assert all(a['win_rate_pct'] is None for a in data['accounts'])
    assert all(a['profit_factor'] is None for a in data['accounts'])


def test_analytics_requires_timezone(tmp_path):
    with pytest.raises(ValueError):
        realized_analytics(fake_db(tmp_path),datetime(2026,10,21))
