"""Phase 41 integration: paper autopilot remains gated, no live broker calls."""
from __future__ import annotations

from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from zoneinfo import ZoneInfo
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from cloud_alerts.paper_book import PaperBook
from cloud_alerts.server import build_app
from cloud_alerts import engine as engine_module
from cloud_alerts.config_guard import configuration_blockers
from test_simulated_broker_pipeline import engine as fake_engine, FakeKite, NOW, synthetic_candidate


def settings(root, **changes):
    data=dict(api_key='TESTKEY',bot_token='FAKE_BOT',chat_id='FAKE_CHAT',
              relay_key='r'*64,vault_key=Fernet.generate_key().decode(),
              root=root,enabled=False,shadow_enabled=False,
              paper_premium_tracking=False,paper_autotrade_enabled=False,
              paper_dashboard_enabled=True,
              paper_dashboard_key='SecureSyntheticDashboardKey_2!'*2,
              validate=lambda:None)
    data.update(changes)
    return SimpleNamespace(**data)


def test_disabled_dashboard_hides_routes(tmp_path):
    conf=settings(tmp_path,paper_dashboard_enabled=False)
    with TestClient(build_app(conf)) as client:
        assert client.get('/paper/dashboard').status_code==404
        assert client.get('/paper/api/summary').status_code==404
        assert client.get('/paper/api/trades').status_code==404


def test_private_dashboard_has_strong_auth_no_cookies_or_cache(tmp_path):
    conf=settings(tmp_path)
    with TestClient(build_app(conf)) as client:
        assert client.get('/paper/api/summary').status_code==404
        assert client.get('/paper/api/summary',headers={'X-Paper-Dashboard-Key':'bad'}).status_code==404
        page=client.get('/paper/dashboard')
        assert page.status_code==200
        assert 'script-src' in page.headers['Content-Security-Policy']
        assert '__NONCE__' not in page.text
        assert 'localStorage' not in page.text
        assert page.headers['Cache-Control']=='no-store'
        auth={'X-Paper-Dashboard-Key':conf.paper_dashboard_key}
        response=client.get('/paper/api/summary',headers=auth)
        assert response.status_code==200
        assert response.headers['Cache-Control']=='no-store'
        d=response.json()
        assert d['actual_orders'] is False
        assert [a['initial_rs'] for a in d['accounts']]==[50000,100000]
        assert client.get('/paper/api/trades',headers=auth).json()['trades']==[]


def test_autopilot_requires_both_dashboard_and_enabled_market(tmp_path):
    with pytest.raises(RuntimeError,match='Automatic paper trading'):
        build_app(settings(tmp_path,paper_autotrade_enabled=True))
    with pytest.raises(RuntimeError,match='Automatic paper trading'):
        build_app(settings(tmp_path,paper_autotrade_enabled=True,
                           paper_dashboard_enabled=False,enabled=True))


def test_autopilot_config_rejects_disabled_or_unsecured_dependencies():
    cfg={'ALERTS_ENABLED':'false','PAPER_AUTOTRADE_ENABLED':'true',
         'PAPER_DASHBOARD_ENABLED':'false'}
    assert 'INVALID_PAPER_AUTOTRADE_DEPENDENCIES' in configuration_blockers(cfg)
    assert 'INVALID_PAPER_DASHBOARD_KEY' in configuration_blockers(
        {**cfg,'PAPER_DASHBOARD_ENABLED':'true','PAPER_DASHBOARD_KEY':'short'})


@pytest.mark.asyncio
async def test_live_market_decision_opens_independent_paper_accounts(tmp_path,monkeypatch):
    worker=fake_engine(tmp_path,monkeypatch)
    worker.paper_book=PaperBook(worker.db.path)
    monkeypatch.setattr(engine_module,'decide',synthetic_candidate)
    await worker.run_once(NOW)
    assert worker.status=='REVIEW_CE'
    positions=worker.paper_book.open_positions()
    assert len(positions)==2
    assert {r['account_id'] for r in positions}=={'PAPER_50K','PAPER_100K'}
    assert all(r['status']=='OPEN' and r['option_symbol']=='NIFTYTESTCE' for r in positions)
    assert worker.paper_book.dashboard()['actual_orders'] is False
    pending=[row[0] for row in worker.db.pending_events()]
    assert any(row.startswith('PAPER_ENTRY:') for row in pending)


@pytest.mark.asyncio
async def test_paper_bid_exit_uses_real_quote_depth_and_recovers_no_duplicate(tmp_path,monkeypatch):
    worker=fake_engine(tmp_path,monkeypatch)
    worker.paper_book=PaperBook(worker.db.path)
    monkeypatch.setattr(engine_module,'decide',synthetic_candidate)
    await worker.run_once(NOW)
    at=NOW+timedelta(seconds=20)
    def target_bid(self,symbol):
        return {'instrument_token':779,'timestamp':at,
                'depth':{'buy':[{'price':142.0,'quantity':195}],
                         'sell':[{'price':143.0,'quantity':195}]}}
    monkeypatch.setattr(FakeKite,'full_quote',target_bid)
    await worker.poll_paper_positions(at)
    d=worker.paper_book.dashboard()
    assert all(a['open_positions']==0 and a['realized_pnl_rs']>0 for a in d['accounts'])
    before=worker.paper_book.trade_history()
    assert all(r['status']=='CLOSED' and r['exit_reason']=='TARGET' for r in before)
    await worker.poll_paper_positions(at)
    assert worker.paper_book.trade_history()==before
    assert all('NO ORDERS PLACED' in m or 'PAPER' in m for m in worker.telegram.sent)


@pytest.mark.asyncio
async def test_stale_bid_never_books_a_simulated_exit(tmp_path,monkeypatch):
    worker=fake_engine(tmp_path,monkeypatch)
    worker.paper_book=PaperBook(worker.db.path)
    monkeypatch.setattr(engine_module,'decide',synthetic_candidate)
    await worker.run_once(NOW)
    at=NOW+timedelta(seconds=21)
    def stale_quote(self,symbol):
        return {'instrument_token':779,'timestamp':NOW,
                'depth':{'buy':[{'price':142.0,'quantity':195}],
                         'sell':[{'price':143.0,'quantity':195}]}}
    monkeypatch.setattr(FakeKite,'full_quote',stale_quote)
    await worker.poll_paper_positions(at)
    assert worker.paper_status=='WAIT_FRESH_EXIT_QUOTE'
    assert all(r['status']=='OPEN' for r in worker.paper_book.trade_history())
    assert all(a['equity_rs'] is None for a in worker.paper_book.dashboard()['accounts'])

@pytest.mark.asyncio
async def test_paper_daily_report_is_durable_and_never_invents_exit(tmp_path,monkeypatch):
    worker=fake_engine(tmp_path,monkeypatch)
    worker.paper_book=PaperBook(worker.db.path)
    monkeypatch.setattr(engine_module,'decide',synthetic_candidate)
    await worker.run_once(NOW)
    cutoff=NOW.replace(hour=15,minute=30)
    await worker.report_paper_session(cutoff)
    rows=worker.paper_book.trade_history()
    assert len(rows)==2
    assert all(r['status']=='EXIT_UNVERIFIABLE' for r in rows)
    assert all(r['net_pnl_rs'] is None for r in rows)
    assert all(a['equity_rs'] is None for a in worker.paper_book.dashboard()['accounts'])
    assert worker.db.is_sent('PAPER_DAILY:'+NOW.date().isoformat())
    await worker.report_paper_session(cutoff)
    assert worker.db.outbox_summary()['queued']<=2

@pytest.mark.asyncio
async def test_paper_autopilot_disabled_keeps_original_signal_mode(tmp_path,monkeypatch):
    worker=fake_engine(tmp_path,monkeypatch)
    monkeypatch.setattr(engine_module,'decide',synthetic_candidate)
    assert worker.paper_book is None
    await worker.run_once(NOW)
    assert worker.status=='REVIEW_CE'
    assert worker.db.is_sent('PAPER_DAILY:'+NOW.date().isoformat()) is False
    await worker.poll_paper_positions(NOW)
    assert worker.paper_status=='DISABLED'

def test_private_signal_audit_api_denies_unauthenticated_clients(tmp_path):
    conf=settings(tmp_path)
    with TestClient(build_app(conf)) as client:
        assert client.get('/paper/api/opportunities').status_code==404
        auth={'X-Paper-Dashboard-Key':conf.paper_dashboard_key}
        response=client.get('/paper/api/opportunities',headers=auth)
        assert response.status_code==200 and response.headers['Cache-Control']=='no-store'
        body=response.json()
        assert body['audit']['strategy_qualified']==0
        assert body['audit']['missed_pnl_verifiable'] is False
        assert body['evaluations']==[]
        assert body['actual_orders'] is False

def test_private_analytics_api_auth_and_no_fabricated_winrate(tmp_path):
    conf=settings(tmp_path)
    with TestClient(build_app(conf)) as client:
        assert client.get('/paper/api/analytics').status_code==404
        data=client.get('/paper/api/analytics',headers={
            'X-Paper-Dashboard-Key':conf.paper_dashboard_key})
        assert data.status_code==200 and data.headers['Cache-Control']=='no-store'
        report=data.json()
        assert report['real_money_orders']==0
        assert report['strategy_profitability_validated'] is False
        assert len(report['accounts'])==2
        assert all(x['win_rate_pct'] is None for x in report['accounts'])

def test_paper_opportunity_date_filter_rejects_bad_calendar_input(tmp_path):
    conf=settings(tmp_path)
    with TestClient(build_app(conf)) as client:
        auth={'X-Paper-Dashboard-Key':conf.paper_dashboard_key}
        assert client.get('/paper/api/opportunities?date=not-a-date',headers=auth).status_code==400
        response=client.get('/paper/api/opportunities?date=2026-10-21',headers=auth)
        assert response.status_code==200
        assert response.json()['evaluations']==[]

def test_private_dashboard_reports_balanced_cash_only_to_authenticated_request(tmp_path):
    import sqlite3
    conf=settings(tmp_path)
    with TestClient(build_app(conf)) as client:
        assert client.get('/paper/api/summary').status_code==404
        auth={'X-Paper-Dashboard-Key':conf.paper_dashboard_key}
        healthy=client.get('/paper/api/summary',headers=auth)
        assert healthy.status_code==200
        state=healthy.json()['paper_recovery_integrity']
        assert state['cash_reconciliation']['status']=='BALANCED'
        assert state['cash_reconciliation']['accounts_verified']==2
        with sqlite3.connect(conf.root/'alerts.sqlite3') as db:
            db.execute("UPDATE paper_accounts SET cash_paise=cash_paise+1 WHERE account_id='PAPER_100K'")
        broken=client.get('/paper/api/summary',headers=auth)
        assert broken.status_code==200
        integrity=broken.json()['paper_recovery_integrity']
        assert integrity['cash_reconciliation']=={
            'status':'FAIL_CLOSED','cash_entries_permitted':False}
        assert integrity['new_entries_permitted'] is False
        assert 'token' not in broken.text.lower()
