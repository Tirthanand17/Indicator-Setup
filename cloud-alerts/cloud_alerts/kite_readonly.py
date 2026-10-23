"""Official read-only REST market data without the trading-capable SDK.

Transport permits only approved market-data GET endpoints. No order methods.
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
    _last: dict[str, float] = {}

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


class KiteReadOnly:
    """Official REST market data only; no SDK or transaction methods loaded."""
    def __init__(self, api_key: str, access_token: str):
        if (not api_key or not access_token or
                any(c in api_key + access_token for c in '\r\n')):
            raise ValueError('Kite daily credentials missing or invalid')
        self._session = requests.Session()
        self._session.trust_env = False
        self._session.max_redirects = 0
        self._session.mount('https://', _MarketDataAdapter())
        self._session.mount('http://', _MarketDataAdapter())
        self._session.headers.update({'X-Kite-Version': '3',
            'Authorization': 'token ' + api_key + ':' + access_token})

    def close(self) -> None:
        self._session.close()

    def _get(self, path: str, params=None, *, csv_response=False):
        # Do not expose remote error bodies or Requests exceptions containing
        # prepared credential-bearing requests to callers/logging.
        try:
            with self._session.get(OFFICIAL_KITE_ROOT + path, params=params,
                    timeout=8, allow_redirects=False, verify=True, proxies={}) as response:
                if response.status_code != 200:
                    raise RuntimeError('Kite market-data HTTP failure')
                if csv_response:
                    import csv
                    import io
                    if 'text/csv' not in response.headers.get('Content-Type', ''):
                        raise ValueError('Unexpected instrument content type')
                    rows = list(csv.DictReader(io.StringIO(response.text)))
                    for row in rows:
                        for field in ('instrument_token', 'exchange_token', 'lot_size'):
                            row[field] = int(row[field])
                        for field in ('last_price', 'strike', 'tick_size'):
                            row[field] = float(row[field])
                        if row.get('expiry'):
                            row['expiry'] = datetime.fromisoformat(row['expiry']).date()
                    return rows
                payload = response.json()
                if not isinstance(payload, dict) or payload.get('status') != 'success':
                    raise ValueError('Invalid API envelope')
                data = payload.get('data')
                if not isinstance(data, dict):
                    raise ValueError('Invalid API data')
                return data
        except Exception:
            raise RuntimeError('Kite market-data request or response invalid') from None

    def instruments_nfo(self) -> list[dict]:
        return self._get('/instruments/NFO', csv_response=True)

    def historical(self, token: int, interval: str, start: datetime, end: datetime) -> list[Candle]:
        if (type(token) is not int or token <= 0 or
                interval not in ('5minute', '15minute') or
                start.tzinfo is None or end.tzinfo is None or start > end):
            raise ValueError('Invalid historical request')
        data = self._get(f'/instruments/historical/{token}/{interval}', {
            'from': start.astimezone(IST).strftime('%Y-%m-%d %H:%M:%S'),
            'to': end.astimezone(IST).strftime('%Y-%m-%d %H:%M:%S'),
            'continuous': 0, 'oi': 0})
        rows = data.get('candles')
        if not isinstance(rows, list):
            raise ValueError('Missing candle sequence')
        out = []
        for row in rows:
            if not isinstance(row, list) or len(row) != 6:
                raise ValueError('Invalid candle row')
            timestamp = datetime.fromisoformat(row[0])
            if timestamp.tzinfo is None or type(row[5]) is not int:
                raise ValueError('Invalid candle timestamp or volume')
            candle = Candle(timestamp.astimezone(IST), *row[1:])
            candle.validate()
            out.append(candle)
        return out

    def full_quote(self, symbol: str) -> dict:
        if not isinstance(symbol, str) or not re.fullmatch(r'NIFTY[A-Z0-9]+', symbol):
            raise ValueError('Invalid NIFTY symbol')
        key = 'NFO:' + symbol
        quote = self._get('/quote', {'i': key}).get(key, {})
        if not isinstance(quote, dict):
            raise ValueError('Invalid quote')
        return quote
