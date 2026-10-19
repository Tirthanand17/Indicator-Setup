"""Single-process FastAPI cloud worker and authenticated token relay.

Run one worker only; avoid two independent processors or duplicate candidate alerts.
Host must be always-on and have persistent storage, not a sleeping free web tier.
"""
from __future__ import annotations
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
import asyncio,os,json,logging
from fastapi import FastAPI,Request,HTTPException
from fastapi.responses import JSONResponse
from .engine import Engine
from .state import State
from .security import TokenVault,verify_relay
from .telegram import Telegram
from .stream_supervisor import ShadowSupervisor
from .runtime_guard import single_worker
from .operational import assess_operational
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
    def validate(self):
        if not self.api_key or not self.bot_token or not self.chat_id:
            raise RuntimeError('Missing runtime API key or Telegram config')
        if len(self.relay_key)<32 or not self.vault_key:
            raise RuntimeError('Missing secure relay/vault keys')


def build_app(settings:AppSettings|None=None)->FastAPI:
    cfg=settings or AppSettings()
    cfg.validate()
    state=State(str(cfg.root/'alerts.sqlite3'))
    vault=TokenVault(cfg.root/'token.enc',cfg.vault_key)
    vault.load(datetime.now(IST))
    # Shadow subscriptions are opt-in diagnostics only. Kite REST is authoritative.
    shadow=ShadowSupervisor(cfg.api_key) if getattr(cfg,'shadow_enabled',False) else None
    engine=Engine(cfg.api_key,vault,state,Telegram(cfg.bot_token,cfg.chat_id),
                  enabled=cfg.enabled,shadow=shadow,
                  paper_premium_tracking=getattr(cfg,"paper_premium_tracking",False))

    @asynccontextmanager
    async def lifespan(app:FastAPI):
        # A second Uvicorn worker using the same durable volume must fail.
        # Different hosts/volumes still require a single-replica deployment.
        with single_worker(cfg.root):
            task=asyncio.create_task(engine.run_forever(),name='kite-paper-alerts')
            app.state.worker_task=task
            try:yield
            finally:
                task.cancel()
                try:await task
                except asyncio.CancelledError:pass
                if shadow is not None:
                    await shadow.shutdown()
                app.state.worker_task=None

    app=FastAPI(title='NIFTY read-only paper alerts',docs_url=None,redoc_url=None,openapi_url=None,lifespan=lifespan)
    app.state.engine=engine
    app.state.worker_task=None
    @app.get('/healthz')
    async def healthz():
        data=engine.health()
        task=app.state.worker_task
        alive=task is not None and not task.done()
        data['worker_running']=alive
        # Do not report a green health probe if FastAPI is serving requests
        # but the background market-data task has crashed.
        return JSONResponse(data,status_code=200 if alive else 503,
                            headers={'Cache-Control':'no-store'})

    @app.get('/readyz')
    async def readyz():
        # Monitoring-only readiness, not the host's liveness probe: missing
        # daily login should NOT cause the cloud provider to restart workers.
        ready=bool(engine.enabled and vault.get(datetime.now(IST)))
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
            worker_running=bool(task is not None and not task.done()),
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
            vault.put(token,now)
        except (ValueError,KeyError,TypeError):
            raise HTTPException(422,'invalid daily Kite token submission') from None
        return JSONResponse({'status':'TOKEN_ACCEPTED'},headers={'Cache-Control':'no-store'})
    return app

# Avoid import-time failure for pytest/missing production secrets; select service explicitly.
if os.environ.get('KITE_ALERT_IMPORT_APP','false').lower()=='true':
    app=build_app()
