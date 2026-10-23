# Phase 43 — Nirala full-checkout Windows QA, 21 October 2026

**Source:** GitHub draft PR #1, initial branch commit `5d6d0ec81afacaf7d0d16f17bdb1850a0e0a8e3c`. GitHub remained the source of truth. No Desktop files or changes to the protected `Automation Day Trading` tree.

## Real execution evidence

- **Remote machine:** Nirala (online via linked Desktop Commander Personal account). Created one disposable checkout and isolated Python venv under `%TEMP%\indicator-phase43-qa-20261021`, not on the Desktop.
- **Source verification:** `git clone --depth 1 --branch feature/phase43-paper-recovery-audit https://github.com/Tirthanand17/Indicator-Setup.git`; `git rev-parse HEAD` matched `5d6d0ec81afacaf7d0d16f17bdb1850a0e0a8e3c`. No checkout branch files were pushed from the PC.
- **Installed runtime:** Windows Python **3.11.0**. Project Docker runtime requires Linux Python **3.12**. No WSL distribution or Docker runtime installed on Nirala. `python -m compileall -q cloud_alerts tests`: **PASS**.
- Created isolated `.venv` and installed `requirements.txt` and test-only `pytest`, `pytest-asyncio` and `httpx` (no production services). Initial collection failed because Windows Python lacked IANA `Asia/Kolkata` timezone. Installed `tzdata` into the temporary venv; added a **Windows-only conditional `tzdata` requirement** to PR #1 so fresh Windows QA installs have the time zone database automatically.
- Executed **the entire cloned repository test suite** after resolving tzdata: `python -m pytest -q --tb=short`. **458 PASSED, 120 FAILED, 4 SKIPPED, 1 warning** in approximately 30 seconds. This is a **RED** result, not a green suite.
- Classification of the Windows failure report (`--tb=line` run duplicated the counts): repeated missing POSIX `os.fchmod`, `os.geteuid`, deliberate runtime error `Cloud worker lock requires a Linux/POSIX host`, Windows file-lock/symlink permissions, and subprocess loopback smoke failures. The largest explicit categories are roughly 67 `os.fchmod`, 29 Linux-only worker lock and 18 `os.geteuid` error lines; additional exceptions are Windows filesystem/subprocess related. **Do not assume each failed test passes on Linux** without running it there.
- **68/68 PASSED** when specifically executing actual repository modules for `test_paper_book.py`, `test_paper_fee_integration.py`, `test_paper_charges.py`, `test_paper_integrity.py`, `test_paper_integrity_cash.py`, `test_paper_integrity_hardening.py`, `test_paper_analytics.py` and `test_signal_audit.py`.
- **2/2 PASSED, 5 deselected** on the real `test_paper_integrity_integration.py` for independently verified State+PaperBook crash recovery and entry/exit cash reconciliation, which do not depend on Linux-only secured vault or worker lock.
- Two targeted integration successes are included in the full suite's 458 passes; do **not** add them to that total as distinct tests. The 68-target subset likewise overlaps the full suite.
- Complete Windows test capture kept in the disposable QA workspace `windows-full-suite.txt`. No chat credentials or market prices were used and no live broker calls or broker orders were made.

## CircleCI security hardening — current continuation

- Updated `.circleci/config.yml` to invoke the entire offline Python 3.12 suite under `env -i`, passing only `HOME`, `PATH`, `LANG=C.UTF-8` and **disabled** monitoring/paper/shadow feature flags. This prevents unrelated project-level CircleCI, GitHub, Kite, Telegram and cloud secrets from being inherited by the pytest process, even if a shared CI context was previously configured.
- The branch-filtered job remains **test-only**, with no token handoff, broker order capability, deployment or release artifact.
- Pulled exact branch change back to Nirala's dedicated temporary checkout. Validated `.circleci/config.yml` parses as YAML with sections `version`, `jobs`, `workflows`; confirmed Git HEAD `126605e` for this change. This YAML validation is **not** equivalent to a CircleCI-run 3.12 test.
- Verified GitHub checks `[]` and workflow runs `[]` for previous branch HEAD. **CircleCI job launch still unverified**; it needs existing CircleCI account's project/repo trigger registration. CircleCI is not an installed connected app in this chat.
- Next operational prerequisite requiring an operator account action if not already configured: CircleCI Dashboard → Organization → Projects → set up **`Tirthanand17/Indicator-Setup`** using committed config branch `feature/phase43-paper-recovery-audit`; run/confirm the `phase43_linux_regression` job. Never enable a billed CircleCI plan or GitHub Actions without approval.
- The project completion estimate remains **53%**, while real host/token/phone/five-session acceptance remains **0/5**. Do not merge draft PR #1 without all-green Linux Python 3.12 test output.

## Linux Python 3.12 CircleCI regression path

The existing user's alternative CI provider is **CircleCI**, previously used for other trading-research repositories. In this Indicator-Setup draft branch, added a branch-filtered `.circleci/config.yml` using `cimg/python:3.12`, a small Docker resource, offline test-only environment flags, explicit unsetting of live Kite/Telegram secrets, and a JUnit test artifact. It targets **only** `feature/phase43-paper-recovery-audit`; there is no deploy/publish job or GitHub Actions use.

**Run status:** GitHub commit-status API returned `statuses: []`, and GitHub workflow-runs returned `[]` after the config commit. This does not prove CircleCI project registration or an executed Linux job. CircleCI is not exposed as a connected action in this ChatGPT tool context, so a successful CircleCI job **has not been verified**. Do not merge pending all-green Linux evidence. Docs: https://circleci.com/docs/guides/getting-started/language-python/


## Decisions and blockers

1. Preserve Linux-only production security and file-mode behavior. Do **NOT** fake POSIX file permissions, bypass `os.fchmod` or remove Linux worker locking just to make Windows tests green.
2. **Phase 43 draft PR #1 remains NOT mergeable based on test evidence**: no verified all-green Linux Python 3.12 suite, no existing GitHub CI status, no cloud deployment.
3. Next run the complete repository test suite on an **authorized Linux Python 3.12 isolated runner** with durable temp storage and no real Kite credentials. Suggested:
   ```bash
   git clone --depth 1 --branch feature/phase43-paper-recovery-audit https://github.com/Tirthanand17/Indicator-Setup.git
   cd Indicator-Setup/cloud-alerts
   python3.12 -m venv .venv
   .venv/bin/python -m pip install -r requirements.txt pytest pytest-asyncio httpx
   .venv/bin/python -m pytest -q --tb=short
   ```
4. Fix real Linux failures and preserve no-order protection; merge PR only when all required tests pass. Host qualification, daily Kite HMAC/token relay, Telegram handset confirmation while Nirala is off and five actual regular NSE sessions remain independent live gates, **0/5**.
5. User granted routine reversible project development, **not** approval for installing WSL (requires machine changes/reboots), cloud accounts, charges or actual option orders. No such operations occurred.

**Overall expanded engineering estimate remains 53%, not 100%; Stage 43 recovery/cash ledger is partially verified.**
