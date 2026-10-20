"""Strict read-only Kite SDK wrapper with credential-bearing transport isolation.

Never offers any order or account methods. The official Kite SDK uses Requests
with an inherited environment by default. Production REST must fail closed if
that SDK no longer exposes the reviewed Requests session configuration.
"""
from __future__ import annotations
from datetime import datetime
from zoneinfo import ZoneInfo
import requests
from .models import Candle
IST=ZoneInfo('Asia/Kolkata')
OFFICIAL_KITE_ROOT = 'https://api.kite.trade'


def _enforce_direct_kite_tls(sdk:object)->None:
    """Enforce the reviewed SDK HTTP transport BEFORE supplying a bearer token.

    For pykiteconnect v5, reqsession is requests.Session, proxies is a mapping,
    and disable_ssl disables request verification. Fail closed if changed.
    """
    if (getattr(sdk,'root',None) != OFFICIAL_KITE_ROOT
            or getattr(sdk,'disable_ssl',None) is not False
            or getattr(sdk,'debug',None) is not False
            or getattr(sdk,'proxies',None) != {}):
        raise RuntimeError('Unapproved Kite SDK endpoint or transport configuration')
    session=getattr(sdk,'reqsession',None)
    if session is None or not isinstance(session,requests.Session):
        raise RuntimeError('Unsupported Kite SDK HTTP session; fail closed')
    session.trust_env=False
    # The SDK passes allow_redirects=True. A zero-redirect Requests limit
    # prevents following 3xx responses carrying a bearer Authorization header.
    session.max_redirects=0
    if session.trust_env is not False or session.max_redirects != 0:
        raise RuntimeError('Kite SDK HTTPS policy not enforced')


class KiteReadOnly:
    def __init__(self,api_key:str,access_token:str):
        from kiteconnect import KiteConnect
        if not api_key or not access_token:raise ValueError('Kite daily credentials missing')
        self._sdk=KiteConnect(api_key=api_key,timeout=8,proxies={},disable_ssl=False,debug=False)
        _enforce_direct_kite_tls(self._sdk)
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
