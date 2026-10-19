"""Dynamic current-month NIFTY FUT and nearest listed NIFTY CE/PE discovery."""
from __future__ import annotations
from datetime import date,datetime
from zoneinfo import ZoneInfo
import math
from .models import Contract,OptionQuote
IST = ZoneInfo("Asia/Kolkata")


def date_value(value):
    if isinstance(value,datetime):return value.date()
    if isinstance(value,date):return value
    return date.fromisoformat(str(value)[:10])


def select_future(instruments: list[dict],today:date)->Contract:
    eligible=[r for r in instruments if r.get('name')=='NIFTY' and r.get('segment')=='NFO-FUT'
      and r.get('instrument_type')=='FUT' and date_value(r.get('expiry'))>=today]
    if not eligible:raise ValueError('no current NIFTY futures contract')
    row=min(eligible,key=lambda r:date_value(r['expiry']))
    return Contract(int(row['instrument_token']),str(row['tradingsymbol']),str(date_value(row['expiry'])),int(row['lot_size']))


def select_option(instruments:list[dict],today:date,side:str,underlying:float,avoid_expiry_day:bool=True)->Contract:
    if side not in ('CE','PE'):raise ValueError('invalid option side')
    eligible=[r for r in instruments if r.get('name')=='NIFTY' and r.get('segment')=='NFO-OPT'
      and r.get('instrument_type')==side and date_value(r['expiry'])>=today
      and (not avoid_expiry_day or date_value(r['expiry'])>today)]
    if not eligible:raise ValueError('no eligible NIFTY option available')
    target_exp=min(date_value(r['expiry']) for r in eligible)
    same=[r for r in eligible if date_value(r['expiry'])==target_exp and float(r['strike'])>0]
    if not same:raise ValueError('no nonzero strike')
    row=min(same,key=lambda r:(abs(float(r['strike'])-underlying),float(r['strike'])))
    return Contract(int(row['instrument_token']),str(row['tradingsymbol']),str(target_exp),int(row['lot_size']),float(row['strike']),side)


def validate_quote(contract:Contract,quote:dict,now:datetime,max_age_seconds:int=15,max_spread_pct:float=2.0)->OptionQuote:
    """Reject corrupt/mismatched quotes before they reach phone or P&L logic.

    Kite exchange timestamps without explicit offsets are interpreted in IST,
    independently of the worker clock's timezone. Optional instrument_token
    metadata must agree with the selected option contract when provided.
    """
    if not isinstance(now,datetime) or now.tzinfo is None or now.utcoffset() is None:
        raise ValueError('aware validation clock required')
    if not isinstance(quote,dict):
        raise ValueError('option quote malformed')
    if 'instrument_token' in quote and (isinstance(quote['instrument_token'],bool)
             or str(quote['instrument_token'])!=str(contract.token)):
        raise ValueError('option quote instrument mismatch')
    depths=quote.get('depth') or {};bids=depths.get('buy') or [];asks=depths.get('sell') or []
    if not bids or not asks:raise ValueError('quote missing bid/ask depth')
    bid,ask=bids[0],asks[0]
    bp,ap=float(bid.get('price',0)),float(ask.get('price',0))
    bq,aq=int(bid.get('quantity',0)),int(ask.get('quantity',0))
    if not math.isfinite(bp) or not math.isfinite(ap):
        raise ValueError('nonfinite option bid/ask')
    if bp<=0 or ap<=bp or bq<contract.lot_size or aq<contract.lot_size:
        raise ValueError('unexecutable or insufficient top-of-book')
    spread=100*(ap-bp)/((ap+bp)/2)
    if not math.isfinite(spread) or spread>max_spread_pct:
        raise ValueError('option spread too wide')
    raw_ts=quote.get('timestamp')
    if not raw_ts:raise ValueError('option exchange quote timestamp missing')
    updated=raw_ts if isinstance(raw_ts,datetime) else datetime.fromisoformat(str(raw_ts))
    if updated.tzinfo is None:
        updated=updated.replace(tzinfo=IST)
    age=(now-updated).total_seconds()
    if age< -3 or age>max_age_seconds:raise ValueError('option quote stale or future dated')
    return OptionQuote(contract,bp,ap,bq,aq,updated)
