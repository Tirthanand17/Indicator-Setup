#!/usr/bin/env bash
# Ephemeral no-broker Linux regression: NO DEPLOY, NO KITE, NO TELEGRAM.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
if [[ "$(uname -s)" != Linux ]]; then
  echo "BLOCKED: the full security suite requires Linux, not Windows emulation." >&2
  exit 90
fi
if ! command -v python3.12 >/dev/null 2>&1; then
  echo "BLOCKED: exact Python 3.12 not installed." >&2
  exit 91
fi
qa_dir="${HOME}/.cache/indicator-phase43-offline-qa"
mkdir -p "$qa_dir"
cd "$repo_root"
echo "SOURCE: $(git rev-parse HEAD)"
echo "PYTHON: $(python3.12 --version)"
echo "DRY RUN: no network broker credentials, no exchange orders, no deployments."
python3.12 -m venv "$qa_dir/venv"
env -i HOME="$HOME" PATH="$PATH" LANG=C.UTF-8 \
  "$qa_dir/venv/bin/python" -m pip install --disable-pip-version-check \
  -r cloud-alerts/requirements.txt pytest pytest-asyncio httpx
cd cloud-alerts
set +e
timeout 600 env -i HOME="$HOME" PATH="$PATH" LANG=C.UTF-8 \
  ALERTS_ENABLED=false PAPER_AUTOTRADE_ENABLED=false \
  PAPER_DASHBOARD_ENABLED=false PAPER_PREMIUM_TRACKING_ENABLED=false \
  KITE_SHADOW_ENABLED=false \
  "$qa_dir/venv/bin/python" -m pytest -q --tb=short \
  --junitxml="$qa_dir/results.xml" 2>&1 | tee "$qa_dir/pytest.log"
test_exit=${PIPESTATUS[0]}
set -e
printf 'PHASE43_LINUX_PY312_RESULT=%s\n' "$test_exit" | tee "$qa_dir/exit-status.txt"
echo "Logs: $qa_dir/pytest.log | JUnit: $qa_dir/results.xml"
exit "$test_exit"
