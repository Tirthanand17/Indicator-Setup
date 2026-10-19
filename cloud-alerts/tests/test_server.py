from datetime import datetime,timedelta
from pathlib import Path
from types import SimpleNamespace
from zoneinfo import ZoneInfo
import json
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from cloud_alerts.security import signature
from cloud_alerts.server import build_app
IST=ZoneInfo('Asia/Kolkata')
KEY='a'*64
TOKEN='DUMMYTESTTOKEN1234567890abcdefghij'

def client(tmp_path):
    cfg=SimpleNamespace(api_key='TEST_KITE_KEY',bot_token='123456:AAAAA_TEST_BOT_TOKEN',chat_id='123456789',
      relay_key=KEY,vault_key=Fernet.generate_key().decode(),root=tmp_path,enabled=False,validate=lambda:None)
    return TestClient(build_app(cfg))

def headers(body:bytes,nonce='b'*40,age=0):
    moment=datetime.now(IST)-timedelta(seconds=age)
    ts=str(int(moment.timestamp()))
    return {'X-Relay-Timestamp':ts,'X-Relay-Nonce':nonce,'X-Relay-Signature':signature(KEY,ts,nonce,body),'Content-Type':'application/json'}

def test_health_never_displays_secrets(tmp_path):
    with client(tmp_path) as c:
        r=c.get('/healthz')
        assert r.status_code==200
        d=r.json();assert d['order_execution'] is False and d['status']=='DISABLED'
        assert TOKEN not in r.text and KEY not in r.text
        assert d['mode']=='READ_ONLY_PAPER'

def test_token_handoff_auth_encrypted_and_replay_blocked(tmp_path):
    body=json.dumps({'api_key':'TEST_KITE_KEY','access_token':TOKEN},separators=(',',':')).encode()
    with client(tmp_path) as c:
        h=headers(body)
        r=c.post('/internal/token',content=body,headers=h)
        assert r.status_code==200 and r.json()['status']=='TOKEN_ACCEPTED'
        assert TOKEN.encode() not in (tmp_path/'token.enc').read_bytes()
        assert c.post('/internal/token',content=body,headers=h).status_code==409
        assert c.post('/internal/token',content=body+b' ',headers=headers(body,nonce='c'*40)).status_code==401
        assert c.post('/internal/token',content=body,headers=headers(body,nonce='d'*40,age=240)).status_code==401

def test_token_wrong_api_key_and_raw_body_rejected(tmp_path):
    bad=json.dumps({'api_key':'NOT_MY_API_KEY','access_token':TOKEN}).encode()
    with client(tmp_path) as c:
        res=c.post('/internal/token',content=bad,headers=headers(bad,nonce='e'*40))
        assert res.status_code==422
        assert not (tmp_path/'token.enc').exists()
