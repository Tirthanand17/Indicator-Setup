"""All tests use a fake HTTP session: no DNS, Kite, Telegram or cloud spend."""
from __future__ import annotations

from types import SimpleNamespace
from urllib.parse import urlsplit

import pytest
import requests

from cloud_alerts.gateway_acceptance import (
    DENIED_GET, DENIED_METHODS, main, probe_gateway,
)

ENDPOINT = 'https://alerts.example.com/internal/token'


class FakeSession:
    def __init__(self, *, status_overrides=None, dashboard_enabled=False,
                 health_headers=True, failures=()):
        self.trust_env = True
        self.requests = []
        self.status_overrides = status_overrides or {}
        self.dashboard_enabled = dashboard_enabled
        self.health_headers = health_headers
        self.failures = set(failures)

    def request(self, method, url, **kwargs):
        path = urlsplit(url).path
        size = len(kwargs.get('data', b''))
        self.requests.append((method, path, kwargs))
        if (method, path) in self.failures:
            raise requests.exceptions.SSLError('synthetic certificate secret')

        if method == 'GET' and path == '/gateway-healthz':
            status, body = 200, 'ok'
            headers = {'Cache-Control': 'no-store',
                       'X-Content-Type-Options': 'nosniff'} if self.health_headers else {}
        elif method == 'GET' and path == '/paper/dashboard' and self.dashboard_enabled:
            status, body = 200, '<html>synthetic only</html>'
            headers = {'Cache-Control': 'no-store',
                       'Content-Security-Policy': "frame-ancestors 'none'"}
        elif method == 'POST' and path == '/internal/token':
            status, body, headers = (413 if size > 2048 else 401), '', {}
        else:
            status, body, headers = 404, '', {}
        status = self.status_overrides.get((method, path, size), status)
        return SimpleNamespace(status_code=status, text=body, headers=headers)


def test_default_public_gateway_acceptance_has_no_credentials():
    session = FakeSession()
    result = probe_gateway(ENDPOINT, confirmed=True, requester=session)
    assert result.passed and not result.blockers
    assert result.public_report()['host_approved_by_this_probe'] is False
    assert result.public_report()['real_broker_token_used'] is False
    assert result.public_report()['dashboard_key_sent'] is False
    assert 'GATEWAY_HEALTH_ONLY' in result.checks
    assert 'OVERSIZE_TOKEN_REJECTED' in result.checks
    assert len(session.requests) == 1 + len(DENIED_GET) + len(DENIED_METHODS) + 1 + 2
    for method, path, kwargs in session.requests:
        assert method in ('GET', 'POST', 'HEAD')
        assert kwargs['verify'] is True
        assert kwargs['allow_redirects'] is False
        assert kwargs['timeout'] == 4.0
        if 'headers' in kwargs:
            assert kwargs['headers'] == {'Content-Type': 'application/json'}
        if 'data' in kwargs:
            assert kwargs['data'] in (b'{}', b'x' * 2049)
    assert session.trust_env is False
    assert 'alerts.example.com' not in str(result.public_report())


def test_probes_never_start_without_confirmation():
    session = FakeSession()
    with pytest.raises(ValueError):
        probe_gateway(ENDPOINT, confirmed=False, requester=session)
    assert not session.requests


@pytest.mark.parametrize('bad_url', [
    'http://alerts.example.com/internal/token',
    'https://alerts.example.com:8081/internal/token',
    'https://localhost/internal/token',
    'https://user:pass@alerts.example.com/internal/token',
    'https://alerts.example.com/internal/token?key=123',
    'https://alerts.example.com/healthz',
])
def test_rejects_unsafe_targets(bad_url):
    with pytest.raises(ValueError):
        probe_gateway(bad_url, confirmed=True, requester=FakeSession())


@pytest.mark.parametrize('timeout', [0, -1, 11, 99])
def test_rejects_unbounded_timeouts(timeout):
    with pytest.raises(ValueError):
        probe_gateway(ENDPOINT, confirmed=True, requester=FakeSession(), timeout=timeout)


def test_live_dashboard_shell_requires_expected_csp():
    session = FakeSession(dashboard_enabled=True)
    report = probe_gateway(ENDPOINT, confirmed=True, dashboard_enabled=True, requester=session)
    assert report.passed
    assert 'DASHBOARD_KEYED_SHELL_AVAILABLE' in report.checks
    assert all((m,p) != ('POST','/paper/dashboard') or k['data'] == b'{}'
               for m,p,k in session.requests if 'data' in k)


def test_dashboard_must_remain_off_unless_expected():
    report = probe_gateway(ENDPOINT, confirmed=True,
                           requester=FakeSession(dashboard_enabled=True))
    assert not report.passed
    assert 'DASHBOARD_EXPOSED_WHEN_DISABLED' in report.blockers


def test_enabled_dashboard_cannot_be_silently_missing():
    report = probe_gateway(ENDPOINT, confirmed=True, dashboard_enabled=True,
                           requester=FakeSession())
    assert not report.passed
    assert 'DASHBOARD_SHELL_SECURITY_UNVERIFIED' in report.blockers


@pytest.mark.parametrize('method,path,status,size', [
    ('GET', '/healthz', 200, 0),
    ('GET', '/paper/api/summary', 200, 0),
    ('GET', '/internal/token', 405, 0),
    ('HEAD', '/paper/api/summary', 200, 0),
    ('POST', '/paper/dashboard', 405, 0),
    ('POST', '/internal/token', 200, 2),
    ('POST', '/internal/token', 401, 2049),
])
def test_fails_closed_when_edge_rule_is_wrong(method, path, status, size):
    fake = FakeSession(status_overrides={(method, path, size): status})
    report = probe_gateway(ENDPOINT, confirmed=True, requester=fake)
    assert not report.passed
    assert report.blockers


def test_health_requires_gateway_body_and_security_headers():
    report = probe_gateway(ENDPOINT, confirmed=True,
                           requester=FakeSession(health_headers=False))
    assert not report.passed
    assert 'GATEWAY_HEALTH_UNEXPECTED' in report.blockers


def test_network_or_tls_failure_redacts_exception_details():
    report = probe_gateway(ENDPOINT, confirmed=True,
                           requester=FakeSession(failures={('GET','/healthz')}))
    assert not report.passed
    assert 'TLS_OR_NETWORK_CHECK_FAILED:GET:/healthz' in report.blockers
    assert 'synthetic certificate secret' not in str(report.public_report())


def test_cli_requires_explicit_opt_in_and_never_connects(capsys):
    assert main(['--endpoint', ENDPOINT, '--json']) == 2
    assert 'INVALID_OR_UNCONFIRMED_ENDPOINT' in capsys.readouterr().out
