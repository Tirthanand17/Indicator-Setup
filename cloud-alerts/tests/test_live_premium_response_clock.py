"""Premium EXIT checks use live quote response time; fake broker and wall clock only."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from cloud_alerts import engine as engine_module
from test_premium_pipeline import NOW, Broker, setup

IST = ZoneInfo('Asia/Kolkata')


def clock_at(monkeypatch, current):
    class Clock:
        @staticmethod
        def now(tz=None):
            return current[0].astimezone(tz or IST)
    monkeypatch.setattr(engine_module, 'datetime', Clock)


def quote_at(instant):
    return {'instrument_token': 88, 'timestamp': instant,
            'depth': {'buy': [{'price': 79.5, 'quantity': 65}],
                      'sell': [{'price': 80.0, 'quantity': 65}]}}


@pytest.mark.asyncio
async def test_live_premium_rejects_quote_which_aged_during_network_request(tmp_path, monkeypatch):
    bot = setup(tmp_path, monkeypatch)
    await bot.run_once(NOW)
    assert len(bot.telegram.messages) == 1
    clock = [NOW + timedelta(seconds=20)]
    clock_at(monkeypatch, clock)

    def delayed_stale(self, symbol):
        clock[0] += timedelta(seconds=20)
        return quote_at(NOW + timedelta(seconds=20))

    monkeypatch.setattr(Broker, 'full_quote', delayed_stale)
    await bot.poll_virtual_premium()  # Unattended runtime: no time supplied.
    assert bot.premium_status == 'WAIT_FRESH_PREMIUM_QUOTE'
    assert len(bot.telegram.messages) == 1
    assert bot.db.get_runtime('virtual_candidate')
    assert not any(row['phase'] == 'EXIT' for row in bot.db.read_option_quote_observations())
    assert bot._live_delivery_clock.get() is False


@pytest.mark.asyncio
async def test_live_premium_accepts_fresh_response_time_and_persists_it(tmp_path, monkeypatch):
    bot = setup(tmp_path, monkeypatch)
    await bot.run_once(NOW)
    clock = [NOW + timedelta(seconds=20)]
    clock_at(monkeypatch, clock)

    def delayed_fresh(self, symbol):
        clock[0] += timedelta(seconds=7)
        return quote_at(clock[0])

    monkeypatch.setattr(Broker, 'full_quote', delayed_fresh)
    await bot.poll_virtual_premium()
    assert bot.premium_status == 'EXIT_REVIEW_STOP'
    assert len(bot.telegram.messages) == 2
    assert bot.db.get_runtime('virtual_candidate') == ''
    exit_row = [x for x in bot.db.read_option_quote_observations() if x['phase'] == 'EXIT'][0]
    assert datetime.fromisoformat(exit_row['observed_at_utc']) == clock[0]
    assert bot.last_premium_quote_at == clock[0]
    assert bot._live_delivery_clock.get() is False


@pytest.mark.asyncio
async def test_live_premium_crosses_time_cutoff_no_fictitious_bid_exit(tmp_path, monkeypatch):
    bot = setup(tmp_path, monkeypatch)
    await bot.run_once(NOW)
    clock = [NOW.replace(hour=15, minute=14, second=59)]
    clock_at(monkeypatch, clock)

    def crossing_cutoff(self, symbol):
        clock[0] += timedelta(seconds=2)
        return quote_at(clock[0])

    monkeypatch.setattr(Broker, 'full_quote', crossing_cutoff)
    await bot.poll_virtual_premium()
    assert bot.premium_status == 'EXIT_REVIEW_TIME'
    assert len(bot.telegram.messages) == 2
    assert 'No executable option bid available' in bot.telegram.messages[-1]
    assert not any(x['phase'] == 'EXIT' for x in bot.db.read_option_quote_observations())
    assert bot.db.get_runtime('virtual_candidate') == ''


@pytest.mark.asyncio
async def test_live_premium_does_not_send_after_market_session_ends(tmp_path, monkeypatch):
    bot = setup(tmp_path, monkeypatch)
    await bot.run_once(NOW)
    clock = [NOW.replace(hour=15, minute=14, second=59)]
    clock_at(monkeypatch, clock)

    def after_hours_response(self, symbol):
        # Simulate the host clock changing sharply while awaiting Kite.
        clock[0] += timedelta(minutes=12)
        return quote_at(clock[0])

    monkeypatch.setattr(Broker, 'full_quote', after_hours_response)
    await bot.poll_virtual_premium()
    assert bot.premium_status == 'SESSION_ENDED_DURING_QUOTE'
    assert len(bot.telegram.messages) == 1
    assert bot.db.get_runtime('virtual_candidate')
    assert bot._live_delivery_clock.get() is False


@pytest.mark.asyncio
async def test_explicit_offline_time_remains_deterministic(tmp_path, monkeypatch):
    bot = setup(tmp_path, monkeypatch)
    await bot.run_once(NOW)
    sample = NOW + timedelta(seconds=25)
    clock = [sample]
    clock_at(monkeypatch, clock)

    def lagged_response(self, symbol):
        clock[0] += timedelta(minutes=40)
        return quote_at(sample)

    monkeypatch.setattr(Broker, 'full_quote', lagged_response)
    await bot.poll_virtual_premium(sample)  # Deterministic offline test seam.
    assert bot.premium_status == 'EXIT_REVIEW_STOP'
    assert bot.last_premium_quote_at == sample
    assert bot._live_delivery_clock.get() is False


@pytest.mark.asyncio
async def test_live_premium_restores_clock_context_on_network_error(tmp_path, monkeypatch):
    bot = setup(tmp_path, monkeypatch)
    await bot.run_once(NOW)
    clock = [NOW + timedelta(seconds=25)]
    clock_at(monkeypatch, clock)

    def broker_fails(self, symbol):
        raise ConnectionError('synthetic broker failure')

    monkeypatch.setattr(Broker, 'full_quote', broker_fails)
    await bot.poll_virtual_premium()
    assert bot.premium_status == 'PREMIUM_QUOTE_UNAVAILABLE'
    assert bot._live_delivery_clock.get() is False
    assert len(bot.telegram.messages) == 1
