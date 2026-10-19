"""Credential-free monitoring quality gate, NOT proof of phone receipt or profit.

A process may be alive and have today's token while silently failing to fetch
completed Kite candles. /operationalz reports that distinction independently of
Docker liveness or the existing minimal /readyz token-availability probe.
"""
from __future__ import annotations
from datetime import datetime, time
from zoneinfo import ZoneInfo

IST = ZoneInfo('Asia/Kolkata')
HEALTHY_DECISIONS = frozenset({'NO_TRADE', 'REVIEW_CE', 'REVIEW_PE'})


def assess_operational(now: datetime, *, worker_running: bool, enabled: bool,
                       token_present: bool, last_data_at: datetime | None,
                       status: str, queued_alerts: int = 0,
                       max_age_seconds: int = 420) -> dict:
    """Produce a minimal non-secret operational report. Never contact Kite/Telegram.

    A green response means recent REST decision data, not proof that Telegram
    reached the device or that paper signals are profitable.
    """
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError('aware monitoring timestamp required')
    if not isinstance(queued_alerts, int) or isinstance(queued_alerts, bool) or queued_alerts < 0:
        raise ValueError('invalid outbox count')
    if not (1 <= max_age_seconds <= 900):
        raise ValueError('invalid data freshness policy')
    here = now.astimezone(IST)
    result = {'monitoring_data_ready': False, 'reason': 'UNKNOWN',
              'mode': 'READ_ONLY_PAPER', 'phone_receipt_verified': False,
              'real_orders_enabled': False}
    if not worker_running:
        reason = 'WORKER_NOT_RUNNING'
    elif not enabled:
        reason = 'ALERTS_DISABLED'
    elif here.weekday() >= 5 or not time(9, 30) <= here.time() <= time(15, 25):
        reason = 'OUTSIDE_MONITORING_SESSION'
    elif not token_present:
        reason = 'DAILY_TOKEN_MISSING'
    elif queued_alerts:
        reason = 'PHONE_OUTBOX_PENDING'
    elif status not in HEALTHY_DECISIONS:
        reason = 'DATA_OR_DELIVERY_NOT_READY'
    elif last_data_at is None or last_data_at.tzinfo is None or last_data_at.utcoffset() is None:
        reason = 'NO_VERIFIED_REST_DECISION'
    else:
        age = (now-last_data_at).total_seconds()
        reason = 'DATA_FUTURE_TIMESTAMP' if age < 0 else (
            'REST_DATA_STALE' if age > max_age_seconds else 'FRESH_REST_DECISION')
        result['monitoring_data_ready'] = reason == 'FRESH_REST_DECISION'
    result['reason'] = reason
    return result
