"""Append-only causal paper signal evidence, never broker account information.

Keeps strategy/quote/portfolio gate outcomes without inventing missed P&L.
"""
from __future__ import annotations
from datetime import datetime,timezone
from pathlib import Path
from dataclasses import asdict,is_dataclass
import json,math,re,sqlite3

VALID_STAGES={'STRATEGY','QUOTE','ELIGIBILITY','PORTFOLIO_50K','PORTFOLIO_100K'}
VALID_OUTCOMES={'REVIEW_CE','REVIEW_PE','NO_TRADE','WAIT_DATA','REJECTED_LIQUIDITY',
                'POSITION_ALREADY_OPEN','REJECTED_RISK','SIMULATED_OPEN','ACCEPTED_SIGNAL'}


class SignalAudit:
    def __init__(self,path:str):
        self.path=str(path)
        Path(path).parent.mkdir(parents=True,exist_ok=True)
        with sqlite3.connect(self.path,timeout=10) as db:
            db.execute('''CREATE TABLE IF NOT EXISTS paper_signal_evaluations (
                future_symbol TEXT NOT NULL,candle_start_utc TEXT NOT NULL,
                observed_at_utc TEXT NOT NULL,stage TEXT NOT NULL,outcome TEXT NOT NULL,
                reason_code TEXT NOT NULL,option_symbol TEXT NOT NULL,
                indicators_json TEXT NOT NULL,
                PRIMARY KEY(future_symbol,candle_start_utc,observed_at_utc,stage))''')
            db.execute('CREATE INDEX IF NOT EXISTS ix_paper_signal_clock ON paper_signal_evaluations(observed_at_utc)')

    def record(self,future_symbol:str,candle_start:datetime,observed_at:datetime,
               stage:str,outcome:str,reason_code:str,*,option_symbol:str='',indicators=None)->bool:
        if not isinstance(future_symbol,str) or not re.fullmatch(r'NIFTY[A-Z0-9]{3,50}',future_symbol):
            raise ValueError('invalid futures contract for paper evidence')
        if not (isinstance(candle_start,datetime) and candle_start.tzinfo is not None
                and candle_start.utcoffset() is not None and isinstance(observed_at,datetime)
                and observed_at.tzinfo is not None and observed_at.utcoffset() is not None):
            raise ValueError('clock must include exchange timezone')
        if not 0 <= (observed_at-candle_start).total_seconds() <= 600:
            raise ValueError('signal not causally tied to recent candle')
        if stage not in VALID_STAGES or outcome not in VALID_OUTCOMES:
            raise ValueError('unknown strategy gate or outcome')
        if not isinstance(reason_code,str) or not re.fullmatch(r'[A-Z0-9_]{3,80}',reason_code):
            raise ValueError('only sanitized reason codes allowed')
        if option_symbol and not re.fullmatch(r'NIFTY[A-Z0-9]{3,50}(?:CE|PE)',option_symbol):
            raise ValueError('invalid observed option identity')
        if indicators is None:
            levels={}
        elif is_dataclass(indicators):
            levels=asdict(indicators)
        elif isinstance(indicators,dict):
            levels=indicators
        else:
            raise ValueError('invalid indicator observation')
        permitted={'vwap','ema9','ema21','plus_di','minus_di','adx','previous_adx','atr'}
        if (set(levels)-permitted or any(type(x) not in (float,int) or not math.isfinite(x)
                                       for x in levels.values())):
            raise ValueError('invalid indicator values')
        encoded=json.dumps(levels,sort_keys=True,allow_nan=False,separators=(',',':'))
        values=(future_symbol,candle_start.astimezone(timezone.utc).isoformat(),
                observed_at.astimezone(timezone.utc).isoformat(),stage,outcome,
                reason_code,option_symbol,encoded)
        with sqlite3.connect(self.path,timeout=10) as db:
            result=db.execute('INSERT OR IGNORE INTO paper_signal_evaluations VALUES(?,?,?,?,?,?,?,?)',values)
            if result.rowcount==0:
                old=db.execute('SELECT outcome,reason_code,option_symbol,indicators_json FROM paper_signal_evaluations WHERE future_symbol=? AND candle_start_utc=? AND observed_at_utc=? AND stage=?',values[:4]).fetchone()
                if old!=values[4:]:
                    raise ValueError('conflicting same-clock strategy evidence')
            return result.rowcount==1

    def recent(self,limit:int=100)->list[dict]:
        if type(limit) is not int or not 1<=limit<=200:
            raise ValueError('invalid audit page limit')
        with sqlite3.connect(self.path,timeout=10) as db:
            rows=db.execute('SELECT future_symbol,candle_start_utc,observed_at_utc,stage,outcome,reason_code,option_symbol,indicators_json FROM paper_signal_evaluations ORDER BY observed_at_utc DESC,stage DESC LIMIT ?',(limit,)).fetchall()
        return [dict(future_symbol=r[0],candle_start_utc=r[1],observed_at_utc=r[2],
                     stage=r[3],outcome=r[4],reason_code=r[5],option_symbol=r[6],
                     indicators=json.loads(r[7])) for r in rows]

    def summary(self)->dict:
        with sqlite3.connect(self.path,timeout=10) as db:
            rows=db.execute('SELECT stage,outcome,COUNT(*) FROM paper_signal_evaluations GROUP BY stage,outcome').fetchall()
        counts={f'{stage}:{outcome}':count for stage,outcome,count in rows}
        return {'observations':sum(counts.values()),'counts':counts,
                'strategy_qualified':sum(n for stage,outcome,n in rows if stage=='STRATEGY' and outcome in ('REVIEW_CE','REVIEW_PE')),
                'risk_rejected':sum(n for stage,outcome,n in rows if stage.startswith('PORTFOLIO_') and outcome=='REJECTED_RISK'),
                'liquidity_rejected':sum(n for stage,outcome,n in rows if stage=='QUOTE' and outcome=='REJECTED_LIQUIDITY'),
                'missed_pnl_verifiable':False,'actual_orders':False}
