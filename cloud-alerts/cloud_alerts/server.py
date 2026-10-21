"""Single-process FastAPI cloud worker and authenticated token relay.

Run one worker only; avoid two independent processors or duplicate candidate alerts.
Host must be always-on and have persistent storage, not a sleeping free web tier.
"""
from __future__ import annotations
from contextlib import asynccontextmanager
from datetime import datetime,date
from pathlib import Path
from zoneinfo import ZoneInfo
import asyncio,os,json,logging,signal,hmac,secrets
from fastapi import FastAPI,Request,HTTPException
from fastapi.responses import JSONResponse,HTMLResponse
from .engine import Engine
from .paper_book import PaperBook
from .paper_dashboard_view import page as paper_dashboard_page
from .signal_audit import SignalAudit
from .paper_analytics import realized_analytics
from .state import State
from .security import TokenVault,verify_relay,TokenRollbackError
from .telegram import Telegram
from .stream_supervisor import ShadowSupervisor
from .runtime_guard import single_worker
from .operational import assess_operational
from .config_guard import configuration_blockers
from .worker_supervisor import WorkerSupervisor
IST=ZoneInfo('Asia/Kolkata')

class AppSettings:
    def __init__(self):
        self.api_key=os.environ.get('KITE_API_KEY','')
        self.bot_token=os.environ.get('TELEGRAM_BOT_TOKEN','')
        self.chat_id=os.environ.get('TELEGRAM_CHAT_ID','')
        self.relay_key=os.environ.get('TOKEN_RELAY_HMAC_KEY','')
        self.vault_key=os.environ.get('TOKEN_VAULT_KEY','')
        self.root=Path(os.environ.get('STATE_DIR','/data/nifty-alerts'))
        self.enabled=os.environ.get('ALERTS_ENABLED','false').strip().lower()=='true'
        self.shadow_enabled=os.environ.get('KITE_SHADOW_ENABLED','false').strip().lower()=='true'
        self.paper_premium_tracking=os.environ.get('PAPER_PREMIUM_TRACKING_ENABLED','false').strip().lower()=='true'
        self.paper_dashboard_enabled=os.environ.get('PAPER_DASHBOARD_ENABLED','false').strip().lower()=='true'
        self.paper_autotrade_enabled=os.environ.get('PAPER_AUTOTRADE_ENABLED','false').strip().lower()=='true'
        self.paper_dashboard_key=os.environ.get('PAPER_DASHBOARD_KEY','')
    def validate(self):
        # Mirror deployment preflight: a direct Uvicorn invocation must not
        # bypass secret placeholders/format checks when preflight is skipped.
        config={'KITE_API_KEY':self.api_key, 'TELEGRAM_BOT_TOKEN':self.bot_token,
                'TELEGRAM_CHAT_ID':self.chat_id,'TOKEN_RELAY_HMAC_KEY':self.relay_key,
                'TOKEN_VAULT_KEY':self.vault_key,
                'ALERTS_ENABLED': 'true' if self.enabled else 'false',
                'KITE_SHADOW_ENABLED':'true' if self.shadow_enabled else 'false',
                'PAPER_PREMIUM_TRACKING_ENABLED':'true' if self.paper_premium_tracking else 'false',
                'PAPER_DASHBOARD_ENABLED':'true' if self.paper_dashboard_enabled else 'false',
                'PAPER_AUTOTRADE_ENABLED':'true' if self.paper_autotrade_enabled else 'false',
                'PAPER_DASHBOARD_KEY':self.paper_dashboard_key}
        if configuration_blockers(config):
            raise RuntimeError('Invalid cloud configuration; use offline preflight for safe blocker codes')


def build_app(settings:AppSettings|None=None)->FastAPI:
    cfg=settings or AppSettings()
    cfg.validate()
    state=State(str(cfg.root/'alerts.sqlite3'))
    vault=TokenVault(cfg.root/'token.enc',cfg.vault_key)
    vault.load(datetime.now(IST))
    # Shadow subscriptions are opt-in diagnostics only. Kite REST is authoritative.
    shadow=ShadowSupervisor(cfg.api_key) if getattr(cfg,'shadow_enabled',False) else None
    # Optional private paper-account data. Disabled by default; no public
    # paper portfolio endpoint is exposed without a strong operator-provided key.
    paper_enabled=bool(getattr(cfg,'paper_dashboard_enabled',False))
    paper_key=str(getattr(cfg,'paper_dashboard_key',''))
    if paper_enabled and (not paper_key.isascii() or len(paper_key)<32 or len(set(paper_key))<8):
        raise RuntimeError('Paper dashboard requires a separate strong access key')
    paper_book=PaperBook(str(cfg.root/'alerts.sqlite3')) if paper_enabled else None
    paper_audit=SignalAudit(str(cfg.root/'alerts.sqlite3')) if paper_enabled else None
    if getattr(cfg,'paper_autotrade_enabled',False) and (
            not paper_enabled or not getattr(cfg,'enabled',False)):
        raise RuntimeError('Automatic paper trading requires enabled monitoring and secured dashboard')
    engine=Engine(cfg.api_key,vault,state,Telegram(cfg.bot_token,cfg.chat_id),
                  enabled=cfg.enabled,shadow=shadow,
                  paper_premium_tracking=getattr(cfg,"paper_premium_tracking",False),
                  paper_book=(paper_book if getattr(cfg,'paper_autotrade_enabled',False) else None))

    supervisor=WorkerSupervisor()

    @asynccontextmanager
    async def lifespan(app:FastAPI):
        # A second Uvicorn worker using the same durable volume must fail.
        # Different hosts/volumes still require a single-replica deployment.
        with single_worker(cfg.root):
            # Reconcile persisted paper state before any retry or market poll.
            # A malformed/unlinked candidate blocks startup until inspected.
            app.state.startup_recovery=state.reconcile_startup(datetime.now(IST))
            # Keep the FastAPI/HTTP process from silently looking healthy
            # when its underlying background task crashed. A bounded series
            # of early crashes triggers a controlled process shutdown; Docker
            # may then restart the container under its configured policy.
            def invalidate_previous_decision():
                # This callback runs only after the previous market worker
                # exits. Reapply the same SQLite recovery invariants used at
                # ASGI startup BEFORE the supervisor starts another worker.
                # In particular, an expired unsent BUY cannot retain a virtual
                # EXIT candidate across an in-process worker restart.
                engine.last_data_at=None
                engine.set_status('WORKER_RECOVERING','Background monitoring worker restarting')
                app.state.last_worker_recovery=state.reconcile_startup(datetime.now(IST))

            task=asyncio.create_task(supervisor.run(
                engine.run_forever,on_failure=invalidate_previous_decision),
                name='kite-paper-alert-supervisor')
            app.state.worker_task=task

            def on_supervisor_done(done:asyncio.Task):
                if done.cancelled():
                    return
                try:
                    done.result()
                except Exception:
                    logger=logging.getLogger('cloud_alerts')
                    logger.critical('Read-only worker failed repeatedly; terminating unhealthy service')
                    # Not called for regular lifespan cancellation. A process
                    # exit is required: an unhealthy Docker HEALTHCHECK alone
                    # does not activate `restart: unless-stopped`.
                    os.kill(os.getpid(), signal.SIGTERM)

            task.add_done_callback(on_supervisor_done)
            await asyncio.sleep(0)  # schedule worker before serving health
            try:yield
            finally:
                task.cancel()
                try:await task
                except asyncio.CancelledError:pass
                except RuntimeError:
                    # The fatal supervisor already signalled process shutdown.
                    # Do not let a generic recovery failure obscure graceful
                    # resource cleanup while SIGTERM is being handled.
                    if supervisor.state != 'FATAL':
                        raise
                if shadow is not None:
                    await shadow.shutdown()
                app.state.worker_task=None

    app=FastAPI(title='NIFTY read-only paper alerts',docs_url=None,redoc_url=None,openapi_url=None,lifespan=lifespan)
    app.state.engine=engine
    app.state.worker_supervisor=supervisor
    app.state.worker_task=None
    app.state.startup_recovery=None
    app.state.last_worker_recovery=None
    def _authorize_paper(request:Request):
        # Never accept dashboard keys in URLs/cookies (easy to leak). Do not
        # expose the presence of accounts to an unauthenticated visitor.
        candidate=request.headers.get('x-paper-dashboard-key','')
        if (paper_book is None or not candidate.isascii()
                or not hmac.compare_digest(candidate, paper_key)):
            raise HTTPException(404,'Not found')

    @app.get('/paper/dashboard')
    async def paper_dashboard():
        if paper_book is None:
            raise HTTPException(404,'Not found')
        nonce=secrets.token_urlsafe(24)
        return HTMLResponse(paper_dashboard_page(nonce),headers={
            'Cache-Control':'no-store',
            'Content-Security-Policy':(
                "default-src 'none'; style-src 'unsafe-inline'; "
                "script-src 'nonce-"+nonce+"'; connect-src 'self'; "
                "img-src 'none'; base-uri 'none'; form-action 'none'; "
                "frame-ancestors 'none'"),
            'X-Content-Type-Options':'nosniff',
            'Referrer-Policy':'no-referrer'})

    @app.get('/paper/api/summary')
    async def paper_summary(request:Request):
        _authorize_paper(request)
        return JSONResponse(paper_book.dashboard(),headers={'Cache-Control':'no-store'})

    @app.get('/paper/api/analytics')
    async def paper_analytics(request:Request):
        _authorize_paper(request)
        return JSONResponse(realized_analytics(str(cfg.root/'alerts.sqlite3'),datetime.now(IST)),
                            headers={'Cache-Control':'no-store'})

    @app.get('/paper/api/opportunities')
    async def paper_opportunities(request:Request):
        _authorize_paper(request)
        query_day=request.query_params.get('date')
        try:
            selected=date.fromisoformat(query_day) if query_day else None
        except ValueError:
            raise HTTPException(400,'Invalid calendar date') from None
        return JSONResponse({'mode':'PAPER_ONLY','actual_orders':False,
                             'audit':paper_audit.summary(day=selected),
                             'evaluations':paper_audit.recent(100,day=selected)},
                            headers={'Cache-Control':'no-store'})

    @app.get('/paper/api/trades')
    async def paper_trades(request:Request):
        _authorize_paper(request)
        return JSONResponse({'mode':'PAPER_ONLY','actual_orders':False,
                             'trades':paper_book.trade_history(limit=100)},
                            headers={'Cache-Control':'no-store'})

    @app.get('/healthz')
    async def healthz():
        data=engine.health()
        task=app.state.worker_task
        alive=task is not None and not task.done() and supervisor.running
        data['worker_running']=alive
        data['worker_supervisor']=supervisor.summary()
        # Sanitized counters from the latest in-process recovery; no messages,
        # tokens, timestamps of individual events, or database contents.
        recovery=app.state.last_worker_recovery
        data['last_worker_reconciliation']=(
            {'performed': True,
             'expired_queued_notifications': recovery['expired_queued_notifications'],
             'cleared_stale_virtual_candidates': recovery['cleared_stale_virtual_candidates'],
             'preserved_active_candidate': recovery['preserved_active_candidate']}
            if recovery is not None else {'performed': False})
        # Do not report a green health probe if FastAPI is serving requests
        # but the background market-data task has crashed.
        return JSONResponse(data,status_code=200 if alive else 503,
                            headers={'Cache-Control':'no-store'})

    @app.get('/readyz')
    async def readyz():
        # Monitoring-only readiness, not the host's liveness probe: missing
        # daily login should NOT cause the cloud provider to restart workers.
        task=app.state.worker_task
        ready=bool(engine.enabled and vault.get(datetime.now(IST)) and
                   task is not None and not task.done() and supervisor.running)
        return JSONResponse({'ready':ready,'mode':'READ_ONLY_PAPER'},
                            status_code=200 if ready else 503,headers={'Cache-Control':'no-store'})

    @app.get('/operationalz')
    async def operationalz():
        # This is stricter than /readyz: today's token is insufficient if
        # REST decisions are stale or Telegram has undelivered queued messages.
        # Never claim the user's phone RECEIVED a notification.
        task = app.state.worker_task
        now = datetime.now(IST)
        report = assess_operational(
            now,
            worker_running=bool(task is not None and not task.done() and supervisor.running),
            enabled=engine.enabled,
            token_present=bool(vault.get(now)),
            last_data_at=engine.last_data_at,
            status=engine.status,
            queued_alerts=state.outbox_summary()['queued'],
        )
        return JSONResponse(report,
                            status_code=200 if report['monitoring_data_ready'] else 503,
                            headers={'Cache-Control': 'no-store'})

    @app.post('/internal/token')
    async def handoff(request:Request):
        if request.headers.get('content-type','').split(';')[0]!='application/json':
            raise HTTPException(415,'JSON only')
        # Strict bound BEFORE reading request content into memory. Content-Length
        # can be absent or dishonest, therefore enforce while streaming too.
        if request.headers.get('content-length','').isdigit() and int(request.headers['content-length'])>2048:
            raise HTTPException(413,'token handoff body too large')
        chunks=[]
        size=0
        async for chunk in request.stream():
            size+=len(chunk)
            if size>2048:
                raise HTTPException(413,'token handoff body too large')
            chunks.append(chunk)
        raw=b''.join(chunks)
        now=datetime.now(IST)
        ts=request.headers.get('x-relay-timestamp','')
        nonce=request.headers.get('x-relay-nonce','')
        digest=request.headers.get('x-relay-signature','')
        if not verify_relay(cfg.relay_key,ts,nonce,digest,raw,now):
            raise HTTPException(401,'relay authentication failed')
        if not state.claim_nonce(nonce,int(now.timestamp())):
            raise HTTPException(409,'replayed request')
        try:
            body=json.loads(raw)
            if not isinstance(body,dict) or body.get('api_key')!=cfg.api_key:
                raise ValueError('API identity mismatch')
            token=body['access_token']
            vault.put(token,now,relay_at=int(ts))
        except TokenRollbackError:
            raise HTTPException(409,'older or ambiguous daily token handoff') from None
        except (ValueError,KeyError,TypeError):
            raise HTTPException(422,'invalid daily Kite token submission') from None
        return JSONResponse({'status':'TOKEN_ACCEPTED'},headers={'Cache-Control':'no-store'})
    return app

# Avoid import-time failure for pytest/missing production secrets; select service explicitly.
if os.environ.get('KITE_ALERT_IMPORT_APP','false').lower()=='true':
    app=build_app()
