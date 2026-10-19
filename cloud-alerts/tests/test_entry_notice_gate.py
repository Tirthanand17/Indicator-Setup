"""An undelivered/expired paper BUY must never lead to a misleading EXIT alert."""
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
import json
import pytest
from cryptography.fernet import Fernet
from cloud_alerts.state import State
from cloud_alerts.engine import Engine
from cloud_alerts.security import TokenVault
from cloud_alerts.models import Candle

IST=ZoneInfo('Asia/Kolkata')
NOW=datetime(2026,10,19,13,0,12,tzinfo=IST)

class FakePhone:
    def __init__(self):self.messages=[]
    def send(self,text):self.messages.append(text)

def create(tmp_path,*,premium=False):
    state=State(str(tmp_path/'db.sqlite'))
    phone=FakePhone()
    vault=TokenVault(tmp_path/'access.enc',Fernet.generate_key().decode())
    engine=Engine('SYNTHETIC_ONLY',vault,state,phone,enabled=True,
                  paper_premium_tracking=premium)
    position={'direction':'CE','symbol':'NIFTY26OCTFUT',
              'signal_candle':(NOW-timedelta(minutes=5)).isoformat(),
              'expiry_date':NOW.date().isoformat(), 'entry':23000,
              'stop':22950,'target':23050, 'entry_event_id':'notice-1'}
    return engine,position

def store(engine,position):
    assert engine.db.claim_entry_with_candidate('notice-1','REVIEW_CE',NOW,
            'FAKE BUY REVIEW',json.dumps(position))

def stopped_candle():
    return Candle(NOW,23000,23025,22940,22990,1000)

@pytest.mark.asyncio
async def test_undelivered_buy_does_not_create_underlying_exit(tmp_path):
    e,pos=create(tmp_path);store(e,pos)
    await e._check_virtual_exit(stopped_candle(),pos['symbol'],NOW+timedelta(minutes=5))
    assert e.db.pending_events()==[('notice-1','FAKE BUY REVIEW')]
    assert e.telegram.messages==[]
    assert e.db.get_runtime('virtual_candidate')

@pytest.mark.asyncio
async def test_expired_unsent_buy_clears_position_no_exit(tmp_path):
    e,pos=create(tmp_path);store(e,pos)
    e.db.expire_events_before(NOW+timedelta(seconds=1))
    assert e.db.event_delivery_status('notice-1')==2
    await e._check_virtual_exit(stopped_candle(),pos['symbol'],NOW+timedelta(minutes=5))
    assert e.telegram.messages==[]
    assert e.db.get_runtime('virtual_candidate')==''
    assert e.db.outbox_summary()['expired']==1

@pytest.mark.asyncio
async def test_accepted_entry_allows_underlying_exit_only_after_acceptance(tmp_path):
    e,pos=create(tmp_path);store(e,pos)
    await e._check_virtual_exit(stopped_candle(),pos['symbol'],NOW+timedelta(minutes=5))
    assert len(e.db.pending_events())==1
    e.db.mark_delivered('notice-1')
    await e._check_virtual_exit(stopped_candle(),pos['symbol'],NOW+timedelta(minutes=5))
    assert len(e.telegram.messages)==1
    assert 'EXIT REVIEW' in e.telegram.messages[0]
    assert e.db.event_delivery_status('notice-1')==1
    assert not e.db.get_runtime('virtual_candidate')

@pytest.mark.asyncio
async def test_premium_monitor_skips_unnotified_entry_before_quote(tmp_path,monkeypatch):
    e,pos=create(tmp_path,premium=True);store(e,pos)
    def forbid(*args,**kwargs):raise AssertionError('No Kite request without accepted entry')
    monkeypatch.setattr('cloud_alerts.engine.KiteReadOnly',forbid)
    await e.poll_virtual_premium(NOW+timedelta(seconds=10))
    assert e.premium_status=='ENTRY_NOTICE_QUEUED'
    assert e.db.get_runtime('virtual_candidate')
    assert e.telegram.messages==[]

@pytest.mark.asyncio
async def test_premium_monitor_clears_expired_entry_without_quote(tmp_path,monkeypatch):
    e,pos=create(tmp_path,premium=True);store(e,pos)
    e.db.expire_events_before(NOW+timedelta(seconds=1))
    monkeypatch.setattr('cloud_alerts.engine.KiteReadOnly',lambda *_: (_ for _ in ()).throw(AssertionError('broker called')))
    await e.poll_virtual_premium(NOW+timedelta(minutes=4))
    assert e.premium_status=='UNSENT_ENTRY_EXPIRED'
    assert e.db.get_runtime('virtual_candidate')==''
    assert e.telegram.messages==[]

@pytest.mark.asyncio
async def test_unknown_entry_event_cannot_generate_exit(tmp_path):
    e,pos=create(tmp_path)
    e.db.set_runtime('virtual_candidate',json.dumps(pos))
    await e._check_virtual_exit(stopped_candle(),pos['symbol'],NOW+timedelta(minutes=5))
    assert e.telegram.messages==[]
    assert e.db.get_runtime('virtual_candidate')
    assert e.status=='WAIT_DATA'

@pytest.mark.asyncio
async def test_restart_retains_entry_notice_gate(tmp_path):
    e,pos=create(tmp_path);store(e,pos)
    second=Engine(e.api_key,e.vault,State(str(tmp_path/'db.sqlite')),FakePhone(),enabled=True)
    await second._check_virtual_exit(stopped_candle(),pos['symbol'],NOW+timedelta(minutes=5))
    assert second.telegram.messages==[]
    assert second.db.get_runtime('virtual_candidate')
    second.db.mark_delivered('notice-1')
    await second._check_virtual_exit(stopped_candle(),pos['symbol'],NOW+timedelta(minutes=5))
    assert len(second.telegram.messages)==1
