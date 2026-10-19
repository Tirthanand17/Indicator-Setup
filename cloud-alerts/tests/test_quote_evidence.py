"""Synthetic-only quote evidence and fail-closed after-cost paper pairing."""
import json
import sqlite3
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from cloud_alerts.evaluation import Costs, EvidenceError
from cloud_alerts.models import Contract, OptionQuote
from cloud_alerts.quote_evidence import make_snapshot, canonical_snapshot, pair_snapshots, validate_snapshot
from cloud_alerts.state import State
from cloud_alerts.evidence_cli import read_only_snapshots, run_cli

IST=ZoneInfo('Asia/Kolkata')
T=datetime(2026,10,19,12,0,12,tzinfo=IST)
EVENT='NIFTY26OCTFUT:2026-10-19T11:55:00+05:30:REVIEW_CE'
CONTRACT=Contract(288,'NIFTY26OCT23000CE','2026-10-20',65,23000,'CE')
COSTS=Costs(slippage_bps=8,roundtrip_charges_rs=50)


def snap(phase='ENTRY',at=T,price=100):
    q=OptionQuote(CONTRACT,price-.5,price+.5,65,65,at-timedelta(seconds=2))
    signal=at-timedelta(seconds=12) if phase=='ENTRY' else q.updated
    return make_snapshot(EVENT,phase,signal,at,q)


def candidate():
    return json.dumps({'direction':'CE','symbol':'NIFTY26OCTFUT',
                       'signal_candle':(T-timedelta(minutes=5)).isoformat(),
                       'expiry_date':T.date().isoformat(),
                       'entry':23000,'stop':22900,'target':23200})


def test_no_evidence_never_reports_win_rate():
    result=pair_snapshots([],COSTS)
    assert result['scorable_quote_pairs']==0
    assert result['summary']['net_win_rate_pct'] is None
    assert result['summary']['status']=='INSUFFICIENT_EVIDENCE'
    assert not result['broker_provenance_independently_verified']


def test_one_timed_quote_pair_is_hypothetical_and_unverified():
    entry=snap()
    exit_=snap('EXIT',T+timedelta(minutes=8),110)
    report=pair_snapshots([entry,exit_],COSTS,min_trades=1,min_days=1)
    assert report['quote_observations']==2
    assert report['scorable_quote_pairs']==1
    assert report['incomplete_quote_pairs']==0
    assert report['summary']['net_win_rate_pct']==100
    assert report['summary']['status']=='UNVERIFIED_SOURCE'
    assert report['summary']['real_fills_verified'] is False
    assert report['summary']['net_pnl_rs']<65*(109.5-100.5)


def test_undelivered_exit_or_only_entry_never_makes_pnl():
    report=pair_snapshots([snap()],COSTS,min_trades=1,min_days=1)
    assert report['incomplete_quote_pairs']==1 and report['scorable_quote_pairs']==0
    assert report['summary']['net_win_rate_pct'] is None


def test_reject_mismatched_contract_even_if_each_snapshot_is_valid():
    entry=snap()
    exit_=snap('EXIT',T+timedelta(minutes=8))
    exit_['instrument_token']=999
    report=pair_snapshots([entry,exit_],COSTS,min_trades=1,min_days=1)
    assert report['rejected_quote_pairs']==1 and report['scorable_quote_pairs']==0


def test_reject_out_of_order_exit_and_unfeasible_gap():
    report=pair_snapshots([snap(),snap('EXIT',T-timedelta(minutes=1))],COSTS)
    assert report['rejected_quote_pairs']==1


@pytest.mark.parametrize('key,value',[
    ('bid',float('nan')),('ask',float('inf')),('bid',0),('ask',1.0),
    ('bid_qty',False),('lot_size',0),('instrument_token','288'),
    ('source','PROVED_REAL_TRADE'),('phase','BUY'),
    ('exchange_quote_at_utc','2026-10-19T09:00:00+00:00'),
    ('signal_at_utc','2026-10-19T18:00:00+00:00'),
    ('option_symbol','BANKNIFTY26OCT23000CE')])
def test_untrusted_quotes_fail_closed(key,value):
    row=snap()
    row[key]=value
    with pytest.raises(EvidenceError):validate_snapshot(row)


def test_fields_are_strict_and_hash_stable():
    row=snap()
    a,d1=canonical_snapshot(row)
    b,d2=canonical_snapshot(json.loads(a))
    assert a==b and d1==d2 and len(d1)==64
    row['api_key']='NEVER_STORE'
    with pytest.raises(EvidenceError):canonical_snapshot(row)


def test_db_atomic_entry_snapshot_restart_and_duplicate_conflict(tmp_path):
    path=str(tmp_path/'s.sqlite3')
    state=State(path)
    obs=snap()
    assert state.claim_entry_with_candidate(EVENT,'REVIEW_CE',T,'TEST',candidate(),quote_snapshot=obs)
    restarted=State(path)
    assert restarted.read_option_quote_observations()==[obs]
    assert restarted.record_option_quote_observation(obs) is False
    bad={**obs,'ask':obs['ask']+.1}
    with pytest.raises(EvidenceError):restarted.record_option_quote_observation(bad)
    assert restarted.event_delivery_status(EVENT)==0
    assert len(restarted.read_option_quote_observations())==1


def test_atomic_entry_rejects_foreign_event_without_side_effect(tmp_path):
    state=State(str(tmp_path/'s.sqlite3'))
    with pytest.raises(EvidenceError):
        state.claim_entry_with_candidate('DIFFERENT_EVENT','REVIEW_CE',T,'TEST',candidate(),quote_snapshot=snap())
    assert state.pending_events()==[]
    assert state.read_option_quote_observations()==[]


def test_db_tampered_json_or_hash_is_detected(tmp_path):
    path=str(tmp_path/'s.sqlite3')
    state=State(path)
    assert state.record_option_quote_observation(snap())
    with sqlite3.connect(path) as db:
        db.execute('UPDATE option_quote_observations SET payload_sha256=?',('0'*64,))
    with pytest.raises(EvidenceError):state.read_option_quote_observations()


def test_entry_exit_db_reads_and_offline_cli_without_modifying_database(tmp_path,capsys):
    path=tmp_path/'s.sqlite3'
    state=State(str(path))
    state.record_option_quote_observation(snap())
    state.record_option_quote_observation(snap('EXIT',T+timedelta(minutes=8),110))
    before=path.read_bytes()
    assert read_only_snapshots(path)==[snap(),snap('EXIT',T+timedelta(minutes=8),110)]
    rc=run_cli(['--state-db',str(path),'--slippage-bps','8','--roundtrip-charges-rs','50',
                '--min-trades','1','--min-days','1'])
    parsed=json.loads(capsys.readouterr().out)
    assert rc==0
    assert parsed['scorable_quote_pairs']==1
    assert parsed['summary']['status']=='UNVERIFIED_SOURCE'
    assert not parsed['actual_orders_or_fills_verified']
    assert path.read_bytes()==before


def test_offline_cli_refuses_missing_db_and_no_path_secret_leak(tmp_path,capsys):
    missing=tmp_path/'secret-token-leak.sqlite'
    rc=run_cli(['--state-db',str(missing),'--slippage-bps','8','--roundtrip-charges-rs','50'])
    line=capsys.readouterr().out
    assert rc==2 and 'secret-token-leak' not in line
    assert not missing.exists()


def test_offline_cli_refuses_bad_fees_or_zero_cost(tmp_path,capsys):
    p=tmp_path/'s.sqlite3'
    State(str(p))
    assert run_cli(['--state-db',str(p),'--slippage-bps','nan','--roundtrip-charges-rs','0'])==2
    assert 'QUOTE_EVIDENCE_UNAVAILABLE' in capsys.readouterr().out


def test_duplicate_stages_abort_research_no_double_count():
    with pytest.raises(EvidenceError):pair_snapshots([snap(),snap()],COSTS)
