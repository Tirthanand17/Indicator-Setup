"""No live endpoints: signed local sender -> ASGI cloud -> encrypted state."""
from __future__ import annotations
from datetime import datetime,timedelta
from pathlib import Path
from types import SimpleNamespace
from zoneinfo import ZoneInfo
import hashlib,json
from unittest.mock import patch
import pytest
import requests
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from cloud_alerts.server import build_app
from cloud_alerts.token_sender import read_env_values,push_once,run,validate_endpoint
IST=ZoneInfo('Asia/Kolkata')
HMAC='r'*64
API='FAKE_RESEARCH_ONLY_KEY'
TOKEN='DUMMY_NO_REAL_AUTH_TOKEN_1234567890'
ENDPOINT='https://approved.example/internal/token'


def _intercept_direct_https(monkeypatch, callback):
    """Replace just the network sender; assert the real method cannot inherit proxies."""
    class FakeSession:
        def __init__(self):
            self.trust_env = True
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False
        def post(self, *args, verify=None, **kwargs):
            assert self.trust_env is False
            assert verify is True
            return callback(*args, **kwargs)
    monkeypatch.setattr('cloud_alerts.token_sender.requests.Session', FakeSession)


def fake_env(path:Path)->bytes:
    data=(f'AEGIS_PRIVATE_PASSWORD=IGNORE_SECRET\nZERODHA_KITE_API_KEY={API}\n'
          f'ZERODHA_KITE_API_SECRET=ALSO_IGNORE\nZERODHA_KITE_ACCESS_TOKEN="{TOKEN}"\n')
    path.write_text(data)
    return path.read_bytes()


def settings(path):
    return SimpleNamespace(api_key=API,bot_token='FAKE_BOT',chat_id='FAKE_CHAT',
      relay_key=HMAC,vault_key=Fernet.generate_key().decode(),root=path,
      enabled=False,validate=lambda:None)


def test_only_allowlisted_names_loaded_from_protected_env(tmp_path):
    source=tmp_path/'protected.env';original=fake_env(source)
    values=read_env_values(source)
    assert set(values)=={'ZERODHA_KITE_API_KEY','ZERODHA_KITE_ACCESS_TOKEN'}
    assert 'SECRET' not in repr(values)
    assert source.read_bytes()==original


def test_unsigned_or_insecure_endpoint_rejected():
    for url in ('http://x/internal/token','https://u:p@x/internal/token',
                'https://x/internal/token?q=1','https://x/other',
                'https://x/internal/token#fragment','https://x:abc/internal/token',
                'https://x:65536/internal/token'):
        with pytest.raises(ValueError):validate_endpoint(url)
    validate_endpoint(ENDPOINT)


def test_sender_to_real_asgi_handler_and_encrypted_vault(tmp_path,monkeypatch):
    source=tmp_path/'protected.env';original=fake_env(source)
    cloud_path=tmp_path/'cloud';cloud_path.mkdir()
    config=settings(cloud_path)
    captured=[]
    with TestClient(build_app(config)) as client:
        def post(url,*,data,headers,timeout,allow_redirects):
            assert url==ENDPOINT and timeout==10 and allow_redirects is False
            r=client.post('/internal/token',content=data,headers=headers)
            captured.append((data,headers,r.status_code))
            return SimpleNamespace(status_code=r.status_code,json=lambda:r.json())
        _intercept_direct_https(monkeypatch,post)
        fingerprint=push_once(source,ENDPOINT,HMAC,API)
        assert fingerprint==hashlib.sha256(TOKEN.encode()).hexdigest()[:12]
        assert len(captured)==1 and captured[0][2]==200
        assert TOKEN.encode() not in (cloud_path/'token.enc').read_bytes()
        assert source.read_bytes()==original
        assert client.app.state.engine.vault.get(datetime.now(IST))==TOKEN
        # A repeated signed request with the exact same nonce fails.
        data,headers,_=captured[0]
        assert client.post('/internal/token',content=data,headers=headers).status_code==409
        assert client.post('/internal/token',content=data+b' ',headers=headers).status_code==401
        # Token stored does not mean a live market worker or phone delivery.
        assert client.get('/readyz').status_code==503


def test_failed_one_shot_push_returns_nonzero_and_hides_token(tmp_path,monkeypatch,capsys):
    source=tmp_path/'protected.env';original=fake_env(source)
    monkeypatch.setenv('KITE_API_KEY',API)
    monkeypatch.setenv('KITE_ALERT_TOKEN_ENDPOINT',ENDPOINT)
    monkeypatch.setenv('TOKEN_RELAY_HMAC_KEY',HMAC)
    def fail(*a,**kw):raise requests.Timeout('potential response secret')
    _intercept_direct_https(monkeypatch,fail)
    code=run(['--env-file',str(source),'--push'])
    out=capsys.readouterr()
    assert code!=0 and 'NOT CONFIRMED' in out.err
    assert TOKEN not in (out.out+out.err)
    assert 'potential response secret' not in (out.out+out.err)
    assert source.read_bytes()==original


def test_one_shot_success_reports_only_generic_confirmation(tmp_path,monkeypatch,capsys):
    source=tmp_path/'protected.env';fake_env(source)
    for key,value in [('KITE_API_KEY',API),('KITE_ALERT_TOKEN_ENDPOINT',ENDPOINT),('TOKEN_RELAY_HMAC_KEY',HMAC)]:
        monkeypatch.setenv(key,value)
    _intercept_direct_https(monkeypatch,
      lambda *a,**k:SimpleNamespace(status_code=200,json=lambda:{'status':'TOKEN_ACCEPTED'}))
    assert run(['--env-file',str(source),'--push'])==0
    out=capsys.readouterr()
    assert 'accepted by cloud' in out.out and TOKEN not in (out.out+out.err)


def test_check_only_fails_nonzero_without_writing_or_network(tmp_path,monkeypatch,capsys):
    p=tmp_path/'protected.env';p.write_text('ZERODHA_KITE_API_KEY=FAKE\n')
    before=p.read_bytes()
    monkeypatch.setattr('cloud_alerts.token_sender.requests.Session',lambda:pytest.fail('no network permitted'))
    assert run(['--env-file',str(p),'--check-only'])==2
    assert 'False' in capsys.readouterr().out
    assert p.read_bytes()==before


def test_watcher_retries_same_token_after_failed_transfer(tmp_path,monkeypatch,capsys):
    source=tmp_path/'protected.env';fake_env(source)
    for key,value in [('KITE_API_KEY',API),('KITE_ALERT_TOKEN_ENDPOINT',ENDPOINT),('TOKEN_RELAY_HMAC_KEY',HMAC)]:
        monkeypatch.setenv(key,value)
    attempts=[]
    def post(*a,**k):
        attempts.append('try')
        if len(attempts)==1:raise requests.Timeout('private')
        return SimpleNamespace(status_code=200,json=lambda:{'status':'TOKEN_ACCEPTED'})
    _intercept_direct_https(monkeypatch,post)
    calls=[]
    def stop_after_recovery(seconds):
        calls.append(seconds)
        if len(calls)>=2:raise KeyboardInterrupt
    monkeypatch.setattr('cloud_alerts.token_sender.time.sleep',stop_after_recovery)
    with pytest.raises(KeyboardInterrupt):run(['--env-file',str(source),'--watch'])
    captured=capsys.readouterr()
    assert len(attempts)==2 and calls==[45,45]
    assert TOKEN not in (captured.out+captured.err)
