"""Opt-in external HTTPS ingress acceptance probe with NO broker credentials.

Never follows redirects, never disables TLS certificate verification, never
reads the protected .env, and never sends a real signed token. This is NOT
cloud deployment, proof of uptime, or Telegram phone delivery.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import ipaddress
import json
import re
from urllib.parse import urlsplit

import requests


PUBLIC_PRIVATE_PATHS = ('/', '/healthz', '/readyz', '/operationalz', '/docs', '/openapi.json')


@dataclass(frozen=True)
class ProbeReport:
    passed: bool
    checks: tuple[str, ...]
    blockers: tuple[str, ...]

    def public_report(self) -> dict:
        return {
            'mode': 'UNAUTHENTICATED_HTTPS_INGRESS_PROBE',
            'result': 'PASS' if self.passed else 'BLOCKED',
            'checks': list(self.checks),
            'blockers': list(self.blockers),
            'real_broker_token_used': False,
            'telegram_message_sent': False,
            'cloud_uptime_verified': False,
            'phone_receipt_verified': False,
            'host_approved_by_this_probe': False,
        }


def validate_public_endpoint(endpoint: str) -> str:
    """Accept only a non-local FQDN on HTTPS 443 with the exact token path."""
    if not isinstance(endpoint, str) or len(endpoint) > 512:
        raise ValueError('invalid endpoint')
    try:
        parsed = urlsplit(endpoint)
        hostname = parsed.hostname or ''
        port = parsed.port
    except ValueError:
        raise ValueError('invalid endpoint') from None
    if (parsed.scheme != 'https' or parsed.netloc != hostname and parsed.netloc != hostname+':443'
            or parsed.path != '/internal/token' or parsed.query or parsed.fragment
            or port not in (None, 443)):
        raise ValueError('exact HTTPS token endpoint on port 443 required')
    if (hostname.lower() in {'localhost', 'localhost.localdomain'}
            or hostname.endswith(('.localhost', '.local', '.internal'))
            or not re.fullmatch(r'[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+', hostname)):
        raise ValueError('public FQDN required')
    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        pass
    else:
        raise ValueError('numeric IP address prohibited')
    return f'https://{hostname}'


def probe_public_ingress(endpoint: str, *, confirmed: bool,
                         requester=None, timeout: float = 4.0) -> ProbeReport:
    """Probe public ingress only after explicit operator confirmation.

    ``requester`` may be a mocked requests.Session in offline tests. No proxy
    environment variables, redirects, or untrusted TLS are accepted.
    """
    base = validate_public_endpoint(endpoint)
    if not confirmed:
        raise ValueError('explicit network-check confirmation is required')
    if not 0.1 <= timeout <= 10.0:
        raise ValueError('timeout out of bounds')
    session = requester if requester is not None else requests.Session()
    session.trust_env = False
    checks = []
    blockers = []
    try:
        for path in PUBLIC_PRIVATE_PATHS + ('/internal/token',):
            try:
                response = session.request('GET', base + path,
                                           timeout=timeout, allow_redirects=False,
                                           verify=True)
                if response.status_code in (403, 404):
                    checks.append('PRIVATE_GET_BLOCKED:' + path)
                else:
                    blockers.append('PRIVATE_GET_EXPOSED_OR_UNVERIFIED:' + path)
            except requests.RequestException:
                blockers.append('TLS_OR_NETWORK_CHECK_FAILED:' + path)
        # One harmless unsigned request; never send a real access token,
        # API key, HMAC signature, nonce or Telegram credential.
        try:
            response = session.request('POST', base + '/internal/token',
                                       data=b'{}', headers={'Content-Type': 'application/json'},
                                       timeout=timeout, allow_redirects=False, verify=True)
            if response.status_code == 401:
                checks.append('UNSIGNED_TOKEN_POST_REJECTED')
            else:
                blockers.append('UNSIGNED_TOKEN_POST_NOT_REJECTED')
        except requests.RequestException:
            blockers.append('TLS_OR_NETWORK_CHECK_FAILED:TOKEN_POST')
    finally:
        if requester is None:
            session.close()
    return ProbeReport(not blockers, tuple(checks), tuple(blockers))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Explicit HTTPS ingress acceptance probe (no credentials)')
    parser.add_argument('--endpoint', required=True)
    parser.add_argument('--confirm-network-checks', action='store_true')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args(argv)
    try:
        result = probe_public_ingress(args.endpoint, confirmed=args.confirm_network_checks)
    except ValueError:
        result = ProbeReport(False, (), ('INVALID_OR_UNCONFIRMED_ENDPOINT',))
    print(json.dumps(result.public_report(), sort_keys=True) if args.json
          else ('HTTPS_INGRESS=' + ('PASS' if result.passed else 'BLOCKED') + '\n' +
                '\n'.join('BLOCKER: ' + code for code in result.blockers)))
    return 0 if result.passed else 2


if __name__ == '__main__':
    raise SystemExit(main())
