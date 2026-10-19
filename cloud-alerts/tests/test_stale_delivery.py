import asyncio
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
import pytest
from cryptography.fernet import Fernet
from cloud_alerts.engine import Engine
from cloud_alerts.security import TokenVault
from cloud_alerts.state import State
IST=ZoneInfo('Asia/Kolkata')

class TG:
    def __init__(self):self.messages=[]
    def send(self,text):self.messages.append(text)

def make(tmp_path):
    return Engine('DUMMY_KEY',TokenVault(tmp_path/'enc',Fernet.generate_key().decode()),
          State(str(tmp_path/'alerts.db')),TG(),enabled=True)

@pytest.mark.asyncio
async def test_late_buy_alert_dropped_instead_of_delayed_delivery(tmp_path):
    e=make(tmp_path)
    older=datetime.now(IST)-timedelta(minutes=10)
    assert e.db.claim_event('old-buy','REVIEW_CE',older,'OLD BUY DO NOT SEND')
    await e._deliver_outbox()
    assert e.telegram.messages==[]
    assert not e.db.pending_events()
    assert e.health()['expired_alerts_discarded']==1

@pytest.mark.asyncio
async def test_recent_alert_delivered_once(tmp_path):
    e=make(tmp_path)
    t=datetime.now(IST)
    e.db.claim_event('new-candidate','REVIEW_PE',t,'PAPER PE REVIEW')
    await e._deliver_outbox()
    await e._deliver_outbox()
    assert e.telegram.messages==['PAPER PE REVIEW']
    assert e.health()['expired_alerts_discarded']==0
