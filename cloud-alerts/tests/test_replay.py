from dataclasses import replace
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import pytest
from cloud_alerts.models import Candle
from cloud_alerts.replay import replay_history, ReplayError, ReplayCheckpoint

IST = ZoneInfo('Asia/Kolkata')

def history():
    five, fifteen = [], []
    for day in [12,13,14,15,16,19]:
        start = datetime(2026,10,day,9,15,tzinfo=IST)
        for k in range(45):
            p = 22000 + k + day*10
            five.append(Candle(start+timedelta(minutes=5*k),p,p+1,p-1,p,1000))
        for k in range(15):
            p = 22000 + k*3 + day*10
            fifteen.append(Candle(start+timedelta(minutes=15*k),p,p+1,p-1,p,3000))
    return five,fifteen

def replay(a=None,b=None,**kwargs):
    x,y=history()
    return replay_history(a if a is not None else x,b if b is not None else y,
      window_start=datetime(2026,10,19,9,30,tzinfo=IST),
      window_end=datetime(2026,10,19,12,30,tzinfo=IST),**kwargs)

def test_deterministic_replay():
    result=replay()
    assert result==replay()
    assert result.simulated_only and not result.option_pnl_supported

def test_checkpoint_resume_is_consistent():
    r=replay();pivot=r.records[7]
    cp=ReplayCheckpoint(pivot.candle_utc,pivot.chain_sha256)
    assert replay(resume_after=cp).records==r.records[8:]

def test_revision_to_warmup_invalidates_checkpoint():
    a,b=history();checkpoint=replay(a,b).records[8]
    a[8]=replace(a[8],close=a[8].close+0.25)
    with pytest.raises(ReplayError,match='history changed'):
        replay(a,b,resume_after=ReplayCheckpoint(checkpoint.candle_utc,checkpoint.chain_sha256))

def test_duplicate_intraday_bar_fails_closed():
    a,b=history();a.insert(-3,a[-4])
    with pytest.raises(ReplayError):
        replay(a,b)
