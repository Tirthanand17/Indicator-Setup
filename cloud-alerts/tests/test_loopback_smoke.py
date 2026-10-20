"""Safe loopback process-boundary checks without real cloud/broker/Telegram traffic."""
from __future__ import annotations

import json
import os

import pytest

from cloud_alerts import loopback_smoke as smoke
from cloud_alerts.token_sender import validate_endpoint


def test_real_http_handoff_replay_and_restart_pass():
    report = smoke.run_smoke(timeout=10)
    assert report['result'] == 'PASS'
    assert report['mode'] == 'SYNTHETIC_LOCALHOST_HTTP_ONLY'
    assert 'PERSISTED_NONCE_REPLAY_REJECTION' in report['checks']
    assert 'PRIVATE_STATE_FILE_PERMISSIONS' in report['checks']
    assert not report['cloud_deployment_validated']
    assert not report['tls_validated']
    assert not report['telegram_message_sent']
    assert not report['real_credentials_used']
    assert not report['real_market_data_used']
    assert not report['live_orders_placed']


def test_smoke_does_not_inherit_real_credentials(monkeypatch):
    monkeypatch.setenv('KITE_API_KEY', 'PRIVATE_EXAMPLE_NEVER_FORWARD')
    monkeypatch.setenv('TELEGRAM_BOT_TOKEN', 'PRIVATE_TELEGRAM_NEVER_FORWARD')
    monkeypatch.setenv('KITE_ALERT_TOKEN_ENDPOINT', 'https://example.invalid/internal/token')
    original = smoke._server
    captured = []

    def guarded_server(state_dir, env, port, **kwargs):
        captured.append(dict(env))
        assert env['ALERTS_ENABLED'] == 'false'
        assert env['KITE_SHADOW_ENABLED'] == 'false'
        assert env['PAPER_PREMIUM_TRACKING_ENABLED'] == 'false'
        assert env['KITE_API_KEY'] != 'PRIVATE_EXAMPLE_NEVER_FORWARD'
        assert env['TELEGRAM_BOT_TOKEN'] != 'PRIVATE_TELEGRAM_NEVER_FORWARD'
        assert 'KITE_ALERT_TOKEN_ENDPOINT' not in env
        assert set(env) <= {
            'PATH','PYTHONDONTWRITEBYTECODE','ALERTS_ENABLED','KITE_SHADOW_ENABLED',
            'PAPER_PREMIUM_TRACKING_ENABLED','KITE_API_KEY','TELEGRAM_BOT_TOKEN',
            'TELEGRAM_CHAT_ID','TOKEN_RELAY_HMAC_KEY','TOKEN_VAULT_KEY','STATE_DIR'}
        return original(state_dir, env, port, **kwargs)

    monkeypatch.setattr(smoke, '_server', guarded_server)
    assert smoke.run_smoke()['result'] == 'PASS'
    assert len(captured) == 2


def test_production_token_sender_refuses_loopback_http():
    with pytest.raises(ValueError):
        validate_endpoint('http://127.0.0.1:8888/internal/token')


def test_cli_json_has_no_sensitive_details(capsys):
    assert smoke.main(['--json']) == 0
    output = capsys.readouterr().out
    report = json.loads(output)
    assert report['result'] == 'PASS'
    assert 'TOP_SECRET' not in output
    assert 'access_token' not in output
    assert 'bot_token' not in output
    assert 'relay_key' not in output


def test_cli_failure_redacts_underlying_error(monkeypatch, capsys):
    def fail(**kwargs):
        raise RuntimeError('TOP_SECRET_CREDENTIAL_MUST_NOT_PRINT')
    monkeypatch.setattr(smoke, 'run_smoke', fail)
    assert smoke.main(['--json']) == 2
    captured = capsys.readouterr()
    assert 'TOP_SECRET_CREDENTIAL_MUST_NOT_PRINT' not in captured.out + captured.err
    assert 'FAIL' in captured.err


def test_request_uses_loopback_and_no_proxy(monkeypatch):
    monkeypatch.setenv('HTTP_PROXY', 'http://127.0.0.1:9')
    monkeypatch.setenv('HTTPS_PROXY', 'http://127.0.0.1:9')
    assert smoke.run_smoke()['result'] == 'PASS'
