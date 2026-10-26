"""Operator-only inspection of the pinned regular NSE F&O holiday snapshot.

Does not open a broker chart, contact Kite, send Telegram or place orders.
For another year, update the NSE official circulars and code before enabling.
"""
from __future__ import annotations
import argparse
from datetime import date, datetime
import json
from zoneinfo import ZoneInfo
from .trading_calendar import session_status, CalendarUnavailable, CALENDAR_VERSION, SOURCE_URLS, maintenance_status


def run_cli(argv: list[str] | None = None) -> int:
    parser=argparse.ArgumentParser(description='Offline NSE F&O normal-session calendar check')
    parser.add_argument('--date',help='IST exchange date YYYY-MM-DD; defaults to today')
    args=parser.parse_args(argv)
    try:
        target = date.fromisoformat(args.date) if args.date is not None else datetime.now(ZoneInfo('Asia/Kolkata')).date()
        status = session_status(target)
    except (ValueError, TypeError, CalendarUnavailable):
        print(json.dumps({'calendar':'UNAVAILABLE','regular_session_verified':False,
                          'error':'CALENDAR_DATE_OR_YEAR_NOT_SUPPORTED',
                          'broker_calls_made':False,'phone_messages_sent':False}))
        return 2
    print(json.dumps({'calendar': CALENDAR_VERSION, 'exchange_date_ist':target.isoformat(),
        'exchange_segment':'NSE_FO', 'session_status':status,
        'regular_session_verified':status=='REGULAR',
        'maintenance':maintenance_status(target),
        'calendar_is_live':False, 'official_circulars':list(SOURCE_URLS),
        'broker_calls_made':False,'phone_messages_sent':False},sort_keys=True))
    return 0

if __name__ == '__main__':
    raise SystemExit(run_cli())
