"""Integrated offline entry paper reference -> live BID exit review; never orders."""
import json
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
import pytest
from cryptography.fernet import Fernet
from cloud_alerts.engine import Engine
from cloud_alerts.security import TokenVault
from cloud_alerts.state import State
from cloud_alerts.models import Candle,Decision,Indicators
from cloud_alerts import engine as module
IST=ZoneInfo('Asia/Kolkata')
NOW=datetime(2026,10,19,12,0,12,tzinfo=IST)

class FakeTelegram:
    def __init__(self):self.messages=[]
    def send(self,body):self.messages.append(body)

class Broker:
    price=99.5
    calls=[]
    def __init__(self,key,token):
        if key!='SYNTHETIC_KEY' or not token.startswith('SYNTHETIC_TOKEN'):
            raise AssertionError('authentication mismatch')
    def instruments_nfo(self):
        return [dict(name='NIFTY',segment='NFO-FUT',instrument_type='FUT',expiry='2026-10-27',instrument_token=77,tradingsymbol='NIFTY26OCTFUT',lot_size=65),
                dict(name='NIFTY',segment='NFO-OPT',instrument_type='CE',expiry='2026-10-20',instrument_token=88,tradingsymbol='NIFTY26OCT23000CE',lot_size=65,strike=23000)]
    def historical(self,token,interval,start,end):
        Broker.calls.append(('historical',interval))
        minutes=5 if interval=='5minute' else 15
        last=NOW.replace(minute=(NOW.minute//minutes)*minutes,second=0,microsecond=0)-timedelta(minutes=minutes)
        n=85 if minutes==5 else 45
        return [Candle(last-timedelta(minutes=(n-1-i)*minutes),23000,23025,22975,23002+i*.002,8000+i) for i in range(n)]
    def full_quote(self,symbol):
        Broker.calls.append(('quote',symbol))
        return {'timestamp':Broker.quote_at,'depth':{'buy':[{'price':Broker.price,'quantity':65}],
                                                    'sell':[{'price':Broker.price+.5,'quantity':65}]}}

def decision(cs,now,confirm):
    return Decision('REVIEW_CE','OFFLINE_SYNTHETIC_ONLY',cs[-1],
                    Indicators(22900,23012,23001,29,16,28,26,24),22930,23130)

def setup(tmp_path,monkeypatch):
    Broker.calls=[];Broker.price=99.5;Broker.quote_at=NOW
    monkeypatch.setattr(module,'KiteReadOnly',Broker)
    monkeypatch.setattr(module,'decide',decision)
    v=TokenVault(tmp_path/'token.enc',Fernet.generate_key().decode())
    v.put('SYNTHETIC_TOKEN_1234567891234567',NOW)
    return Engine('SYNTHETIC_KEY',v,State(str(tmp_path/'test.sqlite')),FakeTelegram(),
                  enabled=True,paper_premium_tracking=True)

@pytest.mark.asyncio
async def test_entry_and_premium_exit_pipeline_exactly_once(tmp_path,monkeypatch):
    engine=setup(tmp_path,monkeypatch)
    await engine.run_once(NOW)
    assert engine.status=='REVIEW_CE'
    assert len(engine.telegram.messages)==1
    assert 'POTENTIAL BUY CE' in engine.telegram.messages[0]
    active=json.loads(engine.db.get_runtime('virtual_candidate'))
    assert active['premium']['reference_ask']==100
    assert active['premium']['stop_bid']==80
    assert active['premium']['paper_only'] is True
    assert len([c for c in Broker.calls if c[0]=='quote'])==1
    Broker.price=79.5;Broker.quote_at=NOW+timedelta(seconds=20)
    await engine.poll_virtual_premium(NOW+timedelta(seconds=20))
    assert engine.premium_status=='EXIT_REVIEW_STOP'
    assert len(engine.telegram.messages)==2
    assert 'VIRTUAL OPTION EXIT REVIEW (STOP)' in engine.telegram.messages[-1]
    assert engine.db.get_runtime('virtual_candidate')==''
    await engine.poll_virtual_premium(NOW+timedelta(seconds=40))
    assert len(engine.telegram.messages)==2
    assert all('NO ORDERS PLACED' in msg or 'NOT A BUY ORDER' in msg for msg in engine.telegram.messages)

@pytest.mark.asyncio
async def test_active_virtual_cannot_be_overwritten_by_next_signal(tmp_path,monkeypatch):
    e=setup(tmp_path,monkeypatch)
    await e.run_once(NOW)
    saved=e.db.get_runtime('virtual_candidate')
    # A new 5m candle with another potential trade must not destroy reference.
    t=NOW+timedelta(minutes=5)
    await e.run_once(t)
    assert e.db.get_runtime('virtual_candidate')==saved
    assert len(e.telegram.messages)==1
    assert e.status in ('NO_TRADE','WAIT_DATA')
