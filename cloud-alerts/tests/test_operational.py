"""Operational report must fail closed without leaking tokens or overstating receipt."""
from datetime import datetime, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from cloud_alerts.operational import assess_operational
from cloud_alerts.server import build_app

IST = ZoneInfo('Asia/Kolkata')
MON = datetime(2026, 10, 19, 11, 35, tzinfo=IST)


def check(now=MON, **kwargs):
    params=dict(worker_running=True,enabled=True,token_present=True,
                last_data_at=now-timedelta(seconds=30),status='NO_TRADE',
                queued_alerts=0)
    params.update(kwargs)
    return assess_operational(now,**params)


def test_fresh_no_trade_means_monitoring_not_phone_verified():
    r=check()
    assert r['monitoring_data_ready'] and r['reason']=='FRESH_REST_DECISION'
    assert r['phone_receipt_verified'] is False and r['real_orders_enabled'] is False


@pytest.mark.parametrize('kwargs,reason',[
    ({'worker_running':False},'WORKER_NOT_RUNNING'),
    ({'enabled':False},'ALERTS_DISABLED'),
    ({'token_present':False},'DAILY_TOKEN_MISSING'),
    ({'queued_alerts':1},'PHONE_OUTBOX_PENDING'),
    ({'status':'PHONE_DELIVERY_FAILED'},'DATA_OR_DELIVERY_NOT_READY'),
    ({'status':'WAIT_DATA'},'DATA_OR_DELIVERY_NOT_READY'),
    ({'last_data_at':None},'NO_VERIFIED_REST_DECISION'),
    ({'last_data_at':MON-timedelta(minutes=8)},'REST_DATA_STALE'),
    ({'last_data_at':MON+timedelta(seconds=1)},'DATA_FUTURE_TIMESTAMP'),
])
def test_missing_operational_evidence_fails_closed(kwargs,reason):
    r=check(**kwargs)
    assert not r['monitoring_data_ready']
    assert r['reason']==reason


def test_after_hours_and_weekends_not_green():
    for now in (MON.replace(hour=15,minute=26),MON.replace(hour=9,minute=29),
                MON.replace(day=18),MON.replace(hour=4)):
        assert check(now)['reason']=='OUTSIDE_MONITORING_SESSION'


def test_invalid_timestamp_and_count_rejected():
    with pytest.raises(ValueError):check(MON.replace(tzinfo=None))
    with pytest.raises(ValueError):check(queued_alerts=-1)
    with pytest.raises(ValueError):check(queued_alerts=True)
    with pytest.raises(ValueError):check(max_age_seconds=3600)


def test_api_reports_token_only_readiness_not_operational_or_phone(tmp_path):
    cfg=SimpleNamespace(api_key='TEST',bot_token='FAKE_TEST_BOT',chat_id='FAKE',
                        relay_key='x'*64,vault_key=Fernet.generate_key().decode(),
                        root=tmp_path,enabled=True,validate=lambda:None)
    with TestClient(build_app(cfg)) as c:
        response=c.get('/operationalz')
        assert response.status_code==503
        assert response.json()['reason'] in {'DAILY_TOKEN_MISSING','OUTSIDE_MONITORING_SESSION','EXCHANGE_HOLIDAY'}
        assert response.json()['phone_receipt_verified'] is False
        assert c.get('/readyz').status_code==503
        assert 'FAKE_TEST_BOT' not in response.text
        assert 'x'*64 not in response.text
