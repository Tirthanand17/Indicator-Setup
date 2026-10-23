"""Generate synthetic Python Premium/PaperBook exit reference results only."""
from __future__ import annotations
from dataclasses import asdict
from datetime import date, datetime, timedelta
from pathlib import Path
import json
import sys
from tempfile import TemporaryDirectory
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent/'cloud-alerts'))
from cloud_alerts.models import Contract,OptionQuote  # noqa: E402
from cloud_alerts.paper_book import PaperBook  # noqa: E402
from cloud_alerts.premium import PremiumHypothesis,reference_from_quote,evaluate_bid  # noqa: E402

IST = ZoneInfo('Asia/Kolkata')
ENTRY = datetime(2026,10,23,10,0,0,tzinfo=IST)
CONTRACT = Contract(2026102301,'NIFTY26OCT23000CE','2026-10-29',65,23000,'CE')


def quote(bid:float, ask:float, when:datetime, *, bid_qty:int=195, ask_qty:int=195)->OptionQuote:
    return OptionQuote(CONTRACT,bid,ask,bid_qty,ask_qty,when - timedelta(seconds=4))


def js_quote(q:OptionQuote)->dict:
    return {'contract':asdict(q.contract),'bid':q.bid,'ask':q.ask,
        'bid_quantity':q.bid_quantity,'ask_quantity':q.ask_quantity,
        'updatedMs':int(q.updated.timestamp()*1000)}


entry_quote=quote(99,100,ENTRY)
ref=reference_from_quote(entry_quote,futures_symbol='NIFTY26OCTFUT',
    signal_candle=ENTRY-timedelta(minutes=5),created_at=ENTRY,hypothesis=PremiumHypothesis())

premium=[]
for name,bid,ask in [('stop',80,80.50),('hold',105,105.50),('target',140,140.50)]:
    now=ENTRY+timedelta(minutes=1)
    q=quote(bid,ask,now)
    premium.append({'name':name,'reference':ref,'quote':js_quote(q),
        'nowMs':int(now.timestamp()*1000),'expected':evaluate_bid(ref,q,now)})

references=[]
for ask in (100,100.05,100.10,142.35,211.80):
    q=quote(ask-0.5,ask,ENTRY)
    references.append({'quote':js_quote(q),'signalCandleMs':int((ENTRY-timedelta(minutes=5)).timestamp()*1000),
        'createdAtMs':int(ENTRY.timestamp()*1000),'futuresSymbol':'NIFTY26OCTFUT',
        'expected':reference_from_quote(q,futures_symbol='NIFTY26OCTFUT',
        signal_candle=ENTRY-timedelta(minutes=5),created_at=ENTRY,hypothesis=PremiumHypothesis())})

paper=[]
for name,bid,ask,now,account,qty in (
    ('STOP',80,80.5,ENTRY+timedelta(minutes=1),'PAPER_50K',195),
    ('TARGET',145,145.5,ENTRY+timedelta(minutes=1),'PAPER_50K',195),
    ('HOLD',108,108.5,ENTRY+timedelta(minutes=1),'PAPER_50K',195),
    ('TIME',105,105.5,datetime(2026,10,23,15,15,0,tzinfo=IST),'PAPER_50K',195),
    ('WAIT_DEPTH',100,100.5,ENTRY+timedelta(minutes=1),'PAPER_100K',65),
    ('DUPLICATE',100,100.5,ENTRY+timedelta(minutes=1),'PAPER_50K',195),
    ('UNVERIFIABLE',100,100.5,ENTRY+timedelta(minutes=1),'PAPER_50K',195),
    ('WAIT_VALUE',0.99,1.0,ENTRY+timedelta(minutes=1),'PAPER_50K',195),
):
    with TemporaryDirectory(prefix='synthetic-exit-oracle-') as temp:
        book=PaperBook(str(Path(temp)/'paper.sqlite'))
        opened=book.enter('SYNTHETIC_CASE_20261023',entry_quote,ENTRY,account_id=account)
        if opened['status']!='OPEN':
            raise RuntimeError(f'expected opening for {name}, got {opened}')
        position=book.open_positions()[0]
        if name=='DUPLICATE':
            with book._db() as db:
                db.execute("UPDATE paper_positions SET status='CLOSED' WHERE trade_id=?",(position['trade_id'],))
            position['status']='CLOSED'
        if name=='UNVERIFIABLE':
            with book._db() as db:
                db.execute("UPDATE paper_positions SET status='EXIT_UNVERIFIABLE' WHERE trade_id=?",(position['trade_id'],))
            position['status']='EXIT_UNVERIFIABLE'
        if name=='WAIT_VALUE':
            # Deliberately pathological synthetic legacy charge: no position
            # may be credited a negative exit value.
            with book._db() as db:
                db.execute("UPDATE paper_positions SET fee_model_version='FIXED_RS_V1', "
                    "exit_fee_assumed_paise=20000 WHERE trade_id=?",(position['trade_id'],))
            position['fee_model_version']='FIXED_RS_V1'
            position['exit_fee_assumed_paise']=20000
        q=quote(bid,ask,now,bid_qty=qty)
        result=book.exit(position['trade_id'],q,now)
        paper.append({'name':name,'position':position,'quote':js_quote(q),
            'nowMs':int(now.timestamp()*1000),'expected':result})

output={'source':'SYNTHETIC_PYTHON_PREMIUM_AND_PAPERBOOK_EXIT',
    'premium':premium,'references':references,'paper':paper}
(ROOT/'exit-parity-fixtures.json').write_text(json.dumps(output,separators=(',',':'))+'\n',encoding='utf-8')
print('premium',len(premium),'paper',[(p['name'],p['expected']['status']) for p in paper])
