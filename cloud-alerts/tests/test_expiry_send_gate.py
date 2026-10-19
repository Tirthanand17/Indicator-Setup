"""Offline regressions: stale BUY must not be newly dispatched or authorize EXIT."""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import json

import pytest
from cryptography.fernet import Fernet

from cloud_alerts import engine as engine_module
from cloud_alerts.engine import Engine
from cloud_alerts.security import TokenVault
from cloud_alerts.state import State
from cloud_alerts.models import Candle

IST=ZoneInfo('Asia/Kolkata')
T=datetime(2026,10,19,11,0,0,tzinfo=IST)


def storage(tmp_path):
    return State(str(tmp_path/'events.sqlite'))


def paper_engine(tmp_path,state=None,phone=None):
    class FakePhone:
        messages=[]
        def send(self,body):self.messages.append(body)
    return Engine('FAKE',TokenVault(tmp_path/'vault',Fernet.generate_key().decode()),
                  state or storage(tmp_path),phone or FakePhone(),enabled=True)


@pytest.mark.parametrize('age,expected', [(0,True),(179.999,True),(180,False),(181,False),(-4,True),(-6,False)])
def test_send_attempt_claim_checks_current_age_atomically(tmp_path,age,expected):
    db=storage(tmp_path)
    db.claim_event('review','REVIEW_CE',T-timedelta(seconds=age),'HIDDEN')
    assert db.claim_fresh_delivery_attempt('review',T)==expected
    assert db.event_delivery_status('review')==(0 if expected else 2)
    audit=db.read_delivery_audit_rows()[0]
    assert audit[3]==(1 if expected else 0)
    if expected:
        assert db.claim_fresh_delivery_attempt('review',T+timedelta(seconds=2)) == (age+2<180)


def test_cross_timezone_instants_and_malformed_rows_fail_closed(tmp_path):
    db=storage(tmp_path)
    db.claim_event('utc','REVIEW_PE',(T-timedelta(seconds=181)).astimezone(timezone.utc),'HIDDEN')
    assert db.claim_fresh_delivery_attempt('utc',T) is False
    assert db.event_delivery_status('utc')==2
    db.claim_event('corrupt','REVIEW_CE',T,'HIDDEN')
    with db._connect() as cx:
        cx.execute("UPDATE events SET at='not-a-date' WHERE event_id='corrupt'")
    assert db.claim_fresh_delivery_attempt('corrupt',T) is False
    assert db.event_delivery_status('corrupt')==2


def test_attempt_gate_refuses_already_sent_expired_and_missing(tmp_path):
    db=storage(tmp_path)
    db.claim_event('accepted','REVIEW_PE',T,'HIDDEN')
    db.mark_delivered('accepted',T+timedelta(seconds=3))
    db.claim_event('expired','REVIEW_PE',T-timedelta(minutes=5),'HIDDEN')
    db.expire_events_before(T-timedelta(seconds=180))
    for event in ('accepted','expired','missing'):
        assert not db.claim_fresh_delivery_attempt(event,T)


def test_attempt_gate_refuses_naive_time_and_invalid_ttl(tmp_path):
    db=storage(tmp_path)
    db.claim_event('e','REVIEW_PE',T,'HIDDEN')
    with pytest.raises(ValueError): db.claim_fresh_delivery_attempt('e',T.replace(tzinfo=None))
    with pytest.raises(ValueError): db.claim_fresh_delivery_attempt('e',T,max_age_seconds=0)
    with pytest.raises(ValueError): db.claim_fresh_delivery_attempt('e',T,max_age_seconds=181)
    assert db.read_delivery_audit_rows()[0][3]==0


@pytest.mark.asyncio
async def test_worker_rechecks_each_queued_message_after_slow_first_request(tmp_path,monkeypatch):
    db=storage(tmp_path)
    db.claim_event('first','REVIEW_CE',T-timedelta(seconds=20),'FIRST')
    db.claim_event('second','REVIEW_PE',T-timedelta(seconds=10),'SECOND STALE')
    current=[T]
    class VirtualClock:
        @staticmethod
        def now(tz=None): return current[0].astimezone(tz or IST)
    class SlowPhone:
        def __init__(self):self.messages=[]
        def send(self,body):
            self.messages.append(body)
            current[0]+=timedelta(seconds=171)
    phone=SlowPhone()
    e=paper_engine(tmp_path,db,phone)
    monkeypatch.setattr(engine_module,'datetime',VirtualClock)
    await e._deliver_outbox()
    assert phone.messages==['FIRST']
    assert db.event_delivery_status('second')==2
    assert db.read_delivery_audit_rows()[1][3]==0 # no send attempt for stale second
    assert db.event_delivery_status('first')==1 # accepted late; not authorized for paper exits
    assert db.entry_notice_delivery_state('first')=='LATE_ACCEPTED'


@pytest.mark.parametrize('seconds,expected',[(15,'ACCEPTED'),(179,'ACCEPTED'),(180,'LATE_ACCEPTED'),(181,'LATE_ACCEPTED'),(-10,'LATE_ACCEPTED')])
def test_virtual_entry_gate_uses_actual_acceptance_latency(tmp_path,seconds,expected):
    db=storage(tmp_path)
    db.claim_event('notice','REVIEW_PE',T,'PRIVATE ENTRY')
    db.mark_delivered('notice',T+timedelta(seconds=seconds))
    assert db.entry_notice_delivery_state('notice')==expected


def test_legacy_accepted_without_proven_time_cannot_authorize_exit(tmp_path):
    db=storage(tmp_path)
    db.claim_event('notice','REVIEW_CE',T,'PRIVATE')
    with db._connect() as cx:
        cx.execute("UPDATE events SET delivered=1,accepted_at_utc=NULL WHERE event_id='notice'")
    assert db.entry_notice_delivery_state('notice')=='UNVERIFIABLE'


@pytest.mark.asyncio
async def test_late_api_acceptance_never_authorizes_virtual_exit(tmp_path):
    db=storage(tmp_path)
    e=paper_engine(tmp_path,db)
    signal=T-timedelta(minutes=5)
    position={'direction':'CE','symbol':'NIFTY26OCTFUT','signal_candle':signal.isoformat(),
              'expiry_date':T.date().isoformat(),'entry_event_id':'notice',
              'entry':23000,'stop':22950,'target':23050}
    assert db.claim_entry_with_candidate('notice','REVIEW_CE',T,json.dumps(position),json.dumps(position))
    db.mark_delivered('notice',T+timedelta(seconds=181))
    await e._check_virtual_exit(Candle(T,23000,23050,22940,23000,100), 'NIFTY26OCTFUT',T+timedelta(minutes=5))
    assert e.telegram.messages==[]
    assert db.get_runtime('virtual_candidate')
    # Also clear a stale candidate on startup before any worker is launched.
    stats=db.reconcile_startup(T+timedelta(minutes=6))
    assert stats['cleared_stale_virtual_candidates']==1
    assert db.get_runtime('virtual_candidate')==''
