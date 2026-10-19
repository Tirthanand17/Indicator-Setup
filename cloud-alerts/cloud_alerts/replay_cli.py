"""Offline-only market candle replay. No credentials, HTTP requests or orders."""
from __future__ import annotations
import argparse
from collections import Counter
from datetime import datetime
import json
from pathlib import Path

from .models import Candle
from .replay import ReplayCheckpoint, ReplayError, replay_history

MAX_INPUT_BYTES = 12 * 1024 * 1024
FIELDS = {'start','open','high','low','close','volume'}


def _load_rows(rows) -> list[Candle]:
    if not isinstance(rows,list) or not 1 <= len(rows) <= 16000:
        raise ReplayError('invalid candle count')
    candles=[]
    for row in rows:
        if not isinstance(row,dict) or set(row) != FIELDS:
            raise ReplayError('invalid candle field names')
        if not (isinstance(row['start'],str) and len(row['start'])<=50):
            raise ReplayError('invalid candle timestamp')
        if (any(type(row[key]) not in (float, int) for key in ('open','high','low','close'))
                or type(row['volume']) is not int):
            raise ReplayError('invalid OHLCV numeric types')
        try:
            candles.append(Candle(
                start=datetime.fromisoformat(row['start']),
                open=float(row['open']),high=float(row['high']),
                low=float(row['low']),close=float(row['close']),
                volume=int(row['volume']),
            ))
        except (ValueError, TypeError, OverflowError) as exc:
            raise ReplayError('malformed candle field value') from exc
    return candles


def load_export(path:Path) -> tuple[list[Candle],list[Candle]]:
    """Reject unexpected metadata; never accept or print tokens in a replay file."""
    try:
        if not path.is_file() or path.stat().st_size>MAX_INPUT_BYTES:
            raise ReplayError('invalid replay file size')
        raw=json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(raw,dict) or set(raw)!={'schema','candles_5m','candles_15m'} or raw['schema']!='nifty-replay-v1':
            raise ReplayError('unsupported replay schema or unexpected fields')
        return _load_rows(raw['candles_5m']),_load_rows(raw['candles_15m'])
    except (OSError,UnicodeError,json.JSONDecodeError) as exc:
        raise ReplayError('could not read replay export') from exc


def run_cli(argv:list[str]|None=None)->int:
    parser=argparse.ArgumentParser(description='OFFLINE synthetic/paper NIFTY signal replay; no orders')
    parser.add_argument('--input',required=True)
    parser.add_argument('--start',required=True,help='ISO date/time with timezone')
    parser.add_argument('--end',required=True,help='ISO date/time with timezone')
    parser.add_argument('--resume-candle',default=None)
    parser.add_argument('--resume-sha',default=None)
    args=parser.parse_args(argv)
    try:
        if bool(args.resume_candle)!=bool(args.resume_sha):
            raise ReplayError('both checkpoint fields are required')
        bars5,bars15=load_export(Path(args.input))
        cp=(ReplayCheckpoint(args.resume_candle,args.resume_sha)
            if args.resume_candle else None)
        report=replay_history(bars5,bars15,
                              window_start=datetime.fromisoformat(args.start),
                              window_end=datetime.fromisoformat(args.end),
                              resume_after=cp)
        counts=dict(sorted(Counter(row.status for row in report.records).items()))
        out={'mode':'OFFLINE_READ_ONLY_REPLAY','historical_decisions':len(report.records),
             'processed_including_prefix':report.all_replayed,
             'review_candidates_including_prefix':report.review_candidates,
             'status_counts':counts,
             'checkpoint':(report.checkpoint.__dict__ if report.checkpoint else None),
             'real_orders':False,'option_pnl_supported':False,
             'historical_option_quotes_verified':False}
        print(json.dumps(out,sort_keys=True))
        return 0
    except (ValueError,TypeError):
        print(json.dumps({'mode':'OFFLINE_READ_ONLY_REPLAY','ok':False,'error':'INVALID_REPLAY_DATA'}))
        return 2


if __name__=='__main__':
    raise SystemExit(run_cli())
