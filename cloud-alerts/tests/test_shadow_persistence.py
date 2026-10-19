"""SQLite persisted quality evidence, with strict market-only schema."""
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
import pytest
from cloud_alerts.state import State
IST=ZoneInfo('Asia/Kolkata')
T=datetime(2026,10,19,10,0,tzinfo=IST)
S='NIFTY26OCTFUT'

def test_record_dedup_and_reload(tmp_path):
    dbfile=str(tmp_path/'alert_state.sqlite3')
    db=State(dbfile)
    assert db.record_shadow_evidence(S,T,T+timedelta(seconds=9),'MATCH')
    assert not db.record_shadow_evidence(S,T,T+timedelta(seconds=12),'MATCH')
    restored=State(dbfile)
    summary=restored.shadow_summary(T+timedelta(minutes=1))
    assert summary['total']==1 and summary['counts']['MATCH']==1
    assert summary['last']['future_symbol']==S
    assert summary['contains_user_credentials'] is False
    assert summary['may_generate_trade_alerts'] is False


def test_mismatch_and_missing_counters_are_separate(tmp_path):
    db=State(str(tmp_path/'metrics.db'))
    db.record_shadow_evidence(S,T,T,'MISMATCH',('OHLC_MISMATCH','VOLUME_MISMATCH'))
    db.record_shadow_evidence(S,T+timedelta(minutes=5),T+timedelta(minutes=5),'MISSING')
    s=db.shadow_summary(T+timedelta(minutes=9))
    assert s['counts']=={'MATCH':0,'MISMATCH':1,'MISSING':1}
    assert s['total']==2


def test_reject_raw_token_username_or_unapproved_reasons(tmp_path):
    db=State(str(tmp_path/'metrics.db'))
    with pytest.raises(ValueError):
        db.record_shadow_evidence('NIFTY; DROP TABLE secrets',T,T,'MATCH')
    with pytest.raises(ValueError):
        db.record_shadow_evidence(S,T,T,'MISMATCH',('ACCESS_TOKEN=SECRET',))
    with pytest.raises(ValueError):
        db.record_shadow_evidence(S,T,T,'MATCH',('OHLC_MISMATCH',))
    with pytest.raises(ValueError):
        db.record_shadow_evidence(S,T,T,'SUCCESS')
    assert db.shadow_summary(T)['total']==0


def test_trim_45day_retention(tmp_path):
    db=State(str(tmp_path/'metrics.db'))
    db.record_shadow_evidence(S,T-timedelta(days=46),T-timedelta(days=46),'MATCH')
    db.record_shadow_evidence(S,T,T,'MISSING')
    assert db.shadow_summary(T,days=45)['total']==1


def test_reject_naive_timestamps_and_invalid_window(tmp_path):
    db=State(str(tmp_path/'metrics.db'))
    with pytest.raises(ValueError):
        db.record_shadow_evidence(S,datetime(2026,10,19,10),T,'MATCH')
    with pytest.raises(ValueError):
        db.shadow_summary(T,days=0)
