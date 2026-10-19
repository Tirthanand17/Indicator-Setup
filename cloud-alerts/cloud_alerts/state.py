"""No credentials in SQLite; supports durable dedupe and token relay nonce replay blocking."""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
import re
from pathlib import Path
import sqlite3

class State:
    def __init__(self,path:str):
        self.path=path
        Path(path).parent.mkdir(parents=True,exist_ok=True)
        with self._connect() as db:
            db.executescript('''CREATE TABLE IF NOT EXISTS events (
              event_id TEXT PRIMARY KEY, status TEXT NOT NULL, at TEXT NOT NULL, payload TEXT NOT NULL,
              delivered INTEGER NOT NULL DEFAULT 0);
              CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, received_at INTEGER NOT NULL);
              CREATE TABLE IF NOT EXISTS runtime (key TEXT PRIMARY KEY, value TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS shadow_evidence (
                future_symbol TEXT NOT NULL, candle_start_utc TEXT NOT NULL,
                compared_at_utc TEXT NOT NULL, verdict TEXT NOT NULL,
                mismatch_reasons TEXT NOT NULL,
                PRIMARY KEY (future_symbol, candle_start_utc));
              CREATE INDEX IF NOT EXISTS idx_shadow_compared_at ON shadow_evidence(compared_at_utc);''')
    def _connect(self):return sqlite3.connect(self.path,timeout=10)
    def is_sent(self,event_id:str)->bool:
        with self._connect() as db:
            return db.execute('SELECT 1 FROM events WHERE event_id=?',(event_id,)).fetchone() is not None
    def claim_event(self,event_id:str,status:str,now:datetime,payload:str)->bool:
        with self._connect() as db:
            row=db.execute('INSERT OR IGNORE INTO events(event_id,status,at,payload) VALUES(?,?,?,?)',
                (event_id,status,now.isoformat(),payload))
            return row.rowcount>0
    def claim_entry_with_candidate(self,event_id:str,status:str,now:datetime,
                                   payload:str,candidate_json:str)->bool:
        """Atomically queue the paper entry and persist its virtual position.

        A process crash cannot leave a queued BUY without its corresponding
        paper-exit reference. Existing same-day virtual entries, malformed
        state and duplicate event IDs all fail closed. No broker orders.
        """
        import json
        try:
            candidate=json.loads(candidate_json)
        except (TypeError, ValueError):
            return False
        if (not isinstance(candidate,dict) or status not in ('REVIEW_CE','REVIEW_PE')
                or candidate.get('direction') != status[-2:]
                or candidate.get('expiry_date') != now.date().isoformat()
                or not isinstance(candidate.get('symbol'),str)
                or not candidate['symbol'].startswith('NIFTY')
                or not isinstance(candidate.get('signal_candle'),str)):
            return False
        # The database is the final authority for the event/candidate link.
        # A caller may omit the ID (compatibility with older research callers),
        # but a mismatched ID is rejected before anything can be persisted.
        if candidate.get('entry_event_id',event_id)!=event_id:
            return False
        candidate['entry_event_id']=event_id
        candidate_json=json.dumps(candidate,separators=(',',':'))
        with self._connect() as db:
            # SQLite executes the claim + candidate update in one transaction.
            db.execute('BEGIN IMMEDIATE')
            old=db.execute('SELECT value FROM runtime WHERE key=?',('virtual_candidate',)).fetchone()
            if old and old[0]:
                try:
                    existing=json.loads(old[0])
                    if not isinstance(existing,dict):return False
                    if existing.get('expiry_date')==now.date().isoformat():return False
                except (ValueError,TypeError):
                    return False
            cur=db.execute('INSERT OR IGNORE INTO events(event_id,status,at,payload) VALUES(?,?,?,?)',
                           (event_id,status,now.isoformat(),payload))
            if cur.rowcount!=1:return False
            db.execute('INSERT INTO runtime(key,value) VALUES(?,?) '
                       'ON CONFLICT(key) DO UPDATE SET value=excluded.value',
                       ('virtual_candidate',candidate_json))
            return True

    def event_delivery_status(self,event_id:str)->int|None:
        """0 queued, 1 Telegram API accepted, 2 expired; None not claimed."""
        with self._connect() as db:
            row=db.execute('SELECT delivered FROM events WHERE event_id=?',(event_id,)).fetchone()
            return int(row[0]) if row else None

    def mark_delivered(self,event_id:str):
        with self._connect() as db:db.execute('UPDATE events SET delivered=1 WHERE event_id=?',(event_id,))
    def pending_events(self)->list[tuple[str,str]]:
        with self._connect() as db:
            return db.execute('SELECT event_id,payload FROM events WHERE delivered=0 ORDER BY at LIMIT 10').fetchall()
    def expire_events_before(self, cutoff:datetime)->int:
        """Never deliver a stale entry review after an outage or restart.

        delivered state: 0 queued, 1 Telegram accepted, 2 expired unsent.
        """
        with self._connect() as db:
            cur=db.execute('UPDATE events SET delivered=2 WHERE delivered=0 AND at < ?',
                           (cutoff.isoformat(),))
            return cur.rowcount
    def outbox_summary(self)->dict:
        """Safe counts for health endpoints; never expose Telegram payloads."""
        with self._connect() as db:
            rows=db.execute('SELECT delivered, COUNT(*) FROM events GROUP BY delivered').fetchall()
        counts={int(status):int(count) for status,count in rows}
        return {'queued':counts.get(0,0),'accepted':counts.get(1,0),
                'expired':counts.get(2,0),'contents_exposed':False}

    def count_expired(self)->int:
        with self._connect() as db:
            return int(db.execute('SELECT COUNT(*) FROM events WHERE delivered=2').fetchone()[0])
    def claim_nonce(self,nonce:str,now_unix:int)->bool:
        with self._connect() as db:
            db.execute('DELETE FROM nonces WHERE received_at<?',(now_unix-300,))
            cur=db.execute('INSERT OR IGNORE INTO nonces(nonce,received_at) VALUES (?,?)',(nonce,now_unix))
            return cur.rowcount==1
    def set_runtime(self,key:str,value:str)->None:
        with self._connect() as db:db.execute('INSERT INTO runtime(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(key,value))
    def get_runtime(self,key:str)->str|None:
        with self._connect() as db:
            row=db.execute('SELECT value FROM runtime WHERE key=?',(key,)).fetchone()
            return row[0] if row else None

    def record_shadow_evidence(self, future_symbol: str, candle_start: datetime,
                               compared_at: datetime, verdict: str,
                               reasons: tuple[str, ...] = ()) -> bool:
        """Persist only non-secret market-data reconciliation outcomes.

        No token, quote depth, broker order data, raw ticks or user IDs.
        Reconciliation is best effort and cannot authorize a trade.
        """
        valid_reasons = {'START_TIMESTAMP_MISMATCH','OHLC_MISMATCH',
                         'VOLUME_MISMATCH','UNEXPECTED_STREAM_QUALITY'}
        if (not isinstance(future_symbol, str)
                or not re.fullmatch(r'[A-Z0-9]{3,40}',future_symbol)
                or verdict not in {'MATCH','MISMATCH','MISSING'}
                or candle_start.tzinfo is None or compared_at.tzinfo is None
                or not isinstance(reasons,tuple) or any(r not in valid_reasons for r in reasons)):
            raise ValueError('invalid sanitized shadow evidence')
        if verdict != 'MISMATCH' and reasons:
            raise ValueError('non-mismatch evidence must not contain mismatch reasons')
        start_utc=candle_start.astimezone(timezone.utc).isoformat()
        now_utc=compared_at.astimezone(timezone.utc).isoformat()
        expiry=(compared_at.astimezone(timezone.utc)-timedelta(days=45)).isoformat()
        with self._connect() as db:
            # One row per futures contract + REST 5-minute candle, no duplicates
            row=db.execute('INSERT OR IGNORE INTO shadow_evidence '
                '(future_symbol,candle_start_utc,compared_at_utc,verdict,mismatch_reasons) '
                'VALUES(?,?,?,?,?)',
                (future_symbol,start_utc,now_utc,verdict,','.join(reasons)))
            db.execute('DELETE FROM shadow_evidence WHERE compared_at_utc < ?', (expiry,))
            return row.rowcount==1

    def shadow_summary(self, now: datetime, days: int = 30) -> dict:
        if now.tzinfo is None or not 1 <= days <= 45:
            raise ValueError('invalid shadow summary window')
        cutoff=(now.astimezone(timezone.utc)-timedelta(days=days)).isoformat()
        with self._connect() as db:
            rows=db.execute('SELECT verdict,COUNT(*) FROM shadow_evidence '
                            'WHERE compared_at_utc >= ? GROUP BY verdict',(cutoff,)).fetchall()
            last=db.execute('SELECT future_symbol,candle_start_utc,verdict,mismatch_reasons '
                            'FROM shadow_evidence WHERE compared_at_utc >= ? '
                            'ORDER BY compared_at_utc DESC LIMIT 1',(cutoff,)).fetchone()
        counts={key:0 for key in ('MATCH','MISMATCH','MISSING')}
        counts.update({k:int(n) for k,n in rows})
        return {'period_days':days,'counts':counts,'total':sum(counts.values()),
                'last':({'future_symbol':last[0], 'candle_start_utc':last[1],
                         'verdict':last[2], 'reasons':last[3].split(',') if last[3] else []}
                        if last else None),
                'contains_user_credentials':False,'may_generate_trade_alerts':False}
