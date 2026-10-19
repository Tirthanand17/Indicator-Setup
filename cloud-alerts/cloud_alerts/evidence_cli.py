"""Offline-only, read-only after-cost option quote evidence summary.

Does not connect to Kite, inspect account holdings, or send Telegram messages.
It cannot assert fills, independently authenticated quotes or a verified edge.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sqlite3
from urllib.parse import quote

from .evaluation import Costs, EvidenceError
from .quote_evidence import canonical_snapshot, pair_snapshots


def read_only_snapshots(db_path:Path) -> list[dict]:
    """Never create or modify the SQLite file used by an operator."""
    if db_path.is_symlink() or not db_path.is_file() or db_path.stat().st_size>1024*1024*1024:
        raise EvidenceError('invalid quote ledger')
    uri='file:'+quote(str(db_path.resolve()),safe='/')+'?mode=ro'
    with sqlite3.connect(uri,uri=True,timeout=3) as db:
        rows=db.execute('SELECT event_id,phase,payload,payload_sha256 FROM '
                        'option_quote_observations ORDER BY event_id,phase').fetchall()
    result=[]
    for event,phase,raw,digest in rows:
        try:
            data=json.loads(raw)
            canonical,actual=canonical_snapshot(data)
            if (event,phase)!=(data['event_id'],data['phase']) or canonical!=raw or actual!=digest:
                raise EvidenceError('unverified or modified quote ledger')
        except (ValueError,TypeError,KeyError) as exc:
            raise EvidenceError('corrupted quote ledger') from exc
        result.append(data)
    return result


def read_only_entry_notices(db_path: Path) -> tuple[list[str], dict[str, int]]:
    """Reconcile ALL review entries against the quote ledger, not just winners.

    No payload, phone number, secret, or filesystem path enters the result.
    SQLite is never opened in writable mode.
    """
    if db_path.is_symlink() or not db_path.is_file() or db_path.stat().st_size > 1024*1024*1024:
        raise EvidenceError('invalid quote ledger')
    uri='file:'+quote(str(db_path.resolve()),safe='/')+'?mode=ro'
    with sqlite3.connect(uri, uri=True, timeout=3) as db:
        rows=db.execute("SELECT event_id,delivered FROM events "
                        "WHERE status IN ('REVIEW_CE','REVIEW_PE') "
                        "ORDER BY event_id").fetchall()
    statuses={'queued':0,'accepted_by_api':0,'expired_unsent':0}
    events=[]
    for event,delivered in rows:
        if type(event) is not str or type(delivered) is not int or delivered not in (0,1,2):
            raise EvidenceError('invalid notice delivery state')
        events.append(event)
        statuses[{0:'queued',1:'accepted_by_api',2:'expired_unsent'}[delivered]]+=1
    return events,statuses


def run_cli(argv:list[str]|None=None)->int:
    parser=argparse.ArgumentParser(description='OFFLINE NIFTY paper quote evidence report (NO EXECUTION)')
    parser.add_argument('--state-db',required=True)
    parser.add_argument('--slippage-bps',required=True,type=float)
    parser.add_argument('--roundtrip-charges-rs',required=True,type=float)
    parser.add_argument('--min-trades',type=int,default=30)
    parser.add_argument('--min-days',type=int,default=5)
    parser.add_argument('--reconcile-entry-outbox',action='store_true',
                        help='Audit all claimed paper REVIEW entries, including those without quotes')
    args=parser.parse_args(argv)
    try:
        costs=Costs(slippage_bps=args.slippage_bps,
                    roundtrip_charges_rs=args.roundtrip_charges_rs)
        expected=None
        statuses=None
        if args.reconcile_entry_outbox:
            expected,statuses=read_only_entry_notices(Path(args.state_db))
        result=pair_snapshots(read_only_snapshots(Path(args.state_db)),costs,
                              min_trades=args.min_trades,min_days=args.min_days,
                              expected_event_ids=expected)
        if statuses is not None:
            result['entry_notice_delivery_counts']=statuses
        print(json.dumps(result,sort_keys=True,allow_nan=False))
        return 0
    except (ValueError,TypeError,OverflowError,OSError,sqlite3.Error):
        # Never reflect a database path, raw message, credential, event ID, or
        # exception text in CLI output, including malformed user-controlled input.
        print(json.dumps({'mode':'UNVERIFIED_READONLY_QUOTE_EVIDENCE',
                          'ok':False,'error':'QUOTE_EVIDENCE_UNAVAILABLE'}))
        return 2


if __name__=='__main__':
    raise SystemExit(run_cli())
