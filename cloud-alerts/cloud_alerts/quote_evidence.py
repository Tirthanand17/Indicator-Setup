"""Sanitized, paper-only NIFTY option quote observations and reproducible pairing.

A hash detects accidental modification inside an exported record; it is NOT a
signature from Zerodha. A quote is NOT a fill and is never represented as one.
No network, account, orders, holdings, or credential code is imported here.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timezone
from hashlib import sha256
import json
import math
import re
from typing import Iterable
from zoneinfo import ZoneInfo

from .evaluation import Costs, EvidenceError, PaperQuotePair, score_pair, summarize
from .models import OptionQuote
from .trading_calendar import regular_session, CalendarUnavailable

IST = ZoneInfo('Asia/Kolkata')
SCHEMA = 'nifty-paper-quote-observation-v1'
FIELDS = frozenset({
    'schema', 'event_id', 'phase', 'signal_at_utc', 'observed_at_utc',
    'exchange_quote_at_utc', 'option_symbol', 'option_expiry',
    'direction', 'instrument_token', 'lot_size', 'bid', 'ask',
    'bid_qty', 'ask_qty', 'source',
})
SOURCE = 'UNVERIFIED_ADAPTER_OBSERVATION'


def _utc(dt: datetime) -> str:
    if not isinstance(dt, datetime) or dt.tzinfo is None or dt.utcoffset() is None:
        raise EvidenceError('aware observation timestamps required')
    return dt.astimezone(timezone.utc).isoformat(timespec='microseconds')


def make_snapshot(event_id: str, phase: str, signal_at: datetime,
                  observed_at: datetime, quote: OptionQuote) -> dict:
    """Preserve exchange time separately from when the API returned the quote."""
    c = quote.contract
    raw = {
        'schema': SCHEMA, 'event_id': event_id, 'phase': phase,
        'signal_at_utc': _utc(signal_at),
        'observed_at_utc': _utc(observed_at),
        'exchange_quote_at_utc': _utc(quote.updated),
        'option_symbol': c.symbol, 'option_expiry': c.expiry,
        'direction': c.kind, 'instrument_token': c.token,
        'lot_size': c.lot_size, 'bid': quote.bid, 'ask': quote.ask,
        'bid_qty': quote.bid_quantity, 'ask_qty': quote.ask_quantity,
        'source': SOURCE,
    }
    return validate_snapshot(raw)


def validate_snapshot(row: dict) -> dict:
    """Reject extra properties, corrupted times, invalid contracts, or prices."""
    if not isinstance(row, dict) or set(row) != FIELDS or row.get('schema') != SCHEMA:
        raise EvidenceError('unsupported option observation schema')
    event = row['event_id']
    if not isinstance(event, str) or not re.fullmatch(r'[A-Za-z0-9:+_.-]{8,220}', event):
        raise EvidenceError('invalid observation event identifier')
    if row['phase'] not in ('ENTRY', 'EXIT') or row['source'] != SOURCE:
        raise EvidenceError('invalid observation purpose or source')
    sym = row['option_symbol']
    side = row['direction']
    if not isinstance(sym,str) or not re.fullmatch(r'NIFTY[A-Z0-9]{3,50}',sym) or side not in ('CE','PE') or not sym.endswith(side):
        raise EvidenceError('invalid listed option identity')
    try:
        expiry = date.fromisoformat(row['option_expiry'])
        signal = datetime.fromisoformat(row['signal_at_utc'])
        observed = datetime.fromisoformat(row['observed_at_utc'])
        quote_at = datetime.fromisoformat(row['exchange_quote_at_utc'])
    except (ValueError,TypeError,OverflowError) as exc:
        raise EvidenceError('invalid observation date or time') from exc
    for dt in (signal,observed,quote_at):
        if dt.tzinfo is None or dt.utcoffset() is None:
            raise EvidenceError('observation timestamps must include timezone')
    signal_ist, observed_ist = signal.astimezone(IST), observed.astimezone(IST)
    try:
        if not regular_session(observed_ist.date()):
            raise EvidenceError('observation outside regular NSE session')
    except CalendarUnavailable:
        raise EvidenceError('NSE calendar unavailable for observation') from None
    if (signal_ist.date()!=observed_ist.date() or observed_ist.date()>expiry
            or observed_ist.weekday()>=5 or signal_ist.time()<time(9,15)
            or observed_ist.time()>time(15,30) or signal>observed
            or (observed-signal).total_seconds()>180):
        raise EvidenceError('observation outside causal same-day market window')
    age = (observed-quote_at).total_seconds()
    if not -3 <= age <= 15 or quote_at.astimezone(IST).date()!=observed_ist.date():
        raise EvidenceError('exchange quote timestamp stale or future dated')
    for field, limit in (('instrument_token',2**63-1),('lot_size',10000),('bid_qty',10**9),('ask_qty',10**9)):
        val = row[field]
        if type(val) is not int or val<1 or val>limit:
            raise EvidenceError('invalid option token, lot or depth')
    for field in ('bid','ask'):
        val=row[field]
        if type(val) not in (float,int) or not math.isfinite(val) or val<=0:
            raise EvidenceError('nonfinite or invalid option price')
    if row['bid']>=row['ask'] or 100*(row['ask']-row['bid'])/((row['ask']+row['bid'])/2)>2:
        raise EvidenceError('inverted or wide option spread')
    if row['bid_qty']<row['lot_size'] or row['ask_qty']<row['lot_size']:
        raise EvidenceError('option depth smaller than one lot')
    # Canonical UTC timestamps and numeric types keep hashing stable across TZs.
    return {**row,'signal_at_utc':_utc(signal),
            'observed_at_utc':_utc(observed),
            'exchange_quote_at_utc':_utc(quote_at),
            'bid':float(row['bid']),'ask':float(row['ask'])}


def canonical_snapshot(row: dict) -> tuple[str,str]:
    """Return deterministic serialized data and a NON-authenticating SHA-256."""
    raw=json.dumps(validate_snapshot(row),sort_keys=True,separators=(',',':'),allow_nan=False)
    return raw,sha256(raw.encode('utf-8')).hexdigest()


def pair_snapshots(rows: Iterable[dict], costs: Costs, *, min_trades: int=30,
                   min_days: int=5, expected_event_ids: Iterable[str] | None=None) -> dict:
    """Score only coherent independently timed ENTRY+EXIT observations.

    Partial or invalid pairs remain visible as COUNTS, never silently recast as
    wins. Source tags are unverified, regardless of the hash present in SQLite.
    """
    # Entry outbox reconciliation is OPTIONAL for historical standalone quote
    # exports, but REQUIRED to make any statement about sample completeness.
    # This prevents quoting a perfect win rate while omitting unquoted entries.
    expected: set[str] | None = None
    if expected_event_ids is not None:
        listed = list(expected_event_ids)
        if any(not isinstance(x, str) or not re.fullmatch(r'[A-Za-z0-9:+_.-]{8,220}', x)
               for x in listed) or len(listed) != len(set(listed)):
            raise EvidenceError('invalid or repeated source entry notice identifiers')
        expected = set(listed)
    grouped:dict[str,dict[str,dict]] = defaultdict(dict)
    total=0
    for row in rows:
        clean=validate_snapshot(row)
        total+=1
        event,phase=clean['event_id'],clean['phase']
        if expected is not None and event not in expected:
            raise EvidenceError('quote observations without source entry notice')
        if phase in grouped[event]:
            raise EvidenceError('duplicate quote observation stage')
        grouped[event][phase]=clean
    incomplete=0
    rejected=0
    scored=[]
    for event, stages in grouped.items():
        if set(stages)!= {'ENTRY','EXIT'}:
            incomplete+=1
            continue
        entry,exit_=stages['ENTRY'],stages['EXIT']
        if any(entry[f]!=exit_[f] for f in ('option_symbol','option_expiry','direction','lot_size','instrument_token')):
            rejected+=1
            continue
        try:
            pair=PaperQuotePair(
                event_id=event,
                option_symbol=entry['option_symbol'],
                option_expiry=date.fromisoformat(entry['option_expiry']),
                direction=entry['direction'],
                signal_entry_at=datetime.fromisoformat(entry['signal_at_utc']),
                quote_entry_at=datetime.fromisoformat(entry['observed_at_utc']),
                entry_bid=entry['bid'],entry_ask=entry['ask'],
                entry_ask_qty=entry['ask_qty'],
                signal_exit_at=datetime.fromisoformat(exit_['signal_at_utc']),
                quote_exit_at=datetime.fromisoformat(exit_['observed_at_utc']),
                exit_bid=exit_['bid'],exit_ask=exit_['ask'],
                exit_bid_qty=exit_['bid_qty'],
                lot_size=entry['lot_size'],lots=1,source='UNVERIFIED',
            )
            score_pair(pair,costs)
        except (EvidenceError, ValueError):
            rejected+=1
            continue
        scored.append(pair)
    result=summarize(scored,costs,min_trades=min_trades,min_days=min_days)
    complete_case_rate=result['net_win_rate_pct']
    missing_entirely = len(expected - grouped.keys()) if expected is not None else None
    reference_events = len(expected) if expected is not None else len(grouped)
    coverage = (round(100 * len(scored) / reference_events, 2)
                if reference_events else None)
    all_matched = (reference_events > 0 and len(scored) == reference_events
                   and not incomplete and not rejected and
                   (missing_entirely is None or missing_entirely == 0))
    sample_sufficient = (result['paper_trades'] >= min_trades
                         and result['session_days'] >= min_days)
    # Even 100% complete records are NOT independently authenticated broker
    # records. A headline/ranked win rate must remain unavailable.
    ranking_blockers = []
    if expected is None:
        ranking_blockers.append('ENTRY_NOTICE_RECONCILIATION_MISSING')
    if not all_matched:
        ranking_blockers.append('MISSING_OR_REJECTED_QUOTE_PAIRS')
    if not sample_sufficient:
        ranking_blockers.append('INSUFFICIENT_PAPER_SAMPLE')
    ranking_blockers.append('BROKER_QUOTE_PROVENANCE_UNVERIFIED')
    # Don't export a bare "net_win_rate_pct" in the ordinary summary; it
    # could be mistaken for a complete strategy sample. Conditional rates stay
    # available under a visibly qualified, explicit field only.
    result = {**result, 'net_win_rate_pct': None,
              'win_rate_withheld_reason': 'UNVERIFIED_OR_INCOMPLETE_SOURCE_SAMPLE'}
    return {'mode':'UNVERIFIED_READONLY_QUOTE_EVIDENCE',
            'quote_observations':total,
            'unique_entry_events':len(grouped),
            'incomplete_quote_pairs':incomplete,
            'rejected_quote_pairs':rejected,
            'scorable_quote_pairs':len(scored),
            'source_entry_events':len(expected) if expected is not None else None,
            'entry_events_missing_all_quotes':missing_entirely,
            'entry_notice_reconciliation_performed':expected is not None,
            'reference_event_count':reference_events,
            'scorable_event_coverage_pct':coverage,
            'all_reference_events_scored':all_matched,
            'complete_case_win_rate_pct':complete_case_rate,
            'rankable_win_rate_pct':None,
            'eligible_for_strategy_ranking':False,
            'ranking_blockers':ranking_blockers,
            'summary':result,
            'broker_provenance_independently_verified':False,
            'telegram_phone_receipt_verified':False,
            'actual_orders_or_fills_verified':False}
