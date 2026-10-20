"""Phase 36: synthetic outbound HTTPS isolation; never connect to live hosts."""
from pathlib import Path
from types import SimpleNamespace
import requests
import pytest

from cloud_alerts import token_sender
from cloud_alerts.telegram import Telegram
from cloud_alerts.token_sender import validate_endpoint

APP='FAKEAPPKEY12345678'
ACCESS='FAKE_NOT_REAL_'+'A'*30
HMAC='FAKE_OWNED_RANDOM_KEY_'+'k'*55
URL='https://alerts.example.com/internal/token'


@pytest.mark.parametrize('url', [
    'https://127.0.0.1/internal/token',
    'https://localhost/internal/token',
    'https://host.internal/internal/token',
    'https://host.local/internal/token',
    'https://alerts.example.com:8443/internal/token',
    'https://alerts.example.com:8080/internal/token',
    'https://alerts.example.com/healthz',
    'https://alerts.example.com/internal/token?debug=1',
    'https://user:password@alerts.example.com/internal/token',
    'https://alerts.example.com//internal/token',
    'https://a..b.example/internal/token',
])
def test_reject_ambiguous_or_private_token_host(url):
    with pytest.raises(ValueError,match='HTTPS'):
        validate_endpoint(url)


def test_allow_normal_and_explicit_443_https():
    validate_endpoint(URL)
    validate_endpoint('https://alerts.example.com:443/internal/token')


class TrappedSession:
    def __init__(self, result=None, failure=None):
        self.trust_env = True
        self.calls = []
        self.result = result
        self.failure = failure
        self.closed = False
    def __enter__(self):
        return self
    def __exit__(self, *args):
        self.closed = True
        return False
    def post(self, url, **kwargs):
        self.calls.append((url, kwargs, self.trust_env))
        assert self.trust_env is False, 'ambient proxy/CA settings must be ignored'
        assert kwargs['verify'] is True, 'TLS certificate verification is mandatory'
        assert kwargs['allow_redirects'] is False, 'token-bearing redirects prohibited'
        assert kwargs['timeout'] in (7, 10)
        if self.failure:
            raise self.failure
        return self.result


def test_token_handoff_ignores_proxy_and_ca_overrides(tmp_path,monkeypatch):
    source=tmp_path/'readonly-source.env'
    before=(f'ZERODHA_KITE_API_KEY={APP}\nZERODHA_KITE_ACCESS_TOKEN={ACCESS}\n'
            'ZERODHA_KITE_API_SECRET=DO_NOT_SEND\n').encode()
    source.write_bytes(before)
    for name in ('HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','REQUESTS_CA_BUNDLE','CURL_CA_BUNDLE'):
        monkeypatch.setenv(name,'http://intentionally-untrusted-proxy.invalid:8080')
    trapped=TrappedSession(SimpleNamespace(status_code=200,json=lambda:{'status':'TOKEN_ACCEPTED'}))
    monkeypatch.setattr(token_sender.requests,'Session',lambda:trapped)
    fingerprint=token_sender.push_once(source,URL,HMAC,APP)
    assert len(fingerprint)==12
    assert len(trapped.calls)==1 and trapped.closed
    url,kw,trust=trapped.calls[0]
    assert url==URL and trust is False
    assert kw['data'].count(ACCESS.encode())==1
    assert b'DO_NOT_SEND' not in kw['data']
    assert source.read_bytes()==before


def test_token_handoff_fails_closed_on_untrusted_certificate(tmp_path,monkeypatch):
    source=tmp_path/'readonly-source.env'
    source.write_text(f'ZERODHA_KITE_API_KEY={APP}\nZERODHA_KITE_ACCESS_TOKEN={ACCESS}\n')
    trapped=TrappedSession(failure=requests.exceptions.SSLError('secret intercepted'))
    monkeypatch.setattr(token_sender.requests,'Session',lambda:trapped)
    with pytest.raises(RuntimeError,match='Cloud token relay unavailable') as err:
        token_sender.push_once(source,URL,HMAC,APP)
    assert 'secret intercepted' not in str(err.value)
    assert trapped.closed


def test_no_network_or_secret_file_read_for_invalid_host(monkeypatch):
    monkeypatch.setattr(token_sender,'read_env_values',lambda _:pytest.fail('must not read protected file'))
    monkeypatch.setattr(token_sender.requests,'Session',lambda:pytest.fail('must not start HTTP'))
    with pytest.raises(ValueError,match='HTTPS'):
        token_sender.push_once(Path('/unneeded/source.env'),'https://127.0.0.1/internal/token',HMAC,APP)


def test_telegram_direct_https_no_ambient_proxy(monkeypatch):
    for name in ('HTTPS_PROXY','ALL_PROXY','REQUESTS_CA_BUNDLE'):
        monkeypatch.setenv(name,'http://hostile-proxy.invalid:8080')
    trapped=TrappedSession(SimpleNamespace(status_code=200,json=lambda:{'ok':True}))
    monkeypatch.setattr('cloud_alerts.telegram.requests.Session',lambda:trapped)
    Telegram('FAKE_BOT_TOKEN_NO_REAL_AUTH','12345678').send('TEST ONLY')
    assert len(trapped.calls)==1 and trapped.closed
    url,kwargs,trust=trapped.calls[0]
    assert url.startswith('https://api.telegram.org/bot')
    assert url.endswith('/sendMessage')
    assert kwargs['json']['text']=='TEST ONLY'
    assert trust is False


def test_telegram_rejects_tls_errors_without_leaking_provider_error(monkeypatch):
    trapped=TrappedSession(failure=requests.exceptions.SSLError('FAKE_TOKEN_IN_PROVIDER_ERROR'))
    monkeypatch.setattr('cloud_alerts.telegram.requests.Session',lambda:trapped)
    with pytest.raises(RuntimeError,match='Telegram delivery failed') as err:
        Telegram('FAKE_BOT','12345678').send('TEST ONLY')
    assert 'FAKE_TOKEN_IN_PROVIDER_ERROR' not in str(err.value)
    assert trapped.closed


def test_telegram_rejects_redirect_without_following(monkeypatch):
    trapped=TrappedSession(SimpleNamespace(status_code=302,json=lambda:{'ok':True}))
    monkeypatch.setattr('cloud_alerts.telegram.requests.Session',lambda:trapped)
    with pytest.raises(RuntimeError,match='Telegram delivery failed'):
        Telegram('FAKE_BOT','12345678').send('TEST ONLY')
    assert len(trapped.calls)==1 and trapped.closed
