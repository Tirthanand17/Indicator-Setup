from pathlib import Path
import json
import os

from cryptography.fernet import Fernet
from cloud_alerts.preflight import check_deployment, persistent_mount, main


def env_for(path: Path) -> dict:
    return {
        'KITE_API_KEY': 'example-not-real',
        'TELEGRAM_BOT_TOKEN': 'fake-synthetic-token',
        'TELEGRAM_CHAT_ID': 'synthetic-id',
        'TOKEN_RELAY_HMAC_KEY': 'q'*40,
        'TOKEN_VAULT_KEY': Fernet.generate_key().decode(),
        'STATE_DIR': str(path),
        'ALERTS_ENABLED': 'false',
    }


def mount_for(path: Path, fstype: str = 'ext4') -> str:
    return f'88 10 8:1 / {path} rw,relatime - {fstype} /dev/sda1 rw\n'


def test_accepts_private_durable_volume_and_cleans_probe(tmp_path):
    tmp_path.chmod(0o700)
    result = check_deployment(env_for(tmp_path), mountinfo=mount_for(tmp_path))
    assert result.ready is True
    assert 'WRITE_FSYNC_CLEANUP' in result.checks
    assert not list(tmp_path.glob('.nifty-preflight-*'))
    report = json.dumps(result.public_report())
    assert 'q'*40 not in report
    assert 'fake-synthetic-token' not in report


def test_rejects_overlay_or_root_only_and_tmpfs(tmp_path):
    for mount in (mount_for(tmp_path,'overlay'), mount_for(tmp_path,'tmpfs'),
                  '10 1 8:1 / / rw - ext4 /dev/root rw'):
        result = check_deployment(env_for(tmp_path), mountinfo=mount)
        assert result.ready is False
        assert 'PERSISTENT_NON_EPHEMERAL_MOUNT_NOT_VERIFIED' in result.blockers


def test_rejects_missing_and_invalid_secret_formats(tmp_path):
    e=env_for(tmp_path)
    e.pop('TELEGRAM_BOT_TOKEN')
    e['TOKEN_VAULT_KEY']='plain-incorrect'
    e['ALERTS_ENABLED']='sometimes'
    r=check_deployment(e,mountinfo=mount_for(tmp_path),probe_write=False)
    assert {'MISSING_TELEGRAM_BOT_TOKEN','INVALID_TOKEN_VAULT_KEY','INVALID_BOOLEAN_ALERTS_ENABLED'} <= set(r.blockers)
    assert 'plain-incorrect' not in json.dumps(r.public_report())


def test_rejects_unprivate_state_dir(tmp_path):
    tmp_path.chmod(0o755)
    r=check_deployment(env_for(tmp_path),mountinfo=mount_for(tmp_path))
    assert 'STATE_DIR_PERMISSIONS_TOO_OPEN' in r.blockers


def test_rejects_symlinked_sensitive_credentials(tmp_path):
    tmp_path.chmod(0o700)
    (tmp_path/'token.enc').symlink_to(tmp_path/'outside.enc')
    r=check_deployment(env_for(tmp_path),mountinfo=mount_for(tmp_path))
    assert 'SENSITIVE_FILE_SYMLINK_TOKEN_ENC' in r.blockers


def test_rejects_unmounted_missing_and_low_storage(tmp_path):
    missing=tmp_path/'does-not-exist'
    r=check_deployment(env_for(missing),mountinfo=mount_for(missing))
    assert 'STATE_DIR_NOT_EXISTING_DIRECTORY' in r.blockers
    tmp_path.chmod(0o700)
    r=check_deployment(env_for(tmp_path),mountinfo=mount_for(tmp_path),min_free_bytes=10**30)
    assert 'INSUFFICIENT_PERSISTENT_STORAGE' in r.blockers


def test_mount_selection_longest_prefix(tmp_path):
    assert persistent_mount(tmp_path, mount_for(tmp_path,'ext4'))
    assert not persistent_mount(tmp_path, '1 2 3:4 / / rw - ext4 /dev/root rw')
    assert not persistent_mount(tmp_path, mount_for(tmp_path,'squashfs'))


def test_cli_fail_closed_without_host_config(monkeypatch,capsys):
    for key in env_for(Path('/nonexistent/test-preflight')):
        monkeypatch.delenv(key,raising=False)
    assert main(['--json'])==2
    output=capsys.readouterr().out
    parsed=json.loads(output)
    assert parsed['preflight']=='BLOCKED'
    assert parsed['broker_orders_enabled'] is False
