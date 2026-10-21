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

## Current verified milestone

- Actual Nirala Python 3.11 Windows full suite: **458 pass, 120 fail, 4 skipped** (RED due primarily to explicit POSIX-only runtime requirements).
- Actual Nirala focused paper-trading suite: **68/68 passed**, selected real State/PaperBook crash integration **2/2 passed**.
- Full Linux Python 3.12 suite: **NOT RUN**. PR remains unmerged, automatic trading disabled, actual live acceptance **0/5**, expanded engineering estimate **53% unchanged**.

If Codespaces allowance is unavailable, another possible service is GitLab Free's 400 shared runner compute minutes/month, **but that requires an account/repo mirror or project approval and should not be created automatically**. https://docs.gitlab.com/ci/pipelines/compute_minutes/
