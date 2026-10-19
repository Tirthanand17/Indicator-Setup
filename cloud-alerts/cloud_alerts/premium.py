"""Explicitly hypothetical option-premium observations, never real holdings.

Reference: the live ASK at the time an entry-review notification is created.
Monitoring: later fresh executable BID, not LTP. This is NOT an entry fill.
No Kite order/account methods exist here and no user holding is inferred.
"""
from __future__ import annotations
from dataclasses import dataclass
from datetime import date,datetime,time
from zoneinfo import ZoneInfo
import json,math,re
from .models import Contract,OptionQuote

IST=ZoneInfo('Asia/Kolkata')

@dataclass(frozen=True)
class PremiumHypothesis:
    """Unoptimized PAPER thresholds, deliberately opt-in in cloud runtime."""
    stop_fraction:float=0.20
    target_fraction:float=0.40
    def __post_init__(self):
        if (not math.isfinite(self.stop_fraction) or not math.isfinite(self.target_fraction)
                or not 0.05<=self.stop_fraction<=0.50
                or not 0.10<=self.target_fraction<=1.0):
            raise ValueError('premium thresholds outside research guardrails')


def reference_from_quote(quote:OptionQuote, *, futures_symbol:str, signal_candle:datetime,
                         created_at:datetime, hypothesis:PremiumHypothesis)->dict:
    c=quote.contract
    if c.kind not in ('CE','PE') or not c.symbol.startswith('NIFTY') or not c.expiry:
        raise ValueError('only eligible NIFTY CE/PE virtual candidates permitted')
    if signal_candle.tzinfo is None or created_at.tzinfo is None:
        raise ValueError('timezone required')
    if not 0 < quote.bid < quote.ask or quote.updated > created_at.replace(microsecond=999999):
        raise ValueError('invalid reference quote')
    if (created_at - quote.updated).total_seconds()>15:
        raise ValueError('reference quote stale')
    stop=round(quote.ask*(1-hypothesis.stop_fraction),2)
    target=round(quote.ask*(1+hypothesis.target_fraction),2)
    return {'version':2,'paper_only':True,'option_symbol':c.symbol,'option_token':c.token,
            'option_kind':c.kind,'option_expiry':c.expiry,'option_lot_size':c.lot_size,
            'futures_symbol':futures_symbol,'signal_candle':signal_candle.isoformat(),
            'created_at':created_at.isoformat(),'reference_ask':quote.ask,
            'stop_bid':stop,'target_bid':target}


def parse_reference(raw:str|None, now:datetime)->dict|None:
    if not raw:return None
    if now.tzinfo is None:raise ValueError('timezone required')
    try:
        r=json.loads(raw)
        if r.get('version')!=2 or r.get('paper_only') is not True:return None
        if (r.get('option_kind') not in ('CE','PE') or
            not re.fullmatch(r'NIFTY[A-Z0-9]{3,50}',r['option_symbol']) or
            not re.fullmatch(r'NIFTY[A-Z0-9]{3,50}',r['futures_symbol'])):
            return None
        if int(r['option_token'])<1 or int(r['option_lot_size'])<1:return None
        expiry=date.fromisoformat(r['option_expiry'])
        created=datetime.fromisoformat(r['created_at'])
        candle=datetime.fromisoformat(r['signal_candle'])
        if created.tzinfo is None or candle.tzinfo is None:return None
        # Candidate must have originated today and cannot survive overnight.
        if created.astimezone(IST).date()!=now.astimezone(IST).date():return None
        if created>now or expiry<now.astimezone(IST).date():return None
        a,s,t=map(float,(r['reference_ask'],r['stop_bid'],r['target_bid']))
        if not all(math.isfinite(x) for x in (a,s,t)) or not 0<s<a<t:return None
        # Configured levels cannot be arbitrary pathological values.
        if not 0.5 <= s/a <= 0.95 or not 1.10<=t/a<=2.0:return None
        return r
    except (TypeError,ValueError,KeyError,OverflowError,AttributeError):
        return None


def reference_contract(r:dict)->Contract:
    return Contract(token=int(r['option_token']),symbol=r['option_symbol'],
       expiry=r['option_expiry'],lot_size=int(r['option_lot_size']),kind=r['option_kind'])


def evaluate_bid(r:dict,q:OptionQuote,now:datetime)->str:
    """Return STOP, TARGET or HOLD. Must receive separately freshness-validated quote."""
    if q.contract.symbol!=r['option_symbol'] or q.contract.kind!=r['option_kind']:
        raise ValueError('option mismatch')
    if now.tzinfo is None or q.updated.tzinfo is None:raise ValueError('quote time missing')
    created=datetime.fromisoformat(r['created_at'])
    if q.updated<created:raise ValueError('quote predates signal reference')
    if q.bid<=float(r['stop_bid']):return 'STOP'
    if q.bid>=float(r['target_bid']):return 'TARGET'
    return 'HOLD'


def exit_text(r:dict,reason:str,now:datetime,quote:OptionQuote|None)->str:
    if reason not in ('STOP','TARGET','TIME'):raise ValueError('invalid virtual reason')
    when=now.astimezone(IST).strftime('%d %b %Y %H:%M:%S IST')
    # This is always explicitly a virtual reference; no actual option entry confirmed.
    lines=['NIFTY PAPER ALERT — VIRTUAL OPTION EXIT REVIEW ('+reason+')',
           'Review time: '+when,
           'Option reference: NFO:'+r['option_symbol']+' '+r['option_kind'],
           f"Reference entry ASK (NOT a fill): Rs {float(r['reference_ask']):.2f}",
           f"Hypothetical BID stop: Rs {float(r['stop_bid']):.2f} | target: Rs {float(r['target_bid']):.2f}"]
    if quote is not None:
        lines.append(f'Fresh quoted BID: Rs {quote.bid:.2f} | ASK: Rs {quote.ask:.2f}')
    else:
        lines.append('No executable option bid available. Time cutoff review only.')
    lines.extend(['This is NOT proof of an actual option holding, fill, stop execution or P&L.',
                  'NO ORDERS PLACED. Independently verify Kite holdings and current market depth.'])
    return '\n'.join(lines)
