"""Static guardrails for operator-only HTTPS proxy example, not live proof."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CADDY = (ROOT/'deploy'/'Caddyfile.example').read_text()
COMPOSE = (ROOT/'deploy'/'compose.yml').read_text()


def test_public_proxy_is_tls_not_http_and_no_secret_values():
    assert '{$NIFTY_TOKEN_FQDN}' in CADDY
    assert 'tls {$NIFTY_TLS_EMAIL}' in CADDY
    assert 'http://' not in CADDY
    for forbidden in ('KITE_API_KEY=', 'TELEGRAM_BOT_TOKEN=', 'TOKEN_RELAY_HMAC_KEY=', 'access_token='):
        assert forbidden not in CADDY


def test_only_token_post_is_forwarded_with_body_limit():
    assert 'path /internal/token' in CADDY
    assert 'method POST' in CADDY
    assert 'max_size 2KB' in CADDY
    assert 'reverse_proxy 127.0.0.1:8080' in CADDY
    assert 'respond "Not found" 404' in CADDY
    assert '127.0.0.1:8080:8080' in COMPOSE


def test_no_public_diagnostics_or_live_order_access():
    assert 'path /healthz' not in CADDY
    assert 'path /operationalz' not in CADDY
    assert 'path /readyz' not in CADDY
    assert '/orders' not in CADDY
    assert 'ALERTS_ENABLED: true' not in COMPOSE
