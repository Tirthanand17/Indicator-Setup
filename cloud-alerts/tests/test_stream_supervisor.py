"""No actual broker session or HTTP calls; deterministic full lifecycle tests."""
import asyncio
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import pytest

from cloud_alerts.models import Candle
from cloud_alerts.streaming import StreamBar
from cloud_alerts.stream_supervisor import ShadowSupervisor, StreamEvidence

IST = ZoneInfo('Asia/Kolkata')
START = datetime(2026,10,19,9,20,tzinfo=IST)

def candle(t=START, vol=600):
    return Candle(t,22990.0,23002.0,22980.0,22997.0,vol)

def shadow(t=START, vol=600):
    return StreamBar(candle(t,vol),t+timedelta(seconds=1),t+timedelta(minutes=4,seconds=59),t+timedelta(minutes=5),100)

class FakeSocket:
    def __init__(self,key,token,instrument,bar,diagnostic):
        self.key=key; self.token=token; self.instrument=instrument
        self.on_bar=bar; self.on_diagnostic=diagnostic
        self.connect_count=0; self.stopped=False
    def connect(self):
        self.connect_count+=1
        self.on_diagnostic({'event':'SOCKET_CONNECTED_REWARM'})
    def stop(self): self.stopped=True


def test_evidence_matched_and_no_replay():
    e=StreamEvidence(max_pending=2)
    e.put(shadow())
    assert e.compare(candle()) is True
    assert e.compare(candle()) is None
    assert e.health()['rest_matched']==1
    assert e.health()['rest_without_shadow']==1
    assert e.health()['may_generate_trade_alerts'] is False


def test_evidence_mismatch_is_diagnostic_only():
    e=StreamEvidence()
    e.put(shadow(vol=601))
    assert e.compare(candle(vol=500)) is False
    assert 'VOLUME_MISMATCH' in e.health()['last_mismatch_reasons']
    assert e.health()['authority']=='REST_ONLY'


def test_evidence_bounded_and_no_old_stale_shadow():
    e=StreamEvidence(max_pending=2)
    for n in (0,5,10):e.put(shadow(START+timedelta(minutes=n)))
    assert e.health()['pending_shadow_bars']==2
    assert e.health()['evicted_shadow_bars']==1
    assert e.compare(candle(START+timedelta(minutes=10))) is True
    assert e.health()['evicted_shadow_bars']==2


def test_evidence_rejects_untrusted_quality():
    e=StreamEvidence()
    s=shadow()
    other=StreamBar(s.candle,s.first_tick_at,s.last_tick_at,s.received_at,s.tick_count,quality='BROKER_CONFIRMED')
    e.put(other)
    assert e.health()['pending_shadow_bars']==0
    assert e.health()['status']=='REJECTED_UNTRUSTED_SHADOW_QUALITY'


@pytest.mark.asyncio
async def test_supervisor_connect_rotates_and_stale_callback_is_ignored():
    created=[]
    def factory(*args):
        s=FakeSocket(*args);created.append(s);return s
    v=ShadowSupervisor('SAFE_NON_SECRET_KEY',shadow_factory=factory)
    assert await v.ensure('DAILY_ONE',101) is True
    assert await v.ensure('DAILY_ONE',101) is True
    assert len(created)==1
    created[0].on_bar(shadow())
    await asyncio.sleep(0)
    assert v.evidence.health()['pending_shadow_bars']==1
    assert await v.ensure('DAILY_TWO',101) is True
    assert created[0].stopped and len(created)==2
    assert v.evidence.health()['pending_shadow_bars']==0
    created[0].on_bar(shadow())
    await asyncio.sleep(0)
    assert v.evidence.health()['pending_shadow_bars']==0
    created[1].on_bar(shadow())
    await asyncio.sleep(0)
    assert v.reconcile(candle()) is True
    assert v.health()['restarts']==1
    assert await v.stop_after_session(datetime(2026,10,19,15,10,tzinfo=IST)) is False
    assert await v.stop_after_session(datetime(2026,10,19,15,31,tzinfo=IST)) is True
    assert created[1].stopped
    assert await v.stop_after_session(datetime(2026,10,19,16,tzinfo=IST)) is False


@pytest.mark.asyncio
async def test_supervisor_instrument_rollover_and_socket_error_no_credentials_in_health():
    created=[]
    def factory(*args):
        s=FakeSocket(*args);created.append(s);return s
    v=ShadowSupervisor('SAFE_NON_SECRET_KEY',shadow_factory=factory)
    assert await v.ensure('DAILY_SECRET',222)
    created[0].on_diagnostic({'event':'SOCKET_ERROR','message':'DAILY_SECRET'})
    await asyncio.sleep(0)
    assert v.health()['status']=='WAIT_SOCKET_RECONNECT'
    assert 'DAILY_SECRET' not in str(v.health())
    assert await v.ensure('DAILY_SECRET',333)
    assert created[0].stopped and v.health()['restarts']==1
    await v.shutdown()


@pytest.mark.asyncio
async def test_supervisor_failed_connect_does_not_block_rest():
    def fail(*a):raise RuntimeError('possibly-secret-secret')
    v=ShadowSupervisor('SAFE_NON_SECRET_KEY',shadow_factory=fail)
    assert await v.ensure('DO_NOT_PRINT',111) is False
    assert v.health()['status']=='SHADOW_CONNECT_FAILED_REST_UNAFFECTED'
    assert 'DO_NOT_PRINT' not in str(v.health())
    assert await v.shutdown() is None


@pytest.mark.asyncio
async def test_stop_session_requires_aware_clock():
    v=ShadowSupervisor('SAFE_KEY',shadow_factory=FakeSocket)
    with pytest.raises(ValueError):
        await v.stop_after_session(datetime(2026,10,19,16))
