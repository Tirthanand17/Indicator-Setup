"""Phase 47 synthetic tests must never sign in or call real Azure APIs."""
import json

from cloud_alerts.azure_student_audit import inspect_student_access, main

SUB = "00000000-1111-2222-3333-444444444444"
STUDENT = "AzureForStudents_2018-01-01"


def runner_with(quota, *, state="Enabled", rest_status=0):
    invocations = []

    def run(argv):
        invocations.append(argv)
        if argv[1:3] == ["account", "list"]:
            return 0, json.dumps([{"id": SUB, "state": state,
                                  "name": "PERSONAL_NAME_MUST_NOT_APPEAR",
                                  "user": {"name": "PRIVATE_EMAIL_EXAMPLE"}}])
        if argv[1:3] == ["rest", "--method"]:
            return rest_status, json.dumps({
                "subscriptionPolicies": {"quotaId": quota},
                "secret": "PRIVATE_QUOTA_RESPONSE_MUST_NOT_APPEAR",
            })
        return 1, ""

    return run, invocations


def test_active_student_offer_verified_but_host_still_not_approved():
    run, calls = runner_with(STUDENT)
    r = inspect_student_access(runner=run)
    assert r["status"] == "STUDENT_OFFER_VERIFIED_READ_ONLY"
    assert r["student_offer_confirmed_count"] == 1
    assert not r["student_credit_balance_verified"]
    assert not r["zero_incremental_cost_verified"]
    assert not r["approved_to_deploy"]
    assert not r["provider_resources_created_or_modified"]
    assert calls[0] == ["az", "account", "list", "--all", "--output", "json"]
    assert calls[1][1:4] == ["rest", "--method", "get"]
    assert calls[1][4] == "--url"
    assert calls[1][5].startswith("https://management.azure.com/subscriptions/")
    assert all("create" not in " ".join(call) and "update" not in " ".join(call)
               for call in calls)
    assert "PRIVATE" not in json.dumps(r)
    assert SUB not in json.dumps(r)


def test_pay_as_you_go_never_recognized_as_student():
    run, _ = runner_with("PayAsYouGo_2014-09-01")
    r = inspect_student_access(runner=run)
    assert r["status"] == "BLOCKED"
    assert "NO_VERIFIED_ACTIVE_AZURE_FOR_STUDENTS_SUBSCRIPTION" in r["blockers"]


def test_disabled_student_does_not_count():
    run, calls = runner_with(STUDENT, state="Disabled")
    r = inspect_student_access(runner=run)
    assert r["student_offer_confirmed_count"] == 0
    assert len(calls) == 1


def test_no_login_or_no_subscriptions_are_safe():
    def none(args):
        return 0, "[]"
    r = inspect_student_access(runner=none)
    assert r["status"] == "BLOCKED"
    assert r["blockers"] == ["AZ_LOGIN_OR_SUBSCRIPTION_ACTIVATION_REQUIRED"]


def test_rest_error_is_not_misreported_as_no_credit():
    run, _ = runner_with(STUDENT, rest_status=1)
    r = inspect_student_access(runner=run)
    assert "SUBSCRIPTION_OFFER_CHECK_INCOMPLETE" in r["blockers"]
    assert r["status"] == "BLOCKED"


def test_malformed_or_excessive_account_lists_fail_closed():
    for output in ('{}', '{', json.dumps([{}] * 16)):
        report = inspect_student_access(runner=lambda args: (0, output))
        assert report["status"] == "BLOCKED"
        assert report["provider_resources_created_or_modified"] is False


def test_suspicious_subscription_id_never_entered_into_url():
    payload = json.dumps([{"id": SUB + " bad", "state": "Enabled"}])
    calls = []
    def run(args):
        calls.append(args)
        return (0, payload)
    result = inspect_student_access(runner=run)
    assert result["status"] == "BLOCKED"
    assert len(calls) == 1


def test_cli_blocked_when_no_account_does_not_disclose_pii(monkeypatch, capsys):
    monkeypatch.setattr("cloud_alerts.azure_student_audit.inspect_student_access",
                        lambda: inspect_student_access(runner=lambda a: (0, "[]")))
    assert main(["--json"]) == 2
    report = json.loads(capsys.readouterr().out)
    assert report["azure_cli_authenticated"] is False
    assert not report["subscription_ids_or_account_emails_reported"]
