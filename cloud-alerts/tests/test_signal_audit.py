"""Phase 42 synthetic signal audit: causal, no hindsight fills or order APIs."""
from datetime import datetime,timedelta,timezone
import pytest
from cloud_alerts.signal_audit import SignalAudit

NOW=datetime(2026,10,21,10,0,12,tzinfo=timezone.utc)
CANDLE=NOW-timedelta(minutes=5,seconds=10)
FUT='NIFTY26OCTFUT'


def test_causal_duplicate_and_restart(tmp_path):
    path=str(tmp_path/'signal.db');a=SignalAudit(path)
    assert a.record(FUT,CANDLE,NOW,'STRATEGY','REVIEW_CE','FIVE_INDICATORS',indicators={'adx':31.1})
    assert not SignalAudit(path).record(FUT,CANDLE,NOW,'STRATEGY','REVIEW_CE','FIVE_INDICATORS',indicators={'adx':31.1})
    assert a.summary()['strategy_qualified']==1


def test_conflicting_same_time_fails_closed(tmp_path):
    a=SignalAudit(str(tmp_path/'signal.db'))
    a.record(FUT,CANDLE,NOW,'STRATEGY','REVIEW_CE','FIVE_INDICATORS')
    with pytest.raises(ValueError):
        a.record(FUT,CANDLE,NOW,'STRATEGY','REVIEW_PE','FIVE_INDICATORS')


def test_missed_quote_has_no_backfilled_pnl(tmp_path):
    a=SignalAudit(str(tmp_path/'signal.db'))
    a.record(FUT,CANDLE,NOW,'STRATEGY','REVIEW_PE','FIVE_INDICATORS')
    a.record(FUT,CANDLE,NOW,'QUOTE','REJECTED_LIQUIDITY','STALE_OPTION_DEPTH')
    s=a.summary()
    assert s['strategy_qualified']==1 and s['liquidity_rejected']==1
    assert s['missed_pnl_verifiable'] is False


def test_invalid_codes_and_nonfinite_indicators_rejected(tmp_path):
    a=SignalAudit(str(tmp_path/'signal.db'))
    with pytest.raises(ValueError):a.record(FUT,CANDLE,NOW,'STRATEGY','REVIEW_CE','access_token=secret')
    with pytest.raises(ValueError):a.record(FUT,CANDLE,NOW,'STRATEGY','REVIEW_CE','SAFE_REASON',indicators={'adx':float('nan')})
    with pytest.raises(ValueError):a.record(FUT,CANDLE,NOW,'STRATEGY','BUY_ORDER','SAFE_REASON')


def test_bounded_read_only_history(tmp_path):
    a=SignalAudit(str(tmp_path/'signal.db'))
    a.record(FUT,CANDLE,NOW,'STRATEGY','NO_TRADE','ADX_NOT_RISING')
    assert len(a.recent(1))==1
    with pytest.raises(ValueError):a.recent(5000)

def test_date_filtered_causal_audit_does_not_include_adjacent_day(tmp_path):
    from datetime import date
    audit=SignalAudit(str(tmp_path/'date.db'))
    audit.record(FUT,CANDLE,NOW,'STRATEGY','REVIEW_CE','FIVE_INDICATORS')
    assert audit.summary(day=date(2026,10,21))['strategy_qualified']==1
    assert audit.summary(day=date(2026,10,20))['strategy_qualified']==0
    assert audit.recent(day=date(2026,10,20))==[]
    with pytest.raises(ValueError):audit.summary(day='2026-10-21')
