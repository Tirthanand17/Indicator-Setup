"""Offline-only regressions: Telegram backlog must not starve fresh Kite polling."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from cryptography.fernet import Fernet

from cloud_alerts import engine as engine_module
from cloud_alerts.engine import Engine
from cloud_alerts.security import TokenVault
from cloud_alerts.state import State

IST = ZoneInfo('Asia/Kolkata')
AT = datetime(2026, 10, 19, 11, 5, 0, tzinfo=IST)


class FakePhone:
    def __init__(self, failure_at=None):
        self.sent=[]
        self.calls=0
        self.failure_at=failure_at

    def send(self, body):
        self.calls+=1
        if self.calls==self.failure_at:
            raise RuntimeError('simulated Telegram outage with private context')
        self.sent.append(body)


def build(tmp_path, phone=None, *, premium=False):
    phone=phone or FakePhone()
    state=State(str(tmp_path/'alerts.sqlite3'))
    vault=TokenVault(tmp_path/'token.enc',Fernet.generate_key().decode())
    worker=Engine('SYNTHETIC', vault, state, phone, enabled=True,
                  paper_premium_tracking=premium)
    return worker


@pytest.mark.asyncio
async def test_ten_queued_messages_use_maximum_two_send_attempts_per_pass(tmp_path):
    e=build(tmp_path)
    for n in range(10):
        assert e.db.claim_event(f'e{n:02d}', 'REVIEW_CE', AT+timedelta(seconds=n), f'PAPER-{n}')
    await e._deliver_outbox(AT + timedelta(seconds=30))
    assert e.telegram.sent == ['PAPER-0','PAPER-1']
    assert len(e.db.pending_events()) == 8
    assert sum(row[3] for row in e.db.read_delivery_audit_rows())==2
    # Later one-minute retries drain the queue without skipping or duplicating
    # its oldest surviving events.
    await e._deliver_outbox(AT + timedelta(seconds=60))
    assert e.telegram.sent == [f'PAPER-{i}' for i in range(4)]
    for _ in range(3):
        await e._deliver_outbox(AT + timedelta(seconds=90))
    assert e.telegram.sent == [f'PAPER-{i}' for i in range(10)]
    assert e.db.pending_events() == []
    assert e.db.outbox_summary()['accepted'] == 10


@pytest.mark.asyncio
async def test_failed_delivery_stops_batch_and_keeps_retries_durable(tmp_path):
    phone=FakePhone(failure_at=2)
    e=build(tmp_path,phone)
    for n in range(4):
        e.db.claim_event(f'id-{n}', 'REVIEW_PE', AT + timedelta(seconds=n), f'NOTICE-{n}')
    await e._deliver_outbox(AT+timedelta(seconds=10))
    assert phone.calls==2
    assert phone.sent==['NOTICE-0']
    assert len(e.db.pending_events())==3
    assert [row[3] for row in e.db.read_delivery_audit_rows()] == [1,1,0,0]
    await e._deliver_outbox(AT+timedelta(seconds=30))
    assert phone.sent==['NOTICE-0','NOTICE-1','NOTICE-2']
    await e._deliver_outbox(AT+timedelta(seconds=60))
    assert phone.sent==['NOTICE-0','NOTICE-1','NOTICE-2','NOTICE-3']
    assert len(e.db.pending_events())==0
    assert [row[3] for row in e.db.read_delivery_audit_rows()] == [1,2,1,1]


@pytest.mark.asyncio
@pytest.mark.parametrize('bad', [0,3,10,False,True,'2',1.0,None])
async def test_delivery_batch_limit_rejects_unbounded_values(tmp_path,bad):
    e=build(tmp_path)
    with pytest.raises(ValueError,match='bounded'):
        await e._deliver_outbox(AT,max_sends=bad)


@pytest.mark.asyncio
async def test_market_candle_gets_scheduling_priority_over_telegram_and_premium(tmp_path,monkeypatch):
    e=build(tmp_path,premium=True)
    order=[]

    class Scheduler:
        def claim(self, now):
            order.append('claim')
            return True

    async def market_poll():
        order.append('REST')

    async def outbox(now=None, *, max_sends=2):
        order.append('TELEGRAM')

    async def premium(now=None):
        order.append('PREMIUM')

    async def break_loop(_):
        raise asyncio.CancelledError()

    monkeypatch.setattr(engine_module,'CandlePollScheduler',Scheduler)
    monkeypatch.setattr(e,'run_once',market_poll)
    monkeypatch.setattr(e,'_deliver_outbox',outbox)
    monkeypatch.setattr(e,'poll_virtual_premium',premium)
    monkeypatch.setattr(engine_module.asyncio,'sleep',break_loop)
    with pytest.raises(asyncio.CancelledError):
        await e.run_forever()
    assert order==['claim','REST','TELEGRAM','PREMIUM']


@pytest.mark.asyncio
async def test_expiry_still_applies_when_second_batch_is_delayed(tmp_path):
    e=build(tmp_path)
    for n in range(4):
        e.db.claim_event(f'event-{n}', 'REVIEW_CE', AT, f'ALERT-{n}')
    await e._deliver_outbox(AT+timedelta(seconds=170))
    assert e.telegram.sent==['ALERT-0','ALERT-1']
    await e._deliver_outbox(AT+timedelta(seconds=181))
    assert e.telegram.sent==['ALERT-0','ALERT-1']
    assert e.db.outbox_summary()['expired']==2
    assert len(e.db.pending_events())==0
