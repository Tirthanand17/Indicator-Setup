"""Offline review gate for a PROPOSED OCI Always Free worker (never provisions).

Inputs are operator-supplied declarations, not verified OCI billing/tenancy data.
Passing this check never authorizes cloud resource creation or proves zero cost.
No network, broker, Telegram, credential, or cloud account access occurs.
"""
from __future__ import annotations

import argparse
import json
from collections.abc import Mapping
from pathlib import Path
import re

A1_FREE_OCPU = 2  # OCI Always Free-only account; recheck provider quotas
A1_FREE_MEMORY_GB = 12
FREE_BLOCK_STORAGE_GB = 200
FIELDS = frozenset({
    'provider', 'account_mode', 'home_region', 'selected_region', 'shape',
    'requested_ocpu', 'existing_a1_ocpu', 'requested_memory_gb',
    'existing_a1_memory_gb', 'requested_boot_volume_gb',
    'existing_boot_block_volume_gb', 'always_free_shape_badge_confirmed',
    'always_free_image_confirmed', 'storage_free_eligibility_confirmed',
    'zero_cost_public_ipv4_confirmed', 'zero_cost_network_confirmed',
    'zero_cost_dns_confirmed', 'no_paid_addons_confirmed',
    'idle_reclamation_risk_acknowledged',
})
BOOLEAN_FIELDS = frozenset({
    'always_free_shape_badge_confirmed', 'always_free_image_confirmed',
    'storage_free_eligibility_confirmed', 'zero_cost_public_ipv4_confirmed',
    'zero_cost_network_confirmed', 'zero_cost_dns_confirmed',
    'no_paid_addons_confirmed', 'idle_reclamation_risk_acknowledged',
})
NUMERIC_FIELDS = frozenset({
    'requested_ocpu', 'existing_a1_ocpu', 'requested_memory_gb',
    'existing_a1_memory_gb', 'requested_boot_volume_gb',
    'existing_boot_block_volume_gb',
})


def review(plan: object) -> dict:
    """Return codes only: deliberately never echo operator input or filenames."""
    blockers: list[str] = []
    if not isinstance(plan, Mapping):
        blockers.append('PLAN_MUST_BE_OBJECT')
        plan = {}
    absent = FIELDS - plan.keys()
    extra = plan.keys() - FIELDS
    if absent:
        blockers.append('REQUIRED_FIELDS_MISSING')
    if extra:
        blockers.append('UNEXPECTED_FIELDS_REJECTED')
    if plan.get('provider') != 'OCI':
        blockers.append('PROVIDER_NOT_OCI')
    if plan.get('account_mode') != 'ALWAYS_FREE_ONLY':
        blockers.append('ACCOUNT_NOT_CONFIRMED_FREE_ONLY')
    region_pattern = r'[a-z]{2}-[a-z][a-z0-9-]*-[1-9][0-9]*'
    home, selected = plan.get('home_region'), plan.get('selected_region')
    if not (isinstance(home, str) and re.fullmatch(region_pattern, home)
            and isinstance(selected, str) and selected == home):
        blockers.append('NOT_HOME_REGION')
    if plan.get('shape') != 'VM.Standard.A1.Flex':
        blockers.append('SHAPE_NOT_REVIEWED_A1_FLEX')
    for field in sorted(BOOLEAN_FIELDS):
        if plan.get(field) is not True:
            blockers.append('UNCONFIRMED_' + field.upper())
    for field in sorted(NUMERIC_FIELDS):
        value = plan.get(field)
        if type(value) is not int or value < 0:
            blockers.append('INVALID_' + field.upper())
    if not any(code.startswith('INVALID_') for code in blockers):
        if plan['requested_ocpu'] < 1 or plan['requested_ocpu'] + plan['existing_a1_ocpu'] > A1_FREE_OCPU:
            blockers.append('A1_OCPU_ABOVE_FREE_ONLY_QUOTA')
        if (plan['requested_memory_gb'] < 1 or
                plan['requested_memory_gb'] + plan['existing_a1_memory_gb'] > A1_FREE_MEMORY_GB):
            blockers.append('A1_MEMORY_ABOVE_FREE_ONLY_QUOTA')
        if (plan['requested_boot_volume_gb'] < 50 or
                plan['requested_boot_volume_gb'] + plan['existing_boot_block_volume_gb'] > FREE_BLOCK_STORAGE_GB):
            blockers.append('BLOCK_STORAGE_OUTSIDE_FREE_QUOTA')
    return {
        'result': 'STRUCTURAL_PLAN_REVIEW_PASS' if not blockers else 'BLOCKED',
        'blockers': blockers,
        'no_cloud_api_calls': True,
        'credentials_processed': False,
        'user_declarations_independently_verified': False,
        'capacity_verified': False,
        'free_cost_guaranteed': False,
        'approved_to_provision': False,
        'instance_provisioned': False,
        'laptop_off_alerts_verified': False,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Offline OCI Always Free-only resource plan review')
    parser.add_argument('--plan', required=True, type=Path)
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args(argv)
    try:
        if not args.plan.is_file() or args.plan.stat().st_size > 16384:
            raise ValueError('invalid plan file')
        plan = json.loads(args.plan.read_text(encoding='utf-8'))
        result = review(plan)
    except (OSError, UnicodeError, ValueError, json.JSONDecodeError):
        result = review({})
        result['blockers'] = ['INVALID_OR_UNREADABLE_PLAN']
        result['result'] = 'BLOCKED'
    if args.json:
        print(json.dumps(result, sort_keys=True))
    else:
        print('OCI FREE-ONLY PLAN: ' + result['result'])
        for code in result['blockers']:
            print('BLOCKER: ' + code)
        print('No cloud account was checked and no resource was provisioned.')
    return 0 if result['result'] == 'STRUCTURAL_PLAN_REVIEW_PASS' else 2


if __name__ == '__main__':
    raise SystemExit(main())
