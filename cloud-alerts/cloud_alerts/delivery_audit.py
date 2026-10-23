"""Privacy-limited Telegram Bot API acceptance/latency audit.

This reports API acceptance, never a phone receipt or trading outcome. It reads
SQLite metadata only; outbox message payloads and destination chat are omitted.
No Kite/Telegram network access or broker execution code is imported here.
"""
from __future__ import annotations

from datetime import date, datetime
from math import ceil
from pathlib import Path
import sqlite3
from zoneinfo import ZoneInfo

IST = ZoneInfo('Asia/Kolkata')
# Entry and exit REVIEW notifications only. Synthetic NO_TRADE events are not
# evidence of a phone notification or a market signal.
ALERT_STATUSES = frozenset({'REVIEW_CE', 'REVIEW_PE', 'EXIT_REVIEW'})


def _when(raw: str | None, *, required: bool) -> datetime | None:
    if raw is None and not required:
        return None
    if not isinstance(raw, str):
        raise ValueError('invalid audit timestamp')
    try:
        result = datetime.fromisoformat(raw)
        if result.tzinfo is None or result.utcoffset() is None:
            raise ValueError('audit timestamps must include an offset')
        return result
    except (OverflowError, TypeError, ValueError) as exc:
        raise ValueError('invalid audit timestamp') from exc


def _percentile(values: list[float], percent: float) -> float | None:
    if not values:
        return None
    return round(sorted(values)[max(0, ceil(percent * len(values)) - 1)], 2)


def delivery_report(rows: list[tuple], session_dates: list[date]) -> dict:
    """Summarize review-alert receipt *at Telegram API* by session date.

    Rows contain (status,queued_at,delivered_state,attempts,first_attempt_utc,
    last_attempt_utc,accepted_at_utc). Missing accepted timestamps from legacy
    database versions are explicitly counted as unmeasured, not instant sends.
    Sessions are user-selected; weekdays do not establish NSE open sessions.
    """
    if (not isinstance(session_dates, list) or not 1 <= len(session_dates) <= 20
            or any(type(d) is not date or d.weekday() >= 5 for d in session_dates)
            or len(set(session_dates)) != len(session_dates)):
        raise ValueError('1-20 unique, explicit weekday dates required')
    if not isinstance(rows, list):
        raise ValueError('invalid audit rows')
    chosen = set(session_dates)
    total = accepted = expired = queued = late = legacy = 0
    attempts_total = retried = 0
    latencies: list[float] = []
    by_day = {d.isoformat(): {'review_alerts': 0, 'accepted_by_bot_api': 0,
                             'expired_unsent': 0, 'still_queued': 0}
              for d in sorted(chosen)}
    for row in rows:
        if not isinstance(row, (list, tuple)) or len(row) != 7:
            raise ValueError('invalid audit row')
        status, issued_raw, state, attempts, first_raw, last_raw, accepted_raw = row
        # We do not interpret unrelated runtime events as entry/exit reviews.
        if status not in ALERT_STATUSES and not (
                isinstance(status, str) and status.startswith('VIRTUAL_OPTION_EXIT_')):
            continue
        issued = _when(issued_raw, required=True)
        if issued is None:
            raise ValueError("missing issue timestamp")
        if issued.astimezone(IST).date() not in chosen:
            continue
        if type(state) is not int or state not in (0, 1, 2):
            raise ValueError('invalid outbox delivery state')
        if type(attempts) is not int or not 0 <= attempts <= 100000:
            raise ValueError('invalid recorded attempt count')
        first = _when(first_raw, required=False)
        last = _when(last_raw, required=False)
        accepted_at = _when(accepted_raw, required=False)
        if (first is None) != (last is None):
            raise ValueError('incomplete attempt timestamps')
        if attempts == 0 and first is not None:
            raise ValueError('unexpected attempt timestamp')
        if attempts and (first is None or last is None):
            raise ValueError('missing attempt timestamps')
        if first is not None and (last is None or first < issued or last < first):
            raise ValueError('invalid attempt order')
        if accepted_at is not None and (state != 1 or accepted_at < issued
                                        or (last is not None and accepted_at < last)):
            raise ValueError('invalid Telegram acceptance time')
        day = issued.astimezone(IST).date().isoformat()
        by_day[day]['review_alerts'] += 1
        total += 1
        attempts_total += attempts
        if attempts > 1:
            retried += 1
        if state == 1:
            accepted += 1
            by_day[day]['accepted_by_bot_api'] += 1
            if accepted_at is None:
                legacy += 1
            else:
                latency = (accepted_at - issued).total_seconds()
                latencies.append(latency)
                if latency > 180:
                    late += 1
        elif state == 2:
            expired += 1
            by_day[day]['expired_unsent'] += 1
        else:
            queued += 1
            by_day[day]['still_queued'] += 1
    return {
        'mode': 'OFFLINE_TELEGRAM_API_ACCEPTANCE_AUDIT',
        'selected_sessions': len(chosen),
        'daily': [{'date': day, **numbers} for day, numbers in by_day.items()],
        'review_alerts': total,
        'accepted_by_bot_api': accepted,
        'expired_unsent': expired,
        'still_queued': queued,
        'telegram_api_acceptance_rate_pct': round(100 * accepted / total, 2) if total else None,
        'accepted_without_timing_evidence': legacy,
        'accepted_with_timing_evidence': len(latencies),
        'accepted_after_180s': late,
        'send_attempts_recorded': attempts_total,
        'alerts_requiring_retry': retried,
        'median_api_latency_seconds': _percentile(latencies, 0.5),
        'p95_api_latency_seconds': _percentile(latencies, 0.95),
        'max_api_latency_seconds': round(max(latencies), 2) if latencies else None,
        'telegram_api_acceptance_is_phone_receipt': False,
        'phone_receipts_verified': False,
        'exchange_holidays_independently_verified': False,
        'kite_source_verified_from_this_audit': False,
        'real_trades_placed': False,
        'contains_message_contents_or_credentials': False,
    }


def read_delivery_rows_readonly(db_file: str | Path) -> list[tuple]:
    """Never create or migrate DB files when running the audit CLI."""
    path = Path(db_file)
    if not path.is_file():
        raise ValueError('audit database must already exist')
    uri = path.resolve().as_uri() + '?mode=ro'
    try:
        with sqlite3.connect(uri, uri=True, timeout=5) as db:
            db.execute('PRAGMA query_only = ON')
            names = {r[1] for r in db.execute('PRAGMA table_info(events)')}
            columns = ('status', 'at', 'delivered', 'delivery_attempts',
                       'first_attempt_utc', 'last_attempt_utc', 'accepted_at_utc')
            if not set(columns).issubset(names):
                raise ValueError('legacy audit schema: migrate through app startup first')
            return db.execute('SELECT ' + ','.join(columns) + ' FROM events').fetchall()
    except sqlite3.DatabaseError as exc:
        raise ValueError('database is unreadable or has invalid schema') from exc
