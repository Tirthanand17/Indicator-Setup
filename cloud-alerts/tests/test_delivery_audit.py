"""Offline-only Telegram API acceptance metrics. No secrets, broker or network."""
from datetime import date, datetime, timedelta, timezone
import json
import sqlite3

import pytest
from cryptography.fernet import Fernet

from cloud_alerts.delivery_audit import delivery_report, read_delivery_rows_readonly
from cloud_alerts.delivery_audit_cli import main
from cloud_alerts.engine import Engine
from cloud_alerts.security import TokenVault
from cloud_alerts.state import State

AT = datetime(2026, 10, 19, 10, 0, 0, tzinfo=timezone(timedelta(hours=5, minutes=30)))
DATE = date(2026, 10, 19)


def test_initial_schema_and_restart_preserve_delivery_telemetry(tmp_path):
    path = tmp_path / 'db.sqlite3'
    s = State(str(path))
    assert s.claim_event('x', 'REVIEW_CE', AT, 'PAPER ONLY')
    assert s.record_delivery_attempt('x', AT + timedelta(seconds=3))
    assert s.record_delivery_attempt('x', AT + timedelta(seconds=13))
    reopened = State(str(path))
    assert reopened.mark_delivered('x', AT + timedelta(seconds=18))
    assert reopened.read_delivery_audit_rows() == [
        ('REVIEW_CE', AT.isoformat(), 1, 2,
         (AT + timedelta(seconds=3)).astimezone(timezone.utc).isoformat(),
         (AT + timedelta(seconds=13)).astimezone(timezone.utc).isoformat(),
         (AT + timedelta(seconds=18)).astimezone(timezone.utc).isoformat())
    ]
    assert reopened.event_delivery_status('x') == 1
    assert reopened.mark_delivered('x', AT + timedelta(seconds=25)) is False
    assert reopened.read_delivery_audit_rows()[0][-1] == (
        AT + timedelta(seconds=18)).astimezone(timezone.utc).isoformat()


def test_old_schema_migrates_without_losing_original_events(tmp_path):
    path = tmp_path / 'legacy.db'
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE events (event_id TEXT PRIMARY KEY, status TEXT NOT NULL, '
                   'at TEXT NOT NULL, payload TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0)')
        db.execute('INSERT INTO events VALUES(?,?,?,?,?)',
                   ('keep', 'REVIEW_PE', AT.isoformat(), 'DO NOT DISCLOSE', 1))
    s = State(str(path))
    assert s.event_delivery_status('keep') == 1
    report = delivery_report(s.read_delivery_audit_rows(), [DATE])
    assert report['accepted_without_timing_evidence'] == 1
    assert report['median_api_latency_seconds'] is None
    assert 'DO NOT DISCLOSE' not in str(report)
    assert State(str(path)).event_delivery_status('keep') == 1


def test_retry_and_expiry_counts_and_latency_are_separate(tmp_path):
    s = State(str(tmp_path / 'db.sqlite'))
    s.claim_event('accepted', 'REVIEW_PE', AT, 'PRIVATE TEXT')
    s.record_delivery_attempt('accepted', AT + timedelta(seconds=1))
    s.record_delivery_attempt('accepted', AT + timedelta(seconds=45))
    s.mark_delivered('accepted', AT + timedelta(seconds=50))
    s.claim_event('expired', 'REVIEW_CE', AT, 'HIDDEN')
    s.record_delivery_attempt('expired', AT + timedelta(seconds=10))
    s.expire_events_before(AT + timedelta(seconds=181))
    s.claim_event('queued', 'EXIT_REVIEW', AT + timedelta(seconds=30), 'HIDDEN AGAIN')
    s.claim_event('noise', 'NO_TRADE', AT, 'not a phone alert')
    report = delivery_report(s.read_delivery_audit_rows(), [DATE])
    assert (report['review_alerts'], report['accepted_by_bot_api'], report['expired_unsent'],
            report['still_queued']) == (3, 1, 1, 1)
    assert report['alerts_requiring_retry'] == 1
    assert report['send_attempts_recorded'] == 3
    assert report['median_api_latency_seconds'] == 50
    assert report['p95_api_latency_seconds'] == 50
    assert report['telegram_api_acceptance_rate_pct'] == 33.33
    assert 'PRIVATE TEXT' not in str(report)


def test_accepted_after_ttl_is_explicit_not_hidden(tmp_path):
    s = State(str(tmp_path / 'db.sqlite'))
    s.claim_event('late', 'VIRTUAL_OPTION_EXIT_TIME', AT, 'VIRTUAL EXIT')
    s.mark_delivered('late', AT + timedelta(seconds=200))
    report = delivery_report(s.read_delivery_audit_rows(), [DATE])
    assert report['accepted_after_180s'] == 1
    assert report['max_api_latency_seconds'] == 200


def test_expired_and_already_accepted_rows_cannot_be_sent_again(tmp_path):
    s = State(str(tmp_path / 'db.sqlite'))
    s.claim_event('expired', 'REVIEW_CE', AT, 'secret')
    s.expire_events_before(AT + timedelta(seconds=181))
    assert not s.record_delivery_attempt('expired', AT + timedelta(seconds=182))
    assert not s.mark_delivered('expired', AT + timedelta(seconds=183))
    s.claim_event('accepted', 'REVIEW_CE', AT, 'secret')
    assert s.mark_delivered('accepted', AT + timedelta(seconds=2))
    assert not s.record_delivery_attempt('accepted', AT + timedelta(seconds=5))
    assert not s.mark_delivered('accepted', AT + timedelta(seconds=10))


def test_invalid_state_and_reverse_time_order_fail_closed():
    rows = [
        ('REVIEW_CE', AT.isoformat(), 9, 0, None, None, None),
        ('REVIEW_CE', AT.isoformat(), 0, -1, None, None, None),
        ('REVIEW_CE', AT.isoformat(), 1, 1, None, None, AT.isoformat()),
        ('REVIEW_CE', AT.isoformat(), 0, 0, None, None, AT.isoformat()),
        ('REVIEW_CE', AT.isoformat(), 1, 1, AT.isoformat(), AT.isoformat(),
         (AT - timedelta(seconds=1)).isoformat()),
        ('REVIEW_CE', AT.isoformat(), 1, 1, AT.isoformat(), AT.isoformat(),
         (AT - timedelta(seconds=10)).isoformat()),
        ('REVIEW_CE', AT.isoformat(), 0, 2, None, None, None),
    ]
    for bad in rows:
        with pytest.raises(ValueError):
            delivery_report([bad], [DATE])


def test_unsafe_time_and_invalid_dates_rejected(tmp_path):
    s = State(str(tmp_path / 'db.sqlite'))
    s.claim_event('one', 'REVIEW_CE', AT, 'hidden')
    for bad in (datetime(2026, 10, 19), None):
        with pytest.raises(ValueError):
            s.record_delivery_attempt('one', bad)
        with pytest.raises(ValueError):
            s.mark_delivered('one', bad) if bad is not None else s.mark_delivered('one', 'bad')
    for dates in ([], [date(2026, 10, 17)], [DATE, DATE], ['2026-10-19']):
        with pytest.raises(ValueError):
            delivery_report([], dates)


def test_api_acceptance_not_phone_receipt(tmp_path):
    s = State(str(tmp_path / 'db.sqlite'))
    s.claim_event('msg', 'REVIEW_CE', AT, 'PAPER')
    s.mark_delivered('msg', AT + timedelta(seconds=2))
    report = delivery_report(s.read_delivery_audit_rows(), [DATE])
    assert report['accepted_by_bot_api'] == 1
    assert report['telegram_api_acceptance_is_phone_receipt'] is False
    assert report['phone_receipts_verified'] is False
    assert report['real_trades_placed'] is False


def test_empty_session_reports_no_made_up_100pct():
    report = delivery_report([], [DATE])
    assert report['review_alerts'] == 0
    assert report['telegram_api_acceptance_rate_pct'] is None
    assert report['median_api_latency_seconds'] is None


def test_date_selection_uses_ist_even_when_storage_is_utc(tmp_path):
    s = State(str(tmp_path / 'db.sqlite'))
    local = AT.replace(hour=0, minute=2)
    s.claim_event('ist-just-after-midnight', 'REVIEW_PE', local.astimezone(timezone.utc), 'PAPER')
    assert delivery_report(s.read_delivery_audit_rows(), [DATE])['review_alerts'] == 1


@pytest.mark.asyncio
async def test_telegram_retry_is_durable_across_engine_restart(tmp_path):
    class Flaky:
        def __init__(self):
            self.calls = 0
        def send(self, body):
            self.calls += 1
            raise RuntimeError('Synthetic transport outage')
    class Working:
        def __init__(self):
            self.sent = []
        def send(self, body):
            self.sent.append(body)
    path = tmp_path / 'db.sqlite'
    s = State(str(path))
    s.claim_event('message', 'REVIEW_CE', AT, 'NO TRADE PLACED')
    vault = TokenVault(tmp_path / 'vault.enc', Fernet.generate_key().decode())
    down = Flaky()
    engine = Engine('TEST', vault, s, down, enabled=True)
    await engine._deliver_outbox(AT + timedelta(seconds=10))
    assert down.calls == 1
    after_restart = State(str(path))
    assert after_restart.event_delivery_status('message') == 0
    working = Working()
    new_engine = Engine('TEST', vault, after_restart, working, enabled=True)
    await new_engine._deliver_outbox(AT + timedelta(seconds=35))
    assert working.sent == ['NO TRADE PLACED']
    report = delivery_report(after_restart.read_delivery_audit_rows(), [DATE])
    assert report['send_attempts_recorded'] == 2
    assert report['alerts_requiring_retry'] == 1
    assert report['median_api_latency_seconds'] == 35


def test_readonly_audit_does_not_modify_db_or_show_payload(tmp_path, capsys):
    path = tmp_path / 'db.sqlite'
    s = State(str(path))
    s.claim_event('id', 'REVIEW_PE', AT, 'DO_NOT_LEAK_PRIVATE_TEXT')
    report = delivery_report(read_delivery_rows_readonly(path), [DATE])
    assert report['still_queued'] == 1
    assert main(['--db', str(path), '--session-date', DATE.isoformat()]) == 0
    output = capsys.readouterr().out
    assert 'DO_NOT_LEAK_PRIVATE_TEXT' not in output
    parsed = json.loads(output)
    assert parsed['contains_message_contents_or_credentials'] is False
    assert s.pending_events() == [('id', 'DO_NOT_LEAK_PRIVATE_TEXT')]


def test_audit_of_legacy_db_is_read_only_and_rejects_missing_columns(tmp_path):
    path = tmp_path / 'legacy.db'
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE events(event_id TEXT PRIMARY KEY, at TEXT NOT NULL)')
    with pytest.raises(ValueError, match='legacy'):
        read_delivery_rows_readonly(path)
    with sqlite3.connect(path) as db:
        columns = {r[1] for r in db.execute('PRAGMA table_info(events)')}
        assert columns == {'event_id', 'at'}


def test_percentile_and_multiple_dates_and_retries(tmp_path):
    s = State(str(tmp_path / 'db.sqlite'))
    for i, seconds in enumerate((2, 4, 6, 8, 15, 25, 60, 95, 130, 190)):
        s.claim_event(f'id{i}', 'REVIEW_CE', AT + timedelta(seconds=i), 'PAPER')
        s.mark_delivered(f'id{i}', AT + timedelta(seconds=i + seconds))
    report = delivery_report(s.read_delivery_audit_rows(), [DATE, date(2026, 10, 20)])
    assert report['median_api_latency_seconds'] == 15
    assert report['p95_api_latency_seconds'] == 190
    assert report['accepted_after_180s'] == 1
    assert report['selected_sessions'] == 2
    assert len(report['daily']) == 2
