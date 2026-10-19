"""Offline startup reconciliation tests; never connect to Kite or Telegram."""
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo
import json
import sqlite3

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from cloud_alerts.server import build_app
from cloud_alerts.state import State

IST = ZoneInfo('Asia/Kolkata')
MONDAY = datetime(2026, 10, 19, 10, 0, tzinfo=IST)


def candidate(now, entry_id='buy-entry'):
    return {'expiry_date': now.date().isoformat(), 'direction': 'CE',
            'symbol': 'NIFTY26OCTFUT',
            'signal_candle': (now-timedelta(minutes=5)).isoformat(),
            'entry_event_id': entry_id}


def test_expiry_uses_absolute_instant_for_mixed_offsets(tmp_path):
    s=State(str(tmp_path/'state.sqlite3'))
    at=MONDAY
    older=(at-timedelta(minutes=8)).astimezone(timezone.utc)
    future=(at+timedelta(seconds=30)).astimezone(timezone.utc)
    # Mixed offsets compare incorrectly as ISO strings; absolute comparison is required.
    s.claim_event('old-ist','REVIEW_CE',at-timedelta(minutes=8),'private')
    s.claim_event('old-utc','REVIEW_CE',older,'private')
    s.claim_event('future-utc','REVIEW_CE',future,'private')
    assert s.expire_events_before(at-timedelta(minutes=3)) == 2
    assert s.event_delivery_status('old-ist')==2
    assert s.event_delivery_status('old-utc')==2
    assert s.event_delivery_status('future-utc')==0


def test_pending_queue_orders_by_instant_across_timezones(tmp_path):
    s=State(str(tmp_path/'state.sqlite3'))
    earlier=(MONDAY-timedelta(seconds=60)).astimezone(timezone.utc)
    s.claim_event('later-ist','REVIEW_CE',MONDAY,'later')
    s.claim_event('earlier-utc','REVIEW_PE',earlier,'earlier')
    assert s.pending_events() == [('earlier-utc','earlier'),('later-ist','later')]


def test_expiry_refuses_timezone_naive_cutoff(tmp_path):
    s=State(str(tmp_path/'state.sqlite3'))
    with pytest.raises(ValueError, match='timezone-aware'):
        s.expire_events_before(datetime(2026,10,19,10,0))


def test_restart_expires_stale_queued_notice_and_clears_linked_candidate(tmp_path):
    path=tmp_path/'state.sqlite3'; s=State(str(path))
    queued=MONDAY-timedelta(minutes=5)
    assert s.claim_event('buy-entry','REVIEW_CE',queued,'secret phone text')
    s.set_runtime('virtual_candidate', json.dumps(candidate(MONDAY)))
    stats=s.reconcile_startup(MONDAY)
    assert stats['expired_queued_notifications']==1
    assert stats['cleared_stale_virtual_candidates']==1
    assert stats['preserved_active_candidate'] is False
    assert s.event_delivery_status('buy-entry')==2
    assert s.get_runtime('virtual_candidate')==''
    assert 'secret phone text' not in str(stats)
    assert State(str(path)).reconcile_startup(MONDAY)['expired_queued_notifications']==0


def test_restart_preserves_accepted_same_day_candidate_and_recent_pending(tmp_path):
    s=State(str(tmp_path/'db.sqlite3'))
    assert s.claim_event('buy-entry','REVIEW_CE',MONDAY-timedelta(seconds=70),'private')
    s.set_runtime('virtual_candidate', json.dumps(candidate(MONDAY)))
    result=s.reconcile_startup(MONDAY)
    assert result['expired_queued_notifications']==0
    assert result['preserved_active_candidate'] is True
    assert s.get_runtime('virtual_candidate')
    s.mark_delivered('buy-entry',MONDAY)
    assert s.reconcile_startup(MONDAY)['preserved_active_candidate'] is True
    assert s.event_delivery_status('buy-entry')==1


def test_restart_clears_previous_day_position_without_touching_accepted_notice(tmp_path):
    s=State(str(tmp_path/'db.sqlite3'))
    prev=MONDAY-timedelta(days=3)
    s.claim_event('buy-entry','REVIEW_PE',prev,'private')
    s.mark_delivered('buy-entry',prev)
    s.set_runtime('virtual_candidate',json.dumps(candidate(prev)))
    stats=s.reconcile_startup(MONDAY)
    assert stats['cleared_stale_virtual_candidates']==1
    assert s.event_delivery_status('buy-entry')==1


@pytest.mark.parametrize('broken',["{",json.dumps([]),json.dumps({"expiry_date":"bad"}),
                                   json.dumps({"expiry_date":"2026-10-20","direction":"CE","signal_candle":"x","entry_event_id":"no"}),
                                   json.dumps(candidate(MONDAY, 'nonexistent'))])
def test_broken_candidate_blocks_recovery_without_partial_changes(tmp_path,broken):
    s=State(str(tmp_path/'db.sqlite3'))
    s.claim_event('old','REVIEW_CE',MONDAY-timedelta(minutes=5),'private')
    s.set_runtime('virtual_candidate',broken)
    with pytest.raises(ValueError,match='invalid or unlinked'):
        s.reconcile_startup(MONDAY)
    assert s.event_delivery_status('old')==0
    assert s.get_runtime('virtual_candidate')==broken


def test_server_lifespan_runs_reconciliation_before_worker(tmp_path):
    old = datetime.now(IST)-timedelta(minutes=6)
    s=State(str(tmp_path/'alerts.sqlite3'))
    assert s.claim_event('stale','REVIEW_CE',old,'PRIVATE ALERT')
    cfg=SimpleNamespace(api_key='TEST_KEY',bot_token='TESTBOT',chat_id='123',
        relay_key='X'*64,vault_key=Fernet.generate_key().decode(),root=tmp_path,
        enabled=False,validate=lambda: None)
    app=build_app(cfg)
    with TestClient(app) as client:
        assert client.get('/healthz').status_code==200
        assert app.state.startup_recovery['expired_queued_notifications']==1
        assert s.event_delivery_status('stale')==2
        assert 'PRIVATE' not in str(app.state.startup_recovery)


def test_server_rejects_malformed_candidate_before_worker_starts(tmp_path):
    s=State(str(tmp_path/'alerts.sqlite3'))
    s.set_runtime('virtual_candidate','{broken')
    cfg=SimpleNamespace(api_key='TEST_KEY',bot_token='TESTBOT',chat_id='123',
        relay_key='X'*64,vault_key=Fernet.generate_key().decode(),root=tmp_path,
        enabled=False,validate=lambda: None)
    app=build_app(cfg)
    with pytest.raises(ValueError, match='invalid or unlinked'):
        with TestClient(app):
            pass
    assert app.state.worker_task is None
