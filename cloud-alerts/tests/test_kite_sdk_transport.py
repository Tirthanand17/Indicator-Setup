"""Offline transport policy tests: fake Kite SDK, no broker or internet calls."""
from datetime import datetime
from types import ModuleType
from zoneinfo import ZoneInfo
import sys
import requests
import pytest

from cloud_alerts.kite_readonly import KiteReadOnly


class FakeSDK:
    created = []
    override = {}

    def __init__(self, **kw):
        self.kw = kw
        self.root = self.override.get('root', 'https://api.kite.trade')
        self.disable_ssl = self.override.get('disable_ssl', False)
        self.debug = self.override.get('debug', False)
        self.proxies = self.override.get('proxies', {})
        self.reqsession = self.override.get('reqsession', requests.Session())
        if isinstance(self.reqsession, requests.Session):
            self.reqsession.trust_env = True
        self.token = None
        self.created.append(self)

    def set_access_token(self, value):
        self.token = value

    def instruments(self, name):
        return [{'exchange': name}]

    def historical_data(self, *args, **kwargs):
        return [{'date': '2026-10-19T09:15:00+05:30',
                 'open': 10, 'high': 12, 'low': 9, 'close': 11, 'volume': 42}]

    def quote(self, names):
        return {names[0]: {'last_price': 12.3}}


@pytest.fixture(autouse=True)
def install_stub(monkeypatch):
    FakeSDK.created.clear()
    FakeSDK.override = {}
    module = ModuleType('kiteconnect')
    module.KiteConnect = FakeSDK
    monkeypatch.setitem(sys.modules, 'kiteconnect', module)


def test_direct_sdk_transport_policy_and_readonly_methods(monkeypatch):
    for name in ('HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY',
                 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE'):
        monkeypatch.setenv(name, 'https://unapproved.invalid')
    client = KiteReadOnly('public_fake_api', 'fake_bearer_access')
    sdk = client._sdk
    assert sdk.kw['disable_ssl'] is False
    assert sdk.kw['proxies'] == {} and sdk.kw['debug'] is False
    assert sdk.reqsession.trust_env is False
    assert sdk.reqsession.max_redirects == 0
    assert sdk.token == 'fake_bearer_access'
    assert client.instruments_nfo() == [{'exchange': 'NFO'}]
    assert client.full_quote('NIFTY') == {'last_price': 12.3}
    now = datetime.now(ZoneInfo('Asia/Kolkata'))
    assert client.historical(1, '5minute', now, now)[0].volume == 42


@pytest.mark.parametrize('field,value', [
    ('root', 'http://api.kite.trade'),
    ('root', 'https://attacker.invalid'),
    ('root', 'https://api.kite.trade/redirect'),
    ('disable_ssl', True),
    ('debug', True),
    ('proxies', {'https': 'http://hostile.invalid'}),
])
def test_unsafe_sdk_does_not_receive_token(field, value):
    FakeSDK.override = {field: value}
    with pytest.raises(RuntimeError):
        KiteReadOnly('fake_api', 'bearer')
    assert FakeSDK.created[-1].token is None


@pytest.mark.parametrize('value', [object(), None])
def test_unknown_sdk_session_fails_closed(value):
    FakeSDK.override = {'reqsession': value}
    with pytest.raises(RuntimeError):
        KiteReadOnly('fake_api', 'bearer')
    assert FakeSDK.created[-1].token is None


def test_credentials_required_before_sdk_creation():
    with pytest.raises(ValueError):
        KiteReadOnly('', 'access')
    assert not FakeSDK.created


def test_unsupported_interval_never_fetches_from_sdk():
    client = KiteReadOnly('fake_api', 'bearer')
    with pytest.raises(ValueError):
        client.historical(1, 'minute', datetime.now(), datetime.now())
