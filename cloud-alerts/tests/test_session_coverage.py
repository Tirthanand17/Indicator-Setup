"""Offline tests never call Kite, Telegram, broker accounts or host APIs."""
import asyncio
import json
from datetime import datetime, date, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from cryptography.fernet import Fernet

from cloud_alerts.session_coverage import boundary_for, expected_boundaries, coverage_report
from cloud_alerts.session_audit_cli import read_only_ledger, run_cli
from cloud_alerts.security import TokenVault
from cloud_alerts.engine import Engine
from cloud_alerts.state import State

IST=ZoneInfo('Asia/Kolkata')
DAY=date(2026,10,19)
FIRST=datetime(2026,10,19,9,25,8,tzinfo=IST)
END=datetime(2026,10,19,15,25,43,tzinfo=IST)


class NoSend:
    def send(self, message):
        raise AssertionError('this test must never send Telegram')


def test_expected_slots_and_timezone_conversion():
    slots=expected_boundaries(DAY)
    assert len(slots)==73
    assert slots[0]==FIRST.replace(second=0).astimezone(timezone.utc)
    assert slots[-1]==END.replace(second=0).astimezone(timezone.utc)
    assert boundary_for(END)==END.replace(second=0)
    assert boundary_for(END.astimezone(timezone.utc))==END.replace(second=0)
    assert boundary_for(END.replace(hour=15,minute=26)) is None
    assert boundary_for(FIRST.replace(hour=9,minute=20)) is None


@pytest.mark.parametrize('date_value',[date(2026,10,18), '2026-10-19', datetime(2026,10,19,10,tzinfo=IST)])
def test_explicit_weekday_dates_only(date_value):
    with pytest.raises(ValueError):expected_boundaries(date_value)


def test_persistent_retry_rest_success_wins_over_later_failures(tmp_path):
    db=tmp_path/'events.sqlite3'
    state=State(str(db))
    state.record_rest_attempt(FIRST,'WAIT_TOKEN')
    state.record_rest_attempt(FIRST+timedelta(seconds=15),'REST_VALID')
    state.record_rest_attempt(FIRST+timedelta(seconds=25),'API_ERROR')
    rows=state.read_rest_coverage()
    assert len(rows)==1 and rows[0][1:]==(3,'REST_VALID')
    assert State(str(db)).read_rest_coverage()==rows
    report=coverage_report(rows,[DAY])
    assert report['valid_rest_boundaries']==1
    assert report['never_observed_boundaries']==72
    assert report['rest_coverage_pct']==round(100/73,2)
    assert not report['paper_session_acceptance_proven']


def test_entire_session_audit_and_missing_day_not_misrepresented(tmp_path):
    s=State(str(tmp_path/'state.sqlite3'))
    for t in expected_boundaries(DAY):
        s.record_rest_attempt(t.astimezone(IST)+timedelta(seconds=8),'REST_VALID')
    days=[DAY,date(2026,10,21)]
    summary=coverage_report(s.read_rest_coverage(),days)
    assert summary['valid_rest_boundaries']==73
    assert summary['never_observed_boundaries']==73
    assert summary['rest_coverage_pct']==50.0
    assert summary['daily'][0]['complete_rest_coverage']
    assert not summary['daily'][1]['complete_rest_coverage']
    assert not summary['all_selected_sessions_complete']
    assert not summary['telegram_phone_receipt_verified']


@pytest.mark.parametrize('outcome',['BAD','',None,True])
def test_bad_outcomes_rejected(tmp_path,outcome):
    s=State(str(tmp_path/'s.db'))
    with pytest.raises(ValueError):s.record_rest_attempt(FIRST,outcome)


def test_invalid_and_duplicate_snapshots_fail_closed():
    row=(expected_boundaries(DAY)[0].isoformat(),1,'REST_VALID')
    with pytest.raises(ValueError):coverage_report([row,row],[DAY])
    with pytest.raises(ValueError):coverage_report([(row[0],False,row[2])],[DAY])
    with pytest.raises(ValueError):coverage_report([('not-a-date',1,'REST_VALID')],[DAY])
    with pytest.raises(ValueError):coverage_report([],[DAY,DAY])
    with pytest.raises(ValueError):coverage_report([],[])


def test_readonly_cli_does_not_write_db_or_claim_real_operations(tmp_path,capsys):
    db=tmp_path/'example.sqlite3'
    state=State(str(db))
    state.record_rest_attempt(FIRST,'WAIT_TOKEN')
    state.record_rest_attempt(FIRST+timedelta(seconds=15),'REST_VALID')
    before=db.read_bytes()
    assert run_cli(['--state-db',str(db),'--session-date','2026-10-19'])==0
    out=json.loads(capsys.readouterr().out)
    assert out['selected_sessions']==1 and out['valid_rest_boundaries']==1
    assert out['exchange_holidays_independently_verified'] is False
    assert out['telegram_phone_receipt_verified'] is False
    assert db.read_bytes()==before
    assert read_only_ledger(db)==state.read_rest_coverage()


def test_cli_fail_closed_and_sanitized_error(tmp_path,capsys):
    db=tmp_path/'missing.sqlite3'
    assert run_cli(['--state-db',str(db),'--session-date','2026-10-19'])==2
    out=capsys.readouterr().out
    assert 'missing.sqlite3' not in out
    assert json.loads(out)['error']=='SESSION_COVERAGE_UNAVAILABLE'
    state=State(str(db))
    assert run_cli(['--state-db',str(db),'--session-date','2026-10-18'])==2
    assert 'SESSION_COVERAGE_UNAVAILABLE' in capsys.readouterr().out


def engine(tmp_path, enabled=True):
    v=TokenVault(tmp_path/'token.enc',Fernet.generate_key().decode())
    return Engine('FAKE_TEST',v,State(str(tmp_path/'events.db')),NoSend(),enabled=enabled)


@pytest.mark.asyncio
async def test_real_engine_missing_token_is_ledger_wait_not_fake_data(tmp_path):
    e=engine(tmp_path)
    await e.run_once(FIRST)
    assert e.status=='WAIT_TOKEN'
    assert e.db.read_rest_coverage()[0][2]=='WAIT_TOKEN'


@pytest.mark.asyncio
async def test_1525_last_boundary_is_eligible_and_1526_closed(tmp_path):
    e=engine(tmp_path)
    await e.run_once(END)
    assert e.status=='WAIT_TOKEN'
    assert len(e.db.read_rest_coverage())==1
    await e.run_once(END.replace(minute=26))
    assert e.status=='MARKET_CLOSED'
    assert len(e.db.read_rest_coverage())==1


@pytest.mark.asyncio
async def test_verified_decision_records_only_one_boundary_with_retries(tmp_path,monkeypatch):
    e=engine(tmp_path)
    e.vault.put('SYNTHETIC_TOKEN_VALID_123456789',FIRST)
    async def fake_collect(now,token):
        assert token.startswith('SYNTHETIC')
        e._rest_verified_at=now
    monkeypatch.setattr(e,'_collect_once',fake_collect)
    await e.run_once(FIRST)
    await e.run_once(FIRST+timedelta(seconds=15))
    rows=e.db.read_rest_coverage()
    assert len(rows)==1 and rows[0][1:]==(2,'REST_VALID')


@pytest.mark.asyncio
async def test_broker_failure_records_api_error_not_success(tmp_path,monkeypatch):
    e=engine(tmp_path)
    e.vault.put('SYNTHETIC_TOKEN_VALID_123456789',FIRST)
    async def bad_collect(now,token):raise RuntimeError('fake broker unavailable')
    monkeypatch.setattr(e,'_collect_once',bad_collect)
    await e.run_once(FIRST)
    assert e.status=='WAIT_DATA'
    assert e.db.read_rest_coverage()[0][2]=='API_ERROR'


def test_coverage_rejects_off_boundary_timestamps_even_when_not_selected():
    with pytest.raises(ValueError):
        coverage_report([(FIRST.astimezone(timezone.utc).isoformat(), 1, 'REST_VALID')], [DAY])
    wrong=expected_boundaries(DAY)[0].replace(minute=23)
    with pytest.raises(ValueError):
        coverage_report([(wrong.isoformat(), 1, 'REST_VALID')], [DAY])


@pytest.mark.asyncio
async def test_verified_candle_remains_logged_if_later_delivery_fails(tmp_path,monkeypatch):
    e=engine(tmp_path)
    e.vault.put('SYNTHETIC_TOKEN_VALID_123456789',FIRST)
    async def later_failure(now,token):
        e._rest_verified_at=now
        raise RuntimeError('fake Telegram failure after verified candle')
    monkeypatch.setattr(e,'_collect_once',later_failure)
    await e.run_once(FIRST)
    assert e.status=='WAIT_DATA'
    assert e.db.read_rest_coverage()[0][2]=='REST_VALID'
