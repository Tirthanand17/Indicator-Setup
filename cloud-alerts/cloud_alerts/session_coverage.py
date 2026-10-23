"""Sanitized coverage accounting for scheduled NIFTY REST monitoring boundaries.

Only an explicitly supplied exchange-session date is audited. Weekdays are NOT
an NSE holiday calendar. These counters do not authenticate Kite, indicate a
phone receipt or prove a paper trade. No broker/Telegram I/O in this module.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo
from typing import TypedDict

class DailyCoverage(TypedDict):
    date: str
    expected_boundaries: int
    rest_valid: int
    attempted_not_valid: int
    not_observed: int
    rest_coverage_pct: float
    complete_rest_coverage: bool


IST = ZoneInfo('Asia/Kolkata')
from .trading_calendar import regular_session, session_status, CalendarUnavailable, CALENDAR_VERSION
FIRST = time(9, 25)
LAST = time(15, 25)
OUTCOMES = frozenset({'REST_VALID', 'WAIT_DATA', 'WAIT_TOKEN', 'API_ERROR'})


def boundary_for(observed_at: datetime) -> datetime | None:
    """Return scheduled 5-minute polling boundary, not a future candle start."""
    if not isinstance(observed_at, datetime) or observed_at.tzinfo is None or observed_at.utcoffset() is None:
        raise ValueError('poll timestamp must be timezone-aware')
    local = observed_at.astimezone(IST)
    boundary = local.replace(second=0, microsecond=0)
    try:
        market_open = regular_session(local.date())
    except CalendarUnavailable:
        return None
    if (not market_open or boundary.time() < FIRST or
            boundary.time() > LAST or local.minute % 5):
        return None
    return boundary


def expected_boundaries(session_day: date) -> tuple[datetime, ...]:
    if type(session_day) is not date or session_status(session_day) != 'REGULAR':
        raise ValueError('explicit regular NSE F&O session required, not holiday/weekend')
    first = datetime.combine(session_day, FIRST, tzinfo=IST)
    last = datetime.combine(session_day, LAST, tzinfo=IST)
    result = []
    t = first
    while t <= last:
        result.append(t.astimezone(timezone.utc))
        t += timedelta(minutes=5)
    return tuple(result)


def coverage_report(records: list[tuple[str, int, str]], session_dates: list[date]) -> dict:
    """Count observed/failed/unobserved slots without inventing uptime.

    records contain (UTC boundary ISO string, attempt count, best outcome).
    An operator MUST select genuinely open NSE dates; a weekday is not proof.
    """
    if not isinstance(session_dates, list) or not 1 <= len(session_dates) <= 20:
        raise ValueError('1-20 explicitly selected session dates required')
    if len(set(session_dates)) != len(session_dates):
        raise ValueError('duplicate session dates')
    for day in session_dates:
        expected_boundaries(day)

    seen: dict[str, tuple[int, str]] = {}
    for utc, attempts, result in records:
        if (not isinstance(utc, str) or type(attempts) is not int
                or not 1 <= attempts <= 100 or result not in OUTCOMES):
            raise ValueError('invalid sanitized REST polling observation')
        try:
            parsed = datetime.fromisoformat(utc)
            if parsed.tzinfo is None or parsed.utcoffset() is None:
                raise ValueError('timezone required')
            canonical = parsed.astimezone(timezone.utc).isoformat()
            slot = boundary_for(parsed)
            if (slot is None or slot.astimezone(timezone.utc) !=
                    parsed.astimezone(timezone.utc)):
                raise ValueError('off-boundary REST observation')
        except (TypeError, OverflowError) as exc:
            raise ValueError('invalid REST observation timestamp') from exc
        if canonical in seen:
            raise ValueError('duplicate REST boundary observation')
        seen[canonical] = (attempts, result)

    daily: list[DailyCoverage] = []
    for day in sorted(session_dates):
        ids = [dt.isoformat() for dt in expected_boundaries(day)]
        valid = sum(seen.get(i, (0, ''))[1] == 'REST_VALID' for i in ids)
        attempted = sum(i in seen for i in ids)
        failures = attempted - valid
        missing = len(ids) - attempted
        daily.append({'date': day.isoformat(), 'expected_boundaries': len(ids),
                      'rest_valid': valid, 'attempted_not_valid': failures,
                      'not_observed': missing,
                      'rest_coverage_pct': round(100 * valid / len(ids), 2),
                      'complete_rest_coverage': valid == len(ids)})
    expect = sum(d['expected_boundaries'] for d in daily)
    ok = sum(d['rest_valid'] for d in daily)
    return {'mode': 'OFFLINE_REST_SESSION_COVERAGE',
            'selected_sessions': len(daily), 'daily': daily,
            'expected_boundaries': expect, 'valid_rest_boundaries': ok,
            'observed_invalid_boundaries': sum(d['attempted_not_valid'] for d in daily),
            'never_observed_boundaries': sum(d['not_observed'] for d in daily),
            'rest_coverage_pct': round(100 * ok / expect, 2),
            'all_selected_sessions_complete': all(d['complete_rest_coverage'] for d in daily),
            'official_fo_calendar_version': CALENDAR_VERSION,
            'calendar_live_reverified': False,
            'exchange_holidays_independently_verified': False,
            'kite_source_independently_verified': False,
            'telegram_phone_receipt_verified': False,
            'paper_session_acceptance_proven': False,
            'live_orders_placed': False}
