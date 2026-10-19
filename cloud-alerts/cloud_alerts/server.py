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
    engine=Engine(cfg.api_key,vault,state,Telegram(cfg.bot_token,cfg.chat_id),enabled=cfg.enabled)

    @asynccontextmanager
    async def lifespan(app:FastAPI):
        task=asyncio.create_task(engine.run_forever(),name='kite-paper-alerts')
        try:yield
        finally:
            task.cancel()
            try:await task
            except asyncio.CancelledError:pass

    app=FastAPI(title='NIFTY read-only paper alerts',docs_url=None,redoc_url=None,openapi_url=None,lifespan=lifespan)
    app.state.engine=engine
    @app.get('/healthz')
    async def healthz():
        return JSONResponse(engine.health(),headers={'Cache-Control':'no-store'})

    @app.post('/internal/token')
    async def handoff(request:Request):
        if request.headers.get('content-type','').split(';')[0]!='application/json':
            raise HTTPException(415,'JSON only')
        raw=await request.body()
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
