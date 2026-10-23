"""Phase 48 OCI bootstrap policy tests, zero cloud/host mutations."""
from pathlib import Path
import shutil
import subprocess

import pytest

DEPLOY = Path(__file__).resolve().parents[1] / 'deploy' / 'oci'


def test_cloud_init_is_nonsecret_and_does_not_activate_worker():
    blob = (DEPLOY / 'ubuntu24-a1-cloud-init.yaml').read_text(encoding='utf-8')
    assert blob.startswith('#cloud-config\n')
    for token in ('docker.io', 'docker-compose-v2', 'ca-certificates',
                  '/private/nifty-alerts', '/srv/nifty-alerts',
                  '/etc/indicator-deployment-disabled'):
        assert token in blob
    assert 'permissions: \'0644\'' in blob
    assert "'0700'" in blob
    forbidden = ('KITE_API_KEY:', 'KITE_ACCESS_TOKEN:', 'TELEGRAM_BOT_TOKEN:',
                 'TOKEN_RELAY_HMAC_KEY:', 'TOKEN_VAULT_KEY:', 'PAPER_AUTOTRADE_ENABLED=true',
                 'ALERTS_ENABLED=true', 'terraform apply', 'docker compose up',
                 'curl | sh', 'git clone')
    for needle in forbidden:
        assert needle not in blob, needle
    assert 'package_upgrade: false' in blob
    assert 'BROKER' not in blob.upper().split('packages:')[1].split('write_files:')[0]


def test_host_verification_never_calls_oci_or_reads_secrets():
    blob = (DEPLOY / 'verify-host.sh').read_text(encoding='utf-8')
    assert blob.startswith('#!/usr/bin/env bash\n')
    for proof in ('WSL_NOT_INDEPENDENT_CLOUD_HOST',
                  'REQUIRES_UBUNTU_2404', 'REQUIRES_ARM64_A1_IMAGE',
                  'CLOUD_TENANCY_ELIGIBILITY=NOT_CHECKED',
                  'FREE_BILLING=NOT_VERIFIED',
                  'DEPLOYMENT_APPROVAL=NOT_GRANTED',
                  'BROKER_AND_TELEGRAM=DISABLED',
                  'PRIVATE_DIRECTORY_NOT_0700'):
        assert proof in blob
    for forbidden in ('eval ', 'curl ', 'wget ', 'oci ', 'terraform ', 'chmod 777',
                      'sudo ', 'docker compose up', 'docker run', 'cat /private',
                      'source /private', 'TOKEN_RELAY_HMAC_KEY', 'TELEGRAM_BOT_TOKEN'):
        assert forbidden not in blob, forbidden


def test_host_verifier_bash_syntax():
    bash = shutil.which('bash')
    if bash is None:
        pytest.skip('Bash syntax can be checked on supported Ubuntu host')
    p = subprocess.run([bash, '-n', str(DEPLOY / 'verify-host.sh')],
                       check=False, capture_output=True, text=True, timeout=8)
    assert p.returncode == 0, p.stderr


def test_host_verifier_fail_closed_on_local_windows_or_test_environment():
    bash = shutil.which('bash')
    if bash is None:
        pytest.skip('Bash is only available on Linux/WSL test host')
    p = subprocess.run([bash, str(DEPLOY / 'verify-host.sh')],
                       check=False, capture_output=True, text=True, timeout=8)
    assert p.returncode == 2
    assert 'OCI_HOST_SOFTWARE=BLOCKED' in p.stdout
    assert 'PREPARED_ONLY' not in p.stdout
