"""Operator safety: bounded token ingress and read-only readiness status."""
from __future__ import annotations
from datetime import datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo
import json
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from cloud_alerts.security import signature
from cloud_alerts.server import build_app
IST=ZoneInfo('Asia/Kolkata')
KEY='r'*64

def client(tmp_path,enabled=False):
    cfg=SimpleNamespace(api_key='TEST_KEY',bot_token='TESTBOT',chat_id='123',
        relay_key=KEY,vault_key=Fernet.generate_key().decode(),root=tmp_path,
        enabled=enabled,validate=lambda:None)
    return TestClient(build_app(cfg))

def headers(body,nonce='y'*40):
    ts=str(int(datetime.now(IST).timestamp()))
    return {'X-Relay-Timestamp':ts,'X-Relay-Nonce':nonce,
        'X-Relay-Signature':signature(KEY,ts,nonce,body),'Content-Type':'application/json'}

def test_readiness_does_not_expose_secrets_or_trigger_alerts(tmp_path):
    with client(tmp_path) as c:
        assert c.get('/healthz').status_code==200
        res=c.get('/readyz')
        assert res.status_code==503
        assert res.json()=={'ready':False,'mode':'READ_ONLY_PAPER'}


def test_readiness_after_successful_token_handoff_only_if_enabled(tmp_path):
    body=json.dumps({'api_key':'TEST_KEY','access_token':'Q'*48}).encode()
    with client(tmp_path,enabled=False) as c:
        assert c.post('/internal/token',headers=headers(body),content=body).status_code==200
        assert c.get('/readyz').status_code==503
    # Fresh config, same path, different Fernet key on purpose: token can't load.
    with client(tmp_path,enabled=True) as c:
        assert c.get('/readyz').status_code==503
        assert c.post('/internal/token',headers=headers(body,nonce='z'*40),content=body).status_code==200
        assert c.get('/readyz').status_code==200


def test_big_body_rejected_without_consuming_nonce(tmp_path):
    body=json.dumps({'api_key':'TEST_KEY','access_token':'Q'*2049}).encode()
    with client(tmp_path) as c:
        assert c.post('/internal/token',headers=headers(body),content=body).status_code==413
        valid=json.dumps({'api_key':'TEST_KEY','access_token':'Q'*48}).encode()
        assert c.post('/internal/token',headers=headers(valid),content=valid).status_code==200


def test_unauthorized_and_non_json_rejected(tmp_path):
    body=b'{}'
    with client(tmp_path) as c:
        assert c.post('/internal/token',headers={'Content-Type':'text/plain'},content=body).status_code==415
        assert c.post('/internal/token',headers={'Content-Type':'application/json'},content=body).status_code==401


def test_health_fails_closed_when_engine_task_is_dead(tmp_path):
    app=client(tmp_path).app
    with TestClient(app) as c:
        assert c.get('/healthz').json()['worker_running'] is True
        running=app.state.worker_task
        app.state.worker_task=SimpleNamespace(done=lambda:True)
        response=c.get('/healthz')
        assert response.status_code==503
        assert response.json()['worker_running'] is False
        app.state.worker_task=running
        assert c.get('/healthz').status_code==200


def test_two_running_web_instances_cannot_share_state_directory(tmp_path):
    first=client(tmp_path)
    second=client(tmp_path)
    with first as a:
        assert a.get('/healthz').status_code==200
        with __import__('pytest').raises(RuntimeError,match='already active'):
            with second:
                pass
        assert a.get('/healthz').status_code==200
    with client(tmp_path) as c:
        assert c.get('/healthz').status_code==200
