"""Fail-closed *paper review* decisions, never order instructions."""
from __future__ import annotations
from datetime import timedelta,datetime,time
from zoneinfo import ZoneInfo
from .models import Candle,Indicators,Decision
from .indicators import compute,ema
IST=ZoneInfo('Asia/Kolkata')


def decide(candles:list[Candle],now:datetime,confirm_15m:list[Candle], *, adx_min:float=25.,atr_buffer:float=.5)->Decision:
    if now.tzinfo is None:return Decision('WAIT_DATA','clock lacks timezone')
    local=now.astimezone(IST)
    if local.weekday()>=5 or local.time()<time(9,30) or local.time()>time(15,0):
        return Decision('NO_TRADE','outside configured entry session')
    if len(candles)<75 or len(confirm_15m)<30:
        return Decision('WAIT_DATA','not enough complete candle history')
    if candles[-1].start.astimezone(IST).date()!=local.date():
        return Decision('WAIT_DATA','no same-day complete bar')
    if timedelta(seconds=0)>(now-candles[-1].start) or (now-candles[-1].start)>timedelta(minutes=7):
        return Decision('WAIT_DATA','5-minute futures candle stale or timestamp invalid')
    if candles[-1].start+timedelta(minutes=5,seconds=8)>now:
        return Decision('WAIT_DATA','latest 5-minute candle not yet confirmed complete')
    if any((b.start-a.start)!=timedelta(minutes=5) for a,b in zip(candles[-4:],candles[-3:])):
        return Decision('WAIT_DATA','recent five-minute candle gaps')
    if any(b.volume<=0 for b in candles[-4:]):
        return Decision('WAIT_DATA','missing recent futures traded volume')
    try:
        ind=compute(candles)
        closes=[b.close for b in confirm_15m]
        higher_fast=ema(closes,9)[-1];higher_slow=ema(closes,21)[-1]
    except ValueError as exc:
        return Decision('WAIT_DATA',str(exc))
    if confirm_15m[-1].start+timedelta(minutes=15)>now or (now-confirm_15m[-1].start)>timedelta(minutes=32):
        return Decision('WAIT_DATA','15-minute confirmation stale or incomplete')
    b=candles[-1]
    if ind.adx<adx_min or ind.adx<=ind.previous_adx:
        return Decision('NO_TRADE','ADX not strong and rising',b,ind)
    higher_hi=max(x.high for x in candles[-4:-1]);lower_lo=min(x.low for x in candles[-4:-1])
    bullish=b.close>ind.vwap and ind.ema9>ind.ema21 and ind.plus_di>ind.minus_di and higher_fast>higher_slow and b.close>higher_hi
    bearish=b.close<ind.vwap and ind.ema9<ind.ema21 and ind.minus_di>ind.plus_di and higher_fast<higher_slow and b.close<lower_lo
    if not (bullish or bearish):
        return Decision('NO_TRADE','VWAP EMA DMI 15m context or breakout mismatch',b,ind)
    stop=min(x.low for x in candles[-4:])-atr_buffer*ind.atr if bullish else max(x.high for x in candles[-4:])+atr_buffer*ind.atr
    risk=(b.close-stop) if bullish else (stop-b.close)
    if risk<=0 or risk>2.5*ind.atr:
        return Decision('NO_TRADE','underlying stop too wide or invalid',b,ind)
    target=b.close+(risk*1.8 if bullish else -risk*1.8)
    return Decision('REVIEW_CE' if bullish else 'REVIEW_PE','5m breakout with aligned VWAP EMA DMI and independent 15m EMA',b,ind,stop,target)
