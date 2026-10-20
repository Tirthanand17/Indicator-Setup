"""Phase 39: close optional high-frequency read-only premium HTTP sessions.

All tests are synthetic; broker responses and Telegram are fake. No real
Kite login, trading, cloud hosting, or protected user file access occurs.
"""
from __future__ import annotations

from datetime import timedelta
from threading import Lock

import pytest
from cloud_alerts import engine as engine_module
from test_premium_pipeline import Broker, NOW, setup


class CountingPremium(Broker):
    lock=Lock()
    instances=[]
    closed=[]

    def __init__(self, key, token):
        super().__init__(key, token)
        with self.lock:
            self.instances.append(self)

    def close(self):
        with self.lock:
            self.closed.append(self)


@pytest.fixture(autouse=True)
def reset():
    CountingPremium.instances.clear()
    CountingPremium.closed.clear()


@pytest.mark.asyncio
async def test_premium_exit_quote_session_closed_after_stop(tmp_path,monkeypatch):
    worker=setup(tmp_path,monkeypatch)
    monkeypatch.setattr(engine_module,'KiteReadOnly',CountingPremium)
    await worker.run_once(NOW)
    assert worker.status=='REVIEW_CE'
    assert len(CountingPremium.instances)==3
    Broker.price=79.5
    Broker.quote_at=NOW+timedelta(seconds=20)
    await worker.poll_virtual_premium(NOW+timedelta(seconds=20))
    assert worker.premium_status=='EXIT_REVIEW_STOP'
    assert len(CountingPremium.instances)==4
    assert set(CountingPremium.closed)==set(CountingPremium.instances)


@pytest.mark.asyncio
async def test_premium_sdk_closed_after_broker_exception_without_exit(tmp_path,monkeypatch):
    worker=setup(tmp_path,monkeypatch)
    monkeypatch.setattr(engine_module,'KiteReadOnly',CountingPremium)
    await worker.run_once(NOW)
    assert worker.status=='REVIEW_CE'
    initial_messages=len(worker.telegram.messages)
    def fail_quote(_self,_symbol):
        raise RuntimeError('synthetic option quote outage')
    monkeypatch.setattr(CountingPremium,'full_quote',fail_quote)
    await worker.poll_virtual_premium(NOW+timedelta(seconds=20))
    assert worker.premium_status=='PREMIUM_QUOTE_UNAVAILABLE'
    assert len(worker.telegram.messages)==initial_messages
    assert len(CountingPremium.instances)==4
    assert set(CountingPremium.closed)==set(CountingPremium.instances)
