"""Pure-paper NIFTY option accounts. No broker execution/network imports.

Two portfolios are independent counterfactuals, NOT orders sent for aggregated depth.
This module owns durable paper cash/position records; notification integration is separate.
"""
from __future__ import annotations

from datetime import datetime, time
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
import math
import sqlite3
from zoneinfo import ZoneInfo

IST = ZoneInfo('Asia/Kolkata')
PAISE = Decimal('0.01')
DEFAULT_CAPITALS = {'PAPER_50K': 50000, 'PAPER_100K': 100000}


def money(value: object) -> int:
    """Convert positive finite rupees to exact integer paise, never float storage."""
    try:
        d = Decimal(str(value))
        if not d.is_finite() or d < 0:
            raise ValueError('invalid money')
        result = int((d / PAISE).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
        if result > 10**14:
            raise ValueError('money outside policy')
        return result
    except (ArithmeticError, TypeError):
        raise ValueError('invalid money') from None


def rupees(paise: int) -> float:
    return float((Decimal(paise) / 100).quantize(PAISE))


class PaperBook:
    """Standalone paper-only accounting over the EXISTING durable SQLite file.

    This module does not send Telegram notifications or execute broker trades.
    Activation in the market engine is separately gated and requires testing.
    """
    def __init__(self, path: str, capitals: dict[str, int] | None = None):
        self.path = str(path)
        amounts = capitals if capitals is not None else DEFAULT_CAPITALS
        if not amounts or any(not key.startswith('PAPER_') or type(value) is not int
                              or not 3000 <= value <= 1000000 for key, value in amounts.items()):
            raise ValueError('invalid paper portfolios')
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self._db() as db:
            db.executescript('''CREATE TABLE IF NOT EXISTS paper_accounts (
              account_id TEXT PRIMARY KEY, initial_paise INTEGER NOT NULL,
              cash_paise INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT 'SIMULATOR');
              CREATE TABLE IF NOT EXISTS paper_positions (
              trade_id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES paper_accounts(account_id),
              signal_id TEXT NOT NULL, option_symbol TEXT NOT NULL, option_kind TEXT NOT NULL,
              option_expiry TEXT NOT NULL, option_token INTEGER NOT NULL, lot_size INTEGER NOT NULL, lots INTEGER NOT NULL,
              entry_at TEXT NOT NULL, entry_quote_at TEXT NOT NULL,
              entry_ask_paise INTEGER NOT NULL, entry_fill_paise INTEGER NOT NULL,
              entry_debit_paise INTEGER NOT NULL, entry_fee_paise INTEGER NOT NULL,
              exit_fee_assumed_paise INTEGER NOT NULL, slippage_bps INTEGER NOT NULL,
              stop_bid_paise INTEGER NOT NULL, target_bid_paise INTEGER NOT NULL,
              status TEXT NOT NULL CHECK(status IN ('OPEN','CLOSED','EXIT_UNVERIFIABLE')),
              exit_at TEXT, exit_quote_at TEXT, exit_bid_paise INTEGER,
              exit_fill_paise INTEGER, exit_credit_paise INTEGER, exit_fee_paise INTEGER,
              exit_reason TEXT, net_pnl_paise INTEGER,
              UNIQUE(account_id,signal_id));
              CREATE UNIQUE INDEX IF NOT EXISTS paper_one_open_per_account
              ON paper_positions(account_id) WHERE status IN ('OPEN','EXIT_UNVERIFIABLE');
              CREATE TABLE IF NOT EXISTS paper_rejections (
              account_id TEXT NOT NULL, signal_id TEXT NOT NULL, at TEXT NOT NULL,
              reason TEXT NOT NULL, PRIMARY KEY(account_id,signal_id));''')
            for name, amount in amounts.items():
                db.execute('INSERT OR IGNORE INTO paper_accounts(account_id,initial_paise,cash_paise) '
                           'VALUES(?,?,?)', (name, money(amount), money(amount)))
            # Never silently overwrite existing balances or reset positions on restart.
            for name, amount in amounts.items():
                row = db.execute('SELECT initial_paise FROM paper_accounts WHERE account_id=?', (name,)).fetchone()
                if row is None or row[0] != money(amount):
                    raise RuntimeError('Paper account capitalization mismatch; preserve existing journal')

    def _db(self):
        db=sqlite3.connect(self.path, timeout=10)
        db.execute('PRAGMA foreign_keys=ON')
        return db

    @staticmethod
    def _queue_telegram(db, event_id: str, status: str, now: datetime, message: str) -> None:
        """Share the existing State.events outbox transaction, if it exists.

        Fresh standalone ledgers need not create the alert subsystem's schema;
        the cloud server always creates State first. The SQLite write stays
        atomic with the position and cash mutation; no network under lock.
        """
        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='events'").fetchone():
            db.execute('INSERT OR IGNORE INTO events(event_id,status,at,payload) VALUES(?,?,?,?)',
                       (event_id,status,now.isoformat(),message))

    @staticmethod
    def _market_time(now: datetime, *, entry: bool) -> None:
        if not isinstance(now,datetime) or now.tzinfo is None or now.utcoffset() is None:
            raise ValueError('aware IST clock required')
        local = now.astimezone(IST)
        if local.weekday()>=5 or not (time(9,30) <= local.time() < (time(15,0) if entry else time(15,26))):
            raise ValueError('outside permitted paper-trading time')

    @staticmethod
    def _quote(quote, now: datetime):
        if (quote.contract.kind not in ('CE','PE') or
            not quote.contract.symbol.startswith('NIFTY') or
            not quote.contract.symbol.endswith(quote.contract.kind) or
            quote.contract.lot_size < 1 or quote.contract.token < 1 or not quote.contract.expiry):
            raise ValueError('invalid listed NIFTY option contract')
        if quote.updated.tzinfo is None or quote.updated.utcoffset() is None:
            raise ValueError('option exchange time missing')
        age = (now - quote.updated).total_seconds()
        if age < -3 or age > 15 or quote.updated.astimezone(IST).date()!=now.astimezone(IST).date():
            raise ValueError('stale option quote')
        if not all(math.isfinite(v) and v > 0 for v in (quote.bid, quote.ask)):
            raise ValueError('invalid quote price')
        if not quote.ask > quote.bid or (quote.ask-quote.bid)/(quote.ask+quote.bid)*200 > 2:
            raise ValueError('quote spread invalid')
        if (type(quote.bid_quantity) is not int or type(quote.ask_quantity) is not int or
            min(quote.bid_quantity, quote.ask_quantity) < quote.contract.lot_size):
            raise ValueError('insufficient top-of-book quantity')
        if datetime.fromisoformat(str(quote.contract.expiry)).date() < now.astimezone(IST).date():
            raise ValueError('option contract expired')

    def enter(self, signal_id: str, quote, now: datetime, *, account_id: str,
              slippage_bps: int = 8, roundtrip_fee_rs: int = 50,
              stop_fraction: float = 0.20, target_fraction: float = 0.40) -> dict:
        """Buy hypothetical whole lots at ASK plus adverse slippage.

        Risk <=3% initial capital, exposure <=30%, daily realized loss <=6%.
        Requires separately verified input quote; this is not an actual fill.
        """
        self._market_time(now,entry=True)
        self._quote(quote,now)
        if (not isinstance(signal_id,str) or not 8 <= len(signal_id) <= 220 or
            not all(ch.isalnum() or ch in ':._+-' for ch in signal_id)):
            raise ValueError('invalid signal identifier')
        if (type(slippage_bps) is not int or not 0 <= slippage_bps <= 100 or
            type(roundtrip_fee_rs) is not int or not 1 <= roundtrip_fee_rs <= 1000 or
            not 0.05 <= stop_fraction <= 0.50 or not 0.10 <= target_fraction <= 1):
            raise ValueError('invalid paper execution assumptions')
        c=quote.contract
        reference=money(quote.ask)
        fill=money(Decimal(str(quote.ask)) * (1 + Decimal(slippage_bps)/10000))
        stop=money(Decimal(str(quote.ask)) * (1 - Decimal(str(stop_fraction))))
        target=money(Decimal(str(quote.ask)) * (1 + Decimal(str(target_fraction))))
        entry_fee=money(Decimal(roundtrip_fee_rs)/2)
        exit_fee=money(roundtrip_fee_rs)-entry_fee
        per_lot=c.lot_size*fill
        risk_per_lot=c.lot_size*(fill-stop)
        qty_limit=quote.ask_quantity//c.lot_size
        with self._db() as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute('SELECT initial_paise,cash_paise FROM paper_accounts WHERE account_id=?',
                           (account_id,)).fetchone()
            if row is None:raise ValueError('unknown paper account')
            initial,cash=row
            old=db.execute('SELECT trade_id,status FROM paper_positions WHERE account_id=? AND signal_id=?',
                           (account_id,signal_id)).fetchone()
            if old:return {'status':'DUPLICATE','trade_id':old[0],'account_id':account_id}
            rejection=db.execute('SELECT reason FROM paper_rejections WHERE account_id=? AND signal_id=?',
                                 (account_id,signal_id)).fetchone()
            if rejection:return {'status':'REJECTED','reason':rejection[0],'account_id':account_id}
            active=db.execute("SELECT 1 FROM paper_positions WHERE account_id=? AND status!='CLOSED'",
                              (account_id,)).fetchone()
            same_day=db.execute('SELECT COUNT(*) FROM paper_positions WHERE account_id=? '
                                'AND substr(entry_at,1,10)=?',(account_id,now.astimezone(IST).date().isoformat())).fetchone()[0]
            daily_loss=db.execute('SELECT COALESCE(SUM(net_pnl_paise),0) FROM paper_positions '
                                  "WHERE account_id=? AND status='CLOSED' AND substr(exit_at,1,10)=? AND net_pnl_paise<0",
                                  (account_id,now.astimezone(IST).date().isoformat())).fetchone()[0]
            max_lots=min(qty_limit,
                         (cash-entry_fee)//per_lot,
                         (initial*30//100-entry_fee)//per_lot,
                         (initial*3//100-entry_fee-exit_fee)//risk_per_lot)
            reason=('POSITION_ALREADY_OPEN' if active else
                    'MAX_TRADES_PER_DAY' if same_day>=3 else
                    'DAILY_LOSS_LIMIT' if -daily_loss >= initial*6//100 else
                    'INSUFFICIENT_PAPER_CAPITAL_OR_DEPTH' if max_lots<1 else '')
            if reason:
                db.execute('INSERT OR IGNORE INTO paper_rejections VALUES(?,?,?,?)',
                           (account_id,signal_id,now.astimezone(IST).isoformat(),reason))
                return {'status':'REJECTED','reason':reason,'account_id':account_id}
            lots=min(max_lots, 3)
            debit=per_lot*lots+entry_fee
            trade_id=account_id+':'+signal_id
            db.execute('UPDATE paper_accounts SET cash_paise=cash_paise-? WHERE account_id=? AND cash_paise>=?',
                       (debit,account_id,debit))
            db.execute('INSERT INTO paper_positions('
                       'trade_id,account_id,signal_id,option_symbol,option_kind,option_expiry,option_token,lot_size,lots,'
                       'entry_at,entry_quote_at,entry_ask_paise,entry_fill_paise,entry_debit_paise,entry_fee_paise,'
                       'exit_fee_assumed_paise,slippage_bps,stop_bid_paise,target_bid_paise,status) '
                       'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                       (trade_id,account_id,signal_id,c.symbol,c.kind,c.expiry,c.token,c.lot_size,lots,
                        now.astimezone(IST).isoformat(),quote.updated.astimezone(IST).isoformat(),reference,
                        fill,debit,entry_fee,exit_fee,slippage_bps,stop,target,'OPEN'))
            self._queue_telegram(db,'PAPER_ENTRY:'+trade_id,'PAPER_ENTRY',now,
                f'NIFTY PAPER BUY {c.kind} — SIMULATED ONLY\n'
                f'Account: {account_id} | Trade: {trade_id}\n'
                f'Option: {c.symbol} | Lots: {lots} | Units: {lots*c.lot_size}\n'
                f'ASK Rs {rupees(reference):.2f} | Simulated entry Rs {rupees(fill):.2f}\n'
                f'Cash debited Rs {rupees(debit):.2f} including modeled entry fees.\n'
                'No real order placed. Model assumptions and slippage apply.')
            return {'status':'OPEN','trade_id':trade_id,'account_id':account_id,'lots':lots,
                    'quantity':lots*c.lot_size,'entry_reference_rs':rupees(reference),
                    'simulated_fill_rs':rupees(fill),'debit_rs':rupees(debit),
                    'stop_bid_rs':rupees(stop),'target_bid_rs':rupees(target),
                    'available_cash_rs':rupees(cash-debit), 'paper_only':True}

    def exit(self,trade_id:str,quote,now:datetime)->dict:
        """Close only on fresh executable BID; no quote => no invented cash."""
        self._market_time(now,entry=False)
        self._quote(quote,now)
        with self._db() as db:
            db.execute('BEGIN IMMEDIATE')
            db.row_factory=sqlite3.Row
            old=db.execute('SELECT * FROM paper_positions WHERE trade_id=?',(trade_id,)).fetchone()
            if old is None:raise ValueError('unknown paper position')
            if old['status']=='CLOSED':return {'status':'DUPLICATE','trade_id':trade_id}
            if old['status']=='EXIT_UNVERIFIABLE':
                return {'status':'UNVERIFIABLE','trade_id':trade_id}
            if old['option_symbol']!=quote.contract.symbol or old['option_kind']!=quote.contract.kind:
                raise ValueError('option mismatch')
            if old['option_expiry']!=quote.contract.expiry or old['lot_size']!=quote.contract.lot_size or old['option_token']!=quote.contract.token:
                raise ValueError('lot/expiry mismatch')
            if now.astimezone(IST).isoformat()<=old['entry_at'] or quote.updated.astimezone(IST).isoformat()<old['entry_quote_at']:
                raise ValueError('noncausal option exit')
            qty=old['lots']*old['lot_size']
            if quote.bid_quantity < qty:
                return {'status':'WAIT_DEPTH','trade_id':trade_id}
            bid=money(quote.bid)
            reason=('TIME' if now.astimezone(IST).time()>=time(15,15) else
                    'STOP' if bid<=old['stop_bid_paise'] else
                    'TARGET' if bid>=old['target_bid_paise'] else 'HOLD')
            if reason=='HOLD':return {'status':'HOLD','trade_id':trade_id}
            fill=money(Decimal(str(quote.bid)) * (1-Decimal(old['slippage_bps'])/10000))
            fee=old['exit_fee_assumed_paise']
            credit=qty*fill-fee
            if credit<0:return {'status':'WAIT_VALUE','trade_id':trade_id}
            pnl=credit-old['entry_debit_paise']
            db.execute("UPDATE paper_positions SET status='CLOSED', exit_at=?, exit_quote_at=?,"
                       'exit_bid_paise=?,exit_fill_paise=?,exit_credit_paise=?,exit_fee_paise=?, '
                       'exit_reason=?,net_pnl_paise=? WHERE trade_id=? AND status!=?',
                       (now.astimezone(IST).isoformat(),quote.updated.astimezone(IST).isoformat(),bid,
                        fill,credit,fee,reason,pnl,trade_id,'CLOSED'))
            db.execute('UPDATE paper_accounts SET cash_paise=cash_paise+? WHERE account_id=?',
                       (credit,old['account_id']))
            self._queue_telegram(db,'PAPER_EXIT:'+trade_id,'PAPER_EXIT',now,
                f'NIFTY PAPER EXIT ({reason}) — SIMULATED ONLY\n'
                f'Account: {old["account_id"]} | Trade: {trade_id}\n'
                f'Option: {old["option_symbol"]} | BID Rs {rupees(bid):.2f}\n'
                f'Net modeled P&L Rs {rupees(pnl):.2f} after slippage/fees.\n'
                'No real order placed. Not an exchange-confirmed fill.')
            return {'status':'CLOSED','trade_id':trade_id,'reason':reason,
                    'exit_reference_rs':rupees(bid),'simulated_exit_fill_rs':rupees(fill),
                    'net_pnl_rs':rupees(pnl),'paper_only':True}

    def open_positions(self)->list[dict]:
        with self._db() as db:
            db.row_factory=sqlite3.Row
            return [dict(r) for r in db.execute("SELECT * FROM paper_positions WHERE status='OPEN' ORDER BY entry_at")]

    def dashboard(self)->dict:
        with self._db() as db:
            db.row_factory=sqlite3.Row
            accounts=[]
            for a in db.execute('SELECT * FROM paper_accounts ORDER BY initial_paise'):
                positions=db.execute('SELECT COUNT(*) FROM paper_positions WHERE account_id=? AND status!=?',
                                     (a['account_id'],'CLOSED')).fetchone()[0]
                closed=db.execute('SELECT COUNT(*),COALESCE(SUM(net_pnl_paise),0),'
                                  'SUM(CASE WHEN net_pnl_paise>0 THEN 1 ELSE 0 END) '
                                  'FROM paper_positions WHERE account_id=? AND status=?',
                                  (a['account_id'],'CLOSED')).fetchone()
                accounts.append({'id':a['account_id'],'initial_rs':rupees(a['initial_paise']),
                                 'available_cash_rs':rupees(a['cash_paise']),
                                 'realized_pnl_rs':rupees(closed[1]),'closed_trades':closed[0],
                                 'wins':closed[2] or 0,'open_positions':positions,
                                 'equity_rs':rupees(a['cash_paise']) if positions==0 else None})
            return {'mode':'PAPER_ONLY','actual_orders':False,'source':'UNVERIFIED_QUOTE_SIMULATION',
                    'accounts':accounts}

    def trade_history(self, *, limit: int = 100) -> list[dict]:
        """Dashboard-safe, strictly read-only immutable trade/event fields."""
        if type(limit) is not int or not 1 <= limit <= 200:
            raise ValueError('invalid history limit')
        with self._db() as db:
            db.row_factory=sqlite3.Row
            rows=db.execute('SELECT trade_id,account_id,signal_id,option_symbol,option_kind,'
                            'option_expiry,option_token,lot_size,lots,entry_at,entry_quote_at,'
                            'entry_ask_paise,entry_fill_paise,entry_debit_paise,entry_fee_paise,'
                            'exit_at,exit_quote_at,exit_bid_paise,exit_fill_paise,exit_credit_paise,'
                            'exit_fee_paise,exit_reason,net_pnl_paise,status FROM paper_positions '
                            'ORDER BY entry_at DESC,trade_id DESC LIMIT ?', (limit,)).fetchall()
        result=[]
        for r in rows:
            row=dict(r)
            for name in tuple(row):
                if name.endswith('_paise'):
                    row[name.removesuffix('_paise')+'_rs'] = (rupees(row.pop(name)) if row[name] is not None else None)
            row['paper_only']=True
            row['actual_fill_verified']=False
            result.append(row)
        return result

    def finish_session(self, now: datetime) -> int:
        """Mark unclosed option positions unverifiable after 15:26 IST.

        No fictional exit price, cash release or win/loss is recorded.
        Unresolved accounts remain blocked by their risk gate until reconciled.
        """
        if now.tzinfo is None or now.utcoffset() is None or now.astimezone(IST).time()<time(15,26):
            raise ValueError('session not completed')
        cutoff=now.astimezone(IST).date().isoformat()
        with self._db() as db:
            db.execute('BEGIN IMMEDIATE')
            cur=db.execute("UPDATE paper_positions SET status='EXIT_UNVERIFIABLE', "
                           "exit_reason='NO_EXECUTABLE_BID_AT_SESSION_END' "
                           "WHERE status='OPEN' AND substr(entry_at,1,10)<=?",(cutoff,))
            return cur.rowcount

    def daily_report(self, now: datetime) -> dict:
        """Read-only actual-observation count; no performance verification claim."""
        if now.tzinfo is None or now.utcoffset() is None:
            raise ValueError('timezone needed')
        day=now.astimezone(IST).date().isoformat()
        with self._db() as db:
            accounts=[]
            for a in db.execute('SELECT account_id,initial_paise,cash_paise FROM paper_accounts ORDER BY initial_paise'):
                name,initial,cash=a
                closed=db.execute("SELECT COUNT(*),COALESCE(SUM(net_pnl_paise),0),"
                                  "SUM(CASE WHEN net_pnl_paise>0 THEN 1 ELSE 0 END) "
                                  "FROM paper_positions WHERE account_id=? AND status='CLOSED' "
                                  "AND substr(exit_at,1,10)=?",(name,day)).fetchone()
                unresolved=db.execute("SELECT COUNT(*) FROM paper_positions WHERE account_id=? "
                                      "AND status!='CLOSED'",(name,)).fetchone()[0]
                rejected=db.execute('SELECT COUNT(*) FROM paper_rejections WHERE account_id=? AND substr(at,1,10)=?',
                                    (name,day)).fetchone()[0]
                accounts.append({'id':name,'initial_rs':rupees(initial),'cash_rs':rupees(cash),
                                 'closed':closed[0],'wins':closed[2] or 0,
                                 'net_realized_rs':rupees(closed[1]),'unresolved':unresolved,
                                 'rejected_signals':rejected})
            return {'day':day,'accounts':accounts,'mode':'PAPER_ONLY',
                    'actual_fills_verified':False,'unresolved_not_counted_as_loss_or_win':True}
