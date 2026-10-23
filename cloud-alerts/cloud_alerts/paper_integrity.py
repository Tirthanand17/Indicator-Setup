"""Recovery audit for NIFTY PAPER-only comparison accounts.

The original REVIEW outbox and simulated portfolio entries are not one SQLite
transaction; a crash between commits cannot be mistaken for a complete trade.
Never backdate a simulated fill, adjust cash, or use a real broker order.
"""
from __future__ import annotations
from datetime import datetime,timezone
import sqlite3

ACCOUNTS=('PAPER_50K','PAPER_100K')
MARKER='paper_autotrade_activated_utc'

def _utc(value:str)->datetime:
    try:
        parsed=datetime.fromisoformat(value)
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise ValueError('naive clock')
        return parsed.astimezone(timezone.utc)
    except (ValueError,TypeError,OverflowError):
        raise RuntimeError('Malformed paper audit event clock') from None

def _validate_signal_outcomes(db:sqlite3.Connection,signal_id:str)->set[str]:
    """Fail closed on unknown account or contradictory paper evidence."""
    positions=[r[0] for r in db.execute(
        'SELECT account_id FROM paper_positions WHERE signal_id=?',(signal_id,))]
    rejected=[r[0] for r in db.execute(
        'SELECT account_id FROM paper_rejections WHERE signal_id=?',(signal_id,))]
    if any(account not in ACCOUNTS for account in positions+rejected):
        raise RuntimeError('Unknown account in paper basket journal')
    if (set(positions).intersection(rejected)
            or len(positions)!=len(set(positions))
            or len(rejected)!=len(set(rejected))):
        raise RuntimeError('Contradictory paper position and rejection evidence')
    return set(positions+rejected)

def audit_cash_reconciliation(db_path:str)->dict:
    """Check exact paise conservation without changing either paper account.

    Initial capital minus every durable entry debit plus verified simulated
    closing credit must equal account cash. An unresolved position cannot
    contribute a fictitious exit credit. Fail closed on corrupt trade rows.
    """
    with sqlite3.connect(db_path,timeout=10) as db:
        db.execute('BEGIN')
        accounts=db.execute(
            'SELECT account_id,initial_paise,cash_paise FROM paper_accounts').fetchall()
        if {r[0] for r in accounts}!=set(ACCOUNTS):
            raise RuntimeError('Paper account set changed unexpectedly')
        if any(type(initial) is not int or type(cash) is not int
               or initial<=0 or cash<0 for _,initial,cash in accounts):
            raise RuntimeError('Paper account money is not valid integer paise')
        rows=db.execute(
            'SELECT account_id,status,entry_debit_paise,exit_credit_paise,'
            'net_pnl_paise FROM paper_positions').fetchall()
    balance={a:int(initial) for a,initial,_ in accounts}
    expected={a:int(cash) for a,_,cash in accounts}
    open_count=0
    for account,status,debit,credit,pnl in rows:
        if account not in balance or type(debit) is not int or debit<=0:
            raise RuntimeError('Paper entry journal is malformed')
        balance[account]-=debit
        if status=='CLOSED':
            if (type(credit) is not int or credit<0 or type(pnl) is not int
                    or pnl!=credit-debit):
                raise RuntimeError('Paper realized P&L journal mismatch')
            balance[account]+=credit
        elif status in ('OPEN','EXIT_UNVERIFIABLE'):
            if credit is not None or pnl is not None:
                raise RuntimeError('Paper unresolved position has fictional credit')
            open_count+=1
        else:
            raise RuntimeError('Invalid paper position state')
    if any(expected[a]<0 or balance[a]!=expected[a] for a in ACCOUNTS):
        raise RuntimeError('Paper cash does not reconcile to journal')
    return {'status':'BALANCED','accounts_verified':len(ACCOUNTS),
            'positions_checked':len(rows),'unresolved_positions':open_count,
            'cash_entries_permitted':True}

def initialize_activation(db_path:str,now:datetime)->str:
    """Save immutable first-activation watermark; ignore earlier alert-only reviews."""
    if not isinstance(now,datetime) or now.tzinfo is None or now.utcoffset() is None:
        raise ValueError('aware activation time required')
    epoch=now.astimezone(timezone.utc).isoformat(timespec='microseconds')
    with sqlite3.connect(db_path,timeout=10) as db:
        db.execute('BEGIN IMMEDIATE')
        prior=db.execute('SELECT value FROM runtime WHERE key=?',(MARKER,)).fetchone()
        if prior:
            _utc(prior[0])
            return prior[0]
        if db.execute('SELECT COUNT(*) FROM paper_positions').fetchone()[0]:
            raise RuntimeError('Prior simulated positions lack an activation watermark')
        db.execute('INSERT INTO runtime(key,value) VALUES(?,?)',(MARKER,epoch))
    return epoch

def audit_entry_coverage(db_path:str,*,max_examples:int=10)->dict:
    """Each review after activation must have a trade OR a rejection per account."""
    if type(max_examples) is not int or not 0<=max_examples<=20:
        raise ValueError('invalid bounded evidence size')
    with sqlite3.connect(db_path,timeout=10) as db:
        marker=db.execute('SELECT value FROM runtime WHERE key=?',(MARKER,)).fetchone()
        if not marker:
            return {'status':'NOT_ACTIVATED','reviews_checked':0,
                    'missing_account_outcomes':0,'sample_count':0,
                    'new_entries_permitted':False}
        activated=_utc(marker[0])
        reviews=db.execute("SELECT event_id,at FROM events WHERE status IN ('REVIEW_CE','REVIEW_PE')").fetchall()
        recorded=set(db.execute('SELECT account_id,signal_id FROM paper_positions').fetchall())
        rejected=set(db.execute('SELECT account_id,signal_id FROM paper_rejections').fetchall())
        # Validate all eligible REVIEW source events before claiming coverage.
        # A contradictory row is never equivalent to a completed basket.
        for signal_id,when in reviews:
            if _utc(when)>=activated:
                _validate_signal_outcomes(db,signal_id)
    checked=missing=0
    for signal_id,when in reviews:
        if _utc(when)<activated:
            continue
        if not isinstance(signal_id,str) or not signal_id:
            raise RuntimeError('Malformed paper review identifier')
        checked+=1
        for account_id in ACCOUNTS:
            if (account_id,signal_id) not in recorded and (account_id,signal_id) not in rejected:
                missing+=1
    return {'status':'PARTIAL_BASKET' if missing else 'COMPLETE',
            'reviews_checked':checked,'missing_account_outcomes':missing,
            'sample_count':min(missing,max_examples),
            'new_entries_permitted':missing==0}

def recover_missing_outcomes(db_path:str,now:datetime,*,grace_seconds:int=180)->dict:
    """Repair orphaned review outcomes as MISSED PAPER entries, not fills.

    Single-worker safe: SQLite BEGIN IMMEDIATE serializes with paper account
    changes. Any recent in-flight REVIEW remains blocked until grace expires.
    """
    if not isinstance(now,datetime) or now.tzinfo is None or now.utcoffset() is None:
        raise ValueError('aware recovery clock required')
    if type(grace_seconds) is not int or not 60<=grace_seconds<=3600:
        raise ValueError('invalid recovery grace period')
    current=now.astimezone(timezone.utc)
    repaired=deferred=0
    with sqlite3.connect(db_path,timeout=10) as db:
        db.execute('BEGIN IMMEDIATE')
        saved=db.execute('SELECT value FROM runtime WHERE key=?',(MARKER,)).fetchone()
        if not saved:
            return {'status':'NOT_ACTIVATED','recovered':0,'pending_grace':0,
                    'new_entries_permitted':False}
        activated=_utc(saved[0])
        reviews=db.execute("SELECT event_id,at FROM events WHERE status IN ('REVIEW_CE','REVIEW_PE')").fetchall()
        for signal_id,raw_time in reviews:
            observed=_utc(raw_time)
            if observed<activated:
                continue
            delta=(current-observed).total_seconds()
            if delta < -3:
                raise RuntimeError('Paper review timestamp is in the future')
            outcomes=_validate_signal_outcomes(db,signal_id)
            missing=[a for a in ACCOUNTS if a not in outcomes]
            if not missing:
                continue
            if delta<grace_seconds:
                deferred+=len(missing)
                continue
            for account_id in missing:
                cur=db.execute('INSERT OR IGNORE INTO paper_rejections('
                    'account_id,signal_id,at,reason) VALUES(?,?,?,?)',
                    (account_id,signal_id,raw_time,'CRASH_GAP_NO_SIMULATED_FILL'))
                repaired+=cur.rowcount
            db.execute('INSERT OR IGNORE INTO events(event_id,status,at,payload) '
                       'VALUES(?,?,?,?)',
                       ('PAPER_RECOVERY:'+signal_id,'PAPER_RECOVERY',now.isoformat(),
                        'PAPER SIMULATOR RECOVERY: missing account outcome recorded '
                        'as a MISSED simulation, not a retroactive fill. '
                        'No real orders. Review completeness audit.'))
    return {'status':'WAIT_GRACE' if deferred else 'RECOVERED',
            'recovered':repaired,'pending_grace':deferred,
            'new_entries_permitted':deferred==0}
