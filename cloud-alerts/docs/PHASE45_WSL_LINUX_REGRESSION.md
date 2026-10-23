# Phase 45 — Nirala Ubuntu 24.04 WSL 2 installed; complete Python 3.12 regression GREEN

**Date:** 2026-10-23 (Asia/Kolkata). **Verification:** actual authorized Nirala computer via Desktop Commander, not an assumed runner.

## Verified installation

- Existing Windows remains **Windows 11 Home Single Language, build 26200**. Official `wsl.exe --install --distribution Ubuntu-24.04 --web-download --no-launch` ran under normal Windows UAC administrator elevation, with installer transcript kept under `%TEMP%\indicator-wsl-install-20261023.log`.
- Windows Installer confirmed **WSL 3.0.3.0** installed successfully; WSL kernel **6.18.54.1-1**, Ubuntu **24.04.5 LTS**, registered as **WSL version 2** and default distribution.
- WSL returned installation exit code **0**. **No Windows restart** was performed. WSL Ubuntu was started successfully and verified Linux kernel `6.18.54.1-microsoft-standard-WSL2`.
- Existing `/etc/wsl.conf` section `[boot] systemd=true` was **preserved**. Added `[user] default=indicatorqa`. After `wsl --terminate Ubuntu-24.04` (only the WSL distro), a fresh `wsl -d Ubuntu-24.04 -- id -un` returned **`indicatorqa`**, a dedicated non-root account. The user account does NOT get blanket passwordless sudo rights.
- Ubuntu Python 3.12.3 was present. Installed the Ubuntu `python3.12-venv` package and related distribution updates. Created non-root, isolated `/home/indicatorqa/work/.venv`; used Python pip to install `cloud-alerts/requirements.txt`, `pytest`, `pytest-asyncio`, `httpx`.
- Windows C: drive had about **104 GiB free** before WSL install and **99.7 GiB free** after the distro installation, before all QA package cache growth. WSL virtual disk capacity is a **maximum**, not immediately allocated physical storage.
- The `Indicator-Setup` checkout was copied from an existing authorized Windows `%TEMP%` Git clone into Ubuntu's native ext4 filesystem at `/home/indicatorqa/work/indicator-setup`. No files were written to the Desktop or the protected `C:\Users\Dell\Desktop\Automation Day Trading` tree. GitHub stays the primary source of truth. No real Kite secrets were read, copied or transmitted.

## Full actual Linux regression evidence

- Initial entire Linux Python 3.12 test run against source commit `9ef3cc1`: **584 passed, 1 failed, 1 skipped**, due to an incorrect synthetic lifecycle-test expectation. The engine correctly closed **three** read-only Kite SDK clients (metadata + independent 5m and 15m historical), but the test compared the two historical client IDs to the entire closed-client set.
- Fixed `tests/test_independent_kite_sessions.py` to assert both historical clients were closed AND that **all created KiteReadOnly clients, including metadata, were closed**. This preserves and strengthens real resource cleanup coverage. Fix commit `a449165f5cdf1dbcfdeadadfbbac640cf3028835`.
- Against exact corrected source commit **`a449165f5cdf1dbcfdeadadfbbac640cf3028835`**, **FULL Linux Python 3.12 pytest: 585 PASSED, 0 FAILED, 1 SKIPPED, 1 Starlette/httpx deprecation warning**, exit code 0, 29.43 seconds.
- Added reproducible no-broker script `cloud-alerts/scripts/Run-Local-WSL-Py312-Regression.sh` on feature branch commit `c96703f12f20b7bd39d5452d911bcb6d9688d5b8`. The file is run with `bash` because Windows Git copies can have CRLF; Windows-to-WSL copy step normalizes shell scripts to LF.
- After pulling and copying exact **`c96703f12f20b7bd39d5452d911bcb6d9688d5b8`** into Ubuntu's ext4 filesystem, **the CHECKED-IN regression script independently passed: 585 PASSED, 0 FAILED, 1 SKIPPED, 1 warning, exit 0, 25.77 seconds.**
- Pytest runs as **UID 1000**, using `env -i` with only harmless system variables and explicitly `ALERTS_ENABLED=false`, `PAPER_AUTOTRADE_ENABLED=false`, `PAPER_DASHBOARD_ENABLED=false`, `KITE_SHADOW_ENABLED=false` and `PAPER_PREMIUM_TRACKING_ENABLED=false`. It uses synthetic test data, not a broker account or live phone alerts.
- Durable local Linux evidence: `/home/indicatorqa/work/reports/phase45-linux-py312.log`, `phase45-linux-py312.xml`, `phase45-exit-code.txt`. The earlier `phase43-linux-py312.log` records the first green run.
- Reproduction from normal Windows PowerShell (no administrator rights, no cloud CI, no new downloads):
  ```powershell
  wsl -d Ubuntu-24.04 -- bash /home/indicatorqa/work/indicator-setup/cloud-alerts/scripts/Run-Local-WSL-Py312-Regression.sh
  ```

## What this does and DOES NOT prove

- **Now verified:** WSL 2 installation, Ubuntu 24.04, non-root environment, Python 3.12, all cloud-alerts unit/integration tests under Linux and repeatable offline full suite. This clears the earlier Linux regression blocker, without CircleCI, Codespaces, GitHub Actions, paid infrastructure or a Windows reboot.
- **Not verified:** actual production cloud host/persistence, signed real daily Kite relay, true live NIFTY option quote handling, Telegram phone receipt with Nirala powered off, and five full live NSE sessions. These are **0/5 acceptance gates**. Broker execution remains disabled. A local WSL laptop session cannot substitute for independent always-on cloud hosting.
- There is a deprecation warning in the Starlette/FastAPI TestClient dependency; it does not fail the suite but should be tracked for future maintenance.
- The Phase 43/44 code is ready for merge consideration based on a genuinely green full Linux Python 3.12 run. A GitHub CI status and production deployment approval are independent concerns. Don't claim those are complete.

**Next:** review PR #1 final diff and merge only if the verified test and safety evidence supports it; then pursue a pre-approved free durable host and five-session cloud acceptance.
