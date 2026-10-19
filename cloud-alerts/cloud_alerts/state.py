"""No credentials in SQLite; supports durable dedupe and token relay nonce replay blocking."""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
import re
from pathlib import Path
import sqlite3
from .quote_evidence import canonical_snapshot
from .evaluation import EvidenceError
from .session_coverage import boundary_for, OUTCOMES

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
              CREATE INDEX IF NOT EXISTS idx_shadow_compared_at ON shadow_evidence(compared_at_utc);
              CREATE TABLE IF NOT EXISTS rest_poll_coverage (
                boundary_utc TEXT PRIMARY KEY, last_observed_utc TEXT NOT NULL,
                attempts INTEGER NOT NULL, outcome TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS option_quote_observations (
                event_id TEXT NOT NULL, phase TEXT NOT NULL, payload TEXT NOT NULL,
                payload_sha256 TEXT NOT NULL,
                PRIMARY KEY (event_id,phase));''')
            # Non-destructive migration: existing saved alert rows remain intact.
            # These columns never contain message bodies, phone IDs or API keys.
            event_columns={row[1] for row in db.execute('PRAGMA table_info(events)')}
            for name,ddl in (
                ('delivery_attempts','INTEGER NOT NULL DEFAULT 0'),
                ('first_attempt_utc','TEXT'),
                ('last_attempt_utc','TEXT'),
                ('accepted_at_utc','TEXT'),
            ):
                if name not in event_columns:
                    db.execute(f'ALTER TABLE events ADD COLUMN {name} {ddl}')
    def _connect(self):return sqlite3.connect(self.path,timeout=10)
    def record_rest_attempt(self, now:datetime, outcome:str)->None:
        """Persist sanitized per-boundary monitoring quality, never prices/secrets.

        A later failure cannot erase a prior successful REST decision. Repeated
        polls count as attempts, not extra monitored candle boundaries.
        """
        if outcome not in OUTCOMES:
            raise ValueError('unsupported REST coverage outcome')
        boundary=boundary_for(now)
        if boundary is None:
            raise ValueError('no scheduled REST polling boundary')
        start=boundary.astimezone(timezone.utc).isoformat()
        observed=now.astimezone(timezone.utc).isoformat()
        with self._connect() as db:
            db.execute('INSERT INTO rest_poll_coverage '
                       '(boundary_utc,last_observed_utc,attempts,outcome) '
                       'VALUES(?,?,1,?) ON CONFLICT(boundary_utc) DO UPDATE SET '
                       'last_observed_utc=excluded.last_observed_utc, '
                       'attempts=rest_poll_coverage.attempts+1, '
                       "outcome=CASE WHEN rest_poll_coverage.outcome='REST_VALID' "
                       "THEN 'REST_VALID' ELSE excluded.outcome END",
                       (start,observed,outcome))

    def read_rest_coverage(self)->list[tuple[str,int,str]]:
        """Entire sanitized ledger; use offline-only for a trial-day audit."""
        with self._connect() as db:
            return db.execute('SELECT boundary_utc,attempts,outcome '
                              'FROM rest_poll_coverage ORDER BY boundary_utc').fetchall()

    def is_sent(self,event_id:str)->bool:
        with self._connect() as db:
            return db.execute('SELECT 1 FROM events WHERE event_id=?',(event_id,)).fetchone() is not None
    def claim_event(self,event_id:str,status:str,now:datetime,payload:str)->bool:
        with self._connect() as db:
            row=db.execute('INSERT OR IGNORE INTO events(event_id,status,at,payload) VALUES(?,?,?,?)',
                (event_id,status,now.isoformat(),payload))
            return row.rowcount>0
    def claim_entry_with_candidate(self,event_id:str,status:str,now:datetime,
                                   payload:str,candidate_json:str,
                                   quote_snapshot:dict|None=None)->bool:
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
        if quote_snapshot is not None:
            encoded,digest=canonical_snapshot(quote_snapshot)
            if quote_snapshot['event_id']!=event_id or quote_snapshot['phase']!='ENTRY':
                raise EvidenceError('entry observation does not match entry event')
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
            # The ENTRY reference belongs to the same SQLite transaction as
            # the paper candidate and pending Telegram outbox event.
            if quote_snapshot is not None:
                db.execute('INSERT INTO option_quote_observations '
                           '(event_id,phase,payload,payload_sha256) VALUES (?,?,?,?)',
                           (event_id,'ENTRY',encoded,digest))
            return True

    def record_option_quote_observation(self, snapshot:dict)->bool:
        """Append a vetted quote snapshot; refuse altered duplicate evidence.

        This is not a provider-signed record. The database may be modified by
        an administrator; a local SHA-256 only detects inconsistent payloads.
        """
        encoded,digest=canonical_snapshot(snapshot)
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            prior=db.execute('SELECT payload,payload_sha256 FROM option_quote_observations '
                'WHERE event_id=? AND phase=?',
                (snapshot['event_id'],snapshot['phase'])).fetchone()
            if prior is not None:
                if prior!=(encoded,digest):
                    raise EvidenceError('conflicting previously recorded option observation')
                return False
            db.execute('INSERT INTO option_quote_observations '
                       '(event_id,phase,payload,payload_sha256) VALUES(?,?,?,?)',
                       (snapshot['event_id'],snapshot['phase'],encoded,digest))
            return True

    def read_option_quote_observations(self)->list[dict]:
        """Read and verify every persisted snapshot before performance scoring."""
        import json
        with self._connect() as db:
            rows=db.execute('SELECT event_id,phase,payload,payload_sha256 '
                            'FROM option_quote_observations ORDER BY event_id,phase').fetchall()
        observations=[]
        for event,phase,raw,digest in rows:
            try:
                data=json.loads(raw)
                canonical,actual=canonical_snapshot(data)
                if (event,phase)!=(data['event_id'],data['phase']) or canonical!=raw or actual!=digest:
                    raise EvidenceError('local option quote evidence tampered')
            except (ValueError,TypeError,KeyError) as exc:
                raise EvidenceError('corrupt option quote evidence') from exc
            observations.append(data)
        return observations

    def event_delivery_status(self,event_id:str)->int|None:
        """0 queued, 1 Telegram API accepted, 2 expired; None not claimed."""
        with self._connect() as db:
            row=db.execute('SELECT delivered FROM events WHERE event_id=?',(event_id,)).fetchone()
            return int(row[0]) if row else None

    def record_delivery_attempt(self,event_id:str,when:datetime)->bool:
        """Durably count a send attempt BEFORE contacting Telegram.

        Only queued events can be retried; accepted/expired events cannot be
        mutated by a delayed task after a restart. No error text is stored.
        """
        if not isinstance(when,datetime) or when.tzinfo is None or when.utcoffset() is None:
            raise ValueError('timezone-aware attempt time required')
        if not isinstance(event_id,str) or not event_id:
            raise ValueError('nonempty event ID required')
        stamp=when.astimezone(timezone.utc).isoformat()
        with self._connect() as db:
            row=db.execute('UPDATE events SET '
                'delivery_attempts=delivery_attempts+1, '
                'first_attempt_utc=COALESCE(first_attempt_utc,?), '
                'last_attempt_utc=? WHERE event_id=? AND delivered=0',
                (stamp,stamp,event_id))
            return row.rowcount==1

    def mark_delivered(self,event_id:str,when:datetime|None=None)->bool:
        """Telegram Bot API accepted a response; NOT a confirmed phone receipt.

        First acceptance is durable and immutable; an expired notification is
        not allowed to become accepted via a late worker response.
        """
        when=when or datetime.now(timezone.utc)
        if not isinstance(when,datetime) or when.tzinfo is None or when.utcoffset() is None:
            raise ValueError('timezone-aware acceptance time required')
        stamp=when.astimezone(timezone.utc).isoformat()
        with self._connect() as db:
            row=db.execute('UPDATE events SET delivered=1,accepted_at_utc=?, '
                'delivery_attempts=CASE WHEN delivery_attempts=0 THEN 1 ELSE delivery_attempts END, '
                'first_attempt_utc=COALESCE(first_attempt_utc,?), '
                'last_attempt_utc=COALESCE(last_attempt_utc,?) '
                'WHERE event_id=? AND delivered=0',
                (stamp,stamp,stamp,event_id))
            return row.rowcount==1

    def read_delivery_audit_rows(self)->list[tuple]:
        """Return only audit metadata, never outbox payloads or user secrets."""
        with self._connect() as db:
            return db.execute('SELECT status,at,delivered,delivery_attempts, '
                'first_attempt_utc,last_attempt_utc,accepted_at_utc '
                'FROM events ORDER BY at,status').fetchall()
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
