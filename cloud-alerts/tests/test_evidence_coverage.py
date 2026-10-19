"""A 100% conditional win rate must not hide missing paper evidence."""
from datetime import datetime, timedelta
import json
import sqlite3
from zoneinfo import ZoneInfo

import pytest

from cloud_alerts.quote_evidence import pair_snapshots, make_snapshot
from cloud_alerts.evaluation import Costs, EvidenceError
from cloud_alerts.evidence_cli import read_only_entry_notices, run_cli
from cloud_alerts.models import Contract, OptionQuote
from cloud_alerts.state import State

IST = ZoneInfo('Asia/Kolkata')
AT = datetime(2026, 10, 19, 11, 0, 10, tzinfo=IST)
C = Contract(1001, 'NIFTY26OCT23000CE', '2026-10-20', 65, 23000, 'CE')
COSTS = Costs(8, 50)


def obs(event, phase='ENTRY', when=AT, price=100.0):
    q=OptionQuote(C, price-.5, price+.5, 65, 65, when-timedelta(seconds=2))
    return make_snapshot(event, phase, when-timedelta(seconds=10), when, q)


def eid(i):
    return 'NIFTY26OCTFUT:2026-10-19T10:55:00+05:30:REVIEW_CE_'+str(i)


def test_missing_source_events_dont_disappear_from_denominator():
    ids=[eid(x) for x in range(10)]
    rows=[obs(ids[0]), obs(ids[0], 'EXIT', AT+timedelta(minutes=5), 120)]
    r=pair_snapshots(rows,COSTS,min_trades=1,min_days=1,expected_event_ids=ids)
    assert r['complete_case_win_rate_pct']==100
    assert r['summary']['net_win_rate_pct'] is None
    assert r['entry_events_missing_all_quotes']==9
    assert r['reference_event_count']==10
    assert r['scorable_event_coverage_pct']==10.0
    assert r['ranking_blockers']==['MISSING_OR_REJECTED_QUOTE_PAIRS','BROKER_QUOTE_PROVENANCE_UNVERIFIED']
    assert r['rankable_win_rate_pct'] is None


def test_unpaired_and_rejected_events_are_not_wins():
    ids=[eid(x) for x in range(3)]
    mismatch=obs(ids[1], 'EXIT', AT+timedelta(minutes=5), 105)
    mismatch['instrument_token']=2222
    rows=[obs(ids[0]), obs(ids[0],'EXIT',AT+timedelta(minutes=5), 110),
          obs(ids[1]), mismatch, obs(ids[2])]
    r=pair_snapshots(rows,COSTS,min_trades=1,min_days=1,expected_event_ids=ids)
    assert (r['scorable_quote_pairs'],r['rejected_quote_pairs'],r['incomplete_quote_pairs'])==(1,1,1)
    assert r['scorable_event_coverage_pct']==33.33
    assert not r['all_reference_events_scored']


def test_empty_reconciled_inventory_reports_zero_coverage_without_division():
    r=pair_snapshots([],COSTS,expected_event_ids=[])
    assert r['source_entry_events']==0
    assert r['scorable_event_coverage_pct'] is None
    assert r['complete_case_win_rate_pct'] is None
    assert r['summary']['net_win_rate_pct'] is None
    assert r['rankable_win_rate_pct'] is None
    assert 'INSUFFICIENT_PAPER_SAMPLE' in r['ranking_blockers']


def test_all_paired_still_unverified_and_not_rankable():
    id1=eid(1)
    r=pair_snapshots([obs(id1),obs(id1,'EXIT',AT+timedelta(minutes=5),120)],
                     COSTS,min_trades=1,min_days=1,expected_event_ids=[id1])
    assert r['scorable_event_coverage_pct']==100
    assert r['all_reference_events_scored']
    assert r['ranking_blockers']==['BROKER_QUOTE_PROVENANCE_UNVERIFIED']
    assert not r['eligible_for_strategy_ranking']


def test_unreconciled_quote_only_sample_does_not_claim_complete_coverage():
    id1=eid(1)
    r=pair_snapshots([obs(id1),obs(id1,'EXIT',AT+timedelta(minutes=5),120)],
                     COSTS,min_trades=1,min_days=1)
    assert not r['entry_notice_reconciliation_performed']
    assert r['source_entry_events'] is None
    assert 'ENTRY_NOTICE_RECONCILIATION_MISSING' in r['ranking_blockers']
    assert r['summary']['net_win_rate_pct'] is None


@pytest.mark.parametrize('ids',[[eid(1),eid(1)],['bad id'],[False], [None]])
def test_bad_notice_inventory_fails_closed(ids):
    with pytest.raises(EvidenceError):pair_snapshots([],COSTS,expected_event_ids=ids)


def test_foreign_quote_cannot_create_perfect_win_rate():
    id1=eid(1)
    with pytest.raises(EvidenceError):
        pair_snapshots([obs(id1)],COSTS,expected_event_ids=[eid(2)])


def test_outbox_read_only_reconciles_claimed_notices_and_states(tmp_path):
    db=tmp_path/'alerts.sqlite3'
    state=State(str(db))
    for i in range(3):
        assert state.claim_event(eid(i),'REVIEW_CE',AT,'SYNTHETIC')
    state.mark_delivered(eid(0))
    with sqlite3.connect(db) as conn:
        conn.execute('UPDATE events SET delivered=2 WHERE event_id=?',(eid(1),))
    notices,counts=read_only_entry_notices(db)
    assert notices==sorted([eid(0),eid(1),eid(2)])
    assert counts=={'queued':1,'accepted_by_api':1,'expired_unsent':1}
    assert read_only_entry_notices(db)[0]==notices
    assert state.claim_event(eid(99),'NO_TRADE',AT,'IGNORE')
    assert len(read_only_entry_notices(db)[0])==3


def test_reconciled_cli_never_mints_results_for_missing_exits(tmp_path,capsys):
    db=tmp_path/'sample.sqlite3'
    state=State(str(db))
    for i in range(5):
        state.claim_event(eid(i),'REVIEW_CE',AT,'SYNTHETIC')
    state.record_option_quote_observation(obs(eid(0)))
    state.record_option_quote_observation(obs(eid(0),'EXIT',AT+timedelta(minutes=5),120))
    before=db.read_bytes()
    rc=run_cli(['--state-db',str(db),'--slippage-bps','8',
                '--roundtrip-charges-rs','50','--min-trades','1','--min-days','1',
                '--reconcile-entry-outbox'])
    report=json.loads(capsys.readouterr().out)
    assert rc==0
    assert report['scorable_event_coverage_pct']==20
    assert report['complete_case_win_rate_pct']==100
    assert report['rankable_win_rate_pct'] is None
    assert report['entry_notice_delivery_counts']['queued']==5
    assert report['entry_events_missing_all_quotes']==4
    assert db.read_bytes()==before


def test_reconciled_cli_rejects_unclaimed_quote_event(tmp_path,capsys):
    db=tmp_path/'sample.sqlite3'
    state=State(str(db))
    state.record_option_quote_observation(obs(eid(1)))
    assert run_cli(['--state-db',str(db),'--slippage-bps','8',
             '--roundtrip-charges-rs','50','--reconcile-entry-outbox'])==2
    report=json.loads(capsys.readouterr().out)
    assert report['error']=='QUOTE_EVIDENCE_UNAVAILABLE'
    assert 'event_id' not in report
