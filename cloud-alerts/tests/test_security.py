from datetime import datetime,timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
import json,pytest
from cryptography.fernet import Fernet
from cloud_alerts.security import signature,verify_relay,TokenVault,next_expiry
from cloud_alerts.state import State
from cloud_alerts.token_sender import read_env_values,push_once
IST=ZoneInfo('Asia/Kolkata')
KEY='a'*64
NOW=datetime(2026,10,19,9,1,tzinfo=IST)

def test_signed_token_handoff_rejects_tampering():
    raw=b'{"access_token":"not-a-real-token"}';ts=str(int(NOW.timestamp()));nonce='A'*40
    sig=signature(KEY,ts,nonce,raw)
    assert verify_relay(KEY,ts,nonce,sig,raw,NOW)
    assert not verify_relay(KEY,ts,nonce,sig,raw+b' ',NOW)
    assert not verify_relay(KEY,ts,nonce,sig,raw,NOW+timedelta(minutes=3))
    assert not verify_relay('a',ts,nonce,sig,raw,NOW)

def test_daily_expiry_at_next_six():
    assert next_expiry(datetime(2026,10,19,9,tzinfo=IST)).isoformat()=='2026-10-20T06:00:00+05:30'
    assert next_expiry(datetime(2026,10,19,5,tzinfo=IST)).isoformat()=='2026-10-19T06:00:00+05:30'

def test_token_vault_encrypted_on_persistent_disk(tmp_path):
    file=tmp_path/'token.enc';key=Fernet.generate_key().decode();v=TokenVault(file,key)
    token='TESTONLY_'+('X'*40)
    v.put(token,NOW)
    assert token.encode() not in file.read_bytes()
    recovered=TokenVault(file,key)
    assert recovered.load(NOW+timedelta(hours=1))
    assert recovered.get(NOW+timedelta(hours=2))==token
    assert recovered.get(NOW+timedelta(days=1)) is None
    assert not recovered.load(NOW+timedelta(days=1))

def test_corrupted_encrypted_vault_fails_closed(tmp_path):
    f=tmp_path/'token.enc';f.write_bytes(b'BROKEN')
    v=TokenVault(f,Fernet.generate_key().decode())
    assert not v.load(NOW)

def test_nonce_prevents_replay(tmp_path):
    s=State(str(tmp_path/'data.db'))
    assert s.claim_nonce('safe-nonce',int(NOW.timestamp()))
    assert not s.claim_nonce('safe-nonce',int(NOW.timestamp()))

def test_read_only_env_parser_keeps_original_untouched(tmp_path):
    p=tmp_path/'readonly.env';p.write_text('ZERODHA_KITE_API_KEY=TEST_KEY\nZERODHA_KITE_ACCESS_TOKEN="DUMMY_LONG_TOKEN_XYZ123456789"\n# anything\n')
    before=p.read_bytes()
    d=read_env_values(p)
    assert d['ZERODHA_KITE_ACCESS_TOKEN']=='DUMMY_LONG_TOKEN_XYZ123456789'
    assert p.read_bytes()==before

def test_sender_rejects_insecure_url_without_network(tmp_path):
    p=tmp_path/'env';p.write_text('ZERODHA_KITE_API_KEY=test\nZERODHA_KITE_ACCESS_TOKEN=TESTONLY_HHHHHHHHHHHHHHHHHHHHH\n')
    with pytest.raises(ValueError,match='HTTPS'):
        push_once(p,'http://example.com/internal/token',KEY,'test')

def test_durable_outbox_claims_unique_events(tmp_path):
    s=State(str(tmp_path/'state.db'))
    assert s.claim_event('C1','REVIEW_CE',NOW,'not a real order')
    assert not s.claim_event('C1','REVIEW_CE',NOW,'duplicate')
    assert s.pending_events()==[('C1','not a real order')]
    s.mark_delivered('C1')
    assert s.pending_events()==[]
