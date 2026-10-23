"""Host suitability declarations are NEVER approval or real uptime evidence."""
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path

import pytest

from cloud_alerts.host_qualification import REQUIRED_TRUE, main, review_host

NOW = datetime(2026, 10, 23, 8, 0, tzinfo=timezone.utc)


def plan(**updates):
    values = {
        'provider': 'EXAMPLE_VM_PROVIDER',
        'service_class': 'linux_vm',
        'plan_tier': 'NO_INCREMENTAL_CHARGE_CONFIRMED',
        'reviewed_at_utc': NOW.isoformat(),
        **{key: True for key in REQUIRED_TRUE},
    }
    values.update(updates)
    return values


def test_all_operator_declarations_never_equal_actual_approval():
    result = review_host(plan(), now=NOW)
    assert result['result'] == 'DECLARATIONS_COMPLETE_ONLY'
    assert result['approved_to_provision_or_deploy'] is False
    assert result['hosting_resource_created'] is False
    assert result['hosting_account_billing_independently_verified'] is False
    assert result['volume_restart_independently_verified'] is False
    assert result['live_telegram_or_kite_verified'] is False


def test_render_free_forced_block_even_with_every_operator_box_ticked():
    result = review_host(plan(provider='Render', plan_tier='FREE',
                              service_class='dedicated_container_worker'), now=NOW)
    assert result['result'] == 'BLOCKED'
    assert 'RENDER_FREE_SLEEP_AND_EPHEMERAL_STATE' in result['blockers']


@pytest.mark.parametrize('flag', REQUIRED_TRUE)
def test_every_required_flag_must_be_literal_true(flag):
    assert 'NOT_CONFIRMED_' + flag.upper() in review_host(
        plan(**{flag: 'true'}), now=NOW)['blockers']
    assert 'NOT_CONFIRMED_' + flag.upper() in review_host(
        plan(**{flag: False}), now=NOW)['blockers']


def test_bad_service_types_fail_closed_without_type_errors():
    for service_class in ('static_site', 'free_web_sleeping', [], {}, None):
        assert 'SERVICE_CANNOT_RUN_PERSISTENT_WORKER' in review_host(
            plan(service_class=service_class), now=NOW)['blockers']


def test_unknown_fields_cannot_leak_secret_values():
    secret = 'PRIVATE_KITE_TOKEN_EXAMPLE_NEVER_REAL'
    result = review_host(plan(KITE_API_SECRET=secret), now=NOW)
    assert 'UNEXPECTED_FIELDS_REJECTED' in result['blockers']
    assert secret not in json.dumps(result)


def test_missing_and_invalid_structures_are_blocked():
    assert review_host([], now=NOW)['result'] == 'BLOCKED'
    assert 'REQUIRED_FIELDS_MISSING' in review_host({}, now=NOW)['blockers']
    assert 'PROVIDER_NOT_DECLARED' in review_host(plan(provider=[]), now=NOW)['blockers']
    assert 'PLAN_TIER_NOT_DECLARED' in review_host(plan(plan_tier={}), now=NOW)['blockers']


@pytest.mark.parametrize('reviewed_at', [
    'bad', '2026-10-23', '2026-10-24T08:00:00Z',
    '2026-10-08T07:59:59Z', None, 1730000000
])
def test_stale_future_or_naive_host_evidence_blocked(reviewed_at):
    result = review_host(plan(reviewed_at_utc=reviewed_at), now=NOW)
    assert 'HOST_EVIDENCE_MISSING_OR_STALE' in result['blockers']


def test_recent_timezone_aware_evidence_is_structurally_accepted():
    reviewed = (NOW-timedelta(days=1)).astimezone(
        timezone(timedelta(hours=5, minutes=30))).isoformat()
    assert review_host(plan(reviewed_at_utc=reviewed), now=NOW)['result'] == 'DECLARATIONS_COMPLETE_ONLY'


def test_cli_rejects_invalid_file_without_echoing_data(tmp_path, capsys):
    secret = 'NEVER_ECHO_THE_FAKE_SECRET'
    path = tmp_path/'host.json'
    path.write_text(json.dumps(plan(unexpected_secret=secret)), encoding='utf-8')
    assert main(['--plan', str(path), '--json']) == 2
    out = capsys.readouterr().out
    assert secret not in out and str(path) not in out
    assert 'UNEXPECTED_FIELDS_REJECTED' in out
    path.write_text('X'*9000, encoding='utf-8')
    assert main(['--plan', str(path), '--json']) == 2
    assert 'INVALID_OR_UNREADABLE_PLAN' in capsys.readouterr().out


def test_cli_does_not_authenticate_or_provision_when_declarations_pass(tmp_path, capsys):
    path = tmp_path/'host.json'
    path.write_text(json.dumps(plan(reviewed_at_utc=datetime.now(timezone.utc).isoformat())),
                    encoding='utf-8')
    assert main(['--plan', str(path), '--json']) == 0
    result = json.loads(capsys.readouterr().out)
    assert result['result'] == 'DECLARATIONS_COMPLETE_ONLY'
    assert result['hosting_resource_created'] is False
    assert result['approved_to_provision_or_deploy'] is False

def test_shipped_host_template_is_explicitly_blocked_and_contains_no_secrets():
    template = (Path(__file__).resolve().parents[1] / 'deploy' /
                'host-plan.example.json')
    plan_values = json.loads(template.read_text(encoding='utf-8'))
    result = review_host(plan_values, now=NOW)
    assert result['result'] == 'BLOCKED'
    assert 'RENDER_FREE_SLEEP_AND_EPHEMERAL_STATE' in result['blockers']
    assert 'NOT_CONFIRMED_ZERO_INCREMENTAL_CHARGE_VERIFIED' in result['blockers']
    assert not any('token' in key.lower() or 'secret' in key.lower()
                   for key in plan_values)
