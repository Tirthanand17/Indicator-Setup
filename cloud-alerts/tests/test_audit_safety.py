"""Independent audit reproductions. Synthetic data only; no network calls."""
from datetime import datetime, timedelta
from dataclasses import replace
import pytest
from test_paper_book import book, quote, NOW
from test_market_data_integrity import snapshot
from cloud_alerts.signals import decide


@pytest.mark.parametrize('day', ['2026-10-20', '2027-01-04'])
def test_ledger_rejects_closed_or_unsupported_session(tmp_path, day):
    ledger = book(tmp_path)
    at = datetime.fromisoformat(day + 'T10:00:00+05:30')
    q = quote(at=at)
    q.contract.expiry = '2027-01-28'
    with pytest.raises(ValueError):
        ledger.enter('audit-signal', q, at, account_id='PAPER_50K')
    assert ledger.dashboard()['accounts'][0]['available_cash_rs'] == 50000


@pytest.mark.parametrize('lot', [True, 1.5, 0, -1])
def test_ledger_rejects_noninteger_lot_metadata(tmp_path, lot):
    q = quote()
    q.contract.lot_size = lot
    with pytest.raises(ValueError):
        book(tmp_path).enter('audit-signal', q, NOW, account_id='PAPER_50K')


@pytest.mark.parametrize('series', ['five', 'fifteen'])
def test_signal_rejects_second_shifted_candle_boundaries(series):
    c, q, now = snapshot()
    target = c if series == 'five' else q
    target[:] = [replace(b, start=b.start + timedelta(seconds=1)) for b in target]
    assert decide(c, now, q).status == 'WAIT_DATA'


def test_signal_rejects_missing_session_open_for_vwap():
    c, q, now = snapshot()
    c = [b for b in c if not (b.start.date() == now.date() and b.start.hour == 9 and b.start.minute == 15)]
    assert decide(c, now, q).status == 'WAIT_DATA'


def test_signal_rejects_zero_volume_confirmation():
    c, q, now = snapshot()
    q[-1] = replace(q[-1], volume=0)
    assert decide(c, now, q).status == 'WAIT_DATA'


def test_holiday_quotes_cannot_contribute_to_backtest_win_rate():
    from test_evaluation import sample
    from cloud_alerts.evaluation import score_pair, Costs, EvidenceError
    p = sample()
    delta = timedelta(days=1)  # 20 October is a pinned NSE holiday.
    p = replace(p, **{name: getattr(p, name)+delta for name in (
        'signal_entry_at','quote_entry_at','signal_exit_at','quote_exit_at')})
    with pytest.raises(EvidenceError):
        score_pair(p, Costs(8, 50))
