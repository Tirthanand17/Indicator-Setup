"""Offline audit; outputs sanitized counts, never SQLite outbox payloads."""
from __future__ import annotations

import argparse
from datetime import date
import json
from .delivery_audit import delivery_report, read_delivery_rows_readonly


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Read-only Telegram API acceptance and latency audit')
    parser.add_argument('--db', required=True, help='Path to existing cloud alerts SQLite database')
    parser.add_argument('--session-date', action='append', required=True,
                        help='Explicitly selected NSE session date YYYY-MM-DD (repeatable)')
    args = parser.parse_args(argv)
    try:
        days = [date.fromisoformat(v) for v in args.session_date]
        report = delivery_report(read_delivery_rows_readonly(args.db), days)
    except (ValueError, TypeError, OSError):
        parser.exit(2, 'Audit rejected: invalid session dates, evidence, or read-only database.\n')
    print(json.dumps(report, sort_keys=True, separators=(',', ':')))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
