"""Fail-closed single-worker guard for the Linux cloud deployment.

Two Uvicorn replicas with independent engine loops could duplicate API requests,
Telegram messages and virtual paper positions. A local POSIX advisory lock prevents
concurrent workers sharing the same durable STATE_DIR. It does not coordinate
workers on *different* hosts or with independent volumes: deployment must enforce
one cloud replica and one durable volume separately.
"""
from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
import os
import stat


@contextmanager
def single_worker(root: Path):
    """Reserve the private state directory for one running Linux process."""
    if os.name != 'posix':
        raise RuntimeError('Cloud worker lock requires a Linux/POSIX host')
    import fcntl

    root = Path(root)
    if root.is_symlink():
        raise RuntimeError('STATE_DIR cannot be a symbolic link')
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if root.is_symlink() or not root.is_dir():
        raise RuntimeError('Invalid STATE_DIR')

    lock_path = root / '.single-worker.lock'
    flags = os.O_CREAT | os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0)
    fd = os.open(lock_path, flags, 0o600)
    locked = False
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise RuntimeError('Worker lock must be a regular file')
        os.fchmod(fd, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('A paper-alert worker is already active for this STATE_DIR') from None
        locked = True
        yield
    finally:
        if locked:
            fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)
