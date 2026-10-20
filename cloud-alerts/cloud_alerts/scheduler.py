"""Low-frequency, idempotent REST publication probe schedule.

Never assumes Kite's historical bar is published at its nominal boundary. A
confirmed REST candle is checked *after* publication, no synthetic fills.
"""
from __future__ import annotations
from datetime import datetime, time
from zoneinfo import ZoneInfo
IST = ZoneInfo('Asia/Kolkata')
from .trading_calendar import regular_session, CalendarUnavailable

class CandlePollScheduler:
    """Maximum three poll attempts for a given 5m boundary.

    Does not persist claims across restart: Engine's durable candle key dedupes
    signals, and restart at a candle boundary may repeat harmless REST reads.
    """
    def __init__(self, slots=(8, 23, 43)):
        if not slots or len(set(slots)) != len(slots) or any(x < 7 or x > 58 for x in slots):
            raise ValueError('poll slots must be distinct, after candle closes')
        self.slots = tuple(sorted(slots))
        self._claimed: set[tuple[str,int]] = set()
        self._last_boundary = None

    def claim(self, now: datetime) -> bool:
        if now.tzinfo is None:
            return False
        local = now.astimezone(IST)
        try:
            market_open = regular_session(local.date())
        except CalendarUnavailable:
            return False  # Fail closed until the next official calendar is installed.
        if (not market_open or not time(9,25) <= local.time() < time(15,26)
                or local.minute % 5 != 0):
            return False
        boundary = local.replace(second=0,microsecond=0)
        if self._last_boundary != boundary:
            self._last_boundary = boundary
            self._claimed.clear()
        second = local.second + local.microsecond / 1_000_000
        # A late wake uses only its current time slot; do not burn all prior
        # unclaimed attempts in a rapid burst, which could violate Kite quotas.
        eligible = [x for x in self.slots if second >= x]
        if not eligible:
            return False
        candidate = eligible[-1]
        if (boundary.isoformat(),candidate) in self._claimed:
            return False
        self._claimed.add((boundary.isoformat(),candidate))
        return True
