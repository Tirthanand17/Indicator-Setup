"""Offline security tests; all credentials in this file are made-up shapes."""
import json
import pytest
from cryptography.fernet import Fernet
from cloud_alerts.config_guard import configuration_blockers
from cloud_alerts.server import AppSettings
from cloud_alerts.preflight import check_deployment

GOOD = {
    'KITE_API_KEY': 'A1B2C3D4E5F6G7H8',
    'TELEGRAM_BOT_TOKEN': '123456789:' + 'A' * 36,
    'TELEGRAM_CHAT_ID': '123456789',
    'TOKEN_RELAY_HMAC_KEY': ('0123456789abcdef' * 4),
    'TOKEN_VAULT_KEY': Fernet.generate_key().decode(),
    'ALERTS_ENABLED': 'true',
}


def test_valid_synthetic_active_configuration():
    assert configuration_blockers(GOOD) == ()


@pytest.mark.parametrize('field,value,code', [
    ('KITE_API_KEY', 'REPLACE_WITH_YOUR_KITE_API_KEY', 'PLACEHOLDER_KITE_API_KEY'),
    ('TELEGRAM_BOT_TOKEN', 'REPLACE_WITH_BOT_TOKEN', 'PLACEHOLDER_TELEGRAM_BOT_TOKEN'),
    ('TELEGRAM_CHAT_ID', 'YOUR_CHAT_ID', 'PLACEHOLDER_TELEGRAM_CHAT_ID'),
    ('KITE_API_KEY', 'wrong*key', 'INVALID_ACTIVE_KITE_API_KEY_FORMAT'),
    ('TELEGRAM_BOT_TOKEN', 'fake-id', 'INVALID_ACTIVE_TELEGRAM_BOT_TOKEN_FORMAT'),
    ('TELEGRAM_CHAT_ID', 'not-a-private-chat', 'INVALID_ACTIVE_TELEGRAM_CHAT_ID_FORMAT'),
    ('TOKEN_RELAY_HMAC_KEY', 'q' * 50, 'INVALID_ACTIVE_RELAY_KEY_ENTROPY'),
    ('ALERTS_ENABLED', 'YES', 'INVALID_BOOLEAN_ALERTS_ENABLED'),
])
def test_rejects_active_secrets_without_echo(field,value,code):
    config={**GOOD,field:value}
    problems=configuration_blockers(config)
    assert code in problems
    assert value not in json.dumps(problems)


def test_disabled_development_allows_fake_shapes_but_not_placeholders():
    config={**GOOD,'ALERTS_ENABLED':'false','KITE_API_KEY':'synthetic-test',
            'TELEGRAM_BOT_TOKEN':'fake-bot','TELEGRAM_CHAT_ID':'fake-chat',
            'TOKEN_RELAY_HMAC_KEY':'q'*40}
    assert not configuration_blockers(config)
    config['KITE_API_KEY']='REPLACE_WITH_YOUR_KITE_API_KEY'
    assert 'PLACEHOLDER_KITE_API_KEY' in configuration_blockers(config)


def test_direct_uvicorn_bootstrap_checks_config_without_reporting_secrets(monkeypatch):
    for name,value in GOOD.items():monkeypatch.setenv(name,value)
    monkeypatch.setenv('TELEGRAM_BOT_TOKEN','REPLACE_WITH_BOT_TOKEN')
    settings=AppSettings()
    with pytest.raises(RuntimeError) as err:
        settings.validate()
    assert 'REPLACE_WITH' not in str(err.value)
    assert 'Invalid cloud configuration' in str(err.value)
    monkeypatch.setenv('TELEGRAM_BOT_TOKEN',GOOD['TELEGRAM_BOT_TOKEN'])
    AppSettings().validate()


def test_private_volume_rejects_existing_world_readable_sqlite_files(tmp_path):
    tmp_path.chmod(0o700)
    db=tmp_path/'alerts.sqlite3'
    db.write_bytes(b'dummy')
    db.chmod(0o644)
    mount=f'3 2 8:1 / {tmp_path} rw - ext4 /dev/sda1 rw\n'
    config={**GOOD,'STATE_DIR':str(tmp_path)}
    result=check_deployment(config,mountinfo=mount,probe_write=False)
    assert not result.ready
    assert 'SENSITIVE_FILE_PERMISSIONS_TOO_OPEN_ALERTS_SQLITE3' in result.blockers
    db.chmod(0o600)
    assert check_deployment(config,mountinfo=mount,probe_write=False).ready


def test_sensitive_sqlite_wal_symlink_is_rejected(tmp_path):
    tmp_path.chmod(0o700)
    (tmp_path/'alerts.sqlite3-wal').symlink_to(tmp_path/'external')
    mount=f'3 2 8:1 / {tmp_path} rw - ext4 /dev/sda1 rw\n'
    result=check_deployment({**GOOD,'STATE_DIR':str(tmp_path)},mountinfo=mount,probe_write=False)
    assert 'SENSITIVE_FILE_SYMLINK_ALERTS_SQLITE3-WAL' in result.blockers


def test_preflight_report_does_not_disclose_private_configuration(tmp_path):
    tmp_path.chmod(0o700)
    config={**GOOD,'STATE_DIR':str(tmp_path),'KITE_API_KEY':'REPLACE_WITH_YOUR_KITE_API_KEY'}
    result=check_deployment(config,mountinfo='5 2 8:1 / / rw - overlay /dev/sda rw',probe_write=False)
    report=json.dumps(result.public_report())
    assert 'PLACEHOLDER_KITE_API_KEY' in report
    for name,value in config.items():
        if name not in ('ALERTS_ENABLED','STATE_DIR'):
            assert value not in report
