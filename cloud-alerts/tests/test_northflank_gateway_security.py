"""Northflank public edge policy tests: source-code guardrails, NOT cloud evidence."""
from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path

from cloud_alerts.host_qualification import review_host

ROOT = Path(__file__).resolve().parents[1]
CADDY = (ROOT / 'deploy' / 'northflank-gateway' / 'Caddyfile').read_text(encoding='utf-8')
DOCKER = (ROOT / 'deploy' / 'northflank-gateway' / 'Dockerfile').read_text(encoding='utf-8')
WORKER = (ROOT / 'cloud_alerts' / 'server.py').read_text(encoding='utf-8')
PLAN = json.loads((ROOT / 'deploy' / 'northflank-host-plan.example.json').read_text(encoding='utf-8'))


def test_edge_has_only_three_exact_reverse_proxy_allowlist_handlers():
    assert CADDY.count('reverse_proxy indicator-worker:8080') == 3
    assert CADDY.count('reverse_proxy ') == 3
    assert CADDY.count('handle @') == 4  # gateway health + three allowed routes
    assert 'handle {\n        respond "Not found" 404\n    }' in CADDY
    assert 'handle_path ' not in CADDY  # never change signed request path


def test_token_handoff_requires_post_and_strict_body_cap():
    assert '@signed_token_handoff {\n        method POST\n        path /internal/token\n    }' in CADDY
    assert 'max_size 2KB' in CADDY
    assert 'path /internal/token' in CADDY
    assert 'async for chunk in request.stream():' in WORKER
    assert 'if size>2048:' in WORKER
    assert 'if not verify_relay(' in WORKER
    assert 'if not state.claim_nonce(' in WORKER


def test_public_dashboard_only_gets_exact_read_only_routes():
    assert '@paper_dashboard_html {\n        method GET\n        path /paper/dashboard\n    }' in CADDY
    assert ('@paper_dashboard_api {\n        method GET\n'
            '        path /paper/api/summary /paper/api/analytics '
            '/paper/api/opportunities /paper/api/trades\n    }') in CADDY
    assert '_authorize_paper(request)' in WORKER
    assert "request.headers.get('x-paper-dashboard-key','')" in WORKER
    assert 'hmac.compare_digest(candidate, paper_key)' in WORKER
    assert 'PAPER_DASHBOARD_ENABLED' in WORKER
    for prohibited in ('/healthz', '/readyz', '/operationalz', '/docs',
                       '/orders', '/paper/api/*', '/paper/api/{', 'header_up X-',
                       'handle_errors', 'redir '):
        assert prohibited not in CADDY


def test_public_gateway_probes_only_its_own_health():
    assert '@gateway_health {\n        method GET\n        path /gateway-healthz\n    }' in CADDY
    assert 'respond "ok" 200' in CADDY
    assert 'Cache-Control "no-store"' in CADDY
    assert 'X-Content-Type-Options "nosniff"' in CADDY
    assert 'Referrer-Policy "no-referrer"' in CADDY
    assert 'FROM caddy:2-alpine' in DOCKER
    assert 'EXPOSE 8081' in DOCKER
    assert 'TOKEN_RELAY_HMAC_KEY=' not in CADDY
    assert 'KITE_API_SECRET=' not in CADDY
    assert 'PAPER_DASHBOARD_KEY=' not in CADDY


def test_unapproved_free_host_template_must_stay_blocked_without_secrets():
    assert PLAN['provider'] == 'Northflank'
    assert PLAN['plan_tier'] == 'sandbox_free'
    assert PLAN['no_real_broker_orders'] is True
    assert PLAN['owner_approved_host'] is False
    assert PLAN['zero_incremental_charge_verified'] is False
    assert PLAN['zero_overspend_guard_confirmed'] is False
    assert 'KITE_API_KEY' not in PLAN
    assert 'KITE_API_SECRET' not in PLAN
    result = review_host(PLAN, now=datetime(2026, 10, 23, 9, 0, tzinfo=timezone.utc))
    assert result['result'] == 'BLOCKED'
    assert result['approved_to_provision_or_deploy'] is False
    assert 'NOT_CONFIRMED_ZERO_INCREMENTAL_CHARGE_VERIFIED' in result['blockers']


def test_edge_configuration_is_only_a_template_not_a_live_deployment():
    assert 'PAPER_AUTOTRADE_ENABLED=true' not in CADDY + DOCKER
    assert 'ALERTS_ENABLED=true' not in CADDY + DOCKER
    assert 'KITE_API_SECRET' not in DOCKER
    assert 'TOKEN_VAULT_KEY' not in DOCKER
