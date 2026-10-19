"""Durable read-only candle-close signal worker; all trading paths absent.

Prototype uses Kite historical 5minute / 15minute REST candles and quote depth.
For millisecond/second tick updates, see the *planned* KiteTicker WebSocket stage.
"""
from __future__ import annotations
import asyncio,json,os,logging
from datetime import datetime,timedelta,time
from zoneinfo import ZoneInfo
from pathlib import Path
from .contracts import select_future,select_option,validate_quote
from .kite_readonly import KiteReadOnly
from .models import Decision
from .security import TokenVault
from .state import State
from .signals import decide
from .telegram import Telegram,format_review
from .scheduler import CandlePollScheduler
IST=ZoneInfo('Asia/Kolkata')
logger=logging.getLogger('cloud_alerts')

class Engine:
    def __init__(self,api_key:str,vault:TokenVault,db:State,telegram:Telegram, *,enabled:bool=False):
        self.api_key=api_key;self.vault=vault;self.db=db;self.telegram=telegram;self.enabled=enabled
        self.status='NOT_STARTED' if enabled else 'DISABLED'
        self.status_at=datetime.now(IST)
        self.instrument_rows=None
        self.instrument_date=None
        self.last_data_at=None
        self.last_alert_at=None
        self.last_error=None

    def set_status(self,status:str,detail:str|None=None):
        self.status=status;self.status_at=datetime.now(IST)
        self.last_error=detail[:100] if detail else None

    def health(self)->dict:
        # Publicly safe diagnostic values only; no token, cloud secrets, phone ID or account data.
        return {'service':'nifty-paper-alerts','enabled':self.enabled,'status':self.status,
          'status_at':self.status_at.isoformat(),
          'last_market_data_at':self.last_data_at.isoformat() if self.last_data_at else None,
          'last_phone_accept_at':self.last_alert_at.isoformat() if self.last_alert_at else None,
          'reason':self.last_error,'expired_alerts_discarded':self.db.count_expired(),
          'mode':'READ_ONLY_PAPER','order_execution':False}

    async def _deliver_outbox(self)->None:
        # Entries older than 180 seconds are informationally stale for intraday
        # option buying. Discard them rather than deliver a dangerous old BUY.
        self.db.expire_events_before(datetime.now(IST)-timedelta(seconds=180))
        # Outbox is *at least once*, not mathematically exactly once: crash after
        # Telegram accepted but before SQLite commit could duplicate a message.
        for event_id,body in self.db.pending_events():
            try:
                await asyncio.to_thread(self.telegram.send,body)
                self.db.mark_delivered(event_id)
                self.last_alert_at=datetime.now(IST)
            except Exception:
                self.set_status('PHONE_DELIVERY_FAILED','Telegram request failed; retrying queued alert')
                break

    async def _send_event(self,event_id:str,status:str,now:datetime,body:str)->None:
        if self.db.claim_event(event_id,status,now,body):
            await self._deliver_outbox()

    async def run_once(self,now:datetime|None=None)->None:
        now=(now or datetime.now(IST)).astimezone(IST)
        if not self.enabled:
            self.set_status('DISABLED');return
        if now.weekday()>=5 or now.time()<time(9,25) or now.time()>time(15,25):
            self.set_status('MARKET_CLOSED');return
        token=self.vault.get(now)
        if not token:
            self.set_status('WAIT_TOKEN','Daily Kite access token not delivered or expired')
            return
        # Market-data getters are blocking HTTP; offload from FastAPI worker loop.
        try:
            await asyncio.wait_for(self._collect_once(now,token),timeout=24)
        except Exception:
            # No raw exception: Kite exceptions can include URLs/Authorization material.
            self.set_status('WAIT_DATA','Kite candle, quote or API request failed; no signal sent')

    async def _collect_once(self,now:datetime,token:str)->None:
        kite=KiteReadOnly(self.api_key,token)
        if self.instrument_rows is None or self.instrument_date!=now.date():
            self.instrument_rows=await asyncio.to_thread(kite.instruments_nfo)
            self.instrument_date=now.date()
        fut=select_future(self.instrument_rows,now.date())
        candle_from=now-timedelta(days=12)
        series5,series15=await asyncio.gather(
            asyncio.to_thread(kite.historical,fut.token,'5minute',candle_from,now),
            asyncio.to_thread(kite.historical,fut.token,'15minute',candle_from,now))
        # Explicit completed-candle rule: broker may include still-forming final row.
        completed5=[b for b in series5 if b.start+timedelta(minutes=5,seconds=8)<=now]
        completed15=[b for b in series15 if b.start+timedelta(minutes=15,seconds=8)<=now]
        if not completed5 or not completed15:
            self.set_status('WAIT_DATA','No confirmed historical candles');return
        boundary=now.replace(minute=(now.minute//5)*5,second=0,microsecond=0)
        if completed5[-1].start+timedelta(minutes=5)!=boundary:
            self.set_status('WAIT_DATA','Latest 5-minute REST candle not published at expected boundary')
            return
        previous_completed=self.db.get_runtime('last_processed_candle')
        stamp=fut.symbol+':'+completed5[-1].start.isoformat()
        if previous_completed==stamp:
            # Don't suppress delayed Telegram retry.
            await self._deliver_outbox()
            return
        decision=decide(completed5,now,completed15)
        self.last_data_at=now
        if decision.status=='WAIT_DATA':
            self.set_status('WAIT_DATA',decision.reason)
            return
        # Previous valid event is finished; do not refetch or spam the candle.
        self.db.set_runtime('last_processed_candle',stamp)
        if decision.candle is not None:
            await self._check_virtual_exit(completed5[-1],fut.symbol,now)
        if decision.status not in ('REVIEW_CE','REVIEW_PE'):
            self.set_status('NO_TRADE',decision.reason)
            await self._deliver_outbox()
            return
        side=decision.status[-2:]
        try:
            opt=select_option(self.instrument_rows,now.date(),side,decision.candle.close,avoid_expiry_day=True)
            raw=await asyncio.to_thread(kite.full_quote,opt.symbol)
            oq=validate_quote(opt,raw,now,max_age_seconds=15,max_spread_pct=2)
        except (ValueError,TypeError,KeyError):
            self.set_status('NO_TRADE','No liquid fresh executable option quote; skip alert')
            return
        except Exception:
            self.set_status('WAIT_DATA','Option quote fetch error; no alert')
            return
        # Informational review only; option premium stops are NOT implied by ATR.
        body=format_review(decision,oq)
        event_id=stamp+':'+decision.status
        await self._send_event(event_id,decision.status,now,body)
        self.set_status(decision.status,'Futures + option market-depth review sent or queued')
        self.db.set_runtime('virtual_candidate',json.dumps({
            'direction':side,'symbol':fut.symbol,'signal_candle':decision.candle.start.isoformat(),
            'entry':decision.candle.close,'stop':decision.stop_underlying,
            'target':decision.target_underlying,'expiry_date':now.date().isoformat()},separators=(',',':')))

    async def _check_virtual_exit(self,candle,symbol:str,now:datetime)->None:
        raw=self.db.get_runtime('virtual_candidate')
        if not raw:return
        position=json.loads(raw)
        if position.get('symbol')!=symbol or position.get('expiry_date')!=now.date().isoformat():
            self.db.set_runtime('virtual_candidate','');return
        if candle.start.isoformat()<=position['signal_candle']:return
        side=position['direction'];stop=position['stop'];target=position['target']
        breached_stop=(candle.low<=stop if side=='CE' else candle.high>=stop)
        breached_target=(candle.high>=target if side=='CE' else candle.low<=target)
        if not (breached_stop or breached_target or now.time()>time(15,15)):
            return
        reason=('INTRABAR STOP/target ambiguous — treat risk-first' if breached_stop and breached_target
           else 'underlying STOP was touched' if breached_stop
           else 'underlying TARGET was touched' if breached_target
           else 'intraday time cutoff')
        msg=('NIFTY PAPER ALERT — EXIT REVIEW (VIRTUAL '+side+')\n'+
             symbol+' candle '+candle.start.strftime('%d %b %H:%M')+' IST\n'+reason+'\n'+
             'This is NOT your actual Kite holding. No option bid, premium fill, or real P&L is known. '+
             'Verify and manage any actual position yourself. NO ORDERS PLACED.')
        await self._send_event('EXIT:'+position['signal_candle']+':'+candle.start.isoformat(),'EXIT_REVIEW',now,msg)
        self.db.set_runtime('virtual_candidate','')

    async def run_forever(self)->None:
        scheduler=CandlePollScheduler()
        last_outbox_minute=None
        while True:
            now=datetime.now(IST)
            minute=now.replace(second=0,microsecond=0)
            # Retry queued Telegram messages even when broker data is unavailable,
            # and expire those no longer timely. Limit retry to once a minute.
            if minute!=last_outbox_minute:
                last_outbox_minute=minute
                if self.enabled:
                    await self._deliver_outbox()
                else:
                    self.db.expire_events_before(now-timedelta(seconds=180))
            if scheduler.claim(now):
                await self.run_once(now)
            await asyncio.sleep(2)
