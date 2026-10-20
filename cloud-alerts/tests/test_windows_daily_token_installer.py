"""Offline deployment-contract tests; these do NOT execute PowerShell or access Nirala."""
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
INSTALLER = (ROOT/'deploy/windows/Install-DailyTokenRelay.ps1').read_text(encoding='utf-8')
WATCH = (ROOT/'deploy/windows/Watch-DailyToken.ps1').read_text(encoding='utf-8')


def test_installation_requires_approved_host_and_explicit_switches():
    assert '[switch]$Install' in INSTALLER
    assert '[switch]$ConfirmApprovedHost' in INSTALLER
    assert 'if (-not $Install -or -not $ConfirmApprovedHost)' in INSTALLER
    assert 'PLAN ONLY' in INSTALLER
    assert 'Register-ScheduledTask' in INSTALLER
    assert INSTALLER.index('if (-not $Install -or -not $ConfirmApprovedHost)') < INSTALLER.index('Register-ScheduledTask')


def test_installer_checks_cloud_https_and_no_local_endpoints():
    assert "$parsed.Scheme -ne 'https'" in INSTALLER
    assert '/internal/token' in INSTALLER
    assert '$parsed.Port -ne 443' in INSTALLER
    assert 'local|localhost|internal' in INSTALLER


def test_user_scoped_dpapi_no_plaintext_hmac_in_task_arguments():
    assert 'ConvertFrom-SecureString -SecureString $secureHmac' in INSTALLER
    assert 'ConvertTo-SecureString -String $cfg.hmac_dpapi' in WATCH
    assert 'ZeroFreeBSTR' in INSTALLER
    assert 'ZeroFreeBSTR' in WATCH
    argument_part = INSTALLER.split('$action = New-ScheduledTaskAction', 1)[1].split('$trigger =', 1)[0]
    assert 'hmac' not in argument_part.lower()
    assert 'token_endpoint' not in argument_part.lower()
    assert 'config' in argument_part.lower()


def test_installer_operates_outside_protected_trading_folder():
    assert "Join-Path $env:LOCALAPPDATA 'NiftyReadOnlyTokenRelay'" in INSTALLER
    assert '.StartsWith($protectedFolder' in INSTALLER
    # ProtectedEnvFile is inspected for existence but never used as a destination.
    assert 'Resolve-Path -LiteralPath $ProtectedEnvFile' in INSTALLER
    assert not re.search(r'(?:Set-Content|Copy-Item|Remove-Item|Add-Content).*ProtectedEnvFile', INSTALLER, re.I)
    assert '--env-file' in WATCH and '--watch' in WATCH
    assert not re.search(r'(?:Set-Content|Copy-Item|Remove-Item|Add-Content).*protected_env_file', WATCH, re.I)


def test_scheduled_task_is_user_logon_only_and_ignores_duplicates():
    assert 'New-ScheduledTaskTrigger -AtLogOn -User $userId' in INSTALLER
    assert '-LogonType Interactive -RunLevel Limited' in INSTALLER
    assert '-MultipleInstances IgnoreNew' in INSTALLER
    assert 'Scheduled task already exists' in INSTALLER
    assert 'Start-ScheduledTask' not in INSTALLER
    assert 'Start-Process' not in INSTALLER
    assert 'Disable-ScheduledTask' in INSTALLER


def test_watcher_supplies_only_needed_env_variables_and_avoids_plaintext_logging():
    assert '$env:TOKEN_RELAY_HMAC_KEY' in WATCH
    assert '$env:KITE_API_KEY' in WATCH
    assert '$env:KITE_ALERT_TOKEN_ENDPOINT' in WATCH
    assert '$env:ZERODHA_KITE_API_SECRET' not in WATCH
    assert 'Remove-Item Env:TOKEN_RELAY_HMAC_KEY' in WATCH
    assert 'Read-only token relay unavailable' in WATCH
    assert 'Write-Output $cfg.hmac_dpapi' not in WATCH


def test_watcher_does_not_write_any_project_or_trading_folder_file():
    for cmd in ('Set-Content', 'Out-File', 'Add-Content', 'Copy-Item', 'Move-Item', 'Remove-Item -LiteralPath'):
        assert cmd not in WATCH


def test_existing_check_only_uses_synthetic_readonly_dotenv(tmp_path):
    dotenv=tmp_path/'.env'
    content=('ZERODHA_KITE_API_KEY=fake-app-key\n'
             'ZERODHA_KITE_API_SECRET=must-not-leave-or-print\n'
             'ZERODHA_KITE_ACCESS_TOKEN=fake-token-'+('x'*28)+'\n')
    dotenv.write_text(content,encoding='utf-8')
    before=dotenv.read_bytes()
    completed=subprocess.run([sys.executable,'-m','cloud_alerts.token_sender',
        '--env-file',str(dotenv),'--check-only'],cwd=ROOT,check=False,
        text=True,capture_output=True,timeout=8)
    assert completed.returncode==0
    assert 'KITE_ENV_KEY_NAMES_PRESENT=True' in completed.stdout
    assert 'fake-token' not in (completed.stdout+completed.stderr)
    assert 'must-not-leave-or-print' not in (completed.stdout+completed.stderr)
    assert dotenv.read_bytes()==before
