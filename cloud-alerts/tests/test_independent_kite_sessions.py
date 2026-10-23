"""Phase 38: independent Kite SDK sessions for parallel five/15-minute history.

Offline synthetic broker tests. They do not use Nirala, paid Kite API, the
public Internet or any real credentials.
"""
from __future__ import annotations

from datetime import timedelta
from threading import Lock
import pytest

from cloud_alerts import engine as engine_module
from cloud_alerts.models import Decision
from test_simulated_broker_pipeline import (
    FakeKite, NOW, engine as fake_engine, synthetic_candidate
)


class TrackedKite(FakeKite):
    instances = []
    observations = []
    closed_ids = set()
    lock = Lock()

    def __init__(self, key, token):
        super().__init__(key, token)
        with self.lock:
            self.instances.append(self)

    def close(self):
        with self.lock:
            self.closed_ids.add(id(self))

    def historical(self, token, interval, start, end):
        with self.lock:
            self.observations.append((id(self), interval))
        return super().historical(token, interval, start, end)


@pytest.fixture(autouse=True)
def clear_tracking():
    TrackedKite.instances.clear()
    TrackedKite.observations.clear()
    TrackedKite.closed_ids.clear()


@pytest.mark.asyncio
async def test_two_concurrent_history_queries_use_distinct_kite_sdk_sessions(tmp_path, monkeypatch):
    instance = fake_engine(tmp_path, monkeypatch)
    monkeypatch.setattr(engine_module, 'KiteReadOnly', TrackedKite)
    monkeypatch.setattr(engine_module, 'decide', lambda candles, now, confirm_15m:
        Decision('NO_TRADE', 'SYNTHETIC SUPPRESSION', candles[-1]))
    await instance.run_once(NOW)
    assert instance.status == 'NO_TRADE'
    observations = TrackedKite.observations
    assert {interval for _,interval in observations} == {'5minute', '15minute'}
    assert len(observations) == 2
    assert observations[0][0] != observations[1][0]
    assert {sdk_id for sdk_id,_ in observations}.issubset(TrackedKite.closed_ids)
    # The metadata/option-quote client is ALSO correctly closed by Engine.
    # Requiring exact equality against only the two history sessions would
    # incorrectly fail when resource cleanup works as designed.
    assert {id(sdk) for sdk in TrackedKite.instances} == TrackedKite.closed_ids
    assert len(TrackedKite.instances) >= 3  # metadata, 5m, 15m
    assert not instance.telegram.sent


@pytest.mark.asyncio
async def test_quote_client_not_shared_with_concurrent_history_reads(tmp_path, monkeypatch):
    instance = fake_engine(tmp_path, monkeypatch)
    monkeypatch.setattr(engine_module, 'KiteReadOnly', TrackedKite)
    monkeypatch.setattr(engine_module, 'decide', synthetic_candidate)
    await instance.run_once(NOW)
    assert instance.status == 'REVIEW_CE'
    assert len(instance.telegram.sent) == 1
    historical_ids = {sdk_id for sdk_id, _ in TrackedKite.observations}
    assert len(historical_ids) == 2
    assert len(TrackedKite.instances) == 3
    assert id(TrackedKite.instances[0]) not in historical_ids
    assert instance.db.get_runtime('last_processed_candle') is not None


@pytest.mark.asyncio
async def test_history_broker_error_fails_closed_without_paper_buy(tmp_path, monkeypatch):
    instance = fake_engine(tmp_path, monkeypatch)
    monkeypatch.setattr(engine_module, 'KiteReadOnly', TrackedKite)
    monkeypatch.setattr(engine_module, 'decide', synthetic_candidate)
    failed_sdk_ids = []
    def fail_15minute(self, token, interval, start, end):
        if interval == '15minute':
            failed_sdk_ids.append(id(self))
            raise RuntimeError('synthetic historical provider outage')
        return FakeKite.historical(self, token, interval, start, end)
    monkeypatch.setattr(TrackedKite, 'historical', fail_15minute)
    await instance.run_once(NOW)
    assert instance.status == 'WAIT_DATA'
    assert not instance.telegram.sent
    assert instance.db.get_runtime('virtual_candidate') is None
    assert failed_sdk_ids and failed_sdk_ids[0] in TrackedKite.closed_ids  # failure thread always closes


@pytest.mark.asyncio
async def test_repeated_candle_poll_does_not_reuse_old_thread_sdk_sessions(tmp_path, monkeypatch):
    instance = fake_engine(tmp_path, monkeypatch)
    monkeypatch.setattr(engine_module, 'KiteReadOnly', TrackedKite)
    monkeypatch.setattr(engine_module, 'decide', lambda candles, now, confirm_15m:
        Decision('NO_TRADE', 'SYNTHETIC SUPPRESSION', candles[-1]))
    await instance.run_once(NOW)
    first_ids = {sdk_id for sdk_id,_ in TrackedKite.observations}
    await instance.run_once(NOW + timedelta(seconds=12))
    second_ids = {sdk_id for sdk_id,_ in TrackedKite.observations[2:]}
    assert len(first_ids) == 2 and len(second_ids) == 2
    assert first_ids.isdisjoint(second_ids)
    assert not instance.telegram.sent


@pytest.mark.asyncio
async def test_review_missing_confirmed_candle_cannot_request_option_quote(tmp_path, monkeypatch):
    instance = fake_engine(tmp_path, monkeypatch)
    monkeypatch.setattr(engine_module, 'KiteReadOnly', TrackedKite)
    monkeypatch.setattr(engine_module, 'decide', lambda candles, now, confirm_15m:
        Decision('REVIEW_CE', 'SYNTHETIC REVIEW WITHOUT CANDLE'))
    await instance.run_once(NOW)
    assert instance.status == 'WAIT_DATA'
    assert not instance.telegram.sent
    assert instance.db.get_runtime('virtual_candidate') is None
    assert len(TrackedKite.instances) == 3  # No separate option quote client.
