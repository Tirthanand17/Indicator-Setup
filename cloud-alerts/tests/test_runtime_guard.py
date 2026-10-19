"""Cloud singleton and private-lock safety checks (Linux host)."""
from __future__ import annotations
import os
from pathlib import Path
import stat
import pytest
from cloud_alerts.runtime_guard import single_worker
pytestmark=pytest.mark.skipif(os.name!='posix',reason='production host is Linux')


def test_exclusive_worker_lock_and_release(tmp_path):
    root=tmp_path/'durable'
    with single_worker(root):
        assert stat.S_IMODE((root/'.single-worker.lock').stat().st_mode)==0o600
        with pytest.raises(RuntimeError,match='already active'):
            with single_worker(root):
                pass
    with single_worker(root):
        pass


def test_worker_lock_released_even_on_error(tmp_path):
    root=tmp_path/'durable'
    with pytest.raises(ArithmeticError):
        with single_worker(root):
            raise ArithmeticError()
    with single_worker(root):
        pass


def test_worker_rejects_symlinked_state_root(tmp_path):
    root=tmp_path/'actual'
    root.mkdir()
    (tmp_path/'alias').symlink_to(root, target_is_directory=True)
    with pytest.raises(RuntimeError,match='symbolic link'):
        with single_worker(tmp_path/'alias'):
            pass


def test_worker_rejects_symlinked_lock(tmp_path):
    root=tmp_path/'state'
    root.mkdir()
    (root/'.single-worker.lock').symlink_to(tmp_path/'elsewhere')
    with pytest.raises(OSError):
        with single_worker(root):
            pass
    assert not (tmp_path/'elsewhere').exists()
