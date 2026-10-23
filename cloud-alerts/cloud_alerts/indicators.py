"""Transparent, independently testable session VWAP/EMA/DMI/ADX/ATR calculations.

EMA: initialized with first close. Wilder RMA: SMA seed after `length` samples.
Chart engines can initialize warmup differently; compare against known chart samples.
"""
from __future__ import annotations
from datetime import timedelta
from .models import Candle, Indicators


def ema(values: list[float], length: int) -> list[float]:
    if length < 1 or not values: raise ValueError('invalid EMA input')
    alpha = 2 / (length + 1)
    current = values[0]
    result = [current]
    for value in values[1:]:
        current = value * alpha + current * (1 - alpha)
        result.append(current)
    return result


def rma(values: list[float | None], length: int) -> list[float | None]:
    if length < 1: raise ValueError('invalid RMA length')
    result: list[float | None] = []
    buffer: list[float] = []
    previous: float | None = None
    for v in values:
        if v is None:
            result.append(previous)
            continue
        if previous is None:
            buffer.append(float(v))
            if len(buffer) == length: previous = sum(buffer)/length
        else:
            previous = ((length - 1) * previous + float(v)) / length
        result.append(previous)
    return result


def compute(candles: list[Candle], length: int = 14) -> Indicators:
    if len(candles) < max(70, 3 * length):
        raise ValueError('insufficient indicator warmup')
    for b in candles: b.validate()
    if any(a.start >= b.start for a,b in zip(candles,candles[1:])):
        raise ValueError('candles not strictly ordered')
    closes=[x.close for x in candles]
    e9,e21=ema(closes,9),ema(closes,21)
    trs: list[float|None]=[None]
    plus: list[float|None]=[None]
    minus: list[float|None]=[None]
    for a,b in zip(candles,candles[1:]):
        up=b.high-a.high;down=a.low-b.low
        plus.append(up if up>down and up>0 else 0.)
        minus.append(down if down>up and down>0 else 0.)
        trs.append(max(b.high-b.low,abs(b.high-a.close),abs(b.low-a.close)))
    atr=rma(trs,length)
    pd=rma(plus,length);md=rma(minus,length)
    di_plus: list[float | None] = []
    di_minus: list[float | None] = []
    dx: list[float | None] = []
    for smoothed_atr,p,m in zip(atr,pd,md):
        if smoothed_atr is None or p is None or m is None or smoothed_atr<=0:
            di_plus.append(None);di_minus.append(None);dx.append(None);continue
        pdi=100*p/smoothed_atr;mdi=100*m/smoothed_atr
        di_plus.append(pdi);di_minus.append(mdi)
        total=pdi+mdi
        dx.append(100*abs(pdi-mdi)/total if total>0 else 0.)
    adx=rma(dx,length)
    if adx[-1] is None or adx[-2] is None or atr[-1] is None:
        raise ValueError('ADX or ATR not ready')
    if di_plus[-1] is None or di_minus[-1] is None:
        raise ValueError('DMI not ready')
    last_day=candles[-1].start.date()
    daily=[x for x in candles if x.start.date()==last_day]
    if not daily or any(x.volume<=0 for x in daily):
        raise ValueError('VWAP missing traded volume')
    vol=sum(x.volume for x in daily)
    vw=sum(((x.high+x.low+x.close)/3)*x.volume for x in daily)/vol
    return Indicators(vwap=vw,ema9=e9[-1],ema21=e21[-1],
        plus_di=float(di_plus[-1]),minus_di=float(di_minus[-1]),
        adx=float(adx[-1]),previous_adx=float(adx[-2]),atr=float(atr[-1]))
