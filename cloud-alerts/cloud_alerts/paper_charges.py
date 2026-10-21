"""Versioned NSE option BUY/SELL charge estimates; not verified Kite fills.

The fee schedule is a dated MODEL, not a broker contract note. Excludes
option exercise/assignment, settlement, platform fees and partial fills.
"""
from __future__ import annotations
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from datetime import date

POLICY='ZERODHA_NSE_OPTIONS_2026_04_V1'
EFFECTIVE_FROM=date(2026,4,1)
PAISE=Decimal('0.01')
EXCHANGE_RATE=Decimal('0.0003553')  # NSE 0.03553% premium turnover
SEBI_RATE=Decimal('0.000001')       # Rs 10 per crore
STAMP_BUY_RATE=Decimal('0.00003')   # 0.003% BUY only
STT_SELL_RATE=Decimal('0.0015')    # 0.15% SELL from April 2026
GST_RATE=Decimal('0.18')
BROKERAGE_RS=Decimal('20')          # Flat Rs 20 per executed option order


def _paise(value: Decimal)->int:
    return int((value/PAISE).quantize(Decimal('1'),rounding=ROUND_HALF_UP))


@dataclass(frozen=True)
class EstimatedLeg:
    policy: str
    side: str
    qty: int
    notional_paise: int
    brokerage_paise: int
    exchange_paise: int
    sebi_paise: int
    gst_paise: int
    stamp_paise: int
    stt_paise: int
    total_paise: int
    audited: bool=False


def estimate_nse_option_leg(unit_price:object,qty:int,side:str,*,on_date:date|None=None)->EstimatedLeg:
    """Estimate per-order fees and taxes in integer paise.

    The entry/exit price must be causal; an estimate is not evidence of a
    broker execution, and any future tariff revisions need a new policy.
    """
    if side not in ('BUY','SELL') or type(qty) is not int or not 1<=qty<=100000:
        raise ValueError('invalid NSE option fee input')
    if on_date is not None and (type(on_date) is not date or on_date < EFFECTIVE_FROM):
        raise ValueError('fee policy not applicable to this date')
    try:
        unit=Decimal(str(unit_price))
        if not unit.is_finite() or not 0<unit<=Decimal('10000000'):
            raise ValueError('invalid simulated unit premium')
    except (TypeError,ArithmeticError):
        raise ValueError('invalid simulated unit premium') from None
    value=unit*qty
    brokerage=BROKERAGE_RS
    exchange=value*EXCHANGE_RATE
    sebi=value*SEBI_RATE
    gst=(brokerage+exchange+sebi)*GST_RATE
    stamp=value*STAMP_BUY_RATE if side=='BUY' else Decimal(0)
    # Zerodha's published STT methodology rounds to nearest full rupee.
    stt=(value*STT_SELL_RATE).quantize(Decimal('1'),rounding=ROUND_HALF_UP) if side=='SELL' else Decimal(0)
    bp,ep,sp,gp,stamp_p,stt_p=(_paise(x) for x in (brokerage,exchange,sebi,gst,stamp,stt))
    return EstimatedLeg(POLICY,side,qty,_paise(value),bp,ep,sp,gp,stamp_p,stt_p,
                        bp+ep+sp+gp+stamp_p+stt_p)
