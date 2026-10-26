"""Pinned official NSE equity-F&O REGULAR session calendar (no network or orders).

Source: NSE/FAOP/71777 dated 12 Dec 2025, supplemented by NSE/FAOP/72262
of 12 Jan 2026 (municipal election closure). Calendars can be amended:
this snapshot is NOT live-fetched, and unsupported years fail closed.

Special Muhurat or exchange-announced sessions are NOT regular 09:15-15:30
sessions and must never enter the normal five-minute bot by assumption.
"""
from __future__ import annotations
from datetime import date
import hashlib
import json
from pathlib import Path
from .calendar_digest import CALENDAR_SHA256

def _load_calendar(raw: bytes) -> dict:
    # Generated alongside the JS module after strict schema validation. A missing,
    # altered or partially promoted manifest stops startup rather than guessing.
    if hashlib.sha256(raw).hexdigest() != CALENDAR_SHA256:
        raise ValueError('NSE_FO_CALENDAR_DIGEST_MISMATCH')
    return json.loads(raw)


_CALENDAR = _load_calendar((Path(__file__).parent / 'data' / 'nse-fo-calendar.json').read_bytes())
CALENDAR_VERSION = _CALENDAR['revision']
SOURCE_URLS = tuple(source['url'] for source in _CALENDAR['sources'])
REVIEWED_AT = _CALENDAR['reviewedAt']
COVERED_YEARS = tuple(entry['year'] for entry in _CALENDAR['years'])
_YEARS = {entry['year']: entry for entry in _CALENDAR['years']}

# NSE/FAOP/76940, 19 Oct 2026: Sunday Muhurat F&O session, 14:20–15:40 IST.
# This is explicitly NOT a regular 09:15–15:30 automated paper session.
SPECIAL_2026 = frozenset(date.fromisoformat(entry['date'])
                        for entry in _YEARS.get(2026, {}).get('overrides', [])
                        if entry['classification'] == 'SPECIAL')

class CalendarUnavailable(ValueError):
    """The pinned official F&O calendar does not cover this year."""


def session_status(day: date) -> str:
    """REGULAR, HOLIDAY, WEEKEND or SPECIAL; never guess unsupported years.

    An exchange emergency closure after publication requires a calendar patch.
    """
    if type(day) is not date:
        raise ValueError('session must be a date, not a datetime or text')
    year = _YEARS.get(day.year)
    if year is None:
        raise CalendarUnavailable('NSE F&O regular-session calendar needs annual refresh')
    for override in year['overrides']:
        if day.isoformat() == override['date']:
            return str(override['classification'])
    if day.weekday() >= 5:
        return 'WEEKEND'
    if day.isoformat() in year['holidays']:
        return 'HOLIDAY'
    return 'REGULAR'


def regular_session(day: date) -> bool:
    return session_status(day) == 'REGULAR'


def maintenance_status(day: date) -> dict:
    if type(day) is not date:
        raise ValueError('inspection date required')
    covered_through = date(max(COVERED_YEARS), 12, 31)
    remaining = (covered_through - day).days
    return {'reviewed_at': REVIEWED_AT, 'covered_years': list(COVERED_YEARS),
            'covered_through': covered_through.isoformat(), 'annual_refresh_due': remaining <= 45,
            'days_until_coverage_ends': remaining, 'live_reverified': False}
