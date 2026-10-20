"""Official 2026 NSE F&O calendar safety tests; zero broker/network activity."""
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import json
import pytest
from cryptography.fernet import Fernet

from cloud_alerts.trading_calendar import (
    CalendarUnavailable, CALENDAR_VERSION, session_status, regular_session,
)
from cloud_alerts.scheduler import CandlePollScheduler
from cloud_alerts.session_coverage import boundary_for, expected_boundaries, coverage_report
from cloud_alerts.operational import assess_operational
from cloud_alerts.security import TokenVault
from cloud_alerts.state import State
from cloud_alerts.engine import Engine
from cloud_alerts.signals import decide
from cloud_alerts.session_audit_cli import run_cli

IST = ZoneInfo('Asia/Kolkata')
HOLIDAY = date(2026, 10, 20)
OPEN = date(2026, 10, 21)


def at(day, hour=9, minute=30, second=12):
    return datetime(day.year, day.month, day.day, hour, minute, second, tzinfo=IST)


@pytest.mark.parametrize('holiday',[
    date(2026, 1, 15), date(2026, 1, 26), date(2026, 3, 3),
    date(2026, 3, 26), date(2026, 3, 31), date(2026, 4, 3),
    date(2026, 4, 14), date(2026, 5, 1), date(2026, 5, 28),
    date(2026, 6, 26), date(2026, 9, 14), date(2026, 10, 2),
    date(2026, 10, 20), date(2026, 11, 10), date(2026, 11, 24),
    date(2026, 12, 25),
])
def test_nse_fo_2026_holidays(holiday):
    assert session_status(holiday) == 'HOLIDAY'
    assert not regular_session(holiday)


def test_nontrading_and_special_session_handling():
    assert session_status(date(2026,10,18)) == 'WEEKEND'
    assert session_status(date(2026,11,8)) == 'WEEKEND'  # Muhurat isn't a regular session.
    assert session_status(date(2026,10,19)) == 'REGULAR'
    assert session_status(OPEN) == 'REGULAR'
    assert '2026' in CALENDAR_VERSION


@pytest.mark.parametrize('invalid',[date(2025,10,20),date(2027,1,4),date(2028,10,20)])
def test_unknown_calendar_year_cannot_be_assumed_open(invalid):
    with pytest.raises(CalendarUnavailable): session_status(invalid)


@pytest.mark.parametrize('invalid',[None,'2026-10-20',datetime(2026,10,20,9,tzinfo=IST)])
def test_calendar_refuses_bad_types(invalid):
    with pytest.raises(ValueError):session_status(invalid)


def test_scheduler_and_boundary_never_poll_fo_holiday_or_unknown_year():
    scheduler=CandlePollScheduler()
    assert not scheduler.claim(at(HOLIDAY))
    assert not scheduler.claim(at(HOLIDAY).astimezone(timezone.utc))
    assert boundary_for(at(HOLIDAY)) is None
    assert not scheduler.claim(at(date(2027,1,4)))
    assert boundary_for(at(date(2027,1,4))) is None
    assert scheduler.claim(at(OPEN))
    assert boundary_for(at(OPEN))==at(OPEN,second=0)


def test_coverage_does_not_count_exchange_holiday_as_failed_session():
    with pytest.raises(ValueError):expected_boundaries(HOLIDAY)
    with pytest.raises(CalendarUnavailable):expected_boundaries(date(2027,1,4))
    with pytest.raises(ValueError):coverage_report([], [HOLIDAY])
    report=coverage_report([], [OPEN])
    assert report['expected_boundaries']==73
    assert report['never_observed_boundaries']==73
    assert report['official_fo_calendar_version']==CALENDAR_VERSION
    assert report['calendar_live_reverified'] is False
    assert report['telegram_phone_receipt_verified'] is False


def test_holiday_audit_cli_rejects_without_writing_database(tmp_path,capsys):
    state=State(str(tmp_path/'alerts.sqlite3'))
    before=(tmp_path/'alerts.sqlite3').read_bytes()
    result=run_cli(['--state-db',state.path,'--session-date','2026-10-20'])
    assert result==2
    assert json.loads(capsys.readouterr().out)['error']=='SESSION_COVERAGE_UNAVAILABLE'
    assert (tmp_path/'alerts.sqlite3').read_bytes()==before


class NoBrokerOrTelegram:
    def send(self,text):
        raise AssertionError('No phone sends on a holiday')


def make_engine(tmp_path):
    vault=TokenVault(tmp_path/'token.enc',Fernet.generate_key().decode())
    return Engine('ONLY_FAKE',vault,State(str(tmp_path/'events.db')),NoBrokerOrTelegram(),
                  enabled=True,paper_premium_tracking=True)


@pytest.mark.asyncio
async def test_engine_short_circuits_on_holiday_without_broker_or_token(tmp_path,monkeypatch):
    engine=make_engine(tmp_path)
    async def forbidden(*args,**kwargs):
        raise AssertionError('Holiday must skip market collection')
    monkeypatch.setattr(engine,'_collect_once',forbidden)
    await engine.run_once(at(HOLIDAY))
    assert engine.status == 'EXCHANGE_CLOSED'
    assert not engine.db.read_rest_coverage()
    await engine.poll_virtual_premium(at(HOLIDAY))
    assert engine.premium_status in {'EXCHANGE_CLOSED','IDLE'}
    assert engine.last_data_at is None
    await engine.run_once(at(date(2027,1,4)))
    assert engine.status=='WAIT_CALENDAR'


@pytest.mark.asyncio
async def test_premium_watcher_clears_yesterday_candidate_on_holiday(tmp_path):
    engine=make_engine(tmp_path)
    yesterday=HOLIDAY-timedelta(days=1)
    engine.db.set_runtime('virtual_candidate',json.dumps({'expiry_date':yesterday.isoformat()}))
    await engine.poll_virtual_premium(at(HOLIDAY))
    assert engine.db.get_runtime('virtual_candidate')==''
    assert engine.premium_status=='EXPIRED_CANDIDATE_CLEARED'


def test_direct_signal_never_generates_entry_on_holiday():
    assert decide([],at(HOLIDAY),[]).status=='NO_TRADE'
    assert decide([],at(date(2027,1,4)),[]).status=='WAIT_DATA'


def test_operational_reports_holiday_distinctly():
    holiday=assess_operational(at(HOLIDAY),worker_running=True,enabled=True,
            token_present=True,last_data_at=at(HOLIDAY)-timedelta(seconds=5),status='REVIEW_CE')
    assert holiday['reason']=='EXCHANGE_HOLIDAY'
    assert not holiday['monitoring_data_ready']
    unknown=assess_operational(at(date(2027,1,4)),worker_running=True,enabled=True,
            token_present=True,last_data_at=None,status='NO_TRADE')
    assert unknown['reason']=='CALENDAR_UNAVAILABLE'


def test_offline_calendar_cli_reports_holiday_and_open_day_without_network(capsys):
    from cloud_alerts.calendar_cli import run_cli
    assert run_cli(['--date','2026-10-20'])==0
    holiday=json.loads(capsys.readouterr().out)
    assert holiday['session_status']=='HOLIDAY'
    assert holiday['regular_session_verified'] is False
    assert holiday['calendar_is_live'] is False
    assert holiday['broker_calls_made'] is False
    assert run_cli(['--date','2026-10-21'])==0
    regular=json.loads(capsys.readouterr().out)
    assert regular['session_status']=='REGULAR'
    assert regular['regular_session_verified'] is True
    assert run_cli(['--date','2027-01-04'])==2
    assert json.loads(capsys.readouterr().out)['calendar']=='UNAVAILABLE'
    assert run_cli(['--date','2026-99-99'])==2
    assert json.loads(capsys.readouterr().out)['regular_session_verified'] is False


def test_historical_replay_rejects_fabricated_holiday_candles():
    from cloud_alerts.replay import replay_history, ReplayError
    from cloud_alerts.models import Candle
    candle = Candle(at(HOLIDAY,9,15,0), 23000, 23001,22999,23000,300)
    with pytest.raises(ReplayError,match='holiday'):
        replay_history([candle],[candle],window_start=at(HOLIDAY),window_end=at(HOLIDAY,15,0))


@pytest.mark.asyncio
async def test_shadow_connection_is_closed_on_holiday():
    from cloud_alerts.stream_supervisor import ShadowSupervisor
    supervisor=ShadowSupervisor('FAKE_FOR_TEST')
    class FakeSocket:
        stopped=False
        def stop(self):self.stopped=True
    socket=FakeSocket()
    supervisor._socket=socket
    assert await supervisor.stop_after_session(at(HOLIDAY)) is True
    assert socket.stopped
