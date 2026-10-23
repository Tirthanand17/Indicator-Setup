# Free-quota alternative: GitHub Codespaces Linux QA (Phase 44)

**Status 2026-10-21:** Prepared and validated the configuration and launcher on Nirala; **no Codespace created or charged**, **no Linux Python 3.12 run yet**, PR #1 remains draft.

## Why this instead of CircleCI / GitHub Actions

The user confirmed CircleCI minutes are exhausted, and GitHub Actions minutes were previously exhausted. The branch-only CircleCI file was **deleted**, preventing accidental extra pipelines. GitHub Codespaces is a DIFFERENT metered product with monthly included free usage on personal accounts, normally 120 core-hours and 15 GB-month for GitHub Free (a 2-core machine is approximately 60 actual runtime hours), subject to the user's actual remaining allowance. Sources:
- https://docs.github.com/en/codespaces/troubleshooting/troubleshooting-included-usage
- https://docs.github.com/en/billing/concepts/product-billing/github-codespaces
- https://cli.github.com/manual/gh_codespace_create

**Important:** Included quota is NOT guaranteed available: the connected GitHub CLI could list user Codespaces (none) and get supported machine types, but billing allowance API requires another OAuth scope and returned 404. **Creating a Codespace can be billable beyond included usage. DO NOT create without checking remaining included compute/storage and confirming a $0 spending cap.**

## What is implemented in the GitHub branch

- `.devcontainer/devcontainer.json`: disposable Debian Linux Python 3.12 image, no forwarded application ports, paper alert/trade flags disabled, and an automatic post-create test command.
- `.devcontainer/run-linux-qa.sh`: asserts native Linux and **Python 3.12** (rejects Windows emulation), creates an isolated virtual environment under `$HOME/.cache`, installs only repository dependencies plus pytest/httpx tooling, and runs the **entire** `cloud-alerts` pytest suite for up to 10 minutes using an `env -i` allowlist. All Kite/Telegram/cloud/account credentials are absent from the test process. Stores JUnit, log and exit-status locally inside the Codespace, **no broker orders or deployments**.
- On Nirala the GitHub branch was pulled into the existing disposable `%TEMP%` QA clone. `python -m json.tool .devcontainer/devcontainer.json`: PASS; `bash -n .devcontainer/run-linux-qa.sh`: PASS. GitHub API reports the **2-core basicLinux32gb** machine is allowed for this repository. `gh codespace list` returned `[]` (no current active/listed Codespaces). The automated Codespace test job itself has NOT run.

## Single-command launch, read-back and cleanup (optional, budget confirmation required)

To minimize manual work, `.devcontainer/Run-Linux-QA.ps1` now wraps the GitHub CLI to create the **2-core** temporary Codespace on the exact branch, poll the auto-run test result, save the final 160 test-output lines under Nirala's existing `%TEMP%\indicator-phase43-qa-20261021\codespaces-linux-qa-result.txt`, and **stop/delete only the Codespace that it created**, even when pytest reports failures. Launch only once the $0 spending guard and remaining free allowance are confirmed:

```powershell
& "C:\Users\Dell\AppData\Local\Temp\indicator-phase43-qa-20261021\.devcontainer\Run-Linux-QA.ps1" -BudgetConfirmed
```

The PowerShell script was pulled to Nirala; PowerShell parser reported **0 syntax errors**. A trial invocation **without** `-BudgetConfirmed` correctly refused to create a Codespace; `gh codespace list` still returned `[]`. Its actual **create/SSH/poll/cleanup path is UNTESTED** until an approved Codespace exists. The user can use the manual CLI steps below if the wrapper fails. Do not pass `-BudgetConfirmed` without actually checking the account's free quota/spending settings.

## Minimal operator steps (only once, after checking $0 usage budget)

1. Verify the personal Codespaces **remaining included allowance** and an effective $0 spend limit in https://github.com/settings/billing. Do not launch if the account could incur charges.
2. Nirala already has `gh` CLI logged in with the `codespace` scope. Once the budget is confirmed, this command creates a 2-core disposable Linux environment on the exact GitHub feature branch:
   ```powershell
   gh codespace create -R Tirthanand17/Indicator-Setup -b feature/phase43-paper-recovery-audit -m basicLinux32gb --idle-timeout 5m --retention-period 1h -d indicator-phase43-offline-qa
   ```
   The devcontainer automatically installs test dependencies and runs the entire suite. No need to copy project files, open charts or expose any live Kite/Telegram token.
3. Read the test result by listing the Codespace and reading its `~/.cache/indicator-phase43-offline-qa/exit-status.txt`, `pytest.log`, and `results.xml` with `gh codespace ssh`. If the suite fails, fix source and rerun. Never claim green from a successful Codespace *creation* alone.
4. Stop/delete the Codespace after capturing the result to avoid consuming idle compute/storage:
   ```powershell
   gh codespace list -R Tirthanand17/Indicator-Setup
   gh codespace stop -c CODE_SPACE_NAME
   gh codespace delete -c CODE_SPACE_NAME
   ```
   Replace `CODE_SPACE_NAME` only using the actual listed Codespace name.

## Do not confuse testing with cloud deployment

Codespaces is an ephemeral **development/test environment**, NOT an approved always-on host. Its short idle timeout is intentionally incompatible with daily market monitoring. Production deployment requires a separately approved durable ₹0-capable host, secure signed daily Kite token relay, read-only NFO REST observations, user-observed Telegram handset receipt with Nirala off, and five full live market sessions.

## Phase 44 result — Codespaces account hard block, no charges (21 October 2026)

The user provided GitHub billing screenshots showing a **$0 Codespaces budget** flagged **`100% Usage blocked`**, plus $1.40 of Codespaces usage fully offset by included discounts (no billed overage shown). A single properly redirected CLI attempt to create the smallest `basicLinux32gb` Codespace on this private feature branch returned:

```text
error creating codespace: HTTP 402: Usage not allowed:
Tirthanand17, you are out of monthly free usage or have exceeded
your budget for Codespaces. Increase your budget to continue using Codespaces.
```

A fresh `gh codespace list -R Tirthanand17/Indicator-Setup --json name,state` returned **`[]`**. **No Codespace was created**, and **the $0 budget must not be raised or removed** to run this project. Do not repeat the blocked creation attempt unless the user explicitly changes the budget/usage situation. `Run-Linux-QA.ps1` was hardened so a GitHub billing-owner notice on stderr cannot abort the script before capturing a CLI failure; the post-fix full Codespace path is NOT tested because creation is blocked.

**Working $0 fallback on Nirala:** added `cloud-alerts/scripts/Invoke-WindowsPaperSmoke.ps1` on the feature branch, runnable with a pre-existing isolated Python venv. It clears broker, token and Telegram environment values for a narrowly selected pure-paper test suite, restores them after the subprocess, and runs Python compileall. On the actual checked-out repository: **72/72 synthetic paper/recovery/fees/audit/security tests PASSED**, exit 0, including 4 new token-vault temp-file failure regressions. The encrypted-vault write path now correctly closes a raw `mkstemp` fd if mandatory `os.fchmod` fails, before removing the temporary encrypted token; no POSIX permission check was weakened. The local standalone Linux Python 3.13 integrity tests separately remain **29/29 PASS**. These cannot replace the missing full Linux Python **3.12** app suite.

The historical full Nirala Windows suite was **458 pass, 120 fail, 4 skip** before adding the 4 token-vault tests, primarily owing to deliberate Linux-only security/worker locking. The full updated Windows suite has NOT been re-run; do not invent a newer full-suite total.

**Completion index remains 53%, with 0/5 production acceptance gates**. Draft PR #1 remains unmerged, market monitoring/real orders OFF. Approved Linux 3.12 runner, real option quotes and five sessions remain unresolved. Do not purchase more CI credits or remove spending protections.

## Additional no-charge Linux test evidence

The ChatGPT execution container is genuine Linux but only Python **3.13**, and currently has just the recovered pure `paper_integrity.py` and its focused tests, not the entire `Indicator-Setup` repository. Executed `PYTHONPATH=/mnt/data/indicator_phase43 python -m pytest -q /mnt/data/indicator_phase43/tests`: **29 passed in 1.49 seconds**. This verifies recovery logic on Linux without using CircleCI, Actions, Codespaces or any paid runner. It does **not** establish Python 3.12 compatibility or full FastAPI/Kite worker correctness.

## Current verified milestone

- Actual Nirala Python 3.11 Windows full suite: **458 pass, 120 fail, 4 skipped** (RED due primarily to explicit POSIX-only runtime requirements).
- Actual Nirala focused paper-trading suite: **68/68 passed**, selected real State/PaperBook crash integration **2/2 passed**.
- Full Linux Python 3.12 suite: **NOT RUN**. PR remains unmerged, automatic trading disabled, actual live acceptance **0/5**, expanded engineering estimate **53% unchanged**.

If Codespaces allowance is unavailable, another possible service is GitLab Free's 400 shared runner compute minutes/month, **but that requires an account/repo mirror or project approval and should not be created automatically**. https://docs.gitlab.com/ci/pipelines/compute_minutes/
