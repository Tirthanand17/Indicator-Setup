"""Crash safety: simulated cash must match whole immutable paper journal."""
import sqlite3
import pytest
from cloud_alerts.paper_integrity import audit_cash_reconciliation

@pytest.fixture
def cashdb(tmp_path):
    path=str(tmp_path/'accounts.db')
    with sqlite3.connect(path) as db:
        db.executescript("""
            CREATE TABLE paper_accounts(
                account_id TEXT PRIMARY KEY, initial_paise INTEGER, cash_paise INTEGER);
            CREATE TABLE paper_positions(
                trade_id TEXT PRIMARY KEY, account_id TEXT, status TEXT,
                entry_debit_paise INTEGER, exit_credit_paise INTEGER,
                net_pnl_paise INTEGER);
            INSERT INTO paper_accounts VALUES('PAPER_50K',5000000,5000000);
            INSERT INTO paper_accounts VALUES('PAPER_100K',10000000,10000000);""")
    return path

def test_fresh_paper_accounts_reconcile_without_invented_trade(cashdb):
    assert audit_cash_reconciliation(cashdb)=={
        'status':'BALANCED','accounts_verified':2,'positions_checked':0,
        'unresolved_positions':0,'cash_entries_permitted':True}

def test_immutable_buy_and_sell_bookkeeping_reconciles(cashdb):
    with sqlite3.connect(cashdb) as db:
        db.execute("UPDATE paper_accounts SET cash_paise=5000000-650025+810900 WHERE account_id='PAPER_50K'")
        db.execute("INSERT INTO paper_positions VALUES(?,?,?,?,?,?)",
                   ('PAPER_50K:s1','PAPER_50K','CLOSED',650025,810900,160875))
    assert audit_cash_reconciliation(cashdb)['positions_checked']==1

def test_unverifiable_exit_has_no_fictitious_credit(cashdb):
    with sqlite3.connect(cashdb) as db:
        db.execute("UPDATE paper_accounts SET cash_paise=5000000-650025 WHERE account_id='PAPER_50K'")
        db.execute("INSERT INTO paper_positions VALUES(?,?,?,?,?,?)",
                   ('PAPER_50K:s1','PAPER_50K','EXIT_UNVERIFIABLE',650025,None,None))
    state=audit_cash_reconciliation(cashdb)
    assert state['unresolved_positions']==1 and state['cash_entries_permitted']

def test_corrupt_cash_is_never_silently_recalculated(cashdb):
    with sqlite3.connect(cashdb) as db:
        db.execute("UPDATE paper_accounts SET cash_paise=cash_paise+1 WHERE account_id='PAPER_100K'")
    with pytest.raises(RuntimeError,match='does not reconcile'):
        audit_cash_reconciliation(cashdb)

def test_incorrect_closed_pnl_fails_closed(cashdb):
    with sqlite3.connect(cashdb) as db:
        db.execute("UPDATE paper_accounts SET cash_paise=5000000-650025+810900 WHERE account_id='PAPER_50K'")
        db.execute("INSERT INTO paper_positions VALUES(?,?,?,?,?,?)",
                   ('PAPER_50K:s1','PAPER_50K','CLOSED',650025,810900,160874))
    with pytest.raises(RuntimeError,match='realized P&L'):
        audit_cash_reconciliation(cashdb)

def test_unresolved_with_imaginary_credit_fails_closed(cashdb):
    with sqlite3.connect(cashdb) as db:
        db.execute("INSERT INTO paper_positions VALUES(?,?,?,?,?,?)",
                   ('PAPER_100K:s1','PAPER_100K','OPEN',650025,999,None))
    with pytest.raises(RuntimeError,match='fictional credit'):
        audit_cash_reconciliation(cashdb)

def test_unknown_paper_account_cannot_be_hidden(cashdb):
    with sqlite3.connect(cashdb) as db:
        db.execute("INSERT INTO paper_accounts VALUES('PAPER_EXTRA',100000,100000)")
    with pytest.raises(RuntimeError,match='account set'):
        audit_cash_reconciliation(cashdb)

def test_orphan_paper_position_is_rejected(cashdb):
    with sqlite3.connect(cashdb) as db:
        db.execute("INSERT INTO paper_positions VALUES(?,?,?,?,?,?)",
                   ('X:s1','PAPER_MISSING','OPEN',10000,None,None))
    with pytest.raises(RuntimeError,match='entry journal'):
        audit_cash_reconciliation(cashdb)

def test_negative_cash_from_disk_fails_closed(cashdb):
    with sqlite3.connect(cashdb) as db:
        db.execute("UPDATE paper_accounts SET cash_paise=-1 WHERE account_id='PAPER_50K'")
    with pytest.raises(RuntimeError,match='integer paise'):
        audit_cash_reconciliation(cashdb)

def test_textual_money_from_disk_fails_closed_without_type_coercion(cashdb):
    with sqlite3.connect(cashdb) as db:
        db.execute("UPDATE paper_accounts SET cash_paise='corrupt' WHERE account_id='PAPER_100K'")
    with pytest.raises(RuntimeError,match='integer paise'):
        audit_cash_reconciliation(cashdb)
