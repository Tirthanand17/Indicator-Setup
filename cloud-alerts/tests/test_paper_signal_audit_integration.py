"""Phase 42: audit real decision paths with a synthetic broker; no Kite HTTP."""
from datetime import timedelta
import pytest

from cloud_alerts import engine as engine_module
from cloud_alerts.models import Decision
from cloud_alerts.paper_book import PaperBook
from cloud_alerts.signal_audit import SignalAudit
from test_simulated_broker_pipeline import (
    engine as make_engine,FakeKite,NOW,synthetic_candidate
)


def audit_worker(tmp_path,monkeypatch):
    worker=make_engine(tmp_path,monkeypatch)
    worker.paper_book=PaperBook(worker.db.path)
    worker.signal_audit=SignalAudit(worker.db.path)
    return worker


@pytest.mark.asyncio
async def test_strategy_quote_and_both_account_results_are_audited(tmp_path,monkeypatch):
    worker=audit_worker(tmp_path,monkeypatch)
    monkeypatch.setattr(engine_module,'decide',synthetic_candidate)
    await worker.run_once(NOW)
    report=worker.signal_audit.summary()
    assert report['strategy_qualified']==1
    assert report['counts']['QUOTE:ACCEPTED_SIGNAL']==1
    assert report['counts']['PORTFOLIO_50K:SIMULATED_OPEN']==1
    assert report['counts']['PORTFOLIO_100K:SIMULATED_OPEN']==1
    assert len(worker.paper_book.open_positions())==2
    records=worker.signal_audit.recent()
    strategy=[r for r in records if r['stage']=='STRATEGY'][0]
    assert set(strategy['indicators'])=={'vwap','ema9','ema21','plus_di','minus_di',
                                        'adx','previous_adx','atr'}
    assert strategy['outcome']=='REVIEW_CE'


@pytest.mark.asyncio
async def test_stale_option_quote_recorded_without_fake_missed_profit(tmp_path,monkeypatch):
    worker=audit_worker(tmp_path,monkeypatch)
    FakeKite.option_quote_valid=False
    monkeypatch.setattr(engine_module,'decide',synthetic_candidate)
    await worker.run_once(NOW)
    report=worker.signal_audit.summary()
    assert report['strategy_qualified']==1
    assert report['liquidity_rejected']==1
    assert report['missed_pnl_verifiable'] is False
    assert worker.paper_book.open_positions()==[]


@pytest.mark.asyncio
async def test_nonqualifying_five_indicator_setup_is_not_missed_signal(tmp_path,monkeypatch):
    worker=audit_worker(tmp_path,monkeypatch)
    monkeypatch.setattr(engine_module,'decide',lambda candles,now,confirm_15m:
        Decision('NO_TRADE','ADX not strong and rising',candles[-1]))
    await worker.run_once(NOW)
    report=worker.signal_audit.summary()
    assert report['strategy_qualified']==0
    assert report['counts']['STRATEGY:NO_TRADE']==1
    assert report['liquidity_rejected']==0
    assert not worker.paper_book.open_positions()


@pytest.mark.asyncio
async def test_duplicated_candle_does_not_duplicate_audit_evidence(tmp_path,monkeypatch):
    worker=audit_worker(tmp_path,monkeypatch)
    monkeypatch.setattr(engine_module,'decide',synthetic_candidate)
    await worker.run_once(NOW)
    first=worker.signal_audit.summary()['observations']
    await worker.run_once(NOW)
    assert worker.signal_audit.summary()['observations']==first
