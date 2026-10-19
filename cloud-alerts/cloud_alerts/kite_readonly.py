"""Strict read-only Kite SDK wrapper: no order or trade methods exposed.

KiteConnect SDK may provide trading methods, but this wrapper never invokes them;
no order code or broker account records are imported into our runtime.
"""
from __future__ import annotations
from datetime import datetime
from zoneinfo import ZoneInfo
from .models import Candle
IST=ZoneInfo('Asia/Kolkata')

class KiteReadOnly:
    def __init__(self,api_key:str,access_token:str):
        from kiteconnect import KiteConnect
        if not api_key or not access_token:raise ValueError('Kite daily credentials missing')
        self._sdk=KiteConnect(api_key=api_key,timeout=8)
        self._sdk.set_access_token(access_token)
    def instruments_nfo(self)->list[dict]:return self._sdk.instruments('NFO')
    def historical(self,token:int,interval:str,start:datetime,end:datetime)->list[Candle]:
        if interval not in ('5minute','15minute'):raise ValueError('unsupported interval')
        raw=self._sdk.historical_data(token,start,end,interval,continuous=False,oi=False)
        out=[]
        for r in raw:
            t=r['date']
            if isinstance(t,str):t=datetime.fromisoformat(t)
            if t.tzinfo is None:t=t.replace(tzinfo=IST)
            out.append(Candle(t.astimezone(IST),float(r['open']),float(r['high']),float(r['low']),float(r['close']),int(r['volume'])))
        return out
    def full_quote(self,symbol:str)->dict:
        key='NFO:'+symbol
        return self._sdk.quote([key]).get(key) or {}
