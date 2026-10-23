"""Prepared synthetic HTTP requests; forbidden APIs are never invoked."""
import pytest
import requests
from cloud_alerts.kite_readonly import _MarketDataAdapter


@pytest.mark.parametrize('method,path', [
    ('POST','/orders/regular'), ('PUT','/orders/regular/1'),
    ('DELETE','/orders/regular/1'), ('POST','/gtt/triggers'),
    ('DELETE','/session/token'), ('GET','/orders'), ('GET','/user/margins'),
    ('GET','/quote/ltp'), ('POST','/quote'),
    ('GET','/instruments/historical/1/minute'),
])
def test_denied_request_never_reaches_network(monkeypatch, method, path):
    monkeypatch.setattr(requests.adapters.HTTPAdapter, 'send',
                        lambda *_a, **_k: pytest.fail('network boundary crossed'))
    prepared = requests.Request(method, 'https://api.kite.trade'+path).prepare()
    with pytest.raises(RuntimeError, match='read-only'):
        _MarketDataAdapter().send(prepared)


@pytest.mark.parametrize('url', ['http://api.kite.trade/quote',
    'https://attacker.invalid/quote', 'https://api.kite.trade:444/quote',
    'https://user@api.kite.trade/quote', 'https://api.kite.trade/quote#fragment'])
def test_noncanonical_host_denied(monkeypatch, url):
    monkeypatch.setattr(requests.adapters.HTTPAdapter, 'send',
                        lambda *_a, **_k: pytest.fail('network boundary crossed'))
    with pytest.raises(RuntimeError):
        _MarketDataAdapter().send(requests.Request('GET', url).prepare())


def test_allowed_reads_and_shared_rate_pacing(monkeypatch):
    from cloud_alerts import kite_readonly as module
    clock=[100.0]
    sleeps=[]
    monkeypatch.setattr(module.time,'monotonic',lambda:clock[0])
    def sleep(delay):
        sleeps.append(delay)
        clock[0]+=delay
    monkeypatch.setattr(module.time,'sleep',sleep)
    monkeypatch.setattr(_MarketDataAdapter,'_last',{})
    monkeypatch.setattr(requests.adapters.HTTPAdapter,'send',lambda *_a,**_k:'synthetic')
    for path in ['/quote','/quote','/instruments/NFO',
                 '/instruments/historical/1/5minute','/instruments/historical/2/15minute']:
        assert _MarketDataAdapter().send(requests.Request('GET','https://api.kite.trade'+path).prepare())=='synthetic'
    assert sleeps == pytest.approx([1.05, .35])
