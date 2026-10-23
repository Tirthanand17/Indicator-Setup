"""Offline official REST contract tests; no SDK or network required."""
from datetime import datetime
from zoneinfo import ZoneInfo
import json
import requests
import pytest
from cloud_alerts.kite_readonly import KiteReadOnly

NOW = datetime(2026,10,19,9,15,tzinfo=ZoneInfo('Asia/Kolkata'))

@pytest.fixture
def fake(monkeypatch):
    calls=[]
    payload={'status':'success','data':{}}
    status=[200]
    def send(session, request, **kwargs):
        calls.append((request,kwargs))
        response=requests.Response()
        response.status_code=status[0]
        response._content=json.dumps(payload).encode()
        response.headers['Content-Type']='application/json'
        return response
    monkeypatch.setattr(requests.Session,'send',send)
    return calls,payload,status

def test_direct_transport_and_quote(fake,monkeypatch):
    calls,payload,_=fake
    monkeypatch.setenv('HTTPS_PROXY','http://unapproved.invalid')
    payload['data']={'NFO:NIFTY26OCTFUT':{'last_price':123}}
    with_client=KiteReadOnly('synthetic','synthetic')
    assert not hasattr(with_client,'_sdk')
    assert with_client._session.trust_env is False
    assert with_client.full_quote('NIFTY26OCTFUT')=={'last_price':123}
    request,options=calls[0]
    assert request.method=='GET' and request.headers['X-Kite-Version']=='3'
    assert options['allow_redirects'] is False and options['verify'] is True
    assert options['proxies']=={}
    with_client.close()

def test_history_preserves_exchange_time_and_volume(fake):
    calls,payload,_=fake
    payload['data']={'candles':[['2026-10-19T09:15:00+0530',10,12,9,11,42]]}
    candle=KiteReadOnly('synthetic','synthetic').historical(1,'5minute',NOW,NOW)[0]
    assert candle.start==NOW and candle.volume==42
    assert 'continuous=0' in calls[0][0].url

@pytest.mark.parametrize('row',[
    ['2026-10-19T09:15:00',10,12,9,11,42],
    ['2026-10-19T09:15:00+0530',10,12,9,11,True],
    ['2026-10-19T09:15:00+0530',10,12,9,11,1.5],
    ['2026-10-19T09:15:00+0530',10,8,9,11,42],
])
def test_malformed_history_fails_closed(fake,row):
    fake[1]['data']={'candles':[row]}
    with pytest.raises(ValueError):
        KiteReadOnly('synthetic','synthetic').historical(1,'5minute',NOW,NOW)

@pytest.mark.parametrize('status',[302,403,429,500])
def test_http_failure_redacted(fake,status):
    fake[2][0]=status
    fake[1]['message']='secret-like remote content'
    with pytest.raises(RuntimeError) as exc:
        KiteReadOnly('synthetic','synthetic').full_quote('NIFTY26OCTFUT')
    assert 'secret-like' not in str(exc.value)

@pytest.mark.parametrize('token,interval',[(True,'5minute'),(1,'minute'),(-1,'15minute')])
def test_invalid_request_never_sends(fake,token,interval):
    with pytest.raises(ValueError):
        KiteReadOnly('synthetic','synthetic').historical(token,interval,NOW,NOW)
    assert not fake[0]

def test_missing_credentials():
    with pytest.raises(ValueError):KiteReadOnly('','synthetic')


def test_instrument_csv_types(monkeypatch):
    def send(session,request,**kwargs):
        response=requests.Response();response.status_code=200
        response.headers['Content-Type']='text/csv'
        response._content=(b'instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange\n'
            b'1,2,NIFTY26OCTFUT,NIFTY,100,2026-10-27,0,0.05,65,FUT,NFO-FUT,NFO\n')
        return response
    monkeypatch.setattr(requests.Session,'send',send)
    row=KiteReadOnly('synthetic','synthetic').instruments_nfo()[0]
    assert row['instrument_token']==1 and row['lot_size']==65
    assert row['expiry'].isoformat()=='2026-10-27'
