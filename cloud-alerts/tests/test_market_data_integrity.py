"""Synthetic fail-closed checks for quote numbers and independent 15m context."""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import math
import pytest
from cloud_alerts.contracts import validate_quote
from cloud_alerts.models import Candle, Contract
from cloud_alerts.signals import decide
from test_signals import market

IST=ZoneInfo('Asia/Kolkata')
OPTION=Contract(909,'NIFTYTESTCE','2026-10-20',65,23000,'CE')
NOW=datetime(2026,10,19,13,0,12,tzinfo=IST)

def book(now=NOW):
    return {'instrument_token':909,'timestamp':now,
            'depth':{'buy':[{'price':100.0,'quantity':65}],
                     'sell':[{'price':101.0,'quantity':65}]}}

@pytest.mark.parametrize('side,value',[
    ('buy',float('nan')),('buy',float('inf')),('buy',-float('inf')),
    ('sell',float('nan')),('sell',float('inf')),('sell',-float('inf')),
])
def test_never_forward_nonfinite_option_price(side,value):
    quote=book();quote['depth'][side][0]['price']=value
    with pytest.raises(ValueError,match='nonfinite'):
        validate_quote(OPTION,quote,NOW)

def test_wrong_token_rejected_even_with_fresh_liquid_depth():
    quote=book();quote['instrument_token']=910
    with pytest.raises(ValueError,match='instrument mismatch'):
        validate_quote(OPTION,quote,NOW)

def test_missing_optional_token_remains_compatible_with_kite_depth():
    quote=book();quote.pop('instrument_token')
    assert validate_quote(OPTION,quote,NOW).ask==101.0

def test_naive_kite_exchange_time_is_ist_when_worker_clock_utc():
    quote=book();quote['timestamp']=NOW.replace(tzinfo=None).isoformat()
    validated=validate_quote(OPTION,quote,NOW.astimezone(timezone.utc))
    assert validated.updated.utcoffset()==timedelta(hours=5,minutes=30)

def test_quote_clock_must_be_timezone_aware():
    with pytest.raises(ValueError,match='aware'):
        validate_quote(OPTION,book(),NOW.replace(tzinfo=None))

def snapshot():
    c,q=market()
    now=c[-1].start+timedelta(minutes=5,seconds=15)
    assert decide(c,now,q).status in ('NO_TRADE','REVIEW_CE','REVIEW_PE')
    return c,q,now

def test_duplicate_15m_history_rejected():
    c,q,now=snapshot();q[-2]=q[-1]
    assert decide(c,now,q).status=='WAIT_DATA'

def test_15m_missing_recent_bar_rejected():
    c,q,now=snapshot();q.pop(-2)
    result=decide(c,now,q)
    assert result.status=='WAIT_DATA' and '15-minute' in result.reason

def test_nan_higher_timeframe_candle_rejected():
    c,q,now=snapshot();b=q[-1]
    q[-1]=Candle(b.start,b.open,b.high,b.low,float('nan'),b.volume)
    assert decide(c,now,q).status=='WAIT_DATA'

def test_invalid_15m_bar_clock_alignment_rejected():
    c,q,now=snapshot();b=q[-1]
    q[-1]=Candle(b.start+timedelta(minutes=1),b.open,b.high,b.low,b.close,b.volume)
    result=decide(c,now,q)
    assert result.status=='WAIT_DATA' and '15-minute' in result.reason

def test_15m_from_prior_day_not_accepted():
    c,q,now=snapshot()
    yesterday=[bar for bar in q if bar.start.date()<now.date()]
    assert len(yesterday)>=30
    assert decide(c,now,yesterday).status=='WAIT_DATA'

def test_15m_mixed_timezones_identifies_correct_ist_session():
    c,q,now=snapshot()
    utc_bars=[Candle(x.start.astimezone(timezone.utc),x.open,x.high,x.low,x.close,x.volume) for x in q]
    assert decide(c,now,utc_bars).status == decide(c,now,q).status

@pytest.mark.asyncio
async def test_nonfinite_kite_option_quote_never_reaches_telegram(tmp_path,monkeypatch):
    from cloud_alerts import engine as engine_module
    from test_simulated_broker_pipeline import (
        engine as make_engine, FakeKite, NOW as BROKER_NOW, synthetic_candidate
    )
    instance=make_engine(tmp_path,monkeypatch)
    monkeypatch.setattr(engine_module,'decide',synthetic_candidate)
    def bad_quote(self,symbol):
        return {'timestamp':BROKER_NOW,'instrument_token':779,
                'depth':{'buy':[{'price':float('nan'),'quantity':65}],
                         'sell':[{'price':100.5,'quantity':65}]}}
    monkeypatch.setattr(FakeKite,'full_quote',bad_quote)
    await instance.run_once(BROKER_NOW)
    assert instance.status=='NO_TRADE'
    assert not instance.telegram.sent
    assert instance.db.get_runtime('virtual_candidate') is None
    assert instance.db.get_runtime('last_processed_candle') is None
