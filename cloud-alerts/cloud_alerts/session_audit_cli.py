"""Offline read-only market-session REST polling coverage; no Kite or Telegram."""
from __future__ import annotations

import argparse
from datetime import date
import json
from pathlib import Path
import sqlite3
from urllib.parse import quote

from .session_coverage import coverage_report


def read_only_ledger(path: Path) -> list[tuple[str, int, str]]:
    if (path.is_symlink() or not path.is_file() or
            path.stat().st_size > 1024 * 1024 * 1024):
        raise ValueError('unavailable private REST coverage ledger')
    url = 'file:' + quote(str(path.resolve()), safe='/') + '?mode=ro'
    with sqlite3.connect(url, uri=True, timeout=3) as db:
        return db.execute('SELECT boundary_utc,attempts,outcome '
                          'FROM rest_poll_coverage ORDER BY boundary_utc').fetchall()


def run_cli(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='OFFLINE five-minute REST monitoring coverage, not trading proof')
    parser.add_argument('--state-db', required=True)
    parser.add_argument('--session-date', action='append', required=True,
                        help='One explicitly confirmed open NSE trading day YYYY-MM-DD; repeat for each day')
    args = parser.parse_args(argv)
    try:
        selected = [date.fromisoformat(day) for day in args.session_date]
        report = coverage_report(read_only_ledger(Path(args.state_db)), selected)
        print(json.dumps(report, sort_keys=True, allow_nan=False))
        return 0
    except (ValueError, TypeError, OSError, sqlite3.Error, OverflowError):
        # Do not echo the user-supplied database path or sqlite error text.
        print(json.dumps({'mode': 'OFFLINE_REST_SESSION_COVERAGE',
                          'ok': False, 'error': 'SESSION_COVERAGE_UNAVAILABLE'}))
        return 2


if __name__ == '__main__':
    raise SystemExit(run_cli())
