"""No credentials in SQLite; supports durable dedupe and token relay nonce replay blocking."""
from __future__ import annotations
from datetime import datetime
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
              CREATE TABLE IF NOT EXISTS runtime (key TEXT PRIMARY KEY, value TEXT NOT NULL);''')
    def _connect(self):return sqlite3.connect(self.path,timeout=10)
    def is_sent(self,event_id:str)->bool:
        with self._connect() as db:
            return db.execute('SELECT 1 FROM events WHERE event_id=?',(event_id,)).fetchone() is not None
    def claim_event(self,event_id:str,status:str,now:datetime,payload:str)->bool:
        with self._connect() as db:
            row=db.execute('INSERT OR IGNORE INTO events(event_id,status,at,payload) VALUES(?,?,?,?)',
                (event_id,status,now.isoformat(),payload))
            return row.rowcount>0
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
