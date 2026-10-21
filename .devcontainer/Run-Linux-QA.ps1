# Explicitly budget-gated disposable Linux QA through user's existing GitHub account.
# Does not touch the protected trading folder, transmit secrets or deploy anything.
[CmdletBinding()]
param(
    [switch]$BudgetConfirmed,
    [string]$ReportDir = [System.IO.Path]::Combine($env:TEMP, 'indicator-phase43-qa-20261021')
)
$ErrorActionPreference = 'Stop'
if (-not $BudgetConfirmed) {
    throw 'Codespaces may incur charges. Confirm remaining INCLUDED Codespaces quota and effective $0 spending limit, then pass -BudgetConfirmed.'
}
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw 'GitHub CLI is missing.'
}
$repo = 'Tirthanand17/Indicator-Setup'
$branch = 'feature/phase43-paper-recovery-audit'
$codespace = ''
New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
try {
    $created = @(& gh codespace create -R $repo -b $branch -m basicLinux32gb `
        --idle-timeout 5m --retention-period 1h -d indicator-phase43-linux-qa 2>&1)
    if ($LASTEXITCODE -ne 0) { throw 'GitHub refused the disposable Codespace.' }
    $codespace = ([string]($created | Select-Object -Last 1)).Trim()
    if ($codespace -notmatch '^[a-z0-9]+(?:-[a-z0-9]+)+$') {
        throw 'Codespace was created but its exact name was not returned. Inspect gh codespace list before deleting anything.'
    }
    Write-Output ('CODESPACE=' + $codespace)
    $complete = $false
    for ($attempt = 0; $attempt -lt 48; $attempt++) {
        $null = & gh codespace ssh -c $codespace -- sh -c 'test -f "$HOME/.cache/indicator-phase43-offline-qa/exit-status.txt"' 2>&1
        if ($LASTEXITCODE -eq 0) { $complete = $true; break }
        Start-Sleep -Seconds 15
    }
    if (-not $complete) { throw 'Automatic QA did not finish. Stop/delete cleanup will still run.' }
    $output = @(& gh codespace ssh -c $codespace -- sh -c 'cat "$HOME/.cache/indicator-phase43-offline-qa/exit-status.txt"; tail -n 160 "$HOME/.cache/indicator-phase43-offline-qa/pytest.log"' 2>&1)
    $log = Join-Path $ReportDir 'codespaces-linux-qa-result.txt'
    $output | Set-Content -Path $log -Encoding UTF8
    $output | Select-Object -Last 20 | ForEach-Object { Write-Output $_ }
    if ($LASTEXITCODE -ne 0 -or -not ($output -match '^PHASE43_LINUX_PY312_RESULT=0$')) {
        throw ('Full Linux regression is RED or unreadable; see ' + $log)
    }
    Write-Output ('PASS: full offline Linux Python 3.12 QA; report=' + $log)
}
finally {
    if ($codespace) {
        # Only this script's newly-created explicit codespace is cleaned up.
        & gh codespace stop -c $codespace 2>&1 | Out-Null
        & gh codespace delete -c $codespace --force 2>&1 | Out-Null
    }
}
