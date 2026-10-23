"""Synthetic, no-credentials checks for a *temporary* AWS Free plan."""
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path

import pytest

from cloud_alerts.aws_free_preflight import (
    FALSE_FLAGS, TRUE_FLAGS, main, review_aws_free,
)

NOW = datetime(2026, 10, 23, 8, tzinfo=timezone.utc)


def proposed(**updates):
    # Fake numbers for structural test coverage only; NOT an AWS quote.
    item = {
        "provider": "AWS",
        "account_plan": "Free",
        "region": "ap-south-1",
        "instance_type": "t3.micro",
        "account_opened_at_utc": "2026-10-01T00:00:00Z",
        "free_plan_expires_at_utc": "2027-04-01T00:00:00Z",
        "migration_cutover_at_utc": "2027-03-10T00:00:00Z",
        "reviewed_at_utc": NOW.isoformat(),
        "pricing_reviewed_at_utc": NOW.isoformat(),
        "planned_run_days": 60,
        "credit_remaining_usd": "100.00",
        "estimated_monthly_usd": {
            "ec2_compute": "8.00", "ebs_storage": "2.00",
            "public_ipv4": "4.00", "data_transfer": "1.00",
            "snapshots": "0.50", "dns": "0.00",
            "monitoring": "0.50", "other": "0.00",
        },
        **{flag: True for flag in TRUE_FLAGS},
        **{flag: False for flag in FALSE_FLAGS},
    }
    item.update(updates)
    return item


def test_complete_fake_declarations_never_authorize_real_cloud_setup():
    result = review_aws_free(proposed(), now=NOW)
    assert result["result"] == "DECLARATIONS_COMPLETE_ONLY"
    assert result["declaration_based_projection_usd"] == "32.00"
    for field in ("approved_to_provision_or_deploy", "hosting_resource_created",
                  "payment_authorized", "real_credentials_used",
                  "credit_and_prices_independently_verified",
                  "backup_restore_independently_verified"):
        assert result[field] is False


@pytest.mark.parametrize("field", TRUE_FLAGS)
def test_required_assertions_fail_closed_when_unverified(field):
    result = review_aws_free(proposed(**{field: False}), now=NOW)
    assert "NOT_VERIFIED_" + field.upper() in result["blockers"]


@pytest.mark.parametrize("field", FALSE_FLAGS)
@pytest.mark.parametrize("unsafe_value", [True, None, "false"])
def test_any_payment_or_upgrade_ambiguity_blocks(field, unsafe_value):
    result = review_aws_free(proposed(**{field: unsafe_value}), now=NOW)
    assert "PAYMENT_OR_UPGRADE_SAFETY_NOT_CONFIRMED_" + field.upper() in result["blockers"]


@pytest.mark.parametrize("provider,plan", [
    ("AWS", "Paid"), ("AWS", "free"), ("Northflank", "Free"),
    (None, "Free"),
])
def test_only_exact_aws_free_plan_can_pass(provider, plan):
    assert "NOT_AWS_NEW_FREE_PLAN" in review_aws_free(
        proposed(provider=provider, account_plan=plan), now=NOW)["blockers"]


@pytest.mark.parametrize("instance", ["t2.micro", "m5.large", [], None])
def test_ineligible_or_malformed_instance_is_rejected(instance):
    assert "INSTANCE_NOT_LISTED_ELIGIBLE" in review_aws_free(
        proposed(instance_type=instance), now=NOW)["blockers"]


@pytest.mark.parametrize("end", [
    "2027-05-01T00:00:00Z", "2030-01-01T00:00:00Z",
])
def test_free_plan_must_end_within_six_calendar_months(end):
    assert "FREE_EXPIRY_EXCEEDS_SIX_MONTHS" in review_aws_free(
        proposed(free_plan_expires_at_utc=end), now=NOW)["blockers"]


def test_six_month_calculation_handles_month_end():
    candidate = proposed(
        account_opened_at_utc="2026-08-31T00:00:00Z",
        free_plan_expires_at_utc="2027-02-28T00:00:00Z",
    )
    assert "FREE_EXPIRY_EXCEEDS_SIX_MONTHS" not in review_aws_free(
        candidate, now=NOW)["blockers"]


@pytest.mark.parametrize("expiry", [
    "2026-10-23T08:00:00Z", "2026-01-01T00:00:00Z",
    "2027-04-01", None,
])
def test_expired_or_unverifiable_free_plan_is_blocked(expiry):
    assert "ACCOUNT_FREE_PERIOD_UNVERIFIED_OR_EXPIRED" in review_aws_free(
        proposed(free_plan_expires_at_utc=expiry), now=NOW)["blockers"]


def test_migration_must_leave_two_weeks_before_forced_account_closure():
    bad = proposed(migration_cutover_at_utc="2027-03-28T00:00:00Z")
    assert "SAFE_MIGRATION_CUTOVER_NOT_SCHEDULED" in review_aws_free(
        bad, now=NOW)["blockers"]


@pytest.mark.parametrize("days", [0, -1, 184, True, "60", None])
def test_runtime_type_and_duration_are_strict(days):
    assert "PLANNED_RUNTIME_INVALID" in review_aws_free(
        proposed(planned_run_days=days), now=NOW)["blockers"]


def test_run_cannot_extend_past_migration_deadline():
    assert "PLANNED_RUNTIME_REACHES_MIGRATION_CUTOFF" in review_aws_free(
        proposed(planned_run_days=150), now=NOW)["blockers"]


@pytest.mark.parametrize("credit", ["0", "0.00", "NaN", "Infinity", 100.0, "-1", None])
def test_credit_balance_must_be_positive_decimal_string(credit):
    assert "CREDIT_BALANCE_NOT_VERIFIED" in review_aws_free(
        proposed(credit_remaining_usd=credit), now=NOW)["blockers"]


def test_conservative_budget_projection_requires_twenty_percent_reserve():
    assert "CREDIT_PROJECTION_EXCEEDS_EIGHTY_PERCENT_LIMIT" in review_aws_free(
        proposed(credit_remaining_usd="20.00"), now=NOW)["blockers"]


@pytest.mark.parametrize("parts", [
    {}, {"ec2_compute": "1.00"},
    {"ec2_compute": "1.00", "secret": "a fake key"},
    [],
])
def test_missing_or_extra_pricing_items_block(parts):
    assert "COST_COMPONENTS_MISSING_OR_UNEXPECTED" in review_aws_free(
        proposed(estimated_monthly_usd=parts), now=NOW)["blockers"]


def test_nonfinite_or_float_pricing_and_zero_quotes_fail_closed():
    valid = proposed()["estimated_monthly_usd"]
    for value in ("NaN", 2.40, "-1.00", "1.001", None):
        prices = {**valid, "public_ipv4": value}
        assert "COST_COMPONENTS_INVALID" in review_aws_free(
            proposed(estimated_monthly_usd=prices), now=NOW)["blockers"]
    prices = {key: "0.00" for key in valid}
    assert "ZERO_RUNNING_COST_ESTIMATE_NOT_CREDIBLE" in review_aws_free(
        proposed(estimated_monthly_usd=prices), now=NOW)["blockers"]


def test_stale_price_quote_or_account_review_fail_closed():
    before = (NOW-timedelta(days=4)).isoformat()
    assert "PRICE_EVIDENCE_MISSING_OR_STALE" in review_aws_free(
        proposed(pricing_reviewed_at_utc=before), now=NOW)["blockers"]
    before = (NOW-timedelta(days=15)).isoformat()
    assert "ACCOUNT_REVIEW_MISSING_OR_STALE" in review_aws_free(
        proposed(reviewed_at_utc=before), now=NOW)["blockers"]


def test_invalid_object_or_extra_secret_key_never_echoed():
    secret = "SYNTHETIC_SECRET_NEVER_PRINT"
    result = review_aws_free(proposed(aws_secret_access_key=secret), now=NOW)
    assert "UNEXPECTED_FIELDS_REJECTED" in result["blockers"]
    assert secret not in json.dumps(result)
    assert review_aws_free(None, now=NOW)["result"] == "BLOCKED"


def test_shipped_sample_is_not_approved_and_has_no_secrets():
    example = (Path(__file__).resolve().parents[1] / "deploy" /
               "aws-free-preflight.example.json")
    plan = json.loads(example.read_text(encoding="utf-8"))
    result = review_aws_free(plan, now=NOW)
    assert result["result"] == "BLOCKED"
    assert result["approved_to_provision_or_deploy"] is False
    assert not any(any(word in field.lower() for word in (
        "token", "password", "access_key", "secret"))
        for field in plan)


def test_cli_rejects_corrupt_and_oversize_json_without_leaks(tmp_path, capsys):
    candidate = tmp_path / "aws-plan.json"
    candidate.write_text("{bad content", encoding="utf-8")
    assert main(["--plan", str(candidate), "--json"]) == 2
    assert "INVALID_OR_UNREADABLE_PLAN" in capsys.readouterr().out
    candidate.write_text("X" * 9000, encoding="utf-8")
    assert main(["--plan", str(candidate), "--json"]) == 2
    assert "INVALID_OR_UNREADABLE_PLAN" in capsys.readouterr().out


def test_cli_complete_fake_plan_never_provisions(tmp_path, capsys):
    candidate = tmp_path / "aws-plan.json"
    candidate.write_text(json.dumps(proposed(
        reviewed_at_utc=datetime.now(timezone.utc).isoformat(),
        pricing_reviewed_at_utc=datetime.now(timezone.utc).isoformat(),
    )), encoding="utf-8")
    # The fixed October-2026 account opens in the past, but cutoff may already
    # have occurred when this test is rerun years later. The plan remains safe.
    rc = main(["--plan", str(candidate), "--json"])
    outcome = json.loads(capsys.readouterr().out)
    assert rc in (0, 2)
    assert outcome["approved_to_provision_or_deploy"] is False
    assert outcome["hosting_resource_created"] is False
