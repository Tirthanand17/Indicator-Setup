"""Fresh wall-clock delivery despite slow REST; synthetic clock, no network."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from cryptography.fernet import Fernet

from cloud_alerts import engine as engine_module
from cloud_alerts.engine import Engine
from cloud_alerts.security import TokenVault
from cloud_alerts.state import State

IST = ZoneInfo('Asia/Kolkata')
START = datetime(2026, 10, 19, 11, 0, tzinfo=IST)


def make_engine(tmp_path, phone=None):
    state = State(str(tmp_path / 'alerts.sqlite3'))
    vault = TokenVault(tmp_path / 'token.enc', Fernet.generate_key().decode())
    vault.put('X' * 32, START)

    class FakePhone:
        def __init__(self):
            self.messages = []

        def send(self, body):
            self.messages.append(body)

    return Engine('TEST', vault, state, phone or FakePhone(), enabled=True)


def mock_clock(monkeypatch, current):
    class Clock:
        @staticmethod
        def now(tz=None):
            return current[0].astimezone(tz or IST)

    monkeypatch.setattr(engine_module, 'datetime', Clock)


@pytest.mark.asyncio
async def test_live_worker_expires_alert_while_kite_data_is_slow(tmp_path, monkeypatch):
    engine = make_engine(tmp_path)
    assert engine.db.claim_event('buy', 'REVIEW_CE', START - timedelta(seconds=170), 'PRIVATE BUY')
    clock = [START]
    mock_clock(monkeypatch, clock)

    async def slow_rest(_start, _token):
        clock[0] += timedelta(seconds=20)
        # The original code passed a *captured* 11:00:00 timestamp here.
        await engine._deliver_outbox(_start)

    monkeypatch.setattr(engine, '_collect_once', slow_rest)
    await engine.run_once()  # Live entry point, must use fresh time.
    assert engine.telegram.messages == []
    assert engine.db.event_delivery_status('buy') == 2
    assert engine.db.read_delivery_audit_rows()[0][3] == 0
    assert engine._live_delivery_clock.get() is False


@pytest.mark.asyncio
async def test_explicit_timestamp_remains_an_offline_test_seam(tmp_path, monkeypatch):
    engine = make_engine(tmp_path)
    assert engine.db.claim_event('buy', 'REVIEW_PE', START - timedelta(seconds=170), 'OFFLINE PAPER')
    clock = [START]
    mock_clock(monkeypatch, clock)

    async def simulated_rest(_start, _token):
        clock[0] += timedelta(seconds=20)
        await engine._deliver_outbox(_start)

    monkeypatch.setattr(engine, '_collect_once', simulated_rest)
    await engine.run_once(START)  # Explicit test clock, deterministic simulation.
    assert engine.telegram.messages == ['OFFLINE PAPER']
    assert engine.db.event_delivery_status('buy') == 1
    assert engine.db.read_delivery_audit_rows()[0][-1] == START.astimezone(timezone.utc).isoformat()
    assert engine._live_delivery_clock.get() is False


@pytest.mark.asyncio
async def test_live_acceptance_records_time_after_slow_telegram_response(tmp_path, monkeypatch):
    clock = [START]

    class SlowPhone:
        def __init__(self):
            self.messages = []

        def send(self, message):
            self.messages.append(message)
            clock[0] += timedelta(seconds=7)

    phone = SlowPhone()
    engine = make_engine(tmp_path, phone=phone)
    assert engine.db.claim_event('review', 'REVIEW_CE', START - timedelta(seconds=25), 'REVIEW ONLY')
    mock_clock(monkeypatch, clock)

    async def slow_rest(_start, _token):
        clock[0] += timedelta(seconds=14)
        await engine._deliver_outbox(_start)

    monkeypatch.setattr(engine, '_collect_once', slow_rest)
    await engine.run_once()
    assert phone.messages == ['REVIEW ONLY']
    row = engine.db.read_delivery_audit_rows()[0]
    assert row[4] == (START + timedelta(seconds=14)).astimezone(timezone.utc).isoformat()
    assert row[-1] == (START + timedelta(seconds=21)).astimezone(timezone.utc).isoformat()


@pytest.mark.asyncio
async def test_live_clock_context_resets_even_if_collection_fails(tmp_path, monkeypatch):
    engine = make_engine(tmp_path)
    clock = [START]
    mock_clock(monkeypatch, clock)

    async def bad_rest(_start, _token):
        raise RuntimeError('synthetic broker outage')

    monkeypatch.setattr(engine, '_collect_once', bad_rest)
    await engine.run_once()
    assert engine.status == 'WAIT_DATA'
    assert engine._live_delivery_clock.get() is False

@pytest.mark.asyncio
async def test_live_option_quote_is_checked_at_response_time_not_old_candle_time(tmp_path, monkeypatch):
    from test_simulated_broker_pipeline import (
        engine as fake_market_engine, FakeKite, NOW, synthetic_candidate
    )

    instance = fake_market_engine(tmp_path, monkeypatch)
    monkeypatch.setattr(engine_module, 'decide', synthetic_candidate)
    clock = [NOW]
    mock_clock(monkeypatch, clock)

    def lagged_valid_quote(self, symbol):
        clock[0] += timedelta(seconds=16)
        return {'instrument_token': 779, 'timestamp': clock[0],
                'depth': {'buy': [{'price': 99.5, 'quantity': 65}],
                          'sell': [{'price': 100.5, 'quantity': 65}]}}

    monkeypatch.setattr(FakeKite, 'full_quote', lagged_valid_quote)
    await instance.run_once()
    assert instance.status == 'REVIEW_CE'
    assert len(instance.telegram.sent) == 1
    rows = instance.db.read_delivery_audit_rows()
    assert rows[0][1] == clock[0].isoformat()
    observation = instance.db.read_option_quote_observations()[0]
    assert observation['phase'] == 'ENTRY'


@pytest.mark.asyncio
async def test_live_quote_that_was_fresh_at_poll_start_is_rejected_if_stale_on_arrival(tmp_path, monkeypatch):
    from test_simulated_broker_pipeline import (
        engine as fake_market_engine, FakeKite, NOW, synthetic_candidate
    )

    instance = fake_market_engine(tmp_path, monkeypatch)
    monkeypatch.setattr(engine_module, 'decide', synthetic_candidate)
    clock = [NOW]
    mock_clock(monkeypatch, clock)

    def lagged_stale_quote(self, symbol):
        clock[0] += timedelta(seconds=21)
        return {'instrument_token': 779, 'timestamp': NOW,
                'depth': {'buy': [{'price': 99.5, 'quantity': 65}],
                          'sell': [{'price': 100.5, 'quantity': 65}]}}

    monkeypatch.setattr(FakeKite, 'full_quote', lagged_stale_quote)
    await instance.run_once()
    assert instance.status == 'NO_TRADE'
    assert instance.telegram.sent == []
    assert instance.db.get_runtime('virtual_candidate') is None
    assert instance.db.get_runtime('last_processed_candle') is None


@pytest.mark.asyncio
async def test_live_quote_crossing_entry_cutoff_never_generates_buy(tmp_path, monkeypatch):
    from test_simulated_broker_pipeline import (
        engine as fake_market_engine, FakeKite, NOW, synthetic_candidate
    )

    instance = fake_market_engine(tmp_path, monkeypatch)
    monkeypatch.setattr(engine_module, 'decide', synthetic_candidate)
    clock = [NOW]
    mock_clock(monkeypatch, clock)

    def quote_arriving_too_late(self, symbol):
        clock[0] = NOW.replace(hour=15, minute=0, second=1)
        return {'instrument_token': 779, 'timestamp': clock[0],
                'depth': {'buy': [{'price': 99.5, 'quantity': 65}],
                          'sell': [{'price': 100.5, 'quantity': 65}]}}

    monkeypatch.setattr(FakeKite, 'full_quote', quote_arriving_too_late)
    await instance.run_once()
    assert instance.status == 'NO_TRADE'
    assert instance.telegram.sent == []
    assert instance.db.get_runtime('virtual_candidate') is None
