"""Bounded restart supervision for the single read-only market-data task.

A FastAPI process can be alive even when its background monitoring task has
terminated. Supervision retries unexpected task exits without spawning parallel
market workers, and never reports a recovery backoff as healthy market coverage.
Exception text is deliberately not retained or surfaced in public diagnostics.
"""
from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable


class WorkerSupervisor:
    """Run exactly one worker; stop after a bounded run of early crashes.

    An extended successful run clears the consecutive-failure budget so a
    single crash months later is not penalized for previous repaired outages.
    The caller owns one process-wide lock and must shut down the host process
    after a FATAL state to allow its deployment supervisor to restart it.
    """

    def __init__(self, *, max_failures: int = 4,
                 backoffs: tuple[float, ...] = (1.0, 2.0, 5.0, 10.0),
                 stable_seconds: float = 300.0):
        if type(max_failures) is not int or not 2 <= max_failures <= 10:
            raise ValueError('invalid worker restart budget')
        if (not backoffs or len(backoffs) < max_failures - 1 or
                any(type(x) not in (int, float) or not 0 < x <= 120 for x in backoffs)):
            raise ValueError('invalid worker backoff schedule')
        if type(stable_seconds) not in (int, float) or not 1 <= stable_seconds <= 86400:
            raise ValueError('invalid stable-worker interval')
        self.max_failures = max_failures
        self.backoffs = backoffs
        self.stable_seconds = stable_seconds
        self.state = 'NOT_STARTED'
        self.starts = 0
        self.restarts = 0
        self.consecutive_failures = 0

    @property
    def running(self) -> bool:
        return self.state == 'RUNNING'

    def summary(self) -> dict:
        # Never expose exception strings or credentials.
        return {'state': self.state, 'starts': self.starts,
                'restarts': self.restarts,
                'consecutive_failures': self.consecutive_failures}

    async def run(self, worker: Callable[[], Awaitable[None]],
                  on_failure: Callable[[], None] | None = None) -> None:
        if self.state != 'NOT_STARTED':
            raise RuntimeError('worker supervisor can only be started once')
        loop = asyncio.get_running_loop()
        try:
            while True:
                self.state = 'RUNNING'
                self.starts += 1
                start = loop.time()
                try:
                    await worker()
                except asyncio.CancelledError:
                    raise
                except Exception:
                    # Broker/transport exceptions may include sensitive data.
                    # Do not store, log, or return the original exception text.
                    pass
                # Unexpected normal return is a failure too: the service must
                # not appear green when there is no market-data worker.
                # Invalidate the last "good" REST decision before attempting
                # recovery, so a restarted worker cannot reuse stale evidence.
                if on_failure is not None:
                    try:
                        on_failure()
                    except Exception:
                        # Do not propagate or log exception text from callbacks.
                        self.state = 'FATAL'
                        raise RuntimeError('worker recovery state reset failed') from None
                if loop.time() - start >= self.stable_seconds:
                    self.consecutive_failures = 0
                self.consecutive_failures += 1
                if self.consecutive_failures >= self.max_failures:
                    self.state = 'FATAL'
                    raise RuntimeError('read-only background worker exhausted restart budget') from None
                self.state = 'BACKOFF'
                await asyncio.sleep(self.backoffs[self.consecutive_failures - 1])
                self.restarts += 1
        finally:
            if self.state != 'FATAL':
                self.state = 'STOPPED'
