"""Synthetic Telegram transport; no broker credentials or external calls."""
import asyncio
from datetime import datetime
from zoneinfo import ZoneInfo
import pytest
from cryptography.fernet import Fernet
from cloud_alerts.engine import Engine
from cloud_alerts.security import TokenVault
from cloud_alerts.state import State

IST=ZoneInfo('Asia/Kolkata')

class FakeTelegram:
    def __init__(self,fail=False): self.messages=[];self.fail=fail
    def send(self,payload):
        if self.fail:raise RuntimeError('fake outage')
        self.messages.append(payload)


def make_engine(tmp_path,fail=False,enabled=True):
    db=State(str(tmp_path/'private.sqlite3'))
    vault=TokenVault(tmp_path/'token.enc',Fernet.generate_key().decode())
    bot=FakeTelegram(fail)
    return Engine('KITE_TEST',vault,db,bot,enabled=enabled)

@pytest.mark.asyncio
async def test_missing_token_warns_once_on_regular_market_day(tmp_path):
    bot=make_engine(tmp_path)
    now=datetime(2026,10,19,9,25,8,tzinfo=IST)
    await bot.run_once(now)
    await bot.run_once(now.replace(minute=30))
    assert len(bot.telegram.messages)==1
    assert 'NOT A TRADE SIGNAL' in bot.telegram.messages[0]
    assert 'Kite access token' in bot.telegram.messages[0]
    assert 'SESSION_WAIT_TOKEN' in str(bot.db.outbox_summary()) or bot.db.is_sent('SESSION_WAIT_TOKEN:2026-10-19')
    assert bot.health()['status']=='WAIT_TOKEN'

@pytest.mark.asyncio
async def test_missing_token_notice_not_created_on_nse_holiday_or_weekend(tmp_path):
    bot=make_engine(tmp_path)
    await bot.run_once(datetime(2026,10,20,10,0,8,tzinfo=IST))
    await bot.run_once(datetime(2026,10,18,10,0,8,tzinfo=IST))
    assert bot.telegram.messages==[]
    assert bot.db.outbox_summary()['queued']==0

@pytest.mark.asyncio
async def test_no_warn_if_worker_disabled_or_premarket(tmp_path):
    bot=make_engine(tmp_path,enabled=False)
    await bot.run_once(datetime(2026,10,19,10,tzinfo=IST))
    bot.enabled=True
    await bot.run_once(datetime(2026,10,19,9,20,tzinfo=IST))
    assert bot.telegram.messages==[]

@pytest.mark.asyncio
async def test_failed_notice_survives_restart_without_duplicate_claim(tmp_path):
    bot=make_engine(tmp_path,fail=True)
    now=datetime(2026,10,19,9,25,8,tzinfo=IST)
    await bot.run_once(now)
    assert bot.db.event_delivery_status('SESSION_WAIT_TOKEN:2026-10-19')==0
    old=bot.telegram
    restarted=Engine('KITE_TEST',bot.vault,State(str(tmp_path/'private.sqlite3')),old,enabled=True)
    old.fail=False
    await restarted.run_once(now.replace(second=23))
    assert old.messages==[]  # no duplicate emission from the same day
    await restarted._deliver_outbox(now.replace(second=40))
    assert len(old.messages)==1
    assert restarted.db.event_delivery_status('SESSION_WAIT_TOKEN:2026-10-19')==1

@pytest.mark.asyncio
async def test_next_market_day_uses_new_dedupe_key(tmp_path):
    bot=make_engine(tmp_path)
    await bot.run_once(datetime(2026,10,19,9,25,8,tzinfo=IST))
    await bot.run_once(datetime(2026,10,21,9,25,8,tzinfo=IST))
    assert len(bot.telegram.messages)==2
    assert bot.db.is_sent('SESSION_WAIT_TOKEN:2026-10-19')
    assert bot.db.is_sent('SESSION_WAIT_TOKEN:2026-10-21')
