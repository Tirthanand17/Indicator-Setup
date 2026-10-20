"""Durable read-only candle-close signal worker; all trading paths absent.

Prototype uses Kite historical 5minute / 15minute REST candles and quote depth.
For millisecond/second tick updates, see the *planned* KiteTicker WebSocket stage.
"""
from __future__ import annotations
import asyncio,json,os,logging
from contextvars import ContextVar
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
from .quote_evidence import make_snapshot
from .scheduler import CandlePollScheduler
from .session_coverage import boundary_for
from .trading_calendar import session_status, regular_session, CalendarUnavailable
from .stream_supervisor import ShadowSupervisor
from .premium import (PremiumHypothesis,reference_from_quote,parse_reference,
                      reference_contract,evaluate_bid,exit_text)
IST=ZoneInfo('Asia/Kolkata')
logger=logging.getLogger('cloud_alerts')

class Engine:
    def __init__(self,api_key:str,vault:TokenVault,db:State,telegram:Telegram, *,enabled:bool=False,
                 shadow:ShadowSupervisor|None=None, paper_premium_tracking:bool=False,
                 premium_hypothesis:PremiumHypothesis|None=None):
        self.api_key=api_key;self.vault=vault;self.db=db;self.telegram=telegram;self.enabled=enabled
        self.shadow=shadow
        self.paper_premium_tracking=paper_premium_tracking
        self.premium_hypothesis=premium_hypothesis or PremiumHypothesis()
        self.premium_status="DISABLED" if not paper_premium_tracking else "IDLE"
        self.last_premium_quote_at=None
        self.status='NOT_STARTED' if enabled else 'DISABLED'
        self.status_at=datetime.now(IST)
        self.instrument_rows=None
        self.instrument_date=None
        self.last_data_at=None
        self._rest_verified_at=None
        self.last_alert_at=None
        self.last_error=None
        # Task-local flag: live polling must sample the wall clock when Telegram
        # is actually contacted, not the earlier REST candle poll timestamp.
        # Explicit run_once(now=...) preserves deterministic historical tests.
        self._live_delivery_clock: ContextVar[bool] = ContextVar(
            'nifty_live_delivery_clock', default=False)

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
          'phone_outbox':self.db.outbox_summary(),
          'mode':'READ_ONLY_PAPER','order_execution':False,
          'paper_premium_tracking':self.paper_premium_tracking,'premium_status':self.premium_status,
          'premium_quote_at':self.last_premium_quote_at.isoformat() if self.last_premium_quote_at else None,
          'shadow_stream':self.shadow.health() if self.shadow is not None else {'status':'DISABLED'},
          'shadow_quality_30d':self.db.shadow_summary(datetime.now(IST)) if self.shadow is not None else None}

    async def _deliver_outbox(self, now:datetime|None=None, *, max_sends:int=2)->None:
        # Bound a delivery batch: Telegram requests can each take seven seconds.
        # A ten-message outbox must not starve the next five-minute REST poll.
        # No exception or event body is logged, and queued events stay durable.
        if type(max_sends) is not int or not 1 <= max_sends <= 2:
            raise ValueError('invalid bounded Telegram delivery batch')
        # run_once() from the real worker can spend up to 24 seconds fetching
        # REST/option data before reaching this function. A captured boundary
        # timestamp cannot authorize a send that is already stale.
        if self._live_delivery_clock.get():
            now=None
        # Entries older than 180 seconds are informationally stale for intraday
        # option buying. Discard them rather than deliver a dangerous old BUY.
        current=(now or datetime.now(IST)).astimezone(IST)
        self.db.expire_events_before(current-timedelta(seconds=180))
        # Outbox is *at least once*, not mathematically exactly once: crash after
        # Telegram accepted but before SQLite commit could duplicate a message.
        sent_attempts=0
        for event_id,body in self.db.pending_events():
            if sent_attempts >= max_sends:
                break
            # Persist the attempt before the external request, so retry counts
            # survive process restarts even if Telegram raises or times out.
            # Recheck each message at actual send time. A batch-wide cutoff
            # can become stale while previous Telegram HTTP calls run.
            attempt_at=current if now is not None else datetime.now(IST)
            if not self.db.claim_fresh_delivery_attempt(event_id,attempt_at):
                continue
            sent_attempts += 1
            try:
                await asyncio.to_thread(self.telegram.send,body)
                accepted_at=current if now is not None else datetime.now(IST)
                if not self.db.mark_delivered(event_id,accepted_at):
                    # A concurrent expiry or state change forbids claiming an
                    # accepted event, even though API response was successful.
                    self.set_status('PHONE_DELIVERY_UNCERTAIN','Alert status changed while sending')
                    break
                self.last_alert_at=accepted_at
            except Exception:
                self.set_status('PHONE_DELIVERY_FAILED','Telegram request failed; retrying queued alert')
                break

    async def _send_event(self,event_id:str,status:str,now:datetime,body:str)->None:
        if self.db.claim_event(event_id,status,now,body):
            await self._deliver_outbox(now)

    def _entry_notice_gate(self,position:dict)->str:
        """Never issue virtual EXIT based on an entry review unseen by Telegram.

        New candidates carry their entry outbox ID. Older persisted candidates
        do not: keep the old research-only semantics, but mark them as legacy.
        This tests Telegram API acceptance, not receipt by the user's phone.
        """
        entry_id=position.get('entry_event_id')
        if entry_id is None:return 'LEGACY_UNVERIFIED'
        if not isinstance(entry_id,str) or not entry_id or len(entry_id)>256:
            return 'INVALID'
        return self.db.entry_notice_delivery_state(entry_id)

    async def run_once(self,now:datetime|None=None)->None:
        # Passing `now` is the offline/replay test seam. The real scheduler calls
        # without it, so network-time expiry and API acceptance always use fresh
        # wall-clock observations even after slow market-data collection.
        token=self._live_delivery_clock.set(now is None)
        try:
            return await self._run_once_at(now)
        finally:
            self._live_delivery_clock.reset(token)

    async def _run_once_at(self,now:datetime|None=None)->None:
        now=(now or datetime.now(IST)).astimezone(IST)
        if not self.enabled:
            self.set_status('DISABLED');return
        # Last scheduled boundary is 15:25:08-58 IST, not exactly 15:25:00.
        # At 15:26 the worker stops, avoiding late new paper-review alerts.
        try:
            market_state = session_status(now.date())
        except CalendarUnavailable:
            self.set_status('WAIT_CALENDAR','NSE F&O annual holiday calendar is not installed');return
        if market_state != 'REGULAR':
            self.set_status('EXCHANGE_CLOSED' if market_state == 'HOLIDAY' else 'MARKET_CLOSED');return
        if now.time()<time(9,25) or now.time()>=time(15,26):
            self.set_status('MARKET_CLOSED');return
        self._rest_verified_at=None
        outcome='WAIT_DATA'
        try:
            token=self.vault.get(now)
            if not token:
                self.set_status('WAIT_TOKEN','Daily Kite access token not delivered or expired')
                outcome='WAIT_TOKEN'
                return
            # Market-data getters are blocking HTTP; offload from FastAPI loop.
            try:
                await asyncio.wait_for(self._collect_once(now,token),timeout=24)
                if self._rest_verified_at==now:
                    outcome='REST_VALID'
            except Exception:
                # Never expose Kite exception text, headers or credentials.
                self.set_status('WAIT_DATA','Kite candle, quote or API request failed; no signal sent')
                outcome='API_ERROR'
        finally:
            # Quote/delivery failure after a validated REST decision must not
            # erase evidence of an otherwise monitored five-minute boundary.
            if self._rest_verified_at==now:
                outcome='REST_VALID'
            if boundary_for(now) is not None:
                self.db.record_rest_attempt(now,outcome)

    async def _collect_once(self,now:datetime,token:str)->None:
        kite=KiteReadOnly(self.api_key,token)
        if self.instrument_rows is None or self.instrument_date!=now.date():
            self.instrument_rows=await asyncio.to_thread(kite.instruments_nfo)
            self.instrument_date=now.date()
        fut=select_future(self.instrument_rows,now.date())
        # Optional diagnostic socket: never authorizes trade candidates and
        # never blocks the existing REST-only candle decision path.
        shadow_ready=False
        if self.shadow is not None:
            try:
                shadow_ready=bool(await self.shadow.ensure(token,fut.token))
            except Exception:
                logger.warning('Optional shadow stream unavailable; continuing REST-only')
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
            self._rest_verified_at=now
            # Don't suppress delayed Telegram retry.
            await self._deliver_outbox(now)
            return
        if shadow_ready:
            try:
                shadow_verdict=self.shadow.reconcile(completed5[-1])
                status=('MISSING' if shadow_verdict is None else
                        'MATCH' if shadow_verdict else 'MISMATCH')
                evidence=getattr(self.shadow,'evidence',None)
                reasons=(evidence.last_reasons if evidence is not None and status=='MISMATCH' else ())
                self.db.record_shadow_evidence(fut.symbol,completed5[-1].start,now,status,tuple(reasons))
            except (ValueError,TypeError):
                # Corrupt shadow evidence is never an excuse to skip an otherwise
                # validated broker REST candle. It is reported in stream health.
                logger.warning('Shadow reconciliation rejected malformed evidence')
            except Exception:
                logger.warning('Optional shadow evidence persistence failed; REST-only strategy unaffected')
        decision=decide(completed5,now,completed15)
        self.last_data_at=now
        if decision.status=='WAIT_DATA':
            self.set_status('WAIT_DATA',decision.reason)
            return
        self._rest_verified_at=now
        # Mark NO_TRADE decisions as completed below. REVIEW candidates must
        # first obtain valid option depth; a transient stale quote can be retried
        # by the bounded scheduler without dropping a potential review.
        if decision.candle is not None:
            await self._check_virtual_exit(completed5[-1],fut.symbol,now)
        if decision.status not in ('REVIEW_CE','REVIEW_PE'):
            self.db.set_runtime('last_processed_candle',stamp)
            self.set_status('NO_TRADE',decision.reason)
            await self._deliver_outbox(now)
            return
        # Only one explicitly virtual candidate at a time. A later apparent entry
        # must never silently replace an older pending paper-exit reference.
        previous_virtual=self.db.get_runtime('virtual_candidate')
        if previous_virtual:
            try:
                active=json.loads(previous_virtual)
                if active.get('expiry_date')==now.date().isoformat():
                    self.db.set_runtime('last_processed_candle',stamp)
                    self.set_status('NO_TRADE','Existing virtual candidate awaiting exit review')
                    await self._deliver_outbox(now)
                    return
            except (ValueError,TypeError,AttributeError):
                # Fail closed: unparseable tracked candidate must not be overwritten.
                self.set_status('WAIT_DATA','Virtual candidate state malformed; no new alert')
                return
        side=decision.status[-2:]
        try:
            opt=select_option(self.instrument_rows,now.date(),side,decision.candle.close,avoid_expiry_day=True)
            raw=await asyncio.to_thread(kite.full_quote,opt.symbol)
            # Historical indicator evaluation belongs to the candle boundary,
            # but executable option depth must be fresh at the *response* time.
            # The REST fetch can take seconds: comparing this quote to the
            # earlier candle-poll clock wrongly accepts stale depth or rejects
            # valid newer exchange timestamps as future dated.
            observed_at=(datetime.now(IST) if self._live_delivery_clock.get() else now)
            if observed_at.date()!=now.date() or observed_at.time()>time(15,0):
                self.set_status('NO_TRADE','Option quote returned after entry cutoff')
                return
            oq=validate_quote(opt,raw,observed_at,max_age_seconds=15,max_spread_pct=2)
        except (ValueError,TypeError,KeyError):
            self.set_status('NO_TRADE','No liquid fresh executable option quote; skip alert')
            return
        except Exception:
            self.set_status('WAIT_DATA','Option quote fetch error; no alert')
            return
        # Informational review only; option premium stops are NOT implied by ATR.
        # Save candidate and outbox in the SAME SQLite transaction before sending
        # to Telegram; a crash cannot strand an alert without its exit reference.
        body=format_review(decision,oq)
        event_id=stamp+':'+decision.status
        candidate={
            'direction':side,'symbol':fut.symbol,'signal_candle':decision.candle.start.isoformat(),
            'entry':decision.candle.close,'stop':decision.stop_underlying,
            'target':decision.target_underlying,'expiry_date':now.date().isoformat(),
            # Link virtual position to delivery of the actual entry notification.
            # Queued/expired entry reviews must never generate misleading exits.
            'entry_event_id':event_id}
        if self.paper_premium_tracking:
            candidate['premium']=reference_from_quote(
                oq,futures_symbol=fut.symbol,signal_candle=decision.candle.start,
                created_at=observed_at,hypothesis=self.premium_hypothesis)
        # Record the actual observed ASK/BID alongside the paper candidate.
        # The quotation is not a fill, and its source is explicitly unverified.
        try:
            quote_snapshot=make_snapshot(event_id,'ENTRY',
                decision.candle.start+timedelta(minutes=5),observed_at,oq)
        except ValueError:
            self.set_status('WAIT_DATA','Quote evidence validation failed; no paper entry')
            return
        accepted=self.db.claim_entry_with_candidate(event_id,decision.status,observed_at,body,
                    json.dumps(candidate,separators=(',',':')),quote_snapshot=quote_snapshot)
        if not accepted:
            self.set_status('WAIT_DATA','Entry claim rejected: duplicate or existing paper position')
            return
        self.db.set_runtime('last_processed_candle',stamp)
        await self._deliver_outbox(now)
        if self.db.entry_notice_delivery_state(event_id)=='ACCEPTED':
            self.set_status(decision.status,'Paper review accepted in time by Telegram API')
        else:
            self.set_status('PHONE_DELIVERY_FAILED','Paper review queued, not confirmed delivered')

    async def poll_virtual_premium(self,now:datetime|None=None)->None:
        """Read-only paper BID watcher; live calls always sample response/send clocks.

        An explicitly supplied `now` is ONLY the deterministic offline-test seam.
        The unattended worker must call without a timestamp. No Kite orders.
        """
        live = now is None
        marker = self._live_delivery_clock.set(live)
        try:
            observed = (now or datetime.now(IST)).astimezone(IST)
            await self._poll_virtual_premium_at(observed, live=live)
        finally:
            self._live_delivery_clock.reset(marker)

    async def _poll_virtual_premium_at(self,now:datetime,*,live:bool)->None:
        if not self.paper_premium_tracking or not self.enabled:return
        raw=self.db.get_runtime('virtual_candidate')
        if not raw:
            self.premium_status='IDLE';return
        try:
            position=json.loads(raw)
            if not isinstance(position,dict):raise ValueError('invalid state')
        except (TypeError,ValueError):
            self.premium_status='INVALID_VIRTUAL_STATE'
            return
        if position.get('expiry_date')!=now.date().isoformat():
            self.db.set_runtime('virtual_candidate','')
            self.premium_status='EXPIRED_CANDIDATE_CLEARED'
            return
        # Clear yesterday's stale paper reference even on an exchange holiday.
        # Never query a broker or create virtual EXIT on a closed/unknown day.
        try:
            if not regular_session(now.date()):
                self.premium_status='EXCHANGE_CLOSED';return
        except CalendarUnavailable:
            self.premium_status='WAIT_CALENDAR';return
        if now.time()<time(9,30) or now.time()>=time(15,26):return
        entry_gate=self._entry_notice_gate(position)
        if entry_gate=='PENDING':
            self.premium_status='ENTRY_NOTICE_QUEUED'
            return
        if entry_gate=='EXPIRED':
            self.db.set_runtime('virtual_candidate','')
            self.premium_status='UNSENT_ENTRY_EXPIRED'
            return
        if entry_gate in ('INVALID','MISSING','LATE_ACCEPTED','UNVERIFIABLE'):
            self.premium_status='ENTRY_NOTICE_UNVERIFIABLE'
            return
        premium=position.get('premium')
        if not isinstance(premium,dict):
            self.premium_status='LEGACY_CANDIDATE_NO_PREMIUM'
            return
        reference=parse_reference(json.dumps(premium),now)
        if reference is None:
            self.premium_status='INVALID_PREMIUM_REFERENCE'
            return
        # Time-based exit review can be sent even when market quotes are missing;
        # the message explicitly says NO executable bid was observed.
        observed_at=now
        if now.time()>=time(15,15):
            reason='TIME'
            quote=None
        else:
            token=self.vault.get(now)
            if not token:
                self.premium_status='WAIT_TOKEN';return
            try:
                contract=reference_contract(reference)
                kite=KiteReadOnly(self.api_key,token)
                raw_quote=await asyncio.wait_for(
                    asyncio.to_thread(kite.full_quote,contract.symbol),timeout=8)
                # A captured 20-second polling-slot timestamp is NOT the moment
                # the quote returned. The option watcher must use fresh time,
                # just like the five-minute entry quote checker.
                observed_at=datetime.now(IST) if live else now
                if observed_at.date()!=now.date() or observed_at.time()>=time(15,26):
                    self.premium_status='SESSION_ENDED_DURING_QUOTE'
                    return
                if observed_at.time()>=time(15,15):
                    # Intraday time cutoff wins. A late quote is NOT executable
                    # evidence for a STOP/TARGET, and no fake EXIT bid is saved.
                    reason='TIME'
                    quote=None
                else:
                    quote=validate_quote(contract,raw_quote,observed_at,
                                         max_age_seconds=15,max_spread_pct=2)
                    reason=evaluate_bid(reference,quote,observed_at)
                    self.last_premium_quote_at=observed_at
            except (ValueError,TypeError,KeyError,asyncio.TimeoutError):
                self.premium_status='WAIT_FRESH_PREMIUM_QUOTE';return
            except Exception:
                self.premium_status='PREMIUM_QUOTE_UNAVAILABLE';return
        if reason=='HOLD':
            self.premium_status='MONITORING'
            return
        if quote is not None and isinstance(position.get('entry_event_id'),str):
            try:
                snapshot=make_snapshot(position['entry_event_id'],'EXIT',quote.updated,observed_at,quote)
                self.db.record_option_quote_observation(snapshot)
            except Exception:
                # Evidence failure is not proof of a fill or a reason to omit a
                # risk EXIT review; the offline report will show it as unpaired.
                self.premium_status='QUOTE_EVIDENCE_WRITE_FAILED'
        event_id='VIRTUAL_OPTION_EXIT:'+position['signal_candle']+':'+reason
        msg=exit_text(reference,reason,observed_at,quote)
        await self._send_event(event_id,'VIRTUAL_OPTION_EXIT_'+reason,observed_at,msg)
        # Durable claim occurs before clearing virtual candidate; on Telegram failure,
        # the pre-existing outbox can still retry until its short expiry.
        self.db.set_runtime('virtual_candidate','')
        self.premium_status='EXIT_REVIEW_'+reason

    async def _check_virtual_exit(self,candle,symbol:str,now:datetime)->None:
        raw=self.db.get_runtime('virtual_candidate')
        if not raw:return
        position=json.loads(raw)
        if position.get('symbol')!=symbol or position.get('expiry_date')!=now.date().isoformat():
            self.db.set_runtime('virtual_candidate','');return
        entry_gate=self._entry_notice_gate(position)
        if entry_gate=='PENDING':return
        if entry_gate=='EXPIRED':
            self.db.set_runtime('virtual_candidate','')
            return
        if entry_gate in ('INVALID','MISSING','LATE_ACCEPTED','UNVERIFIABLE'):
            self.set_status('WAIT_DATA','Virtual entry notification cannot be verified')
            return
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
        last_premium_poll_slot=None
        while True:
            now=datetime.now(IST)
            minute=now.replace(second=0,microsecond=0)
            # Market-candle collection gets FIRST priority. Backlogged phone
            # delivery or slow premium HTTP must not consume a fresh boundary.
            if scheduler.claim(now):
                await self.run_once()
            # Retry pending alerts every minute and expire stale ones. At most
            # two Telegram attempts per delivery pass so the worker remains
            # responsive to upcoming market-data boundaries.
            if minute!=last_outbox_minute:
                last_outbox_minute=minute
                if self.shadow is not None:
                    try:
                        await self.shadow.stop_after_session(datetime.now(IST))
                    except Exception:
                        logger.warning('Shadow socket after-hours cleanup failed')
                if self.enabled:
                    await self._deliver_outbox()
                else:
                    self.db.expire_events_before(datetime.now(IST)-timedelta(seconds=180))
            # Optional paper-BID monitoring is lower priority than the
            # authoritative five-minute candle and the durable Telegram queue.
            if self.paper_premium_tracking and self.enabled:
                observed=datetime.now(IST)
                slot=(observed.date().isoformat(),observed.hour,observed.minute,observed.second//20)
                if slot!=last_premium_poll_slot:
                    last_premium_poll_slot=slot
                    await self.poll_virtual_premium()
            await asyncio.sleep(2)
