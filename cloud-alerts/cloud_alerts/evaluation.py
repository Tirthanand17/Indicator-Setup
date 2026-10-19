"""After-cost option paper-evidence scorer; refuses to manufacture a win rate.

Consumes independently timestamped, paired quote observations, NOT signal-only
rows or assumed fills. A synthetic unit fixture proves arithmetic, not strategy
profitability. Historical Kite 5m OHLC alone cannot reconstruct option BID/ASK.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, date, time
from zoneinfo import ZoneInfo
import math
import re

IST=ZoneInfo('Asia/Kolkata')


class EvidenceError(ValueError):
    """A paper trade's inputs cannot support a defensible P&L estimate."""


@dataclass(frozen=True)
class PaperQuotePair:
    event_id: str
    option_symbol: str
    option_expiry: date
    direction: str
    signal_entry_at: datetime
    quote_entry_at: datetime
    entry_bid: float
    entry_ask: float
    entry_ask_qty: int
    signal_exit_at: datetime
    quote_exit_at: datetime
    exit_bid: float
    exit_ask: float
    exit_bid_qty: int
    lot_size: int
    lots: int
    # Metadata only. Real provenance also requires independent Kite capture logs.
    source: str = 'UNVERIFIED'


@dataclass(frozen=True)
class Costs:
    """Research assumptions: fees/taxes are caller-supplied per round trip."""
    slippage_bps: float
    roundtrip_charges_rs: float

    def __post_init__(self):
        if (not math.isfinite(self.slippage_bps) or not 0<=self.slippage_bps<=100
                or not math.isfinite(self.roundtrip_charges_rs)
                or self.roundtrip_charges_rs<=0):
            raise EvidenceError('Specify plausible nonzero roundtrip charges and bounded slippage')


def score_pair(p: PaperQuotePair, costs: Costs, *, max_delay_seconds: int = 20,
               max_spread_pct: float = 2.0) -> dict:
    """Conservative taker quotes: enter at ASK, exit at BID, add slippage + fees.

    The resulting hypothetical P&L is *not* evidence of a Kite execution.
    """
    if not re.fullmatch(r'[A-Za-z0-9:+_.-]{8,220}',p.event_id):
        raise EvidenceError('invalid event id')
    if (not re.fullmatch(r'NIFTY[A-Z0-9]{3,50}',p.option_symbol)
            or p.direction not in {'CE','PE'}
            or not p.option_symbol.endswith(p.direction)):
        raise EvidenceError('invalid listed NIFTY option identity')
    if p.source not in {'UNVERIFIED','CAPTURED_KITE_QUOTE','SYNTHETIC_TEST'}:
        raise EvidenceError('unsupported provenance')
    if any(x.tzinfo is None for x in
           (p.signal_entry_at,p.quote_entry_at,p.signal_exit_at,p.quote_exit_at)):
        raise EvidenceError('all timestamps must be timezone-aware')
    es=p.signal_entry_at.astimezone(IST)
    eq=p.quote_entry_at.astimezone(IST)
    xs=p.signal_exit_at.astimezone(IST)
    xq=p.quote_exit_at.astimezone(IST)
    if not (es <= eq < xs <= xq):
        raise EvidenceError('signals and quote observations must be in causal time order')
    if (eq-es).total_seconds()>max_delay_seconds or (xq-xs).total_seconds()>max_delay_seconds:
        raise EvidenceError('quote observations too delayed for a time-sensitive paper evaluation')
    if (es.weekday()>=5 or xs.weekday()>=5 or es.time()<time(9,15)
            or xq.time()>time(15,30)):
        raise EvidenceError('quotes outside the regular weekday session')
    if (eq.date()>p.option_expiry or xq.date()>p.option_expiry
            or es.date()!=eq.date() or xs.date()!=xq.date() or es.date()!=xs.date()):
        raise EvidenceError('expired contract, overnight trade or crossed local trading day')
    if not (isinstance(p.lot_size,int) and isinstance(p.lots,int)
            and 0<p.lot_size<=10000 and 0<p.lots<=100):
        raise EvidenceError('invalid lots')
    if not isinstance(p.entry_ask_qty,int) or not isinstance(p.exit_bid_qty,int):
        raise EvidenceError('invalid quote depth quantity')
    qty=p.lot_size*p.lots
    if p.entry_ask_qty<qty or p.exit_bid_qty<qty:
        raise EvidenceError('top-of-book volume insufficient for proposed quantity')
    values=(p.entry_bid,p.entry_ask,p.exit_bid,p.exit_ask)
    if not all(isinstance(x,(float,int)) and math.isfinite(x) and x>0 for x in values):
        raise EvidenceError('invalid option price')
    if p.entry_bid>p.entry_ask or p.exit_bid>p.exit_ask:
        raise EvidenceError('crossed or inverted bid/ask')
    for bid,ask in ((p.entry_bid,p.entry_ask),(p.exit_bid,p.exit_ask)):
        if 100*(ask-bid)/((ask+bid)/2)>max_spread_pct:
            raise EvidenceError('option spread exceeds research policy')
    slip=costs.slippage_bps/10000
    hypothetical_entry=qty*p.entry_ask*(1+slip)
    hypothetical_exit=qty*p.exit_bid*(1-slip)
    gross=qty*(p.exit_bid-p.entry_ask)
    net=hypothetical_exit-hypothetical_entry-costs.roundtrip_charges_rs
    return {'event_id':p.event_id,'day':es.date().isoformat(),
            'option_symbol':p.option_symbol,'lots':p.lots,'quantity':qty,
            'gross_rs':round(gross,2),'net_rs':round(net,2),
            'assumed_fees_rs':costs.roundtrip_charges_rs,
            'slippage_bps_each_side':costs.slippage_bps,
            'entry_delay_seconds':round((eq-es).total_seconds(),2),
            'exit_delay_seconds':round((xq-xs).total_seconds(),2),
            'source':p.source,'actual_fill_proven':False}


def summarize(records: list[PaperQuotePair], costs: Costs, *, min_trades: int=30,
              min_days: int=5) -> dict:
    """Descriptive paper statistics, never labeled a verified trading edge."""
    if min_trades<1 or min_days<1:
        raise EvidenceError('minimum evidence thresholds must be positive')
    if len({x.event_id for x in records})!=len(records):
        raise EvidenceError('duplicate paper signal id')
    ordered=sorted(records,key=lambda p:p.quote_exit_at)
    scored=[score_pair(x,costs) for x in ordered]
    days=len({x['day'] for x in scored})
    wins=sum(x['net_rs']>0 for x in scored)
    net=sum(x['net_rs'] for x in scored)
    gross=sum(x['gross_rs'] for x in scored)
    peak=0.0
    equity=0.0
    max_drawdown=0.0
    for row in scored:
        equity+=row['net_rs']
        peak=max(peak,equity)
        max_drawdown=max(max_drawdown,peak-equity)
    sufficient=len(scored)>=min_trades and days>=min_days
    unverified=sum(r['source']!='CAPTURED_KITE_QUOTE' for r in scored)
    # Provenance tags alone are not independently authenticated records.
    status=('INSUFFICIENT_EVIDENCE' if not sufficient else
            'UNVERIFIED_SOURCE' if unverified else 'PAPER_SAMPLE_REVIEW_UNAUDITED')
    return {'status':status,
            'paper_trades':len(scored),'session_days':days,
            'net_pnl_rs':round(net,2),'gross_pnl_rs':round(gross,2),
            'net_win_rate_pct':round(100*wins/len(scored),2) if scored else None,
            'max_paper_drawdown_rs':round(max_drawdown,2),
            'synthetic_or_unverified_rows':unverified,
            'live_trading_verified':False,'real_fills_verified':False,
            'option_quote_depth_verified':False,
            'required_min_trades':min_trades,'required_min_days':min_days}
