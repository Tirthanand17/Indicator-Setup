from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
import math,pytest
from cloud_alerts.models import Candle
from cloud_alerts.indicators import ema,rma,compute
IST=ZoneInfo('Asia/Kolkata')
START=datetime(2026,10,19,9,15,tzinfo=IST)

def series(n=95,up=True,base=22800,start=START):
    candles=[]
    for i in range(n):
        current=base+(i if up else -i)*2.1
        candles.append(Candle(start+timedelta(minutes=5*i),current-1,current+2,current-3,current,1000+i))
    return candles

def test_ema_wilder_constant():
    assert ema([100]*25,9)[-1]==100
    assert rma([10]*25,14)[-1]==10

def test_ema_linear_increasing():
    vals=ema(list(range(60)),9)
    assert vals[-1]>vals[-2]
    assert vals[-1]<59

def test_bullish_indicators():
    x=compute(series())
    assert x.ema9>x.ema21 and x.plus_di>x.minus_di
    assert x.adx>25
    assert x.atr>0

def test_bearish_indicators():
    x=compute(series(up=False))
    assert x.ema9<x.ema21 and x.minus_di>x.plus_di
    assert x.adx>25

def test_vwap_volume_weighted_and_resets():
    last=series(85)
    today=last[-1].start.date()
    d=[b for b in last if b.start.date()==today]
    expected=sum(((b.high+b.low+b.close)/3)*b.volume for b in d)/sum(b.volume for b in d)
    assert math.isclose(compute(last).vwap,expected)

def test_stale_volume_fails():
    data=series()
    b=data[-1]
    data[-1]=Candle(b.start,b.open,b.high,b.low,b.close,0)
    with pytest.raises(ValueError,match='volume'):compute(data)

def test_out_of_order_fails():
    data=series();data[-1]=data[-2]
    with pytest.raises(ValueError,match='ordered'):compute(data)

def test_naive_timestamp_rejected():
    b=series()[-1]
    with pytest.raises(ValueError,match='naive'):
        Candle(b.start.replace(tzinfo=None),b.open,b.high,b.low,b.close,b.volume).validate()

def test_insufficient_warmup():
    with pytest.raises(ValueError,match='warmup'):compute(series(30))
