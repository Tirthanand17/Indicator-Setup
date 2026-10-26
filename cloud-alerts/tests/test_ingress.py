import asyncio
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import subprocess
import pytest
from fastapi.testclient import TestClient
from fastapi import HTTPException
from cryptography.fernet import Fernet
from cloud_alerts.ingress import TokenAdmission
from cloud_alerts.server import build_app


def test_token_budget_counts_failures_and_keeps_live_leases_across_rollover(monkeypatch):
    clock = [100.0]
    monkeypatch.setattr('cloud_alerts.ingress.time.monotonic', lambda: clock[0])
    gate = TokenAdmission()
    for _ in range(4):
        assert gate.claim()
    clock[0] += 60
    assert not gate.claim()
    gate.release()
    assert gate.claim()
    for _ in range(4):
        gate.release()
    for _ in range(59):
        assert gate.claim()
        gate.release()
    assert not gate.claim()


def make_app(tmp_path):
    cfg = SimpleNamespace(api_key='TEST_KITE_KEY', bot_token='123456:AAAAA_TEST_BOT_TOKEN', chat_id='123456789',
        relay_key='a'*64, vault_key=Fernet.generate_key().decode(), root=tmp_path,
        enabled=False, validate=lambda: None)
    return build_app(cfg)


def test_invalid_requests_exhaust_admission_without_writing_a_token(tmp_path):
    app = make_app(tmp_path)
    with TestClient(app) as client:
        for _ in range(60):
            assert client.post('/internal/token', content=b'invalid').status_code == 415
        denied = client.post('/internal/token', content=b'invalid')
        assert denied.status_code == 429
        assert denied.headers['retry-after'] == '60'
        assert not (tmp_path/'token.enc').exists()


@pytest.mark.asyncio
async def test_stalled_asgi_body_rejects_without_mutating_token_or_nonce(tmp_path, monkeypatch):
    app = make_app(tmp_path)
    route = next(route for route in app.routes if getattr(route, 'path', '') == '/internal/token')
    async def stalled():
        await asyncio.sleep(10)
        yield b'never'
    request = SimpleNamespace(headers={'content-type':'application/json'}, stream=stalled)
    # Real timeout/cancellation with a short test deadline; do not wait three seconds.
    original = asyncio.timeout
    monkeypatch.setattr('cloud_alerts.server.asyncio.timeout', lambda _: original(0.02))
    with pytest.raises(HTTPException) as rejected:
        await route.endpoint(request)
    assert rejected.value.status_code == 408
    assert not (tmp_path/'token.enc').exists()
    # A failed read must release its concurrency slot for subsequent requests.
    request = SimpleNamespace(headers={'content-type':'text/plain'})
    for _ in range(6):
        with pytest.raises(HTTPException) as invalid:
            await route.endpoint(request)
        assert invalid.value.status_code == 415


def test_secret_scanner_never_emits_values(tmp_path):
    scanner = Path(__file__).resolve().parents[2] / 'scripts' / 'scan-git-history.py'
    spec = importlib.util.spec_from_file_location('history_scanner', scanner)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    # Public, deliberately predictable noncredentials; findings are still retained.
    token = b'ghp_' + b'A'*36
    result = module.scan_blob(token + b'\n-----BEGIN PRIVATE KEY-----')
    assert result == {'GITHUB_TOKEN':1, 'PRIVATE_KEY_BLOCK':1}
    assert token.decode() not in json.dumps(result)

    # A removed secret-shaped fixture must still be found in reachable history.
    repo = tmp_path/'history'
    repo.mkdir()
    def git(*args):
        subprocess.run(['git', *args], cwd=repo, check=True, capture_output=True)
    git('init', '-q')
    sample = repo/'sample.txt'
    sample.write_bytes(token)
    git('add', 'sample.txt')
    git('-c', 'user.name=Synthetic Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'synthetic fixture')
    sample.write_text('removed fixture')
    git('add', 'sample.txt')
    git('-c', 'user.name=Synthetic Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'remove fixture')
    report = module.scan_history(repo)
    assert report['reachable_commits'] == 2
    assert report['unique_blobs_scanned'] == 2
    assert len(report['findings']) == 1
    assert report['findings'][0]['rule'] == 'GITHUB_TOKEN'
    assert token.decode() not in json.dumps(report)
