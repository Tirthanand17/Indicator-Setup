"""Offline AWS Free account preflight: NEVER authenticates, deploys, or accepts secrets.

A DECLARATIONS_COMPLETE_ONLY result is not evidence that a real AWS account
qualified for the Free plan, that credits/quotas are usable, or that this
temporary host is approved by the owner. No SDK imports or network calls.
"""
from __future__ import annotations

import argparse
import calendar
from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_UP
import json
from pathlib import Path
import re

TRUE_FLAGS = (
    "owner_accepted_temporary_host",
    "owner_approved_automatic_first_project_creation",
    "owner_accepted_sydney_region_tradeoff",
    "new_signup_available_for_actual_account",
    "no_prior_aws_free_tier_ineligibility",
    "free_plan_verified_in_account",
    "ec2_eligibility_verified_for_region_and_instance",
    "price_components_verified_from_provider",
    "automatic_account_closure_and_data_loss_acknowledged",
    "out_of_account_daily_backup_verified",
    "independent_restore_test_passed",
    "migration_destination_verified",
    "private_worker_and_restricted_https_confirmed",
    "exactly_one_writer",
    "no_real_broker_orders",
)
FALSE_FLAGS = (
    "payment_card_requested",
    "payment_method_added",
    "paid_plan_or_upgrade_enabled",
    "card_verification_hold_requested",
    "advanced_aws_features_activated",
)
PRICE_COMPONENTS = frozenset((
    "ec2_compute", "ebs_storage", "public_ipv4", "data_transfer",
    "snapshots", "dns", "monitoring", "other",
))
FIELDS = frozenset((
    "provider", "account_plan", "signup_experience",
    "contact_country_code", "region", "instance_type", "cpu_credit_mode",
    "account_opened_at_utc", "free_plan_expires_at_utc",
    "migration_cutover_at_utc", "reviewed_at_utc",
    "pricing_reviewed_at_utc", "planned_run_days",
    "credit_remaining_usd", "estimated_monthly_usd",
    *TRUE_FLAGS, *FALSE_FLAGS,
))
SUPPORTED_INSTANCES = frozenset((
    "t3.micro", "t3.small", "t4g.micro", "t4g.small",
    "c7i-flex.large", "m7i-flex.large",
))
MIN_EXIT_BUFFER = timedelta(days=14)
MAX_REVIEW_AGE = timedelta(days=14)
MAX_PRICE_AGE = timedelta(days=3)
SAFE_CREDIT_FRACTION = Decimal("0.80")
USD_PATTERN = re.compile(r"(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,2})?\Z")
REGION_PATTERN = re.compile(r"[a-z]{2}-[a-z]+-[1-9][0-9]*\Z")


def _utc_date(value: object) -> datetime | None:
    if not isinstance(value, str) or len(value) > 40:
        return None
    try:
        date = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if date.utcoffset() is None:
        return None
    return date.astimezone(timezone.utc)


def _usd(value: object) -> Decimal | None:
    # Only decimal strings are accepted: JSON floating-point billing values
    # silently lose cents or admit NaN and must never be treated as evidence.
    if not isinstance(value, str) or not USD_PATTERN.fullmatch(value):
        return None
    try:
        amount = Decimal(value)
    except InvalidOperation:
        return None
    return amount if amount.is_finite() else None


def _six_calendar_months_later(value: datetime) -> datetime:
    months = value.year * 12 + value.month - 1 + 6
    year, zero_month = divmod(months, 12)
    month = zero_month + 1
    return value.replace(
        year=year, month=month,
        day=min(value.day, calendar.monthrange(year, month)[1]),
    )


def review_aws_free(plan: object, *, now: datetime | None = None) -> dict:
    """Check conservative declarations, without reading account credentials."""
    observed = datetime.now(timezone.utc) if now is None else now
    if observed.utcoffset() is None:
        raise ValueError("review clock must be timezone-aware")
    observed = observed.astimezone(timezone.utc)
    blockers: list[str] = []
    if not isinstance(plan, Mapping):
        plan = {}
        blockers.append("PLAN_NOT_AN_OBJECT")
    if FIELDS.difference(plan):
        blockers.append("REQUIRED_FIELDS_MISSING")
    if set(plan).difference(FIELDS):
        blockers.append("UNEXPECTED_FIELDS_REJECTED")

    if plan.get("provider") != "AWS" or plan.get("account_plan") != "Free":
        blockers.append("NOT_AWS_NEW_FREE_PLAN")
    if plan.get("signup_experience") != "new":
        blockers.append("AWS_NEW_SIGNUP_NOT_CONFIRMED")
    if plan.get("contact_country_code") != "IN":
        blockers.append("INDIA_CONTACT_ADDRESS_NOT_CONFIRMED")
    # As published by AWS in October 2026, new-signup projects for genuine
    # Indian contact addresses are provisioned in Sydney, not Mumbai. Do not
    # substitute a false billing address to get another Region. Reassess this
    # explicit rule if AWS officially expands the eligible project Regions.
    if plan.get("signup_experience") == "new" and plan.get("contact_country_code") == "IN" and plan.get("region") != "ap-southeast-2":
        blockers.append("AWS_NEW_INDIA_REGION_MUST_BE_SYDNEY")
    if not isinstance(plan.get("region"), str) or not REGION_PATTERN.fullmatch(plan["region"]):
        blockers.append("REGION_NOT_VERIFIED")
    if not isinstance(plan.get("instance_type"), str) or plan["instance_type"] not in SUPPORTED_INSTANCES:
        blockers.append("INSTANCE_NOT_LISTED_ELIGIBLE")
    instance = plan.get("instance_type")
    cpu_mode = plan.get("cpu_credit_mode")
    if isinstance(instance, str) and (instance.startswith("t3.") or instance.startswith("t4g.")):
        if cpu_mode != "standard":
            blockers.append("T_INSTANCE_UNLIMITED_CPU_SURCHARGE_RISK")
    elif cpu_mode != "not_applicable":
        blockers.append("CPU_CREDIT_MODE_UNVERIFIED")
    for flag in TRUE_FLAGS:
        if plan.get(flag) is not True:
            blockers.append("NOT_VERIFIED_" + flag.upper())
    for flag in FALSE_FLAGS:
        if plan.get(flag) is not False:
            blockers.append("PAYMENT_OR_UPGRADE_SAFETY_NOT_CONFIRMED_" + flag.upper())

    reviewed = _utc_date(plan.get("reviewed_at_utc"))
    if reviewed is None or not timedelta(0) <= observed-reviewed <= MAX_REVIEW_AGE:
        blockers.append("ACCOUNT_REVIEW_MISSING_OR_STALE")
    priced = _utc_date(plan.get("pricing_reviewed_at_utc"))
    if priced is None or not timedelta(0) <= observed-priced <= MAX_PRICE_AGE:
        blockers.append("PRICE_EVIDENCE_MISSING_OR_STALE")

    opened = _utc_date(plan.get("account_opened_at_utc"))
    expires = _utc_date(plan.get("free_plan_expires_at_utc"))
    cutover = _utc_date(plan.get("migration_cutover_at_utc"))
    if opened is None or opened > observed or expires is None or expires <= observed:
        blockers.append("ACCOUNT_FREE_PERIOD_UNVERIFIED_OR_EXPIRED")
    elif expires > _six_calendar_months_later(opened):
        blockers.append("FREE_EXPIRY_EXCEEDS_SIX_MONTHS")
    if expires is None or cutover is None or not observed < cutover <= expires-MIN_EXIT_BUFFER:
        blockers.append("SAFE_MIGRATION_CUTOVER_NOT_SCHEDULED")

    days = plan.get("planned_run_days")
    if type(days) is not int or not 1 <= days <= 183:
        blockers.append("PLANNED_RUNTIME_INVALID")
    elif cutover is None or observed+timedelta(days=days) > cutover:
        blockers.append("PLANNED_RUNTIME_REACHES_MIGRATION_CUTOFF")

    credit = _usd(plan.get("credit_remaining_usd"))
    if credit is None or credit <= 0:
        blockers.append("CREDIT_BALANCE_NOT_VERIFIED")
    components = plan.get("estimated_monthly_usd")
    monthly: Decimal | None = None
    if not isinstance(components, Mapping) or set(components) != PRICE_COMPONENTS:
        blockers.append("COST_COMPONENTS_MISSING_OR_UNEXPECTED")
    else:
        prices = [_usd(components[key]) for key in sorted(PRICE_COMPONENTS)]
        if any(price is None for price in prices):
            blockers.append("COST_COMPONENTS_INVALID")
        else:
            monthly = sum((price for price in prices if price is not None), Decimal(0))
            if monthly == 0:
                blockers.append("ZERO_RUNNING_COST_ESTIMATE_NOT_CREDIBLE")

    projected: Decimal | None = None
    if monthly is not None and type(days) is int and 1 <= days <= 183:
        # Thirty days per billable month is deliberately conservative for a
        # provisional estimate. It is NOT an AWS price quote or quota proof.
        projected = (monthly * Decimal(days) / Decimal(30)).quantize(
            Decimal("0.01"), rounding=ROUND_UP)
        if credit is not None and projected > credit*SAFE_CREDIT_FRACTION:
            blockers.append("CREDIT_PROJECTION_EXCEEDS_EIGHTY_PERCENT_LIMIT")

    return {
        "result": "BLOCKED" if blockers else "DECLARATIONS_COMPLETE_ONLY",
        "blockers": list(dict.fromkeys(blockers)),
        "declaration_based_projection_usd": str(projected) if projected is not None else None,
        "cloud_account_eligibility_independently_verified": False,
        "credit_and_prices_independently_verified": False,
        "backup_restore_independently_verified": False,
        "approved_to_provision_or_deploy": False,
        "hosting_resource_created": False,
        "payment_authorized": False,
        "real_credentials_used": False,
        "live_telegram_or_kite_verified": False,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Offline/no-card AWS Free expiry safety gate")
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    try:
        if not args.plan.is_file() or args.plan.stat().st_size > 8192:
            raise ValueError("invalid size")
        plan = json.loads(args.plan.read_text(encoding="utf-8"))
        result = review_aws_free(plan)
    except (OSError, ValueError, UnicodeError):
        result = review_aws_free({})
        result["result"] = "BLOCKED"
        result["blockers"] = ["INVALID_OR_UNREADABLE_PLAN"]
    if args.json:
        print(json.dumps(result, sort_keys=True))
    else:
        print("AWS FREE PREFLIGHT: " + result["result"])
        for blocker in result["blockers"]:
            print("BLOCKER: " + blocker)
        print("No AWS calls, no resource creation, no paid upgrade authorized")
    return 0 if result["result"] == "DECLARATIONS_COMPLETE_ONLY" else 2


if __name__ == "__main__":
    raise SystemExit(main())
