# Optional historical Codespaces runner; offline audits do not authorize creation.
[CmdletBinding()]
param(
    [switch]$BudgetConfirmed,
    [switch]$ResourceCreationApproved,
    [string]$ReportDir = [System.IO.Path]::Combine($env:TEMP, 'indicator-linux-qa')
)
$ErrorActionPreference = 'Stop'
if (-not $BudgetConfirmed -or -not $ResourceCreationApproved) {
    throw 'STOP: separate resource approval and verified included quota with a $0 spending limit are required. Prefer local WSL QA.'
}
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'GitHub CLI is missing.' }
$repo = 'Tirthanand17/Indicator-Setup'
$codespace = ''
New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
try {
    $created = @(& gh codespace create -R $repo -b main -m basicLinux32gb --idle-timeout 5m --retention-period 1h -d indicator-linux-qa)
    if ($LASTEXITCODE -ne 0) { throw 'Creation failed; inspect account resources before retrying.' }
    $codespace = [string]($created | Where-Object { $_ -match '^[a-z0-9]+(?:-[a-z0-9]+)+$' } | Select-Object -Last 1)
    $codespace = $codespace.Trim()
    if ($codespace -notmatch '^[a-z0-9]+(?:-[a-z0-9]+)+$') {
        $codespace = ''
        throw 'Exact created Codespace name unavailable. Inspect the account; never guess a resource name.'
    }
    $complete = $false
    for ($attempt = 0; $attempt -lt 48; $attempt++) {
        & gh codespace ssh -c $codespace -- sh -c 'test -f "$HOME/.cache/indicator-phase43-offline-qa/exit-status.txt"'
        if ($LASTEXITCODE -eq 0) { $complete = $true; break }
        Start-Sleep -Seconds 15
    }
    if (-not $complete) { throw 'QA timed out; cleaning up only this invocation resource.' }
    $output = @(& gh codespace ssh -c $codespace -- sh -c 'cat "$HOME/.cache/indicator-phase43-offline-qa/exit-status.txt"; tail -n 160 "$HOME/.cache/indicator-phase43-offline-qa/pytest.log"')
    $result = $LASTEXITCODE
    $output | Set-Content -LiteralPath (Join-Path $ReportDir 'linux-qa-result.txt') -Encoding UTF8
    if ($result -ne 0 -or -not ($output -match '^PHASE43_LINUX_PY312_RESULT=0$')) { throw 'Linux regression failed or result unreadable.' }
    Write-Output 'PASS: offline regression; no live acceptance proved.'
}
finally {
    if ($codespace) {
        & gh codespace stop -c $codespace | Out-Null
        & gh codespace delete -c $codespace --force | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Warning 'Cleanup failed; inspect the account immediately.' }
    }
}
