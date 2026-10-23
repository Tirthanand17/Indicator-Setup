"""Opt-in synthetic HTTPS probe for the exact Northflank public gateway policy.

Only benign, unsigned requests. No protected Windows files, Kite credentials,
Telegram messages, account data, redirects, disabled TLS, or account changes.
A PASS does NOT authorize billing, deployment, secret activation, or trading.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import json

import requests

from .https_acceptance import validate_public_endpoint

DENIED_GET = (
    '/', '/healthz', '/readyz', '/operationalz', '/docs',
    '/openapi.json', '/orders', '/metrics', '/.env', '/internal/token',
    '/paper/api/summary', '/paper/api/analytics',
    '/paper/api/opportunities', '/paper/api/trades',
)
DENIED_METHODS = (
    ('POST', '/gateway-healthz'),
    ('POST', '/paper/dashboard'),
    ('POST', '/paper/api/summary'),
    ('POST', '/orders'),
    ('HEAD', '/paper/api/summary'),
)


@dataclass(frozen=True)
class GatewayReport:
    passed: bool
    checks: tuple[str, ...]
    blockers: tuple[str, ...]

    def public_report(self) -> dict:
        return {
            'mode': 'NORTHFLANK_GATEWAY_SYNTHETIC_HTTPS_PROBE',
            'result': 'PASS' if self.passed else 'BLOCKED',
            'checks': list(self.checks),
            'blockers': list(self.blockers),
            'real_broker_token_used': False,
            'telegram_message_sent': False,
            'dashboard_key_sent': False,
            'cloud_uptime_verified': False,
            'phone_receipt_verified': False,
            'host_approved_by_this_probe': False,
        }


def probe_gateway(endpoint: str, *, confirmed: bool,
                  dashboard_enabled: bool = False,
                  requester=None, timeout: float = 4.0) -> GatewayReport:
    """Verify the public edge with no secrets after an explicit opt-in.

    ``requester`` accepts an offline mock requests.Session for unit tests.
    The endpoint must be an HTTPS public FQDN on port 443 ending /internal/token.
    """
    base = validate_public_endpoint(endpoint)
    if not confirmed:
        raise ValueError('explicit network-check confirmation is required')
    if not 0.1 <= timeout <= 10:
        raise ValueError('timeout out of bounds')
    session = requester if requester is not None else requests.Session()
    session.trust_env = False
    checks: list[str] = []
    blockers: list[str] = []

    def request(method: str, path: str, **kwargs):
        try:
            return session.request(
                method, base + path, timeout=timeout,
                allow_redirects=False, verify=True, **kwargs)
        except requests.RequestException:
            blockers.append('TLS_OR_NETWORK_CHECK_FAILED:' + method + ':' + path)
            return None

    def expect(method: str, path: str, acceptable: tuple[int, ...], name: str,
               **kwargs) -> None:
        response = request(method, path, **kwargs)
        if response is None:
            return
        if response.status_code in acceptable:
            checks.append(name)
        else:
            blockers.append('EDGE_POLICY_FAILED:' + method + ':' + path)

    try:
        health = request('GET', '/gateway-healthz')
        if health is not None:
            headers = health.headers
            if (health.status_code == 200 and health.text.strip() == 'ok'
                    and headers.get('Cache-Control') == 'no-store'
                    and headers.get('X-Content-Type-Options') == 'nosniff'):
                checks.append('GATEWAY_HEALTH_ONLY')
            else:
                blockers.append('GATEWAY_HEALTH_UNEXPECTED')

        for path in DENIED_GET:
            expect('GET', path, (403, 404), 'GET_DENIED:' + path)

        for method, path in DENIED_METHODS:
            expect(method, path, (403, 404), 'METHOD_DENIED:' + method + ':' + path)

        dashboard = request('GET', '/paper/dashboard')
        if dashboard is not None:
            if not dashboard_enabled:
                if dashboard.status_code == 404:
                    checks.append('DASHBOARD_DISABLED')
                else:
                    blockers.append('DASHBOARD_EXPOSED_WHEN_DISABLED')
            elif (dashboard.status_code == 200
                  and "frame-ancestors 'none'" in
                  dashboard.headers.get('Content-Security-Policy', '')
                  and dashboard.headers.get('Cache-Control') == 'no-store'):
                checks.append('DASHBOARD_KEYED_SHELL_AVAILABLE')
            else:
                blockers.append('DASHBOARD_SHELL_SECURITY_UNVERIFIED')

        # Intentionally unsigned; the response must be 401 from the worker.
        expect('POST', '/internal/token', (401,), 'UNSIGNED_TOKEN_REJECTED',
               data=b'{}', headers={'Content-Type': 'application/json'})

        # Prove the 2 KiB cap without sending any meaningful JSON/credentials.
        expect('POST', '/internal/token', (413,), 'OVERSIZE_TOKEN_REJECTED',
               data=b'x' * 2049,
               headers={'Content-Type': 'application/json'})
    finally:
        if requester is None:
            session.close()

    return GatewayReport(not blockers, tuple(checks), tuple(blockers))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description='Opt-in Northflank gateway policy probe (no secrets)')
    parser.add_argument('--endpoint', required=True,
                        help='https://public.example.com/internal/token')
    parser.add_argument('--confirm-network-checks', action='store_true')
    parser.add_argument('--dashboard-enabled', action='store_true',
                        help='Expect HTML shell to be on; JSON remains key-protected')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args(argv)
    try:
        report = probe_gateway(
            args.endpoint, confirmed=args.confirm_network_checks,
            dashboard_enabled=args.dashboard_enabled)
    except ValueError:
        report = GatewayReport(False, (), ('INVALID_OR_UNCONFIRMED_ENDPOINT',))
    if args.json:
        print(json.dumps(report.public_report(), sort_keys=True))
    else:
        print('GATEWAY_HTTPS=' + ('PASS' if report.passed else 'BLOCKED'))
        for blocker in report.blockers:
            print('BLOCKER: ' + blocker)
    return 0 if report.passed else 2


if __name__ == '__main__':
    raise SystemExit(main())
