"""Synthetic ordering and expiry regression tests for authenticated daily handoff."""
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
import json
import pytest

from cloud_alerts.security import TokenVault, TokenRollbackError, signature
from cloud_alerts.server import build_app

IST=ZoneInfo('Asia/Kolkata')
HMAC='M'*64
TOKEN1='FAKE_RELAY_TOKEN_ONE_' + 'A'*24
TOKEN2='FAKE_RELAY_TOKEN_TWO_' + 'B'*24


def test_vault_rejects_signed_token_rollback_and_equal_timestamp_conflict(tmp_path):
    now=datetime(2026,10,20,9,20,tzinfo=IST)
    t=int(now.timestamp())
    key=Fernet.generate_key().decode()
    p=tmp_path/'token.enc'
    vault=TokenVault(p,key)
    vault.put(TOKEN1,now,relay_at=t)
    vault.put(TOKEN2,now+timedelta(seconds=1),relay_at=t+1)
    ciphertext=p.read_bytes()
    with pytest.raises(TokenRollbackError):vault.put(TOKEN1,now+timedelta(seconds=2),relay_at=t)
    with pytest.raises(TokenRollbackError):vault.put(TOKEN1,now+timedelta(seconds=2),relay_at=t+1)
    assert p.read_bytes()==ciphertext
    assert vault.get(now+timedelta(minutes=1))==TOKEN2
    assert TokenVault(p,key).load(now+timedelta(minutes=1))
    restarted=TokenVault(p,key)
    assert restarted.load(now+timedelta(minutes=1))
    with pytest.raises(TokenRollbackError):restarted.put(TOKEN1,now+timedelta(seconds=3),relay_at=t)
    restarted.put(TOKEN2,now+timedelta(seconds=3),relay_at=t+1)
    assert p.read_bytes()==ciphertext  # identical-token retransmission no rewrite


def test_vault_rejects_signed_payload_crossing_six_am_expiry(tmp_path):
    key=Fernet.generate_key().decode()
    p=tmp_path/'token.enc'
    vault=TokenVault(p,key)
    before=datetime(2026,10,20,5,59,59,tzinfo=IST)
    after=before+timedelta(seconds=2)
    with pytest.raises(TokenRollbackError):
        vault.put(TOKEN1,after,relay_at=int(before.timestamp()))
    assert not p.exists()
    vault.put(TOKEN2,after,relay_at=int(after.timestamp()))
    assert vault.get(after)==TOKEN2


def test_new_session_rollover_resets_monotonic_timestamp(tmp_path):
    key=Fernet.generate_key().decode()
    p=tmp_path/'token.enc'
    vault=TokenVault(p,key)
    yesterday=datetime(2026,10,19,14,30,tzinfo=IST)
    today=datetime(2026,10,20,9,20,tzinfo=IST)
    vault.put(TOKEN1,yesterday,relay_at=int(yesterday.timestamp()))
    # Yesterday's encrypted file must not block the new brokerage session.
    restarted=TokenVault(p,key)
    assert not restarted.load(today)
    restarted.put(TOKEN2,today,relay_at=int(today.timestamp()))
    assert restarted.get(today)==TOKEN2


def test_existing_encrypted_vault_without_relay_metadata_is_upgradable(tmp_path):
    key=Fernet.generate_key().decode();now=datetime(2026,10,20,9,20,tzinfo=IST)
    path=tmp_path/'token.enc'
    from cloud_alerts.security import next_expiry
    legacy={'access_token':TOKEN1,'expires':next_expiry(now).isoformat()}
    path.write_bytes(Fernet(key.encode()).encrypt(json.dumps(legacy).encode()))
    vault=TokenVault(path,key)
    assert vault.load(now) and vault.get(now)==TOKEN1
    vault.put(TOKEN2,now,relay_at=int(now.timestamp()))
    assert TokenVault(path,key).load(now)


def test_bad_encrypted_relay_metadata_fails_closed(tmp_path):
    key=Fernet.generate_key().decode();now=datetime(2026,10,20,9,20,tzinfo=IST)
    from cloud_alerts.security import next_expiry
    path=tmp_path/'token.enc'
    raw={'access_token':TOKEN1,'expires':next_expiry(now).isoformat(),'relay_at':'bad'}
    path.write_bytes(Fernet(key.encode()).encrypt(json.dumps(raw).encode()))
    assert not TokenVault(path,key).load(now)


def _client(tmp_path):
    cfg=SimpleNamespace(api_key='FAKE_API_TEST',bot_token='123456:'+'A'*35,chat_id='12345678',
        relay_key=HMAC,vault_key=Fernet.generate_key().decode(),root=tmp_path,
        enabled=False,validate=lambda:None)
    return TestClient(build_app(cfg))


def _post(c,token,nonce,issued_at):
    body=json.dumps({'api_key':'FAKE_API_TEST','access_token':token}).encode()
    ts=str(issued_at)
    hdr={'Content-Type':'application/json','X-Relay-Nonce':nonce,
         'X-Relay-Timestamp':ts,'X-Relay-Signature':signature(HMAC,ts,nonce,body)}
    return c.post('/internal/token',content=body,headers=hdr)


def test_http_rejects_older_authenticated_handoff_without_leaking_token(tmp_path):
    now=datetime.now(IST);stamp=int(now.timestamp())
    with _client(tmp_path) as c:
        # Newer signed handoff accepted first; distinct nonce for stale request.
        newer=_post(c,TOKEN2,'B'*40,stamp)
        assert newer.status_code==200
        stale=_post(c,TOKEN1,'C'*40,stamp-1)
        assert stale.status_code==409
        assert TOKEN1 not in stale.text and TOKEN2 not in stale.text
        assert c.app.state.engine.vault.get(now)==TOKEN2
        # A second token with the exact same signed second is ambiguous.
        ambiguity=_post(c,TOKEN1,'D'*40,stamp)
        assert ambiguity.status_code==409


def test_http_equal_signed_second_retransmission_is_idempotent(tmp_path):
    now=datetime.now(IST);stamp=int(now.timestamp())
    with _client(tmp_path) as c:
        assert _post(c,TOKEN1,'E'*40,stamp).status_code==200
        original=(tmp_path/'token.enc').read_bytes()
        assert _post(c,TOKEN1,'F'*40,stamp).status_code==200
        assert (tmp_path/'token.enc').read_bytes()==original
