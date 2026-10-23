"""Read-only, optional KiteTicker shadow supervision and REST reconciliation.

Authoritative signal input is always Kite's completed historical REST candles.
Shadow ticks never create a BUY, SELL or EXIT message. No broker order API.
"""
from __future__ import annotations

import asyncio
from collections import OrderedDict
from datetime import datetime, time
from zoneinfo import ZoneInfo
from typing import Callable

from .models import Candle
from .streaming import KiteTickerShadow, StreamBar, reconcile_stream_bar


class StreamEvidence:
    """Bounded one-session shadow-vs-REST diagnostics, no executable signals.

    Stream callback ingestion and REST reconciliation both occur on the event
    loop thread; the websocket callback is marshalled via call_soon_threadsafe.
    The main data engine never waits for shadow availability.
    """
    def __init__(self, max_pending: int = 16):
        if not 1 <= max_pending <= 200:
            raise ValueError('invalid shadow ring capacity')
        self.max_pending = max_pending
        self.pending: OrderedDict[datetime, StreamBar] = OrderedDict()
        self.received = self.matched = self.mismatched = 0
        self.no_shadow = self.evicted = 0
        self.last_rest_at: str | None = None
        self.last_match_at: str | None = None
        self.last_reasons: tuple[str, ...] = ()
        self.status = 'WAIT_STREAM'

    def put(self, bar: StreamBar) -> None:
        if bar.quality != 'SHADOW_UNRECONCILED':
            self.status = 'REJECTED_UNTRUSTED_SHADOW_QUALITY'
            return
        bar.candle.validate()
        self.pending[bar.candle.start] = bar
        self.pending.move_to_end(bar.candle.start)
        self.received += 1
        while len(self.pending) > self.max_pending:
            self.pending.popitem(last=False)
            self.evicted += 1
        self.status = 'WAIT_REST_VERIFICATION'

    def compare(self, historical: Candle) -> bool | None:
        historical.validate()
        self.last_rest_at = historical.start.isoformat()
        # Old partial/disconnected bars must not remain candidates forever.
        for key in list(self.pending):
            if key < historical.start:
                del self.pending[key]
                self.evicted += 1
        bar = self.pending.pop(historical.start, None)
        if bar is None:
            self.no_shadow += 1
            self.status = 'REST_OK_SHADOW_NOT_AVAILABLE'
            return None
        result = reconcile_stream_bar(bar, historical)
        if result.matched:
            self.matched += 1
            self.last_match_at = historical.start.isoformat()
            self.last_reasons = ()
            self.status = 'REST_STREAM_MATCH'
        else:
            self.mismatched += 1
            self.last_reasons = result.reasons
            self.status = 'REST_STREAM_MISMATCH'
        return result.matched

    def clear(self, reason: str) -> None:
        self.pending.clear()
        self.status = reason

    def health(self) -> dict:
        return {
            'status': self.status, 'received_shadow_bars': self.received,
            'rest_matched': self.matched, 'rest_mismatched': self.mismatched,
            'rest_without_shadow': self.no_shadow, 'evicted_shadow_bars': self.evicted,
            'pending_shadow_bars': len(self.pending), 'last_rest_candle': self.last_rest_at,
            'last_matched_candle': self.last_match_at,
            'last_mismatch_reasons': list(self.last_reasons),
            'authority': 'REST_ONLY', 'may_generate_trade_alerts': False,
        }


class ShadowSupervisor:
    """Owns precisely one optional read-only KiteTicker connection.

    No retries are scheduled here: the REST worker's existing low-frequency
    session scheduler may re-attempt a stopped socket. The SDK handles normal
    socket reconnects internally. Token rotations and instrument expiry force
    a complete reset, and callbacks from a closed socket are discarded.
    """
    def __init__(self, api_key: str, *, shadow_factory: Callable = KiteTickerShadow,
                 evidence: StreamEvidence | None = None):
        if not api_key:
            raise ValueError('missing Kite API identity')
        self.api_key = api_key
        self.shadow_factory = shadow_factory
        self.evidence = evidence if evidence is not None else StreamEvidence()
        self._session_token: str | None = None
        self._instrument: int | None = None
        self._socket = None
        self._generation = 0
        self._loop: asyncio.AbstractEventLoop | None = None
        self.connections = 0
        self.restart_count = 0
        self.last_diagnostic: str | None = None
        self.status = 'NOT_STARTED'

    def _accept_bar(self, generation: int, bar: StreamBar) -> None:
        if generation != self._generation:
            return
        try:
            self.evidence.put(bar)
        except (TypeError, ValueError):
            self.evidence.clear('REJECTED_INVALID_SHADOW_BAR')

    def _accept_diagnostic(self, generation: int, event: dict) -> None:
        if generation != self._generation:
            return
        # Ignore any unaudited network SDK text such as exception body, URL or
        # reason; only events from the bounded internal callback vocabulary.
        value = event.get('event') if isinstance(event, dict) else None
        allowed = {'SOCKET_CONNECTED_REWARM','SOCKET_DISCONNECTED','SOCKET_ERROR'}
        self.last_diagnostic = value if value in allowed else 'SOCKET_DIAGNOSTIC'
        if value in {'SOCKET_DISCONNECTED','SOCKET_ERROR'}:
            self.evidence.clear('SOCKET_RECONNECT_REQUIRES_REST')
            self.status = 'WAIT_SOCKET_RECONNECT'

    async def _close(self) -> None:
        self._generation += 1  # revoke in-flight old websocket callbacks
        sock = self._socket
        self._socket = None
        self._session_token = None
        self._instrument = None
        self.evidence.clear('SHADOW_RESTART_REQUIRES_WARMUP')
        if sock is not None:
            try:
                await asyncio.to_thread(sock.stop)
            except Exception:
                self.status = 'SOCKET_CLOSE_FAILED'

    async def ensure(self, token: str, instrument_token: int) -> bool:
        if not token or not isinstance(instrument_token, int) or instrument_token <= 0:
            self.status = 'INVALID_SESSION_OR_INSTRUMENT'
            return False
        if self._socket is not None and (token, instrument_token) == (self._session_token, self._instrument):
            return True
        if self._socket is not None:
            self.restart_count += 1
            await self._close()
        loop = asyncio.get_running_loop()
        self._loop = loop
        generation = self._generation + 1
        self._generation = generation

        def on_bar(bar: StreamBar) -> None:
            try:
                loop.call_soon_threadsafe(self._accept_bar, generation, bar)
            except RuntimeError:
                pass  # event loop is shutting down, never keep stale data

        def on_diagnostic(event: dict) -> None:
            try:
                loop.call_soon_threadsafe(self._accept_diagnostic, generation, event)
            except RuntimeError:
                pass

        try:
            sock = self.shadow_factory(self.api_key, token, instrument_token, on_bar, on_diagnostic)
            self._socket = sock
            self._session_token = token
            self._instrument = instrument_token
            await asyncio.to_thread(sock.connect)
            self.connections += 1
            self.status = 'SHADOW_CONNECTED_UNVALIDATED'
            return True
        except Exception:
            # Transport and credentials must never be logged or returned.
            await self._close()
            self.status = 'SHADOW_CONNECT_FAILED_REST_UNAFFECTED'
            return False

    def reconcile(self, broker_candle: Candle) -> bool | None:
        return self.evidence.compare(broker_candle)

    async def stop_after_session(self, now: datetime) -> bool:
        """Close a session's socket after exchange hours to avoid stale overnight feed.

        This runs from the ordinary event-loop housekeeping, not tick callbacks.
        Holiday/weekend sessions are handled the same way.
        """
        if now.tzinfo is None:
            raise ValueError('session clock must carry a timezone')
        local = now.astimezone(ZoneInfo('Asia/Kolkata'))
        from .trading_calendar import regular_session, CalendarUnavailable
        try:
            normal_day = regular_session(local.date())
        except CalendarUnavailable:
            normal_day = False
        should_stop = (not normal_day or local.time() < time(9, 0)
                       or local.time() >= time(15, 31))
        if should_stop and self._socket is not None:
            await self.shutdown()
            return True
        return False

    async def shutdown(self) -> None:
        await self._close()
        self.status = 'SHUT_DOWN'

    def health(self) -> dict:
        return {
            'status': self.status,
            'connections': self.connections,
            'restarts': self.restart_count,
            'last_socket_event': self.last_diagnostic,
            'shadow': self.evidence.health(),
            'enabled_for_alerts': False,
        }
