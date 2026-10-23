#!/usr/bin/env bash
# Full offline Python 3.12 regression on an existing WSL/Ubuntu checkout.
# No Kite broker/Telegram credentials, order placement, deployment or CI minutes.
set -euo pipefail
if [[ "$(uname -s)" != Linux ]] || [[ "$(id -u)" == 0 ]]; then
  echo "BLOCKED: run as a non-root Linux user, not in Windows or as root." >&2
  exit 80
fi
project="$(cd "$(dirname "$0")/.." && pwd -P)"
python="$HOME/work/.venv/bin/python"
if [[ ! -x "$python" ]]; then
  echo "BLOCKED: create the isolated Python 3.12 virtualenv at $python first." >&2
  exit 81
fi
version="$("$python" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
if [[ "$version" != "3.12" ]]; then
  echo "BLOCKED: test runner requires Python 3.12, found $version." >&2
  exit 82
fi
reports="$HOME/work/reports"
mkdir -p "$reports"
cd "$project"
printf 'SOURCE_HEAD=%s\n' "$(git -C "$project/.." rev-parse HEAD)"
printf 'PYTHON=%s\n' "$("$python" --version)"
echo "NO LIVE BROKER CREDENTIALS; DISABLED FEATURE FLAGS; NO REAL ORDERS."
set +e
env -i HOME="$HOME" PATH=/usr/bin:/bin LANG=C.UTF-8 \
  ALERTS_ENABLED=false PAPER_AUTOTRADE_ENABLED=false \
  PAPER_DASHBOARD_ENABLED=false PAPER_PREMIUM_TRACKING_ENABLED=false \
  KITE_SHADOW_ENABLED=false \
  "$python" -m pytest -q --tb=short \
  --junitxml="$reports/phase45-linux-py312.xml" \
  2>&1 | tee "$reports/phase45-linux-py312.log"
exit_code=$?
set -e
printf '%s\n' "$exit_code" > "$reports/phase45-exit-code.txt"
printf 'FULL_LINUX_PY312_EXIT=%s\n' "$exit_code"
exit "$exit_code"
