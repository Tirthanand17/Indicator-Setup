"""Entry and virtual state are atomic, fail closed and survive process restart."""
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
import json
import pytest
from cloud_alerts.state import State
from cloud_alerts.engine import Engine
from cloud_alerts.security import TokenVault
from cryptography.fernet import Fernet

IST=ZoneInfo('Asia/Kolkata')
NOW=datetime(2026,10,19,12,0,12,tzinfo=IST)


def candidate(t=NOW):
    return json.dumps({'direction':'CE','symbol':'NIFTY26OCTFUT',
                       'signal_candle':t.isoformat(), 'expiry_date':t.date().isoformat(),
                       'entry':23000,'stop':22900,'target':23200})


def test_atomic_claim_is_idempotent_and_virtual_state_durable(tmp_path):
    path=str(tmp_path/'alert.sqlite')
    s=State(path)
    assert s.claim_entry_with_candidate('entry-c1','REVIEW_CE',NOW,'test paper only',candidate())
    assert s.event_delivery_status('entry-c1')==0
    restarted=State(path)
    assert json.loads(restarted.get_runtime('virtual_candidate'))['symbol']=='NIFTY26OCTFUT'
    assert restarted.pending_events()==[('entry-c1','test paper only')]
    assert not restarted.claim_entry_with_candidate('entry-c1','REVIEW_CE',NOW,'duplicate',candidate())
    assert not restarted.claim_entry_with_candidate('entry-c2','REVIEW_CE',NOW,'second entry',candidate())
    assert restarted.pending_events()==[('entry-c1','test paper only')]
    restarted.mark_delivered('entry-c1')
    assert restarted.event_delivery_status('entry-c1')==1


def test_malformed_previous_candidate_prevents_new_claim(tmp_path):
    s=State(str(tmp_path/'alert.sqlite'))
    s.set_runtime('virtual_candidate','{BAD')
    assert not s.claim_entry_with_candidate('e1','REVIEW_CE',NOW,'message',candidate())
    assert not s.pending_events()
    assert s.get_runtime('virtual_candidate')=='{BAD'


def test_invalid_claim_cannot_leave_partial_state(tmp_path):
    s=State(str(tmp_path/'alert.sqlite'))
    invalid=[candidate().replace('NIFTY26OCTFUT','BANKNIFTY26OCTFUT'),
             '{bad',json.dumps({'direction':'PE'}),
             candidate().replace('"direction": "CE"','"direction": "PE"')]
    for i,bad in enumerate(invalid):
        assert not s.claim_entry_with_candidate(f'e{i}','REVIEW_CE',NOW,'test',bad)
    assert not s.pending_events()
    assert s.get_runtime('virtual_candidate') is None


def test_new_day_can_replace_expired_virtual_candidate(tmp_path):
    s=State(str(tmp_path/'alert.sqlite'))
    assert s.claim_entry_with_candidate('day1','REVIEW_CE',NOW,'day1',candidate())
    next_day=NOW+timedelta(days=1)
    assert s.claim_entry_with_candidate('day2','REVIEW_CE',next_day,'day2',candidate(next_day))
    assert json.loads(s.get_runtime('virtual_candidate'))['expiry_date']==next_day.date().isoformat()


@pytest.mark.asyncio
async def test_queued_entry_survives_telegram_error_and_restart(tmp_path):
    class BrokenTelegram:
        def send(self,body):raise RuntimeError('Synthetic Telegram failure')
    class GoodTelegram:
        def __init__(self):self.sent=[]
        def send(self,body):self.sent.append(body)
    db_path=str(tmp_path/'outbox.db')
    db=State(db_path)
    db.claim_entry_with_candidate('c1','REVIEW_CE',NOW,'PAPER TEST ONLY',candidate())
    v=TokenVault(tmp_path/'token.enc',Fernet.generate_key().decode())
    failing=Engine('TEST_KEY',v,db,BrokenTelegram(),enabled=True)
    await failing._deliver_outbox(NOW)
    assert db.event_delivery_status('c1')==0
    assert db.get_runtime('virtual_candidate') is not None
    good=GoodTelegram()
    restarted=Engine('TEST_KEY',v,State(db_path),good,enabled=True)
    await restarted._deliver_outbox(NOW+timedelta(seconds=15))
    assert good.sent==['PAPER TEST ONLY']
    assert restarted.db.event_delivery_status('c1')==1


def test_expired_entry_remains_non_deliverable_after_restart(tmp_path):
    s=State(str(tmp_path/'outbox.db'))
    s.claim_entry_with_candidate('e','REVIEW_CE',NOW,'old paper',candidate())
    s.expire_events_before(NOW+timedelta(seconds=1))
    assert s.event_delivery_status('e')==2
    assert State(str(tmp_path/'outbox.db')).pending_events()==[]


def test_health_outbox_summary_never_exposes_payload(tmp_path):
    s=State(str(tmp_path/'db.sqlite'))
    s.claim_entry_with_candidate('e1','REVIEW_CE',NOW,'FAKE_SECRET_LIKE_TEXT',candidate())
    summary=s.outbox_summary()
    assert summary['queued']==1 and summary['accepted']==0
    assert 'FAKE_SECRET_LIKE_TEXT' not in str(summary)
    s.mark_delivered('e1')
    assert s.outbox_summary()['accepted']==1
