import pytest
from datetime import datetime,date,timedelta
from zoneinfo import ZoneInfo
from cloud_alerts.contracts import select_future,select_option,validate_quote
IST=ZoneInfo('Asia/Kolkata')
def instruments():
    return [{'name':'NIFTY','segment':'NFO-FUT','instrument_type':'FUT','expiry':'2026-10-29','tradingsymbol':'NIFTY26OCTFUT','instrument_token':11,'lot_size':65},
            {'name':'NIFTY','segment':'NFO-FUT','instrument_type':'FUT','expiry':'2026-11-26','tradingsymbol':'NIFTY26NOVFUT','instrument_token':22,'lot_size':65},
            *[{'name':'NIFTY','segment':'NFO-OPT','instrument_type':side,'expiry':exp,'strike':strike,'tradingsymbol':f'NIFTY{strike}{side}{exp}','instrument_token':k,'lot_size':65} for k,(side,strike,exp) in enumerate([('CE',22900,'2026-10-19'),('CE',22900,'2026-10-22'),('CE',23000,'2026-10-22'),('PE',22900,'2026-10-22'),('PE',22800,'2026-10-22')],100)]]

def test_dynamic_future_selection():
    assert select_future(instruments(),date(2026,10,19)).token==11
    assert select_future(instruments(),date(2026,11,1)).token==22
    with pytest.raises(ValueError):select_future(instruments(),date(2026,12,1))

def test_dynamic_option_expiry_skips_same_day():
    a=select_option(instruments(),date(2026,10,19),'CE',22902)
    assert a.expiry=='2026-10-22' and a.strike==22900
    b=select_option(instruments(),date(2026,10,19),'PE',22800)
    assert b.kind=='PE' and b.strike==22800
    c=select_option(instruments(),date(2026,10,19),'CE',22900,avoid_expiry_day=False)
    assert c.expiry=='2026-10-19'

def quote(ts,spread=1.0):
    return {'timestamp':ts,'depth':{'buy':[{'price':100,'quantity':100}], 'sell':[{'price':100+spread,'quantity':100}]}}

def test_option_quote_depth_and_freshness():
    now=datetime(2026,10,19,11,0,tzinfo=IST)
    c=select_option(instruments(),now.date(),'CE',22900)
    q=validate_quote(c,quote(now),now)
    assert q.ask>q.bid
    with pytest.raises(ValueError,match='stale'):validate_quote(c,quote(now-timedelta(seconds=30)),now)
    with pytest.raises(ValueError,match='spread'):validate_quote(c,quote(now,spread=8),now)
    a=quote(now);a['depth']['sell'][0]['quantity']=3
    with pytest.raises(ValueError,match='insufficient'):validate_quote(c,a,now)
