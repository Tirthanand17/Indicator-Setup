from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
from cloud_alerts.scheduler import CandlePollScheduler
IST=ZoneInfo('Asia/Kolkata')
D=datetime(2026,10,19,9,20,tzinfo=IST)

def test_poll_runs_after_boundary_and_at_most_three_times():
    s=CandlePollScheduler()
    assert not s.claim(D+timedelta(seconds=7))
    assert s.claim(D+timedelta(seconds=8))
    assert not s.claim(D+timedelta(seconds=8))
    assert not s.claim(D+timedelta(seconds=20))
    assert s.claim(D+timedelta(seconds=23))
    assert s.claim(D+timedelta(seconds=43))
    assert not s.claim(D+timedelta(seconds=58))
    assert s.claim(D+timedelta(minutes=5,seconds=8))

def test_scheduler_ignores_closed_session_and_timezone_naive_clock():
    s=CandlePollScheduler()
    assert not s.claim(D.replace(tzinfo=None))
    assert not s.claim(D-timedelta(minutes=5)+timedelta(seconds=20))
    assert not s.claim(D.replace(hour=15,minute=30,second=8))
    assert not s.claim(D+timedelta(days=5,seconds=20))

def test_scheduler_catch_up_after_late_wake_cannot_spam():
    s=CandlePollScheduler()
    now=D+timedelta(seconds=50)
    assert [s.claim(now) for _ in range(6)]==[True,False,False,False,False,False]
