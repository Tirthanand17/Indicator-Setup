"""Offline host suitability gate. Never provisions infrastructure or accepts secrets.

A 'pass' means operator declarations are structurally consistent; it does NOT
prove provider billing, cloud uptime, credential handoff, laptop-off alerts,
or authorization to create a resource.
"""
from __future__ import annotations

import argparse
from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path

REQUIRED_TRUE = (
    'owner_approved_host',
    'zero_incremental_charge_verified',
    'zero_overspend_guard_confirmed',
    'always_on_without_inbound_requests',
    'supports_private_durable_volume',
    'one_worker_only',
    'supports_restricted_https_ingress',
    'no_real_broker_orders',
)
FIELDS = frozenset((*REQUIRED_TRUE, 'provider', 'service_class',
                    'plan_tier', 'reviewed_at_utc'))
CLASSES = frozenset(('linux_vm', 'dedicated_container_worker'))
REVIEW_MAX_AGE = timedelta(days=14)


def _date_is_current(value: object, now: datetime) -> bool:
    if not isinstance(value, str) or len(value) > 40:
        return False
    try:
        reviewed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return False
    if reviewed.tzinfo is None or reviewed.utcoffset() is None:
        return False
    age = now - reviewed.astimezone(timezone.utc)
    return timedelta(0) <= age <= REVIEW_MAX_AGE


def review_host(plan: object, *, now: datetime | None = None) -> dict:
    """Fail closed for sleeping/ephemeral plans; return blocker CODES only."""
    observed = datetime.now(timezone.utc) if now is None else now
    if observed.tzinfo is None or observed.utcoffset() is None:
        raise ValueError('host review clock must be timezone-aware')
    blockers: list[str] = []
    if not isinstance(plan, Mapping):
        plan = {}
        blockers.append('PLAN_NOT_AN_OBJECT')
    if FIELDS.difference(plan):
        blockers.append('REQUIRED_FIELDS_MISSING')
    if set(plan).difference(FIELDS):
        blockers.append('UNEXPECTED_FIELDS_REJECTED')

    provider = plan.get('provider')
    tier = plan.get('plan_tier')
    service_class = plan.get('service_class')
    if not isinstance(provider, str) or not provider.strip() or len(provider) > 40:
        blockers.append('PROVIDER_NOT_DECLARED')
    if not isinstance(tier, str) or not tier.strip() or len(tier) > 80:
        blockers.append('PLAN_TIER_NOT_DECLARED')
    if not isinstance(service_class, str) or service_class not in CLASSES:
        blockers.append('SERVICE_CANNOT_RUN_PERSISTENT_WORKER')
    if (isinstance(provider, str) and provider.lower() == 'render'
            and isinstance(tier, str) and tier.lower() == 'free'):
        blockers.append('RENDER_FREE_SLEEP_AND_EPHEMERAL_STATE')
    if (isinstance(provider, str) and provider.strip().lower() == 'northflank'
            and isinstance(tier, str) and tier.strip().lower() in
            {'sandbox_free', 'developer_sandbox', 'sandbox'}):
        # On the user's actual Oct 2026 no-card signup, the first build or
        # deployment starts a 60-minute account verification window.
        # A payment card is required to keep workloads running afterward.
        # Marketing 'always-on' does not override this account restriction.
        blockers.append('NORTHFLANK_SANDBOX_NO_CARD_60_MINUTE_WINDOW')
    for key in REQUIRED_TRUE:
        if plan.get(key) is not True:
            blockers.append('NOT_CONFIRMED_' + key.upper())
    if not _date_is_current(plan.get('reviewed_at_utc'), observed):
        blockers.append('HOST_EVIDENCE_MISSING_OR_STALE')

    blockers = list(dict.fromkeys(blockers))
    return {
        'result': 'DECLARATIONS_COMPLETE_ONLY' if not blockers else 'BLOCKED',
        'blockers': blockers,
        'only_operator_declarations_checked': True,
        'hosting_account_billing_independently_verified': False,
        'volume_restart_independently_verified': False,
        'public_tls_independently_verified': False,
        'approved_to_provision_or_deploy': False,
        'hosting_resource_created': False,
        'real_credentials_used': False,
        'live_telegram_or_kite_verified': False,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='No-network host suitability and zero-cost gate')
    parser.add_argument('--plan', required=True, type=Path)
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args(argv)
    try:
        if not args.plan.is_file() or args.plan.stat().st_size > 8192:
            raise ValueError('invalid host plan')
        plan = json.loads(args.plan.read_text(encoding='utf-8'))
        result = review_host(plan)
    except (OSError, ValueError, UnicodeError, json.JSONDecodeError):
        result = review_host({})
        result['result'] = 'BLOCKED'
        result['blockers'] = ['INVALID_OR_UNREADABLE_PLAN']
    if args.json:
        print(json.dumps(result, sort_keys=True))
    else:
        print('HOST QUALIFICATION: ' + result['result'])
        for blocker in result['blockers']:
            print('BLOCKER: ' + blocker)
        print('NO resources provisioned, no secrets read, no deployment authorized')
    return 0 if result['result'] == 'DECLARATIONS_COMPLETE_ONLY' else 2


if __name__ == '__main__':
    raise SystemExit(main())
