"""Offline shadow integration tests: REST must remain sole source of alerts."""
import pytest
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
from cryptography.fernet import Fernet
from cloud_alerts import engine as mod
from cloud_alerts.models import Candle,Decision
from cloud_alerts.engine import Engine
from cloud_alerts.security import TokenVault
from cloud_alerts.state import State
IST=ZoneInfo('Asia/Kolkata')
T=datetime(2026,10,19,12,0,12,tzinfo=IST)

class FakeBroker:
    def __init__(self,key,token):pass
    def instruments_nfo(self):return [dict(name='NIFTY',segment='NFO-FUT',instrument_type='FUT',expiry='2026-10-27',instrument_token=999,tradingsymbol='NIFTY26OCTFUT',lot_size=65)]
    def historical(self,token,interval,start,end):
        if interval=='5minute':
            return [Candle(datetime(2026,10,19,11,55,tzinfo=IST),23000,23004,22996,23003,800)]
        return [Candle(datetime(2026,10,19,11,45,tzinfo=IST),23000,23004,22996,23003,1100)]

class TG:
    def send(self,msg):raise AssertionError('Never send a trade from shadow data')

class FakeShadow:
    def __init__(self,fail=False):
        self.fail=fail;self.ensures=[];self.reconciles=[]
    async def ensure(self,token,inst):
        self.ensures.append(inst)
        if self.fail:raise RuntimeError('shadow transport failure')
        return True
    def reconcile(self,candle):self.reconciles.append(candle.start)
    def health(self):return {'status':'SHADOW_TEST','authority':'REST_ONLY'}

def make(tmp_path,shadow):
    vault=TokenVault(tmp_path/'secure_token',Fernet.generate_key().decode())
    vault.put('FAKE_DAILY_ACCESS_TOKEN_1234567890',T)
    return Engine('DUMMY',vault,State(str(tmp_path/'sqlite.db')),TG(),enabled=True,shadow=shadow)

@pytest.mark.asyncio
async def test_shadow_integrated_but_no_signal_generated(tmp_path,monkeypatch):
    monkeypatch.setattr(mod,'KiteReadOnly',FakeBroker)
    monkeypatch.setattr(mod,'decide',lambda c,n,c15:Decision('NO_TRADE','Momentum contradicts trend',c[-1]))
    sh=FakeShadow()
    e=make(tmp_path,sh)
    await e.run_once(T)
    assert e.status=='NO_TRADE'
    assert sh.ensures==[999]
    assert sh.reconciles==[datetime(2026,10,19,11,55,tzinfo=IST)]
    assert e.health()['shadow_stream']['authority']=='REST_ONLY'
    await e.run_once(T+timedelta(seconds=2))
    assert len(sh.reconciles)==1  # duplicate authenticated REST candle

@pytest.mark.asyncio
async def test_shadow_transport_failure_does_not_disable_broker_rest(tmp_path,monkeypatch):
    monkeypatch.setattr(mod,'KiteReadOnly',FakeBroker)
    monkeypatch.setattr(mod,'decide',lambda c,n,c15:Decision('NO_TRADE','Weak ADX',c[-1]))
    sh=FakeShadow(True)
    e=make(tmp_path,sh)
    await e.run_once(T)
    assert e.status=='NO_TRADE'
    assert not sh.reconciles  # diagnostic evidence unavailable
    assert e.db.get_runtime('last_processed_candle')
