"""Secure cloud-token vault must fail closed without leaking temporary files.

Tests exercise only synthetic tokens in pytest's temporary directory.
Do not bypass production POSIX permission checks for the sake of Windows.
"""
from datetime import datetime
from zoneinfo import ZoneInfo
import os

import pytest
from cryptography.fernet import Fernet
from cloud_alerts import security
from cloud_alerts.security import TokenVault

NOW=datetime(2026,10,21,10,0,tzinfo=ZoneInfo('Asia/Kolkata'))
TOKEN='SYNTHETIC_ACCESS_TOKEN_NEVER_VALID_1234'


@pytest.fixture
def vault(tmp_path):
    return TokenVault(tmp_path/'token.enc', Fernet.generate_key().decode())


def _raise(exc):
    def callback(*_args,**_kwargs):
        raise exc
    return callback


def _assert_no_published_or_temp_token(vault):
    assert not vault.file_path.exists()
    assert not list(vault.file_path.parent.glob('.token-*.tmp'))
    assert vault.get(NOW) is None


def test_permission_failure_closes_temp_fd_before_unlink(vault,monkeypatch):
    monkeypatch.setattr(security.os,'fchmod',
                        _raise(PermissionError('permission hardening refused')),
                        raising=False)
    with pytest.raises(PermissionError,match='permission hardening refused'):
        vault.put(TOKEN,NOW)
    _assert_no_published_or_temp_token(vault)


def test_write_sync_failure_does_not_publish_vault(vault,monkeypatch):
    # Exercise a synthetic filesystem error even on non-POSIX QA machines,
    # without changing what production code requires for a real save.
    monkeypatch.setattr(security.os,'fchmod',lambda _fd,_mode:None,raising=False)
    monkeypatch.setattr(security.os,'fsync',_raise(OSError('synthetic sync fault')))
    with pytest.raises(OSError,match='synthetic sync fault'):
        vault.put(TOKEN,NOW)
    _assert_no_published_or_temp_token(vault)


def test_atomic_replace_failure_discards_temporary_vault(vault,monkeypatch):
    monkeypatch.setattr(security.os,'fchmod',lambda _fd,_mode:None,raising=False)
    monkeypatch.setattr(security.os,'replace',_raise(PermissionError('synthetic replace refusal')))
    with pytest.raises(PermissionError,match='synthetic replace refusal'):
        vault.put(TOKEN,NOW)
    _assert_no_published_or_temp_token(vault)


@pytest.mark.skipif(hasattr(os,'fchmod'),reason='POSIX runtime has secure fchmod')
def test_windows_without_posix_permission_api_still_fails_closed(vault):
    with pytest.raises(AttributeError,match='fchmod'):
        vault.put(TOKEN,NOW)
    _assert_no_published_or_temp_token(vault)
