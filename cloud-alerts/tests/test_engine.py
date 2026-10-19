import asyncio,pytest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
from cryptography.fernet import Fernet
from cloud_alerts.engine import Engine
from cloud_alerts.security import TokenVault
from cloud_alerts.state import State
IST=ZoneInfo('Asia/Kolkata')

class TG:
    def __init__(self):self.messages=[]
    def send(self,x):self.messages.append(x)

def engine(tmp_path,enabled=True):
    v=TokenVault(tmp_path/'token.enc',Fernet.generate_key().decode())
    return Engine('TEST_KEY',v,State(str(tmp_path/'state.db')),TG(),enabled=enabled)

@pytest.mark.asyncio
async def test_disabled_engine_does_not_call_kite(tmp_path):
    e=engine(tmp_path,False)
    await e.run_once(datetime(2026,10,19,10,tzinfo=IST))
    assert e.health()['status']=='DISABLED'

@pytest.mark.asyncio
async def test_missing_token_does_not_call_kite(tmp_path):
    e=engine(tmp_path)
    await e.run_once(datetime(2026,10,19,10,tzinfo=IST))
    assert e.health()['status']=='WAIT_TOKEN'

@pytest.mark.asyncio
async def test_during_weekend_no_signals(tmp_path):
    e=engine(tmp_path)
    await e.run_once(datetime(2026,10,18,10,tzinfo=IST))
    assert e.health()['status']=='MARKET_CLOSED'

@pytest.mark.asyncio
async def test_outbox_durable_no_duplicate(tmp_path):
    e=engine(tmp_path)
    t=datetime.now(IST)
    await e._send_event('unique','REVIEW_CE',t,'PAPER TEST ONLY')
    await e._send_event('unique','REVIEW_CE',t,'duplicate')
    assert e.telegram.messages==['PAPER TEST ONLY']
    assert not e.db.pending_events()
