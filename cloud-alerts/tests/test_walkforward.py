"""No historical lookahead, fake fill evidence, or double-counted quote events."""
from dataclasses import replace
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
import pytest
from cloud_alerts.evaluation import PaperQuotePair, Costs, EvidenceError
from cloud_alerts.walkforward import walk_forward_windows
IST = ZoneInfo('Asia/Kolkata')
COSTS = Costs(slippage_bps=12,roundtrip_charges_rs=35)


def fake_rows(sessions=12):
    result=[]
    for i in range(sessions):
        # Weekday-only sample session dates: October 2026 weekdays.
        d=date(2026,10,1)+timedelta(days=i)
        while d.weekday()>=5:
            d+=timedelta(days=1)
        # Unique distinct trading sessions regardless of weekends.
        if result:
            prev=result[-1].signal_entry_at.date()
            if d<=prev:
                d=prev+timedelta(days=1)
                while d.weekday()>=5:d+=timedelta(days=1)
        entry=datetime(d.year,d.month,d.day,10,0,tzinfo=IST)
        result.append(PaperQuotePair(
            event_id=f'PAPER-SESSION-{i:02}',option_symbol='NIFTY26OCT24500CE',
            option_expiry=date(2026,10,27),direction='CE',
            signal_entry_at=entry,quote_entry_at=entry+timedelta(seconds=2),
            entry_bid=99.5,entry_ask=100,entry_ask_qty=150,
            signal_exit_at=entry+timedelta(minutes=5),
            quote_exit_at=entry+timedelta(minutes=5,seconds=2),
            exit_bid=110,exit_ask=110.5,exit_bid_qty=150,
            lot_size=65,lots=1,source='SYNTHETIC_TEST'))
    return result


def test_folds_have_disjoint_train_embargo_test_sessions():
    r=walk_forward_windows(fake_rows(),COSTS,train_sessions=5,test_sessions=2,embargo_sessions=1)
    assert r['fold_count']==3
    for fold in r['folds']:
        assert fold['train_last'] < fold['embargo_first'] <= fold['embargo_last'] < fold['test_first']
        assert fold['test_last'] > fold['test_first']
        assert fold['test_quote_pairs']==2 and fold['train_quote_pairs']==5
        assert not fold['actual_fills_proven'] and not fold['independent_source_audit_complete']
    assert r['out_of_sample_trading_edge_proven'] is False
    assert r['real_orders_placed'] is False


def test_shuffled_input_does_not_change_windows():
    rows=fake_rows()
    assert walk_forward_windows(rows,COSTS)==walk_forward_windows(list(reversed(rows)),COSTS)


def test_few_days_fail_closed_with_no_derived_accuracy():
    s=walk_forward_windows(fake_rows(5),COSTS,train_sessions=4,test_sessions=2,embargo_sessions=1)
    assert s['status']=='INSUFFICIENT_SESSION_DAYS'
    assert s['folds']==[] and not s['out_of_sample_trading_edge_proven']


def test_duplicate_event_rejected_even_on_different_day():
    rows=fake_rows(8)
    rows[1]=replace(rows[1],event_id=rows[0].event_id)
    with pytest.raises(EvidenceError,match='duplicate'):
        walk_forward_windows(rows,COSTS,train_sessions=4,test_sessions=2)


def test_invalid_quote_fails_before_reporting_any_fold():
    rows=fake_rows(8)
    rows[4]=replace(rows[4],entry_bid=105)
    with pytest.raises(EvidenceError,match='bid'):
        walk_forward_windows(rows,COSTS,train_sessions=4,test_sessions=2)


def test_parameters_reject_invalid_or_zero_gap():
    rows=fake_rows(9)
    for args in ({'train_sessions':1},{'test_sessions':0},{'embargo_sessions':0},
                 {'step_sessions':0},{'train_sessions':True}):
        with pytest.raises(EvidenceError):walk_forward_windows(rows,COSTS,**args)


def test_all_figures_remain_synthetic_and_after_costs():
    rows=fake_rows(9)
    a=walk_forward_windows(rows,COSTS,train_sessions=4,test_sessions=2)
    b=walk_forward_windows(rows,Costs(40,70),train_sessions=4,test_sessions=2)
    assert a['folds'][0]['test_hypothetical_net_rs']>b['folds'][0]['test_hypothetical_net_rs']
    assert a['folds'][0]['test_unverified_quote_pairs']==2
