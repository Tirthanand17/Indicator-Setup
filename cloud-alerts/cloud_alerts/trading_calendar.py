"""Pinned official NSE equity-F&O REGULAR session calendar (no network or orders).

Source: NSE/FAOP/71777 dated 12 Dec 2025, supplemented by NSE/FAOP/72262
of 12 Jan 2026 (municipal election closure). Calendars can be amended:
this snapshot is NOT live-fetched, and unsupported years fail closed.

Special Muhurat or exchange-announced sessions are NOT regular 09:15-15:30
sessions and must never enter the normal five-minute bot by assumption.
"""
from __future__ import annotations
from datetime import date, datetime

CALENDAR_VERSION = 'NSE-FO-2026-FAOP71777-FAOP72262'
SOURCE_URLS = (
    'https://nsearchives.nseindia.com/content/circulars/FAOP71777.pdf',
    'https://nsearchives.nseindia.com/content/circulars/FAOP72262.pdf',
)

_CLOSED_2026 = frozenset(date.fromisoformat(s) for s in (
    '2026-01-15', '2026-01-26', '2026-03-03', '2026-03-26',
    '2026-03-31', '2026-04-03', '2026-04-14', '2026-05-01',
    '2026-05-28', '2026-06-26', '2026-09-14', '2026-10-02',
    '2026-10-20', '2026-11-10', '2026-11-24', '2026-12-25',
))

class CalendarUnavailable(ValueError):
    """The pinned official F&O calendar does not cover this year."""


def session_status(day: date) -> str:
    """REGULAR, HOLIDAY or WEEKEND; never guess for unsupported years.

    An exchange emergency closure after publication requires a calendar patch.
    """
    if type(day) is not date:
        raise ValueError('session must be a date, not a datetime or text')
    if day.year != 2026:
        raise CalendarUnavailable('NSE F&O regular-session calendar needs annual refresh')
    if day.weekday() >= 5:
        return 'WEEKEND'
    if day in _CLOSED_2026:
        return 'HOLIDAY'
    return 'REGULAR'


def regular_session(day: date) -> bool:
    return session_status(day) == 'REGULAR'
