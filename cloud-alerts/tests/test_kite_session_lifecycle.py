"""Phase 39: close the base Kite REST SDK on every poll outcome.

All tests use a fake Kite SDK and fake Telegram transport. No live HTTP, real
credentials, live orders, or protected user files are accessed.
"""
from __future__ import annotations

from threading import Lock

import pytest

from cloud_alerts import engine as engine_module
from cloud_alerts.models import Decision
from test_simulated_broker_pipeline import FakeKite, NOW, engine as build_fake_engine, synthetic_candidate


class CountingKite(FakeKite):
    lock = Lock()
    opened = []
    closed = []

    def __init__(self, api_key, token):
        super().__init__(api_key, token)
        with self.lock:
            self.opened.append(self)

    def close(self):
        with self.lock:
            self.closed.append(self)


@pytest.fixture(autouse=True)
def reset_counter():
    CountingKite.opened.clear()
    CountingKite.closed.clear()


@pytest.mark.asyncio
async def test_base_instrument_quote_and_history_sdk_sessions_all_closed(tmp_path,monkeypatch):
    worker=build_fake_engine(tmp_path,monkeypatch)
    monkeypatch.setattr(engine_module,'KiteReadOnly',CountingKite)
    monkeypatch.setattr(engine_module,'decide',synthetic_candidate)
    await worker.run_once(NOW)
    assert worker.status=='REVIEW_CE'
    assert len(worker.telegram.sent)==1
    assert len(CountingKite.opened)==3
    assert set(CountingKite.closed)==set(CountingKite.opened)


@pytest.mark.asyncio
async def test_main_sdk_closed_even_when_instrument_master_fails(tmp_path,monkeypatch):
    worker=build_fake_engine(tmp_path,monkeypatch)
    monkeypatch.setattr(engine_module,'KiteReadOnly',CountingKite)
    def fail_master(_self):
        raise RuntimeError('synthetic response error, no secrets')
    monkeypatch.setattr(CountingKite,'instruments_nfo',fail_master)
    await worker.run_once(NOW)
    assert worker.status=='WAIT_DATA'
    assert not worker.telegram.sent
    assert len(CountingKite.opened)==1
    assert CountingKite.closed==CountingKite.opened


@pytest.mark.asyncio
async def test_main_sdk_closed_when_option_quote_raises(tmp_path,monkeypatch):
    worker=build_fake_engine(tmp_path,monkeypatch)
    monkeypatch.setattr(engine_module,'KiteReadOnly',CountingKite)
    monkeypatch.setattr(engine_module,'decide',synthetic_candidate)
    def fail_option(_self,_symbol):
        raise RuntimeError('synthetic quote outage')
    monkeypatch.setattr(CountingKite,'full_quote',fail_option)
    await worker.run_once(NOW)
    assert worker.status=='WAIT_DATA'
    assert not worker.telegram.sent
    assert len(CountingKite.opened)==3
    assert set(CountingKite.closed)==set(CountingKite.opened)


@pytest.mark.asyncio
async def test_no_trade_keeps_sdk_cleanup_without_option_request(tmp_path,monkeypatch):
    worker=build_fake_engine(tmp_path,monkeypatch)
    monkeypatch.setattr(engine_module,'KiteReadOnly',CountingKite)
    monkeypatch.setattr(engine_module,'decide',lambda candles,now,confirm_15m:
        Decision('NO_TRADE','SYNTHETIC NO TRADE',candles[-1]))
    await worker.run_once(NOW)
    assert worker.status=='NO_TRADE'
    assert not worker.telegram.sent
    assert len(CountingKite.opened)==3
    assert set(CountingKite.closed)==set(CountingKite.opened)
