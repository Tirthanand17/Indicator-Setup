"""Offline-only real-HTTP, two-process token-handoff rehearsal.

All keys and tokens are synthetic and transient; the service binds exclusively
on IPv4 loopback. Broker monitoring is disabled, no Telegram request is made,
and there is no TLS, public host, production preflight or Docker claim.
"""
from __future__ import annotations

from contextlib import contextmanager
from cryptography.fernet import Fernet
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

from .security import TokenVault, signature

LOCAL_HOST = '127.0.0.1'


def _request(url: str, *, content: bytes | None = None,
             headers: dict[str, str] | None = None, timeout: float = 1.5) -> tuple[int, bytes]:
    request = urllib.request.Request(url, data=content, headers=headers or {},
                                     method='POST' if content is not None else 'GET')
    # Never use inherited HTTP_PROXY/HTTPS_PROXY for this local-only rehearsal.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(request, timeout=timeout) as response:
            return response.status, response.read(4096)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(4096)


def _unused_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((LOCAL_HOST, 0))
        return int(sock.getsockname()[1])


@contextmanager
def _server(state_dir: Path, env: dict[str, str], port: int, *, startup_timeout: float = 12.0):
    """Start actual ASGI/Uvicorn HTTP server without production secrets."""
    base = Path(__file__).resolve().parents[1]
    cmd = [sys.executable, '-m', 'uvicorn', 'cloud_alerts.main:app',
           '--host', LOCAL_HOST, '--port', str(port), '--workers', '1', '--no-access-log']
    options = {'umask': 0o077} if os.name == 'posix' else {}
    proc = subprocess.Popen(cmd, cwd=base, env=env,
                            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, **options)
    try:
        endpoint = f'http://{LOCAL_HOST}:{port}'
        until = time.monotonic() + startup_timeout
        while time.monotonic() < until:
            if proc.poll() is not None:
                raise RuntimeError('synthetic loopback worker exited before ready')
            try:
                code, _ = _request(endpoint + '/healthz', timeout=0.5)
                if code == 200:
                    break
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                pass
            time.sleep(0.1)
        else:
            raise RuntimeError('synthetic loopback worker did not become healthy')
        yield endpoint
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=6)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=3)


def run_smoke(*, timeout: float = 12.0) -> dict:
    """Perform real localhost HTTP and process-restart tests, with mock credentials.

    Never accesses the source machine, original .env, broker, Telegram or cloud.
    No credentials are included in the returned report or error messages.
    """
    token = 'SYNTHETIC' + secrets.token_urlsafe(36)
    api_key = 'SYNTHETICKEY123456'
    relay_key = secrets.token_urlsafe(48)
    vault_key = Fernet.generate_key().decode('ascii')
    with tempfile.TemporaryDirectory(prefix='nifty-loopback-smoke-') as scratch:
        state_dir = Path(scratch) / 'private-state'
        state_dir.mkdir(mode=0o700)
        env = {
            # Explicit allow-list: do not forward inherited real service secrets.
            'PATH': os.defpath,
            'PYTHONDONTWRITEBYTECODE': '1',
            'ALERTS_ENABLED': 'false',
            'KITE_SHADOW_ENABLED': 'false',
            'PAPER_PREMIUM_TRACKING_ENABLED': 'false',
            'KITE_API_KEY': api_key,
            'TELEGRAM_BOT_TOKEN': '12345678:' + 'X' * 40,
            'TELEGRAM_CHAT_ID': '123456789',
            'TOKEN_RELAY_HMAC_KEY': relay_key,
            'TOKEN_VAULT_KEY': vault_key,
            'STATE_DIR': str(state_dir),
        }
        raw = json.dumps({'api_key': api_key, 'access_token': token},
                         separators=(',', ':')).encode('ascii')
        timestamp = str(int(time.time()))
        nonce = secrets.token_hex(24)
        headers = {'Content-Type': 'application/json',
                   'X-Relay-Timestamp': timestamp,
                   'X-Relay-Nonce': nonce,
                   'X-Relay-Signature': signature(relay_key, timestamp, nonce, raw)}
        port = _unused_loopback_port()
        with _server(state_dir, env, port, startup_timeout=timeout) as base:
            health, _ = _request(base + '/healthz')
            disabled, _ = _request(base + '/readyz')
            accepted, body = _request(base + '/internal/token', content=raw, headers=headers)
            replayed, _ = _request(base + '/internal/token', content=raw, headers=headers)
            invalid = dict(headers)
            invalid['X-Relay-Nonce'] = secrets.token_hex(24)
            tampered, _ = _request(base + '/internal/token', content=raw, headers=invalid)
            if not (health == 200 and disabled == 503 and accepted == 200
                    and json.loads(body).get('status') == 'TOKEN_ACCEPTED'
                    and replayed == 409 and tampered == 401):
                raise RuntimeError('synthetic loopback HTTP safety checks failed')

        # A local HTTP trial must not weaken production file permissions.
        if os.name == 'posix':
            for name in ('token.enc', 'alerts.sqlite3'):
                if (state_dir / name).stat().st_mode & 0o077:
                    raise RuntimeError('synthetic state permissions too permissive')
        ciphertext = (state_dir / 'token.enc').read_bytes()
        if token.encode('ascii') in ciphertext:
            raise RuntimeError('synthetic token not encrypted at rest')
        vault = TokenVault(state_dir / 'token.enc', vault_key)
        if not vault.load(datetime.now(timezone.utc)) or vault.get(datetime.now(timezone.utc)) != token:
            raise RuntimeError('synthetic token did not survive worker restart')
        with _server(state_dir, env, _unused_loopback_port(), startup_timeout=timeout) as base:
            after_restart, _ = _request(base + '/healthz')
            replay_after_restart, _ = _request(base + '/internal/token', content=raw, headers=headers)
            if after_restart != 200 or replay_after_restart != 409:
                raise RuntimeError('restarted worker did not retain persisted replay protection')
            # Newer signed credential should rotate cleanly after restart;
            # an older signed credential (with a NEW nonce) may not roll back.
            later_token = 'SYNTHETIC' + secrets.token_urlsafe(36)
            later_raw = json.dumps({'api_key': api_key, 'access_token': later_token},
                                   separators=(',', ':')).encode('ascii')
            later_ts = str(int(timestamp) + 1)
            later_nonce = secrets.token_hex(24)
            later_headers = {'Content-Type': 'application/json',
                'X-Relay-Timestamp': later_ts,
                'X-Relay-Nonce': later_nonce,
                'X-Relay-Signature': signature(relay_key,later_ts,later_nonce,later_raw)}
            rotated, _ = _request(base + '/internal/token',content=later_raw,headers=later_headers)
            outdated_headers=dict(headers)
            outdated_headers['X-Relay-Nonce']=secrets.token_hex(24)
            outdated_headers['X-Relay-Signature']=signature(
                relay_key,timestamp,outdated_headers['X-Relay-Nonce'],raw)
            rollback, _ = _request(base + '/internal/token',content=raw,headers=outdated_headers)
            if rotated!=200 or rollback!=409:
                raise RuntimeError('signed out-of-order relay rollback guard failed')
        latest = TokenVault(state_dir / 'token.enc',vault_key)
        if not latest.load(datetime.now(timezone.utc)) or latest.get(datetime.now(timezone.utc))!=later_token:
            raise RuntimeError('latest encrypted cloud token did not survive restart')

    return {
        'mode': 'SYNTHETIC_LOCALHOST_HTTP_ONLY',
        'result': 'PASS',
        'real_market_data_used': False,
        'telegram_message_sent': False,
        'live_orders_placed': False,
        'real_credentials_used': False,
        'tls_validated': False,
        'cloud_deployment_validated': False,
        'checks': ['LOOPBACK_HEALTH', 'ALERTS_DISABLED', 'SIGNED_TOKEN_ACCEPTED',
                   'REPLAY_REJECTED', 'TAMPER_REJECTED', 'ENCRYPTED_STATE',
                   'SERVER_RESTART_AND_STATE_RECOVERY', 'PERSISTED_NONCE_REPLAY_REJECTION',
                   'PRIVATE_STATE_FILE_PERMISSIONS', 'SIGNED_NEWER_TOKEN_ROTATION',
                   'OUT_OF_ORDER_RELAY_REJECTED_AFTER_RESTART',
                   'LATEST_TOKEN_ENCRYPTED_AND_PERSISTED'],
    }


def main(argv: list[str] | None = None) -> int:
    import argparse
    parser = argparse.ArgumentParser(description='Safe local cloud-worker HTTP restart rehearsal')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args(argv)
    try:
        report = run_smoke()
    except Exception:
        # Secrets from underlying exceptions must never escape into CLI logs.
        print('LOOPBACK_SMOKE=FAIL (details redacted)', file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(report, sort_keys=True))
    else:
        print('LOOPBACK_SMOKE=PASS; synthetic localhost only; no cloud or broker traffic')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
