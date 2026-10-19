"""Full offline broker-adapter test: fake Kite reads, zero live HTTP/orders."""
import pytest
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
from cryptography.fernet import Fernet
from cloud_alerts import engine as engine_module
from cloud_alerts.engine import Engine
from cloud_alerts.models import Candle,Decision,Indicators
from cloud_alerts.state import State
from cloud_alerts.security import TokenVault
IST=ZoneInfo('Asia/Kolkata')
NOW=datetime(2026,10,19,12,0,12,tzinfo=IST)

class TG:
    def __init__(self):self.sent=[]
    def send(self,message):self.sent.append(message)

class FakeKite:
    records=[]
    option_quote_valid=True
    def __init__(self,key,token):
        if key!='DUMMY_KEY' or not token.startswith('DUMMY_ACCESS'):
            raise AssertionError('unrecognized test authorization')
    def instruments_nfo(self):
        return [{'name':'NIFTY','segment':'NFO-FUT','instrument_type':'FUT',
                 'expiry':'2026-10-27','instrument_token':777,'tradingsymbol':'NIFTY26OCTFUT','lot_size':65},
                {'name':'NIFTY','segment':'NFO-OPT','instrument_type':'CE',
                 'expiry':'2026-10-20','instrument_token':779,'tradingsymbol':'NIFTYTESTCE','lot_size':65,'strike':23000},
                {'name':'NIFTY','segment':'NFO-OPT','instrument_type':'PE',
                 'expiry':'2026-10-20','instrument_token':781,'tradingsymbol':'NIFTYTESTPE','lot_size':65,'strike':23000}]
    def historical(self,token,interval,start,end):
        FakeKite.records.append((token,interval))
        n=85 if interval=='5minute' else 45
        minutes=5 if interval=='5minute' else 15
        # 5m finish 11:55, 15m finish 11:45. Synthetic history spans previous days.
        finish=NOW-timedelta(minutes=minutes,seconds=12)
        finish=finish.replace(minute=(finish.minute//minutes)*minutes,second=0,microsecond=0)
        return [Candle(finish-timedelta(minutes=(n-1-i)*minutes),23000,23012,22992,23003+i*.01,7000+i*3)
                for i in range(n)]
    def full_quote(self,symbol):
        FakeKite.records.append(('quote',symbol))
        ts=NOW if FakeKite.option_quote_valid else NOW-timedelta(minutes=2)
        return {'timestamp':ts,'depth':{'buy':[{'price':99.50,'quantity':65}],
                'sell':[{'price':100.50,'quantity':65}]}}


def engine(tmp_path,monkeypatch):
    FakeKite.records=[]
    FakeKite.option_quote_valid=True
    monkeypatch.setattr(engine_module,'KiteReadOnly',FakeKite)
    v=TokenVault(tmp_path/'vault.enc',Fernet.generate_key().decode())
    v.put('DUMMY_ACCESS_TOKEN_987654321000',NOW)
    return Engine('DUMMY_KEY',v,State(str(tmp_path/'events.db')),TG(),enabled=True)


def synthetic_candidate(candles,now,confirm_15m):
    assert len(candles)>=80 and len(confirm_15m)>=40
    b=candles[-1]
    return Decision('REVIEW_CE','SYNTHETIC TEST ONLY',b,
        Indicators(22990,23010,23000,30,12,27,26,25),b.close-25,b.close+45)

@pytest.mark.asyncio
async def test_readonly_broker_candle_option_quote_to_telegram(tmp_path,monkeypatch):
    e=engine(tmp_path,monkeypatch)
    monkeypatch.setattr(engine_module,'decide',synthetic_candidate)
    await e.run_once(NOW)
    assert e.status=='REVIEW_CE'
    assert len(e.telegram.sent)==1
    assert 'POTENTIAL BUY CE' in e.telegram.sent[0]
    assert 'NIFTYTESTCE' in e.telegram.sent[0]
    assert 'NEVER sends orders' in e.telegram.sent[0]
    assert 'NOT A BUY ORDER' in e.telegram.sent[0]
    assert sorted(FakeKite.records[:2])==sorted([(777,'5minute'),(777,'15minute')])
    assert FakeKite.records[2]==('quote','NIFTYTESTCE')
    await e.run_once(NOW+timedelta(seconds=5))
    assert len(e.telegram.sent)==1

@pytest.mark.asyncio
async def test_stale_option_depth_suppresses_entry_alert(tmp_path,monkeypatch):
    e=engine(tmp_path,monkeypatch)
    FakeKite.option_quote_valid=False
    monkeypatch.setattr(engine_module,'decide',synthetic_candidate)
    await e.run_once(NOW)
    assert e.status=='NO_TRADE'
    assert not e.telegram.sent
    assert e.db.get_runtime('virtual_candidate') is None

@pytest.mark.asyncio
async def test_strategy_no_trade_does_not_send_or_fetch_option(tmp_path,monkeypatch):
    e=engine(tmp_path,monkeypatch)
    monkeypatch.setattr(engine_module,'decide',lambda candles,now,confirm_15m:Decision('NO_TRADE','ADX not rising',candles[-1]))
    await e.run_once(NOW)
    assert e.status=='NO_TRADE'
    assert not e.telegram.sent
    assert not any(x[0]=='quote' for x in FakeKite.records)

@pytest.mark.asyncio
async def test_incomplete_historical_candles_fail_closed(tmp_path,monkeypatch):
    e=engine(tmp_path,monkeypatch)
    monkeypatch.setattr(engine_module,'decide',synthetic_candidate)
    # 8 seconds are explicitly needed after end of the last bar.
    await e.run_once(NOW-timedelta(seconds=8))
    assert e.status=='WAIT_DATA' and not e.telegram.sent

@pytest.mark.asyncio
async def test_temporary_stale_option_quote_can_retry_same_completed_candle(tmp_path,monkeypatch):
    """A missing quote at first REST poll must not permanently skip the candle."""
    e=engine(tmp_path,monkeypatch)
    monkeypatch.setattr(engine_module,'decide',synthetic_candidate)
    FakeKite.option_quote_valid=False
    await e.run_once(NOW)
    assert e.status=='NO_TRADE'
    assert e.db.get_runtime('last_processed_candle') is None
    assert not e.telegram.sent
    FakeKite.option_quote_valid=True
    await e.run_once(NOW)
    assert e.status=='REVIEW_CE'
    assert len(e.telegram.sent)==1
    assert e.db.get_runtime('last_processed_candle') is not None
