"""Read-only Azure for Students subscription discovery.

Only invokes Azure CLI account listing and Azure Resource Manager HTTP GET.
Never creates resources, modifies subscriptions, signs in, prints identifiers,
examines secrets or assumes that student credits guarantee free continuous hosting.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
from collections.abc import Callable
from typing import Any

_STUDENT_QUOTA_IDS = frozenset((
    "AzureForStudents_2018-01-01",
    "MS-AZR-0170P",
))
_SUB_ID = re.compile(r"^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$")
_AZURE_API = "2022-12-01"
_MAX_SUBSCRIPTIONS = 15

# Return code + stdout, never stderr (stderr may include account details).
Runner = Callable[[list[str]], tuple[int, str]]


def _run_cli(args: list[str]) -> tuple[int, str]:
    try:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=25,
                              check=False)
    except (OSError, subprocess.TimeoutExpired, UnicodeError):
        return 1, ""
    return proc.returncode, proc.stdout if proc.returncode == 0 else ""


def inspect_student_access(*, runner: Runner | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {
        "mode": "AZURE_STUDENT_ACCOUNT_READ_ONLY",
        "status": "BLOCKED",
        "blockers": [],
        "enabled_subscriptions_checked": 0,
        "student_offer_confirmed_count": 0,
        "azure_cli_authenticated": False,
        "subscription_ids_or_account_emails_reported": False,
        "student_credit_balance_verified": False,
        "zero_incremental_cost_verified": False,
        "host_storage_and_network_cost_verified": False,
        "provider_resources_created_or_modified": False,
        "approved_to_deploy": False,
    }
    if runner is None and shutil.which("az") is None:
        result["blockers"] = ["AZ_CLI_NOT_INSTALLED"]
        return result
    invoke = runner if runner is not None else _run_cli
    code, body = invoke(["az", "account", "list", "--all", "--output", "json"])
    if code:
        result["blockers"] = ["AZ_ACCOUNT_READ_FAILED_OR_SIGN_IN_REQUIRED"]
        return result
    try:
        subscriptions = json.loads(body)
    except (ValueError, TypeError):
        result["blockers"] = ["AZ_ACCOUNT_LIST_INVALID"]
        return result
    if not isinstance(subscriptions, list) or len(subscriptions) > _MAX_SUBSCRIPTIONS:
        result["blockers"] = ["AZ_ACCOUNT_LIST_UNEXPECTED"]
        return result
    if not subscriptions:
        result["blockers"] = ["AZ_LOGIN_OR_SUBSCRIPTION_ACTIVATION_REQUIRED"]
        return result
    result["azure_cli_authenticated"] = True
    failures = 0
    for item in subscriptions:
        if not isinstance(item, dict) or item.get("state") != "Enabled":
            continue
        sub_id = item.get("id")
        if not isinstance(sub_id, str) or _SUB_ID.fullmatch(sub_id) is None:
            failures += 1
            continue
        result["enabled_subscriptions_checked"] += 1
        # Explicit Azure Resource Manager GET: no key vault, role changes,
        # subscription selection, deployment, cost or payment APIs.
        url = (f"https://management.azure.com/subscriptions/{sub_id}"
               f"?api-version={_AZURE_API}")
        status, response = invoke(["az", "rest", "--method", "get",
                                   "--url", url, "--output", "json"])
        if status:
            failures += 1
            continue
        try:
            policy = json.loads(response).get("subscriptionPolicies", {})
            quota_id = policy.get("quotaId") if isinstance(policy, dict) else None
        except (TypeError, ValueError, AttributeError):
            failures += 1
            continue
        if isinstance(quota_id, str) and quota_id in _STUDENT_QUOTA_IDS:
            result["student_offer_confirmed_count"] += 1
    if failures:
        result["blockers"].append("SUBSCRIPTION_OFFER_CHECK_INCOMPLETE")
    if not result["student_offer_confirmed_count"]:
        result["blockers"].append("NO_VERIFIED_ACTIVE_AZURE_FOR_STUDENTS_SUBSCRIPTION")
    # Identifying an active student subscription is not proof of remaining
    # credit, zero-cost disk/IP/network or availability in the desired region.
    if not result["blockers"]:
        result["status"] = "STUDENT_OFFER_VERIFIED_READ_ONLY"
        result["blockers"] = ["CREDIT_COST_QUOTA_AND_HOST_APPROVAL_STILL_REQUIRED"]
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Read-only Azure Student offer audit")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    report = inspect_student_access()
    if args.json:
        print(json.dumps(report, sort_keys=True))
    else:
        print("AZURE STUDENT DISCOVERY: " + report["status"])
        for blocker in report["blockers"]:
            print("BLOCKER: " + blocker)
        print("NO CLOUD RESOURCES CREATED; NO SUBSCRIPTION UPGRADE")
    return 0 if report["status"] == "STUDENT_OFFER_VERIFIED_READ_ONLY" else 2


if __name__ == "__main__":
    raise SystemExit(main())
