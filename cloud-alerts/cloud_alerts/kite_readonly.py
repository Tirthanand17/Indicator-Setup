"""Strict read-only Kite SDK wrapper with credential-bearing transport isolation.

Never offers any order or account methods. The official Kite SDK uses Requests
with an inherited environment by default. Production REST must fail closed if
that SDK no longer exposes the reviewed Requests session configuration.
"""
from __future__ import annotations
from datetime import datetime
from zoneinfo import ZoneInfo
import requests
import re
import threading
import time
from urllib.parse import urlsplit
from .models import Candle
IST=ZoneInfo('Asia/Kolkata')
OFFICIAL_KITE_ROOT = 'https://api.kite.trade'


class _MarketDataAdapter(requests.adapters.HTTPAdapter):
    """Deny transaction endpoints at the final HTTP boundary, including SDK calls.

    A shared pacing lock covers all transient REST clients in this process.
    Python is not a security sandbox: deliberate code replacement is out of scope.
    """
    _lock = threading.Lock()
    _last = {}

    def send(self, request, **kwargs):
        url = urlsplit(request.url)
        historical = re.fullmatch(r'/instruments/historical/[1-9][0-9]*/(5minute|15minute)', url.path)
        if (request.method != 'GET' or url.scheme != 'https' or
                url.netloc != 'api.kite.trade' or url.fragment or
                not (url.path in ('/instruments/NFO', '/quote') or historical) or
                kwargs.get('verify', True) is not True or kwargs.get('proxies')):
            raise RuntimeError('Kite transport permits approved read-only market data only')
        group = 'history' if historical else 'quote' if url.path == '/quote' else 'instruments'
        spacing = {'history': 0.35, 'quote': 1.05, 'instruments': 0.11}[group]
        with self._lock:
            delay = self._last.get(group, float('-inf')) + spacing - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            self._last[group] = time.monotonic()
        return super().send(request, **kwargs)


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
    # Even accidental access to the underlying SDK cannot send order, account,
    # GTT, token-revocation or arbitrary host requests through this session.
    session.mount('https://', _MarketDataAdapter())
    session.mount('http://', _MarketDataAdapter())
    if session.trust_env is not False or session.max_redirects != 0:
        raise RuntimeError('Kite SDK HTTPS policy not enforced')


class KiteReadOnly:
    def __init__(self,api_key:str,access_token:str):
        from kiteconnect import KiteConnect
        if not api_key or not access_token:raise ValueError('Kite daily credentials missing')
        self._sdk=KiteConnect(api_key=api_key,timeout=8,proxies={},disable_ssl=False,debug=False)
        _enforce_direct_kite_tls(self._sdk)
        self._sdk.set_access_token(access_token)
    def close(self)->None:
        """Release SDK HTTP connections; no broker/API network request."""
        self._sdk.reqsession.close()

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
