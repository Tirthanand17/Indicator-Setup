"""Read-only KiteTicker shadow feed; never a live-trade signal source.

The exchange historical REST candle remains authoritative until a *separate*
reconciliation and multi-session forward test validates stream OHLCV fidelity.
No broker order interfaces, cookies, credentials logging, or account endpoints.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, time
from math import isfinite
from zoneinfo import ZoneInfo
from typing import Any, Callable

from .models import Candle

IST = ZoneInfo('Asia/Kolkata')


@dataclass(frozen=True)
class StreamBar:
    """Locally observed 5m bar; *not* broker-confirmed or trade-authorizing."""
    candle: Candle
    first_tick_at: datetime
    last_tick_at: datetime
    received_at: datetime
    tick_count: int
    quality: str = 'SHADOW_UNRECONCILED'


@dataclass(frozen=True)
class Comparison:
    matched: bool
    reasons: tuple[str, ...]
    max_price_difference: float
    volume_difference: int


def _as_ist(value: Any) -> datetime:
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    if not isinstance(value, datetime):
        raise ValueError('exchange timestamp missing or invalid')
    # Kite SDK may return naive IST timestamps; assume IST only at this gateway.
    if value.tzinfo is None:
        value = value.replace(tzinfo=IST)
    return value.astimezone(IST)


def _bucket(ts: datetime) -> datetime:
    return ts.replace(minute=ts.minute - ts.minute % 5, second=0, microsecond=0)


def reconcile_stream_bar(stream: StreamBar, historical: Candle, *,
                         price_tolerance: float = 0.10,
                         volume_tolerance_ratio: float = 0.025) -> Comparison:
    """Check shadow OHLCV against REST; returns evidence, never approves an order."""
    stream.candle.validate()
    historical.validate()
    if not (0 <= price_tolerance <= 5 and 0 <= volume_tolerance_ratio <= 0.5):
        raise ValueError('invalid reconciliation tolerance')
    reasons = []
    if stream.candle.start != historical.start:
        reasons.append('START_TIMESTAMP_MISMATCH')
    delta = max(abs(getattr(stream.candle, k) - getattr(historical, k))
                for k in ('open', 'high', 'low', 'close'))
    if delta > price_tolerance:
        reasons.append('OHLC_MISMATCH')
    vd = stream.candle.volume - historical.volume
    if abs(vd) > max(1, int(historical.volume * volume_tolerance_ratio)):
        reasons.append('VOLUME_MISMATCH')
    if stream.quality != 'SHADOW_UNRECONCILED':
        reasons.append('UNEXPECTED_STREAM_QUALITY')
    return Comparison(not reasons, tuple(reasons), delta, vd)


class FiveMinuteTickAggregator:
    """Build diagnostic 5m OHLCV from NIFTY futures streamed tick packets.

    Important caveats:
    * Kite full-mode volume_traded is cumulative session volume. Incremental
      volume requires a baseline and may miss between-packet trades.
    * The initial partial bar after subscription is discarded.
    * Disconnect, gaps, stale/future timestamps and volume resets fail CLOSED.
    * A bar emitted when the next interval first ticks is NOT automatically an
      authoritative complete candle. The REST reconciliation gate is mandatory.
    """
    def __init__(self, instrument_token: int, *, max_gap_seconds: float = 45.0,
                 close_proximity_seconds: float = 5.0,
                 max_source_age_seconds: float = 10.0):
        if instrument_token <= 0 or not 0 < max_gap_seconds < 300:
            raise ValueError('invalid instrument token or max gap')
        self.token = instrument_token
        self.max_gap_seconds = float(max_gap_seconds)
        self.close_proximity_seconds = float(close_proximity_seconds)
        self.max_source_age_seconds = float(max_source_age_seconds)
        self.reason = 'WAIT_STREAM'
        self.received_count = 0
        self.rejected_count = 0
        self.emitted_count = 0
        self.reset_count = 0
        self._session_day = None
        self._last_tick_time = None
        self._last_volume = None
        self._bucket_time = None
        self._open = self._high = self._low = self._close = None
        self._volume = 0
        self._ticks = 0
        self._first_at = self._last_at = None
        self._ready = False
        self._discard_initial_bucket = True

    def reset(self, reason: str) -> None:
        self.reason = reason
        self.reset_count += 1
        self._last_tick_time = None
        self._last_volume = None
        self._bucket_time = None
        self._volume = self._ticks = 0
        self._ready = False
        self._discard_initial_bucket = True
        self._open = self._high = self._low = self._close = None
        self._first_at = self._last_at = None

    def disconnected(self) -> None:
        self.reset('DISCONNECTED_REQUIRES_RECONCILIATION')

    def diagnostic(self) -> dict:
        """Safe health data: no raw packet, API token or access credentials."""
        return {'status':self.reason,'ticks_seen':self.received_count,
                'ticks_rejected':self.rejected_count,'bars_shadow':self.emitted_count,
                'resets':self.reset_count,'last_exchange_tick_at':(
                    self._last_tick_time.isoformat() if self._last_tick_time else None),
                'broker_confirmed':False}

    def ingest(self, tick: dict, received_at: datetime) -> list[StreamBar]:
        """Accept only timestamped, fresh tradeable futures packets.

        The consumer explicitly rejects the whole state on sequencing failures,
        rather than reconstructing missing candles by interpolation.
        """
        if not isinstance(tick, dict) or tick.get('instrument_token') != self.token:
            return []
        self.received_count += 1
        try:
            now = _as_ist(received_at)
            ts = _as_ist(tick.get('exchange_timestamp'))
            price = float(tick.get('last_price'))
            cumulative = int(tick.get('volume_traded'))
            if not isfinite(price) or price <= 0 or cumulative < 0:
                raise ValueError('BAD_TICK_PRICE_OR_VOLUME')
            latency = (now-ts).total_seconds()
            if latency < -2 or latency > self.max_source_age_seconds:
                raise ValueError('STALE_OR_FUTURE_TICK')
            if ts.weekday() >= 5 or not (time(9, 15) <= ts.time() <= time(15, 30)):
                raise ValueError('OUTSIDE_NSE_SESSION')
        except (TypeError, ValueError, OverflowError) as exc:
            self.rejected_count += 1
            # Do not reuse partial series after a bad packet that may indicate
            # feed desynchronization. Error string only from our own validators.
            self.reset('INVALID_TICK')
            return []

        if self._session_day is not None and ts.date() != self._session_day:
            self.reset('NEW_SESSION_REQUIRES_WARMUP')
        self._session_day = ts.date()

        if self._last_tick_time is not None:
            if ts < self._last_tick_time:
                self.rejected_count += 1
                self.reset('OUT_OF_ORDER_TICK')
                return []
            if (ts-self._last_tick_time).total_seconds() > self.max_gap_seconds:
                self.reset('TICK_GAP_REQUIRES_RECONCILIATION')
            elif cumulative < self._last_volume:
                self.rejected_count += 1
                self.reset('CUMULATIVE_VOLUME_RESET')
                return []

        tick_bucket = _bucket(ts)
        if self._bucket_time is None:
            self._init_bucket(tick_bucket, ts, price)
            self._last_volume = cumulative
            self._last_tick_time = ts
            self.reason = 'WARMING_UP_FIRST_PARTIAL_BUCKET'
            return []

        # Repeated ticks in the same second with identical price and volume
        # are duplicates, not fresh independent observations.
        if ts == self._last_tick_time and cumulative == self._last_volume and price == self._close:
            return []

        delta = cumulative - self._last_volume
        if delta < 0:
            self.reset('CUMULATIVE_VOLUME_RESET')
            return []

        emitted: list[StreamBar] = []
        if tick_bucket != self._bucket_time:
            diff = tick_bucket - self._bucket_time
            near_close = (self._bucket_time + timedelta(minutes=5)-self._last_tick_time).total_seconds()
            if (diff == timedelta(minutes=5) and not self._discard_initial_bucket
                    and self._ready and self._volume > 0
                    and 0 <= near_close <= self.close_proximity_seconds):
                candle = Candle(self._bucket_time,self._open,self._high,self._low,self._close,self._volume)
                candle.validate()
                emitted.append(StreamBar(candle,self._first_at,self._last_at,now,self._ticks))
                self.emitted_count += 1
                self.reason = 'SHADOW_BAR_READY_NEEDS_REST_VERIFICATION'
            else:
                self.reason = 'BAR_GAP_OR_UNCONFIRMED_CLOSE'
            self._init_bucket(tick_bucket,ts,price)
            self._discard_initial_bucket = False
            # delta is captured for this new bucket; the baseline belongs to
            # the prior bucket's last tick. It does not make the bar confirmed.
            self._volume = delta
            self._ready = True
        else:
            self._ready = True
            self._volume += delta
            self._high = max(self._high,price)
            self._low = min(self._low,price)
            self._close = price
            self._last_at = ts
            self._ticks += 1

        self._last_volume = cumulative
        self._last_tick_time = ts
        return emitted

    def _init_bucket(self, bucket: datetime, ts: datetime, price: float) -> None:
        self._bucket_time = bucket
        self._open = self._high = self._low = self._close = price
        self._first_at = self._last_at = ts
        self._volume = 0
        self._ticks = 1
        self._ready = False


class KiteTickerShadow:
    """One-instrument KiteTicker transport: diagnostics only, NO order access.

    Reconnect/backoff is handled by the official SDK. The hosting runner must
    resolve the front NFO futures token each new session before starting.
    """
    def __init__(self, api_key: str, token: str, future_token: int,
                 on_bar: Callable[[StreamBar], None],
                 on_diagnostic: Callable[[dict], None] | None = None,
                 *, ticker_factory=None):
        if not api_key or not token or future_token <= 0:
            raise ValueError('missing read-only Kite subscription credentials')
        self.future_token = future_token
        self.aggregator = FiveMinuteTickAggregator(future_token)
        self.on_bar = on_bar
        self.on_diagnostic = on_diagnostic or (lambda event: None)
        if ticker_factory is None:
            from kiteconnect import KiteTicker
            ticker_factory = KiteTicker
        self._ticker = ticker_factory(api_key,token)
        self._ticker.on_ticks = self._on_ticks
        self._ticker.on_connect = self._on_connect
        self._ticker.on_close = self._on_close
        self._ticker.on_error = self._on_error

    def _on_connect(self, ws, response):
        self.aggregator.disconnected()  # old state untrusted after reconnect
        ws.subscribe([self.future_token])
        ws.set_mode(ws.MODE_FULL,[self.future_token])
        self.on_diagnostic({'event':'SOCKET_CONNECTED_REWARM','status':'WAIT_REST_RECONCILIATION'})

    def _on_close(self, ws, code, reason):
        self.aggregator.disconnected()
        self.on_diagnostic({'event':'SOCKET_DISCONNECTED','status':'WAIT_DATA'})

    def _on_error(self, ws, code, reason):
        self.aggregator.disconnected()
        self.on_diagnostic({'event':'SOCKET_ERROR','status':'WAIT_DATA'})

    def _on_ticks(self, ws, ticks):
        at = datetime.now(IST)
        for tick in ticks:
            for bar in self.aggregator.ingest(tick,at):
                self.on_bar(bar)

    def connect(self):
        """The worker owns lifecycle and must call stop when shutting down."""
        self._ticker.connect(threaded=True)

    def stop(self):
        self._ticker.close()
        self.aggregator.disconnected()
