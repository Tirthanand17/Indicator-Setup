from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
import dataclasses
import pytest
from cloud_alerts.evaluation import PaperQuotePair,Costs,EvidenceError,score_pair,summarize
IST=ZoneInfo('Asia/Kolkata')
BASE=datetime(2026,10,19,10,0,tzinfo=IST)


def sample(i=0,entry=100,exit_bid=109,source='SYNTHETIC_TEST'):
    t=BASE+timedelta(minutes=i*5)
    return PaperQuotePair('TEST-SIGNAL-'+str(i),'NIFTY26OCT24500CE',date(2026,10,27),'CE',
         t,t+timedelta(seconds=3),entry-1,entry,130,
         t+timedelta(minutes=2),t+timedelta(minutes=2,seconds=4),
         exit_bid,exit_bid+1,130,65,1,source)


def test_taker_prices_fee_slippage_reduce_paper_pnl():
    record=sample()
    gross=score_pair(record,Costs(0,20))
    slipped=score_pair(record,Costs(10,20))
    assert gross['gross_rs']==585
    assert gross['net_rs']==565
    assert slipped['net_rs']<gross['net_rs']
    assert slipped['actual_fill_proven'] is False


def test_invalid_bid_ask_or_depth_fail_closed():
    p=sample()
    for bad in [dataclasses.replace(p,entry_bid=101),
                dataclasses.replace(p,entry_ask_qty=0),
                dataclasses.replace(p,exit_bid_qty=10),
                dataclasses.replace(p,exit_bid=1),
                dataclasses.replace(p,entry_ask=float('nan'))]:
        with pytest.raises(EvidenceError):score_pair(bad,Costs(10,20))


def test_delayed_or_lookahead_quote_rejected():
    p=sample()
    for bad in [dataclasses.replace(p,quote_entry_at=p.signal_entry_at-timedelta(seconds=1)),
                dataclasses.replace(p,quote_exit_at=p.signal_exit_at+timedelta(seconds=25)),
                dataclasses.replace(p,quote_exit_at=p.signal_entry_at)]:
        with pytest.raises(EvidenceError):score_pair(bad,Costs(10,20))


def test_expired_or_overnight_quotes_rejected():
    p=sample()
    with pytest.raises(EvidenceError):score_pair(dataclasses.replace(p,option_expiry=date(2026,10,18)),Costs(10,20))
    with pytest.raises(EvidenceError):score_pair(dataclasses.replace(p,quote_exit_at=p.quote_exit_at+timedelta(days=1)),Costs(10,20))


def test_no_fake_win_rate_from_empty_or_tiny_dataset():
    empty=summarize([],Costs(10,20))
    assert empty['status']=='INSUFFICIENT_EVIDENCE'
    assert empty['net_win_rate_pct'] is None
    one=summarize([sample()],Costs(10,20))
    assert one['status']=='INSUFFICIENT_EVIDENCE'
    assert one['net_win_rate_pct'] is not None
    assert one['live_trading_verified'] is False


def test_duplicate_signal_ids_rejected():
    with pytest.raises(EvidenceError,match='duplicate'):
        summarize([sample(),sample()],Costs(10,20))


def test_no_zero_fee_benchmark_mistaken_for_net():
    for c in [(0,0),(-1,20),(200,20),(20,-2)]:
        with pytest.raises(EvidenceError):Costs(*c)


def test_full_paper_sample_never_implies_actual_fill():
    # Construct five different sessions and enough synthetic evidence.
    rows=[]
    for d in (0,2,3,4,7):  # 19,21,22,23,26: skip holiday and weekend.
        for n in range(6):
            p=sample(n)
            when=p.signal_entry_at+timedelta(days=d)
            delta=when-p.signal_entry_at
            rows.append(dataclasses.replace(p,event_id='PAPER-TEST-'+str(d)+'-'+str(n),
                signal_entry_at=p.signal_entry_at+delta,quote_entry_at=p.quote_entry_at+delta,
                signal_exit_at=p.signal_exit_at+delta,quote_exit_at=p.quote_exit_at+delta))
    summary=summarize(rows,Costs(10,20))
    assert summary['status']=='UNVERIFIED_SOURCE'
    assert summary['paper_trades']==30
    assert summary['session_days']==5
    assert summary['synthetic_or_unverified_rows']==30
    assert summary['real_fills_verified'] is False


def test_provenance_tag_does_not_prove_captured_quote():
    summary=summarize([sample(source='CAPTURED_KITE_QUOTE')],Costs(10,20))
    assert summary['live_trading_verified'] is False
    assert summary['option_quote_depth_verified'] is False


def test_weekend_or_preopen_paper_quotes_rejected():
    p=sample()
    with pytest.raises(EvidenceError):
        score_pair(dataclasses.replace(p,signal_entry_at=p.signal_entry_at.replace(hour=8)),Costs(10,20))
    shifted=timedelta(days=5)
    with pytest.raises(EvidenceError):
        score_pair(dataclasses.replace(p,signal_entry_at=p.signal_entry_at+shifted,
          quote_entry_at=p.quote_entry_at+shifted, signal_exit_at=p.signal_exit_at+shifted,
          quote_exit_at=p.quote_exit_at+shifted),Costs(10,20))
