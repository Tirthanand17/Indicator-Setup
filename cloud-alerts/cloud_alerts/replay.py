"""Deterministic, read-only futures signal replay with causal snapshots.

No broker client, Telegram transport, option fill, or order API is imported here.
Replay hashes are consistency markers, NOT trusted provenance signatures.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, time, timezone
from hashlib import sha256
import json
from zoneinfo import ZoneInfo

from .models import Candle
from .signals import decide

IST = ZoneInfo('Asia/Kolkata')


class ReplayError(ValueError):
    """Offline evidence is incomplete, changed or chronologically invalid."""


@dataclass(frozen=True)
class ReplayCheckpoint:
    candle_utc: str
    chain_sha256: str


@dataclass(frozen=True)
class ReplayRecord:
    candle_utc: str
    observed_utc: str
    status: str
    reason: str
    review_event_id: str | None
    chain_sha256: str


@dataclass(frozen=True)
class ReplayReport:
    records: tuple[ReplayRecord, ...]
    checkpoint: ReplayCheckpoint | None
    all_replayed: int
    review_candidates: int
    simulated_only: bool = True
    option_pnl_supported: bool = False


def _utc(value: datetime) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ReplayError('all replay timestamps must have time zones')
    return value.astimezone(timezone.utc)


def _row(c: Candle) -> tuple:
    return (_utc(c.start).isoformat(), c.open, c.high, c.low, c.close, c.volume)


def _validate_history(bars: list[Candle], minutes: int) -> None:
    if not isinstance(bars, (list, tuple)) or not bars:
        raise ReplayError('no historical candles')
    prior = None
    for c in bars:
        if not isinstance(c, Candle):
            raise ReplayError('invalid candle type')
        try:
            c.validate()
        except (ValueError, TypeError, OverflowError) as e:
            raise ReplayError('malformed historical OHLCV') from e
        local = _utc(c.start).astimezone(IST)
        if local.weekday() >= 5 or local.time() < time(9, 15) or local.time() >= time(15, 30):
            raise ReplayError('historical candle outside exchange weekday hours')
        if (local.hour * 60 + local.minute - 9 * 60 - 15) % minutes or local.second or local.microsecond:
            raise ReplayError('off-boundary historical candle')
        if prior is not None:
            previous = _utc(prior.start)
            current = _utc(c.start)
            if current <= previous:
                raise ReplayError('duplicate or reversed historical candles')
            if current.astimezone(IST).date() == previous.astimezone(IST).date() and current - previous != timedelta(minutes=minutes):
                raise ReplayError('missing intraday historical candle')
        prior = c


def replay_history(bars5: list[Candle], bars15: list[Candle], *,
                   window_start: datetime, window_end: datetime,
                   resume_after: ReplayCheckpoint | None = None) -> ReplayReport:
    """Replay completed 5-minute candles using only already completed 15-minute bars.

    Hash chains bind every prior replayed candle and its available 15-minute
    context. resume_after validates the entire prior prefix before emitting
    later decisions, rather than silently trusting a possibly revised broker
    historical response. Input does not contain option quotes; do not score P&L.
    """
    begin, end = _utc(window_start), _utc(window_end)
    if begin > end or end - begin > timedelta(days=45):
        raise ReplayError('invalid replay range')
    _validate_history(bars5, 5)
    _validate_history(bars15, 15)
    if resume_after is not None and (not isinstance(resume_after, ReplayCheckpoint)
        or len(resume_after.chain_sha256) != 64):
        raise ReplayError('invalid resume checkpoint')

    chain = '0' * 64
    records: list[ReplayRecord] = []
    verified = resume_after is None
    encountered = False
    count = 0
    reviews = 0
    c15_index = 0
    first_record = True
    for i, bar in enumerate(bars5):
        observed = _utc(bar.start) + timedelta(minutes=5, seconds=12)
        if not (begin <= observed <= end):
            continue
        while (c15_index < len(bars15) and
               _utc(bars15[c15_index].start) + timedelta(minutes=15,seconds=8) <= observed):
            c15_index += 1
        available5 = bars5[:i+1]
        available15 = bars15[:c15_index]
        verdict = decide(available5, observed, available15)
        count += 1
        event_id = ('REPLAY:' + _utc(bar.start).isoformat() + ':' + verdict.status
                    if verdict.status in {'REVIEW_CE','REVIEW_PE'} else None)
        reviews += int(event_id is not None)
        source = json.dumps({
            'previous': chain,
            'warmup5': [_row(x) for x in bars5[:i]] if first_record else [],
            'candle': _row(bar),
            'confirm15': [_row(x) for x in available15],
            'decision': [verdict.status, verdict.reason, event_id],
        }, separators=(',', ':'), allow_nan=False)
        chain = sha256(source.encode('utf-8')).hexdigest()
        first_record = False
        record = ReplayRecord(_utc(bar.start).isoformat(), observed.isoformat(),
                              verdict.status, verdict.reason, event_id, chain)
        if resume_after and record.candle_utc == resume_after.candle_utc:
            encountered = True
            if record.chain_sha256 != resume_after.chain_sha256:
                raise ReplayError('replay checkpoint history changed')
            verified = True
            continue
        if verified:
            records.append(record)
    if resume_after is not None and not encountered:
        raise ReplayError('replay resume checkpoint not in requested window')
    checkpoint = (ReplayCheckpoint(records[-1].candle_utc, records[-1].chain_sha256)
                  if records else resume_after)
    return ReplayReport(tuple(records), checkpoint, count, reviews)
