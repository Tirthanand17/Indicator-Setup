"""Fail-closed *paper review* decisions, never order instructions."""
from __future__ import annotations
from datetime import timedelta,datetime,time
from zoneinfo import ZoneInfo
from .models import Candle,Indicators,Decision
from .indicators import compute,ema
from .trading_calendar import session_status, CalendarUnavailable
IST=ZoneInfo('Asia/Kolkata')


def decide(candles:list[Candle],now:datetime,confirm_15m:list[Candle], *, adx_min:float=25.,atr_buffer:float=.5)->Decision:
    if now.tzinfo is None:return Decision('WAIT_DATA','clock lacks timezone')
    local=now.astimezone(IST)
    try:
        calendar_state = session_status(local.date())
    except CalendarUnavailable:
        return Decision('WAIT_DATA','official NSE F&O holiday calendar unavailable')
    if calendar_state!='REGULAR':
        return Decision('NO_TRADE','NSE F&O market closed for normal session')
    if local.time()<time(9,30) or local.time()>time(15,0):
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
    # Higher-timeframe EMA is an independent confirmation input, not trusted
    # solely because its final timestamp looks recent. Corrupt/duplicate bars
    # or intraday gaps must not silently shift EMA context into a BUY review.
    try:
        for bar in confirm_15m:
            bar.validate()
        if any(a.start >= b.start for a,b in zip(confirm_15m, confirm_15m[1:])):
            raise ValueError('15-minute candles not strictly ordered')
    except ValueError as exc:
        return Decision('WAIT_DATA',f'invalid 15-minute history: {exc}')
    local_15m=[b for b in confirm_15m if b.start.astimezone(IST).date()==local.date()]
    if not local_15m or local_15m[-1] != confirm_15m[-1]:
        return Decision('WAIT_DATA','15-minute confirmation not from current session')
    if any(b.start.astimezone(IST).time() < time(9,15) or
           b.start.astimezone(IST).time() > time(15,15) or
           ((b.start.astimezone(IST).minute-15) % 15)!=0
           for b in local_15m):
        return Decision('WAIT_DATA','invalid 15-minute session candle boundary')
    if any(b.start-a.start!=timedelta(minutes=15)
           for a,b in zip(local_15m[-3:],local_15m[-2:])):
        return Decision('WAIT_DATA','recent 15-minute confirmation candle gaps')
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
