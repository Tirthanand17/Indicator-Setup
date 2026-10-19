"""Research-only virtual premium tracking: fake quotes, no account/orders/network."""
import json
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
import pytest
from cryptography.fernet import Fernet
from cloud_alerts.premium import (PremiumHypothesis,reference_from_quote,parse_reference,
                                  reference_contract,evaluate_bid,exit_text)
from cloud_alerts.models import Contract,OptionQuote
from cloud_alerts.state import State
from cloud_alerts.security import TokenVault
from cloud_alerts.engine import Engine
from cloud_alerts import engine as engine_module
IST=ZoneInfo('Asia/Kolkata')
NOW=datetime(2026,10,19,13,0,tzinfo=IST)
CONTRACT=Contract(778,'NIFTY26OCT23000CE','2026-10-20',65,23000,'CE')

def make_quote(bid=99.5,ask=100.5,when=NOW):
    return OptionQuote(CONTRACT,bid,ask,100,100,when)

def make_reference(now=NOW,qq=None):
    quote=qq or make_quote(when=now)
    return reference_from_quote(quote,futures_symbol='NIFTY26OCTFUT',
           signal_candle=now-timedelta(minutes=5),created_at=now,
           hypothesis=PremiumHypothesis())

class FakeTelegram:
    def __init__(self):self.sent=[]
    def send(self,message):self.sent.append(message)

class FakeKite:
    quote=None
    calls=[]
    def __init__(self,api_key,token):
        assert api_key=='TEST_KEY' and token.startswith('TEST_TOKEN')
    def full_quote(self,symbol):
        FakeKite.calls.append(symbol)
        if self.quote is None:raise ValueError('quote not initialized')
        return self.quote

def make_engine(tmp_path,monkeypatch,now=NOW,enabled=True,premium=True):
    v=TokenVault(tmp_path/'vault',Fernet.generate_key().decode())
    v.put('TEST_TOKEN_123456789123456789',now)
    e=Engine('TEST_KEY',v,State(str(tmp_path/'alerts.sqlite3')),
             FakeTelegram(),enabled=enabled,paper_premium_tracking=premium)
    monkeypatch.setattr(engine_module,'KiteReadOnly',FakeKite)
    FakeKite.calls=[]
    return e

def save_candidate(e,now=NOW):
    pos={'direction':'CE','symbol':'NIFTY26OCTFUT',
         'signal_candle':(now-timedelta(minutes=5)).isoformat(),
         'entry':23000,'stop':22960,'target':23080,
         'expiry_date':now.date().isoformat(),'premium':make_reference(now)}
    e.db.set_runtime('virtual_candidate',json.dumps(pos))
    return pos

def kite_quote(now=NOW,bid=99.5,ask=100.5):
    return {'timestamp':now,'depth':{'buy':[{'price':bid,'quantity':65}],
                                    'sell':[{'price':ask,'quantity':65}]}}

def test_reference_fresh_and_hypothetical():
    p=make_reference()
    assert p['paper_only'] is True and p['version']==2
    assert p['reference_ask']==100.5
    assert p['stop_bid']==80.4 and p['target_bid']==140.7
    assert 'access_token' not in json.dumps(p)
    assert reference_contract(p).symbol==CONTRACT.symbol

@pytest.mark.parametrize('stop,target',[(0,0.4),(.51,.4),(.2,.09),(.2,1.1), (float('nan'),.4)])
def test_invalid_premium_guardrails(stop,target):
    with pytest.raises(ValueError): PremiumHypothesis(stop,target)

def test_reference_rejects_stale_and_future_quote():
    with pytest.raises(ValueError,match='stale'):make_reference(NOW,make_quote(when=NOW-timedelta(minutes=3)))
    with pytest.raises(ValueError,match='invalid reference'):make_reference(NOW,make_quote(when=NOW+timedelta(minutes=1)))

def test_reference_parse_is_fail_closed_and_expires_over_midnight():
    p=make_reference()
    assert parse_reference(json.dumps(p),NOW)==p
    assert parse_reference(json.dumps(p),NOW+timedelta(days=1)) is None
    assert parse_reference('not json',NOW) is None
    assert parse_reference(json.dumps({**p,'paper_only':False}),NOW) is None
    assert parse_reference(json.dumps({**p,'option_symbol':'BANKNIFTYOTHER'}),NOW) is None
    assert parse_reference(json.dumps({**p,'stop_bid':1000}),NOW) is None

def test_bid_evaluation_not_last_traded_price():
    p=make_reference()
    assert evaluate_bid(p,make_quote(90,91),NOW)=='HOLD'
    assert evaluate_bid(p,make_quote(79,80),NOW)=='STOP'
    assert evaluate_bid(p,make_quote(141,142),NOW)=='TARGET'
    with pytest.raises(ValueError,match='predates'):evaluate_bid(p,make_quote(120,121,when=NOW-timedelta(minutes=1)),NOW)

def test_virtual_exit_messages_never_assume_holdings():
    p=make_reference()
    msg=exit_text(p,'STOP',NOW,make_quote(79,80))
    assert 'VIRTUAL OPTION EXIT REVIEW' in msg and 'NOT proof of an actual option holding' in msg
    assert 'NO ORDERS PLACED' in msg and 'Fresh quoted BID' in msg
    assert 'No executable option bid' in exit_text(p,'TIME',NOW,None)

@pytest.mark.asyncio
async def test_premium_watcher_waits_with_unbreached_quote(tmp_path,monkeypatch):
    e=make_engine(tmp_path,monkeypatch)
    save_candidate(e)
    FakeKite.quote=kite_quote()
    await e.poll_virtual_premium(NOW+timedelta(seconds=1))
    assert e.premium_status=='MONITORING'
    assert not e.telegram.sent
    assert e.db.get_runtime('virtual_candidate')
    assert FakeKite.calls==[CONTRACT.symbol]

@pytest.mark.asyncio
async def test_breached_bid_emits_exactly_one_stop_review(tmp_path,monkeypatch):
    e=make_engine(tmp_path,monkeypatch)
    save_candidate(e)
    now=NOW+timedelta(seconds=1)
    FakeKite.quote=kite_quote(now,bid=79.3,ask=79.8)
    await e.poll_virtual_premium(now)
    await e.poll_virtual_premium(now+timedelta(seconds=1))
    assert len(e.telegram.sent)==1
    assert 'VIRTUAL OPTION EXIT REVIEW (STOP)' in e.telegram.sent[0]
    assert not e.db.get_runtime('virtual_candidate')
    assert e.premium_status=='IDLE'
    assert e.db.pending_events()==[]

@pytest.mark.asyncio
async def test_target_review_and_persistent_dedupe(tmp_path,monkeypatch):
    e=make_engine(tmp_path,monkeypatch)
    save_candidate(e)
    now=NOW+timedelta(seconds=1)
    FakeKite.quote=kite_quote(now,bid=141.0,ask=141.5)
    await e.poll_virtual_premium(now)
    assert e.premium_status=='EXIT_REVIEW_TARGET'
    assert len(e.telegram.sent)==1
    assert 'TARGET' in e.telegram.sent[0]
    assert e.db.pending_events()==[]

@pytest.mark.asyncio
async def test_stale_option_quote_keeps_candidate_no_alert(tmp_path,monkeypatch):
    e=make_engine(tmp_path,monkeypatch)
    save_candidate(e)
    now=NOW+timedelta(seconds=1)
    FakeKite.quote=kite_quote(now-timedelta(seconds=25),bid=50,ask=50.5)
    await e.poll_virtual_premium(now)
    assert e.premium_status=='WAIT_FRESH_PREMIUM_QUOTE'
    assert not e.telegram.sent and e.db.get_runtime('virtual_candidate')

@pytest.mark.asyncio
async def test_time_cutoff_emits_review_without_any_quote(tmp_path,monkeypatch):
    e=make_engine(tmp_path,monkeypatch)
    save_candidate(e)
    now=NOW.replace(hour=15,minute=16)
    await e.poll_virtual_premium(now)
    assert len(e.telegram.sent)==1
    assert 'EXIT REVIEW (TIME)' in e.telegram.sent[0]
    assert 'No executable option bid available' in e.telegram.sent[0]
    assert FakeKite.calls==[]

@pytest.mark.asyncio
async def test_no_phone_alert_without_paper_premium_opt_in(tmp_path,monkeypatch):
    e=make_engine(tmp_path,monkeypatch,premium=False)
    save_candidate(e)
    FakeKite.quote=kite_quote(NOW,bid=30,ask=30.5)
    await e.poll_virtual_premium(NOW)
    assert not e.telegram.sent and FakeKite.calls==[]

@pytest.mark.asyncio
async def test_old_candidate_not_pushed_into_new_session(tmp_path,monkeypatch):
    e=make_engine(tmp_path,monkeypatch)
    save_candidate(e)
    await e.poll_virtual_premium(NOW+timedelta(days=1))
    assert not e.db.get_runtime('virtual_candidate')
    assert e.premium_status=='EXPIRED_CANDIDATE_CLEARED'
    assert not e.telegram.sent

@pytest.mark.asyncio
async def test_corrupt_premium_reference_fails_closed(tmp_path,monkeypatch):
    e=make_engine(tmp_path,monkeypatch)
    pos=save_candidate(e)
    pos['premium']['option_symbol']='BANKNIFTYFAKE'
    e.db.set_runtime('virtual_candidate',json.dumps(pos))
    await e.poll_virtual_premium(NOW)
    assert not FakeKite.calls and not e.telegram.sent
    assert e.premium_status=='INVALID_PREMIUM_REFERENCE'

@pytest.mark.asyncio
async def test_disabled_engine_never_queries_option(tmp_path,monkeypatch):
    e=make_engine(tmp_path,monkeypatch,enabled=False)
    save_candidate(e)
    await e.poll_virtual_premium(NOW)
    assert not FakeKite.calls and not e.telegram.sent
