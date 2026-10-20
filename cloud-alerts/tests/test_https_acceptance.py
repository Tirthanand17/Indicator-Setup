"""No real network connections, DNS queries, Kite or Telegram requests."""
from types import SimpleNamespace
import pytest
import requests
from cloud_alerts.https_acceptance import (validate_public_endpoint,
                                           probe_public_ingress, main)

VALID = 'https://alerts.example.com/internal/token'


@pytest.mark.parametrize('url', [
    'http://alerts.example.com/internal/token',
    'https://alerts.example.com/internal/token?debug=1',
    'https://alerts.example.com/internal/token#fragment',
    'https://user:password@alerts.example.com/internal/token',
    'https://alerts.example.com:8080/internal/token',
    'https://localhost/internal/token',
    'https://127.0.0.1/internal/token',
    'https://host.internal/internal/token',
    'https://alerts.example.com/healthz',
    'https://alerts.example.com//internal/token',
])
def test_reject_unsafe_endpoint(url):
    with pytest.raises(ValueError):
        validate_public_endpoint(url)


def test_accept_only_https_443_public_fqdn():
    assert validate_public_endpoint(VALID) == 'https://alerts.example.com'
    assert validate_public_endpoint('https://alerts.example.com:443/internal/token') == 'https://alerts.example.com'


class MockRequests:
    def __init__(self, changes=None, failure=None):
        self.requests = []
        self.trust_env = True
        self.changes = changes or {}
        self.failure = failure
    def request(self, method, url, **kwargs):
        self.requests.append((method, url, kwargs))
        if self.failure and self.failure in url:
            raise requests.exceptions.SSLError('synthetic certificate failure')
        status = self.changes.get((method, url), 401 if method=='POST' else 404)
        return SimpleNamespace(status_code=status)


def test_network_never_started_without_confirmation():
    client=MockRequests()
    with pytest.raises(ValueError):
        probe_public_ingress(VALID,confirmed=False,requester=client)
    assert client.requests == []


def test_successful_ingress_has_strict_tls_no_redirects_and_no_secrets():
    client=MockRequests()
    report=probe_public_ingress(VALID,confirmed=True,requester=client)
    assert report.passed and len(client.requests)==8
    for method,url,kwargs in client.requests:
        assert method in ('GET','POST')
        assert url.startswith('https://alerts.example.com/')
        assert kwargs['verify'] is True
        assert kwargs['allow_redirects'] is False
        assert kwargs['timeout']==4.0
        if method == 'POST':
            assert kwargs['data']==b'{}'
            assert kwargs['headers']=={'Content-Type':'application/json'}
    report_text=str(report.public_report())
    assert 'alerts.example.com' not in report_text
    assert 'real_broker_token_used' in report.public_report()
    assert report.public_report()['cloud_uptime_verified'] is False
    assert client.trust_env is False


def test_exposed_health_route_is_blocker():
    client=MockRequests({('GET','https://alerts.example.com/healthz'):200})
    report=probe_public_ingress(VALID,confirmed=True,requester=client)
    assert not report.passed
    assert 'PRIVATE_GET_EXPOSED_OR_UNVERIFIED:/healthz' in report.blockers


def test_unauthenticated_post_must_be_401_and_not_redirected():
    client=MockRequests({('POST', VALID):302})
    report=probe_public_ingress(VALID,confirmed=True,requester=client)
    assert not report.passed
    assert 'UNSIGNED_TOKEN_POST_NOT_REJECTED' in report.blockers


def test_tls_failure_does_not_expose_underlying_exception():
    client=MockRequests(failure='/healthz')
    report=probe_public_ingress(VALID,confirmed=True,requester=client)
    assert not report.passed
    assert 'TLS_OR_NETWORK_CHECK_FAILED:/healthz' in report.blockers
    assert 'synthetic certificate failure' not in str(report.public_report())


def test_cli_refuses_network_without_confirmation(capsys):
    assert main(['--endpoint', VALID, '--json'])==2
    assert 'INVALID_OR_UNCONFIRMED_ENDPOINT' in capsys.readouterr().out
