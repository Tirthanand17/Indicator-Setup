"""Worker coroutine restarts must re-run private SQLite safety recovery."""
import asyncio
import json
import threading
import time
from datetime import datetime, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from cloud_alerts.server import build_app

IST = ZoneInfo('Asia/Kolkata')


def _configured_app(tmp_path):
    cfg = SimpleNamespace(
        api_key='TEST_KEY', bot_token='123:FAKE_TOKEN', chat_id='100',
        relay_key='a' * 64, vault_key=Fernet.generate_key().decode(),
        root=tmp_path, enabled=True, validate=lambda: None,
    )
    app = build_app(cfg)
    app.state.worker_supervisor.backoffs = (0.001, 0.001, 0.001)
    return app


def _position(now, event_id):
    return json.dumps({
        'direction': 'CE', 'symbol': 'NIFTY26OCTFUT',
        'signal_candle': (now - timedelta(minutes=5)).isoformat(),
        'expiry_date': now.date().isoformat(),
        'entry_event_id': event_id,
    })


def _worker_once_then_hold(app, trigger):
    starts = []

    async def worker():
        starts.append(datetime.now(IST))
        if len(starts) == 1:
            # Controlled synthetic crash, signalled by the test thread.
            await asyncio.to_thread(trigger.wait)
            raise RuntimeError('DO_NOT_LEAK_SYNTHETIC_BROKER_SECRET')
        await asyncio.Event().wait()

    app.state.engine.run_forever = worker
    return starts


def _await_restart(starts, timeout=3):
    until = time.monotonic() + timeout
    while len(starts) < 2 and time.monotonic() < until:
        time.sleep(0.01)
    assert len(starts) == 2


def test_crash_recovers_expired_unseen_entry_without_phantom_exit(tmp_path):
    app = _configured_app(tmp_path)
    trigger = threading.Event()
    starts = _worker_once_then_hold(app, trigger)
    with TestClient(app) as client:
        assert len(starts) == 1
        db = app.state.engine.db
        now = datetime.now(IST)
        event = 'SYNTHETIC_ENTRY_ID'
        # Created only after normal ASGI startup reconciliation has completed.
        assert db.claim_event(event, 'REVIEW_CE', now - timedelta(minutes=4), 'TEST PAPER BUY')
        db.set_runtime('virtual_candidate', _position(now, event))
        trigger.set()
        _await_restart(starts)
        assert db.event_delivery_status(event) == 2
        assert db.get_runtime('virtual_candidate') == ''
        result = app.state.last_worker_recovery
        assert result['expired_queued_notifications'] == 1
        assert result['cleared_stale_virtual_candidates'] == 1
        assert result['telegram_phone_receipt_verified'] is False
        assert app.state.engine.last_data_at is None
        health = client.get('/healthz')
        assert 'DO_NOT_LEAK' not in health.text
        assert health.json()['last_worker_reconciliation']['expired_queued_notifications'] == 1
        assert health.json()['last_worker_reconciliation']['cleared_stale_virtual_candidates'] == 1
        assert 'TEST PAPER BUY' not in health.text
        assert client.get('/operationalz').status_code == 503


def test_crash_preserves_current_day_accepted_paper_candidate(tmp_path):
    app = _configured_app(tmp_path)
    trigger = threading.Event()
    starts = _worker_once_then_hold(app, trigger)
    with TestClient(app):
        db = app.state.engine.db
        now = datetime.now(IST)
        event = 'SYNTHETIC_ACCEPTED_ENTRY'
        assert db.claim_event(event, 'REVIEW_CE', now - timedelta(seconds=30), 'TEST ONLY')
        assert db.mark_delivered(event, now - timedelta(seconds=20))
        position = _position(now, event)
        db.set_runtime('virtual_candidate', position)
        trigger.set()
        _await_restart(starts)
        assert db.get_runtime('virtual_candidate') == position
        assert db.event_delivery_status(event) == 1
        assert app.state.last_worker_recovery['preserved_active_candidate'] is True
        assert app.state.last_worker_recovery['cleared_stale_virtual_candidates'] == 0


def test_corrupt_current_day_candidate_blocks_worker_restart(tmp_path, monkeypatch):
    app = _configured_app(tmp_path)
    trigger = threading.Event()
    starts = _worker_once_then_hold(app, trigger)
    # A real process would receive SIGTERM on fatal. Prevent killing the test runner.
    terminations = []
    monkeypatch.setattr('cloud_alerts.server.os.kill', lambda pid, sig: terminations.append((pid, sig)))
    with TestClient(app) as client:
        db = app.state.engine.db
        db.set_runtime('virtual_candidate', '{not JSON}')
        trigger.set()
        deadline = time.monotonic() + 3
        while not terminations and time.monotonic() < deadline:
            time.sleep(0.01)
        assert terminations, 'corrupt state should trigger fatal supervisor shutdown'
        assert len(starts) == 1  # Never starts a worker with unsafe persisted state.
        assert app.state.worker_supervisor.state == 'FATAL'
        assert app.state.engine.last_data_at is None
        health = client.get('/healthz')
        assert health.status_code == 503
        assert 'not JSON' not in health.text
        assert 'DO_NOT_LEAK' not in health.text


def test_crash_preserves_recent_queued_entry_for_safe_retry(tmp_path):
    app = _configured_app(tmp_path)
    trigger = threading.Event()
    starts = _worker_once_then_hold(app, trigger)
    with TestClient(app) as client:
        db = app.state.engine.db
        now = datetime.now(IST)
        event = 'PENDING_PAPER_REVIEW'
        assert db.claim_event(event, 'REVIEW_PE', now - timedelta(seconds=50), 'PRIVATE_PHONE_MESSAGE')
        candidate = json.loads(_position(now, event))
        candidate['direction'] = 'PE'
        candidate = json.dumps(candidate)
        db.set_runtime('virtual_candidate', candidate)
        trigger.set()
        _await_restart(starts)
        assert db.get_runtime('virtual_candidate') == candidate
        assert db.event_delivery_status(event) == 0
        assert app.state.last_worker_recovery['preserved_active_candidate'] is True
        report = client.get('/healthz').json()['last_worker_reconciliation']
        assert report == {
            'performed': True,
            'expired_queued_notifications': 0,
            'cleared_stale_virtual_candidates': 0,
            'preserved_active_candidate': True,
        }
        assert 'PRIVATE_PHONE_MESSAGE' not in client.get('/healthz').text
        assert client.get('/operationalz').status_code == 503
