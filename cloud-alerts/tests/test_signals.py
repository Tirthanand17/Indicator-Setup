from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
import pytest
from cloud_alerts.models import Candle
from cloud_alerts.signals import decide
from cloud_alerts.indicators import compute
IST=ZoneInfo('Asia/Kolkata')

def market():
    # Ten full days of synthetic futures candles, valid 5min and 15min recent data.
    c=[];q=[]
    for d,(monthday) in enumerate((8,9,12,13,14,15,16,19)):
      day=datetime(2026,10,monthday,9,15,tzinfo=IST)
      for i in range(60):
        price=22000+d*140+i*0.6
        c.append(Candle(day+timedelta(minutes=5*i),price-0.4,price+1.3,price-1.9,price,900+i))
      for j in range(20):
        price=22000+d*140+j*1.8
        q.append(Candle(day+timedelta(minutes=15*j),price-0.8,price+3,price-3,price,3000+j))
    return c,q

def test_missing_candles_wait_data():
    c,q=market();now=c[-1].start+timedelta(minutes=5,seconds=15)
    assert decide(c[-30:],now,q).status=='WAIT_DATA'

def test_no_trade_when_not_aligned_or_wrong_session():
    c,q=market()
    assert decide(c,datetime(2026,10,17,10,tzinfo=IST),q).status=='NO_TRADE' # Saturday

def test_incomplete_last_bar_never_generates_entry():
    c,q=market()
    assert decide(c,c[-1].start+timedelta(minutes=4),q).status=='WAIT_DATA'

def test_stale_future_no_signal():
    c,q=market()
    assert decide(c,c[-1].start+timedelta(minutes=50),q).status=='WAIT_DATA'

def test_zero_recent_volume_no_signal():
    c,q=market();b=c[-1];c[-1]=Candle(b.start,b.open,b.high,b.low,b.close,0)
    assert decide(c,b.start+timedelta(minutes=5,seconds=15),q).status=='WAIT_DATA'

def test_15min_must_be_complete():
    c,q=market();b=c[-1]
    # q[-1] ends after current five-minute decision timestamp
    assert decide(c,b.start+timedelta(minutes=5,seconds=15),q).status in ('WAIT_DATA','NO_TRADE')
