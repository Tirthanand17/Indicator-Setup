"""Synthetic full-mode broker tick packets; no actual Kite requests or tokens."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from cloud_alerts.streaming import FiveMinuteTickAggregator, reconcile_stream_bar, KiteTickerShadow
from cloud_alerts.models import Candle
IST=ZoneInfo('Asia/Kolkata')
TOK=256423
D=datetime(2026,10,19,9,15,tzinfo=IST)

def tick(t, price=23000., cumulative=2000, tok=TOK, age=0):
    return {'instrument_token':tok,'exchange_timestamp':t,
            'last_price':price,'volume_traded':cumulative}

def sample_bar():
    a=FiveMinuteTickAggregator(TOK)
    assert a.ingest(tick(D,23000,100),D)==[]
    # Keep an actively ticking full-mode feed; a 5-minute gap must not pass.
    for seconds in range(30,300,30):
        t=D+timedelta(seconds=seconds)
        assert not a.ingest(tick(t,23000,100+seconds//3),t)
    assert a.ingest(tick(D+timedelta(minutes=4,seconds=59),23001,200),D+timedelta(minutes=4,seconds=59))==[]
    assert a.ingest(tick(D+timedelta(minutes=5),23001,201),D+timedelta(minutes=5))==[]
    for seconds in range(30,300,30):
        t=D+timedelta(minutes=5,seconds=seconds)
        assert not a.ingest(tick(t,23002,201+seconds//4),t)
    assert a.ingest(tick(D+timedelta(minutes=9,seconds=59),23005,301),D+timedelta(minutes=9,seconds=59))==[]
    bars=a.ingest(tick(D+timedelta(minutes=10),23004,302),D+timedelta(minutes=10))
    assert len(bars)==1
    return a,bars[0]

def test_first_bar_is_dropped_since_no_baseline():
    a=FiveMinuteTickAggregator(TOK)
    assert not a.ingest(tick(D,23000,100),D)
    assert not a.ingest(tick(D+timedelta(minutes=4,seconds=59),23001,200),D+timedelta(minutes=4,seconds=59))
    assert not a.ingest(tick(D+timedelta(minutes=5),23001,201),D+timedelta(minutes=5))
    assert a.emitted_count==0

def test_sample_ohlcv_volume_and_unconfirmed_quality():
    a,b=sample_bar()
    assert b.candle.start==D+timedelta(minutes=5)
    assert (b.candle.open,b.candle.high,b.candle.low,b.candle.close,b.candle.volume)==(23001.,23005.,23001.,23005.,101)
    assert b.quality=='SHADOW_UNRECONCILED'
    assert a.diagnostic()['broker_confirmed'] is False

def test_reconcile_shadow_requires_exchange_rest_confirmation():
    _,b=sample_bar()
    auth=Candle(b.candle.start,23001.,23005.,23001.,23005.,101)
    check=reconcile_stream_bar(b,auth)
    assert check.matched and not check.reasons
    check=reconcile_stream_bar(b,Candle(auth.start,23001.,23008.,23001.,23005.,110))
    assert not check.matched and 'OHLC_MISMATCH' in check.reasons and 'VOLUME_MISMATCH' in check.reasons

def test_stream_tick_gap_fails_closed():
    a=FiveMinuteTickAggregator(TOK)
    a.ingest(tick(D,23000,100),D)
    a.ingest(tick(D+timedelta(minutes=2),23000,200),D+timedelta(minutes=2))
    assert a.diagnostic()['status']=='WARMING_UP_FIRST_PARTIAL_BUCKET'
    assert a.reset_count>=1
    assert a.emitted_count==0

def test_stale_tick_and_out_of_order_rejected():
    a=FiveMinuteTickAggregator(TOK)
    assert not a.ingest(tick(D),D+timedelta(seconds=12))
    assert a.rejected_count==1
    a.ingest(tick(D+timedelta(seconds=20)),D+timedelta(seconds=20))
    assert not a.ingest(tick(D+timedelta(seconds=19)),D+timedelta(seconds=20))
    assert a.diagnostic()['status']=='OUT_OF_ORDER_TICK'

def test_volume_reset_and_disconnect_rewarm():
    a=FiveMinuteTickAggregator(TOK)
    a.ingest(tick(D,23000,200),D)
    a.ingest(tick(D+timedelta(seconds=1),23000,198),D+timedelta(seconds=1))
    assert a.diagnostic()['status']=='CUMULATIVE_VOLUME_RESET'
    a.disconnected()
    assert a.diagnostic()['status']=='DISCONNECTED_REQUIRES_RECONCILIATION'

def test_wrong_instrument_and_duplicate_packet_ignored():
    a=FiveMinuteTickAggregator(TOK)
    assert not a.ingest(tick(D,23000,200,TOK+1),D)
    assert a.received_count==0
    a.ingest(tick(D,23000,200),D)
    a.ingest(tick(D,23000,200),D)
    assert a.received_count==2
    assert a.diagnostic()['last_exchange_tick_at'] is not None

def test_session_gate_and_bad_values():
    a=FiveMinuteTickAggregator(TOK)
    assert not a.ingest(tick(D-timedelta(hours=1)),D-timedelta(hours=1))
    assert not a.ingest(tick(D,float('nan')),D)
    assert a.rejected_count==2

class FakeTicker:
    MODE_FULL='full'
    def __init__(self,key,token): self.connected=False;self.tokens=[];self.mode=None;self.closed=False
    def subscribe(self, tokens):self.tokens=tokens
    def set_mode(self,mode,tokens):self.mode=mode
    def connect(self,threaded=False):self.connected=threaded;self.on_connect(self,{})
    def close(self):self.closed=True

def test_readonly_transport_subscribes_full_mode_only_and_clears_on_disconnect():
    events=[];bars=[]
    w=KiteTickerShadow('DUMMY_KEY','DUMMY_TOKEN',TOK,bars.append,events.append,ticker_factory=FakeTicker)
    w.connect()
    assert w._ticker.connected and w._ticker.tokens==[TOK] and w._ticker.mode=='full'
    assert events[-1]['status']=='WAIT_REST_RECONCILIATION'
    w.stop()
    assert w._ticker.closed
    assert w.aggregator.diagnostic()['status']=='DISCONNECTED_REQUIRES_RECONCILIATION'
