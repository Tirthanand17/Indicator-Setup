"""Single-worker crash recovery never presents backoff as healthy monitoring."""
import asyncio
from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from cloud_alerts.worker_supervisor import WorkerSupervisor
from cloud_alerts.server import build_app


@pytest.mark.asyncio
async def test_recovers_two_crashes_without_parallel_workers(monkeypatch):
    supervisor = WorkerSupervisor(max_failures=4, backoffs=(0.001,0.001,0.001))
    keep_running = asyncio.Event()
    started = asyncio.Event()
    count = 0
    active = 0
    max_active = 0

    async def flaky():
        nonlocal count, active, max_active
        count += 1
        active += 1
        max_active = max(max_active, active)
        try:
            if count < 3:
                raise RuntimeError('PRIVATE_FAKE_SECRET must not be leaked')
            started.set()
            await keep_running.wait()
        finally:
            active -= 1

    failures=[]
    task = asyncio.create_task(supervisor.run(flaky,on_failure=lambda:failures.append('reset')))
    try:
        await asyncio.wait_for(started.wait(), 1)
        assert supervisor.running
        assert supervisor.summary() == {'state':'RUNNING', 'starts':3,
                                        'restarts':2, 'consecutive_failures':2}
        assert max_active == 1
        assert failures == ['reset','reset']
        assert 'PRIVATE_FAKE_SECRET' not in str(supervisor.summary())
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    assert supervisor.state == 'STOPPED'


@pytest.mark.asyncio
async def test_unexpected_clean_return_is_failure_and_budget_is_bounded():
    supervisor=WorkerSupervisor(max_failures=3,backoffs=(0.001,0.001))
    async def exits():
        return None
    with pytest.raises(RuntimeError,match='exhausted restart budget'):
        await supervisor.run(exits)
    assert supervisor.summary()=={'state':'FATAL','starts':3,'restarts':2,
                                  'consecutive_failures':3}


@pytest.mark.asyncio
async def test_crash_exception_details_are_not_propagated():
    supervisor=WorkerSupervisor(max_failures=2,backoffs=(0.001,))
    async def broken():
        raise ValueError('PRIVATE_TOKEN_CONTENT')
    with pytest.raises(RuntimeError,match='exhausted restart budget') as error:
        await supervisor.run(broken)
    assert 'PRIVATE_TOKEN_CONTENT' not in str(error.value)
    assert 'PRIVATE_TOKEN_CONTENT' not in str(supervisor.summary())


@pytest.mark.asyncio
async def test_cancel_during_backoff_ends_without_restarting(monkeypatch):
    supervisor=WorkerSupervisor(max_failures=3,backoffs=(30.,30.))
    async def broken():
        raise RuntimeError('failure')
    task=asyncio.create_task(supervisor.run(broken))
    for _ in range(100):
        if supervisor.state=='BACKOFF':break
        await asyncio.sleep(0.001)
    assert supervisor.state=='BACKOFF' and not supervisor.running
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert supervisor.state=='STOPPED' and supervisor.starts==1


def test_health_and_token_readiness_fail_during_supervisor_backoff(tmp_path):
    cfg=SimpleNamespace(api_key='TEST_KEY',bot_token='123:FAKE_TOKEN',chat_id='100',
        relay_key='a'*64,vault_key=Fernet.generate_key().decode(),root=tmp_path,
        enabled=True,validate=lambda:None)
    app=build_app(cfg)
    with TestClient(app) as c:
        app.state.engine.vault.put('Q'*40,__import__('datetime').datetime.now(__import__('zoneinfo').ZoneInfo('Asia/Kolkata')))
        assert c.get('/healthz').status_code==200
        assert c.get('/readyz').status_code==200
        app.state.worker_supervisor.state='BACKOFF'
        health=c.get('/healthz')
        assert health.status_code==503 and health.json()['worker_running'] is False
        assert health.json()['worker_supervisor']['state']=='BACKOFF'
        assert c.get('/readyz').status_code==503
        assert c.get('/operationalz').status_code==503
        assert not c.get('/operationalz').json()['phone_receipt_verified']
        app.state.worker_supervisor.state='RUNNING'


@pytest.mark.asyncio
async def test_failure_callback_exception_blocks_restart_without_leaking_text():
    supervisor=WorkerSupervisor(max_failures=3,backoffs=(0.001,0.001))
    async def fail():
        raise RuntimeError('PRIVATE_FROM_MARKET')
    def reset():
        raise ValueError('PRIVATE_FROM_CALLBACK')
    with pytest.raises(RuntimeError, match='recovery state reset failed') as error:
        await supervisor.run(fail,on_failure=reset)
    assert supervisor.state=='FATAL' and supervisor.starts==1
    assert 'PRIVATE' not in str(error.value)


def test_actual_crash_clears_old_fresh_decision_before_recovery(tmp_path):
    """A recovered web process must not report a prior worker's REST age as fresh."""
    from datetime import datetime
    from zoneinfo import ZoneInfo

    cfg=SimpleNamespace(api_key='TEST_KEY',bot_token='123:FAKE_TOKEN',chat_id='100',
        relay_key='a'*64,vault_key=Fernet.generate_key().decode(),root=tmp_path,
        enabled=True,validate=lambda:None)
    app=build_app(cfg)
    bot=app.state.engine
    ist=ZoneInfo('Asia/Kolkata')
    bot.last_data_at=datetime.now(ist)
    bot.status='NO_TRADE'
    attempts=[0]
    recovered=asyncio.Event()

    async def fake_worker():
        attempts[0]+=1
        if attempts[0]==1:
            raise RuntimeError('PRIVATE_SYNTHETIC_NETWORK_DETAILS')
        recovered.set()
        await asyncio.Event().wait()

    bot.run_forever=fake_worker
    with TestClient(app) as c:
        # TestClient uses a separate event loop; poll from host thread.
        import time
        for _ in range(100):
            if attempts[0]>=2:break
            time.sleep(0.03)
        assert attempts[0]==2
        assert bot.last_data_at is None
        assert bot.status=='WORKER_RECOVERING'
        health=c.get('/healthz')
        assert health.status_code==200
        assert health.json()['worker_supervisor']['restarts']==1
        assert 'PRIVATE_SYNTHETIC_NETWORK_DETAILS' not in health.text
        assert c.get('/operationalz').status_code==503
