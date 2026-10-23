#!/usr/bin/env bash
# Read-only local prerequisites probe ON AN OPERATOR-CREATED OCI Ubuntu 24.04 A1 VM.
# Does not query the cloud account, read any secrets, alter the host or deploy.
set -euo pipefail
blockers=()
if [[ ! -r /etc/os-release ]]; then
  blockers+=(OS_RELEASE_UNAVAILABLE)
else
  # shellcheck disable=SC1091
  . /etc/os-release
  [[ "${ID:-}" == ubuntu && "${VERSION_ID:-}" == 24.04 ]] || blockers+=(REQUIRES_UBUNTU_2404)
fi
[[ "$(uname -m)" == aarch64 ]] || blockers+=(REQUIRES_ARM64_A1_IMAGE)
if grep -qi microsoft /proc/version 2>/dev/null; then
  blockers+=(WSL_NOT_INDEPENDENT_CLOUD_HOST)
fi
[[ -f /etc/indicator-deployment-disabled ]] || blockers+=(CLOUD_INIT_DISABLED_MARKER_MISSING)
command -v docker >/dev/null 2>&1 || blockers+=(DOCKER_NOT_INSTALLED)
if command -v docker >/dev/null 2>&1; then
  docker compose version >/dev/null 2>&1 || blockers+=(COMPOSE_PLUGIN_UNAVAILABLE)
fi
for path in /private/nifty-alerts /srv/nifty-alerts; do
  if [[ ! -d "$path" ]]; then
    blockers+=(PRIVATE_HOST_DIRECTORIES_MISSING)
  elif [[ "$path" == /private/nifty-alerts ]]; then
    perms="$(stat -c '%a' "$path")"
    [[ "$perms" == 700 ]] || blockers+=(PRIVATE_DIRECTORY_NOT_0700)
  fi
done
if ((${#blockers[@]})); then
  printf 'OCI_HOST_SOFTWARE=BLOCKED\n'
  for code in "${blockers[@]}"; do printf 'BLOCKER=%s\n' "$code"; done
  exit 2
fi
printf 'OCI_HOST_SOFTWARE=PREPARED_ONLY\n'
printf 'CLOUD_TENANCY_ELIGIBILITY=NOT_CHECKED\n'
printf 'FREE_BILLING=NOT_VERIFIED\n'
printf 'HTTPS_AND_DNS=NOT_CONFIGURED\n'
printf 'BROKER_AND_TELEGRAM=DISABLED\n'
printf 'DEPLOYMENT_APPROVAL=NOT_GRANTED\n'
printf 'NO_SECRETS_READ_OR_NETWORK_REQUESTS\n'
