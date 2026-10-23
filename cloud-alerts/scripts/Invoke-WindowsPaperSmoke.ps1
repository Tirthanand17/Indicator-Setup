# No-cost Windows smoke tests for pure NIFTY paper/accounting modules only.
# Security-dependent Linux/POSIX tests MUST be run separately on Linux Python 3.12.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$PythonExe
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not (Test-Path -LiteralPath $PythonExe -PathType Leaf)) {
    throw 'Pass an existing isolated virtualenv Python path.'
}
$checks = @(
    'tests/test_paper_book.py',
    'tests/test_paper_fee_integration.py',
    'tests/test_paper_charges.py',
    'tests/test_paper_integrity.py',
    'tests/test_paper_integrity_cash.py',
    'tests/test_paper_integrity_hardening.py',
    'tests/test_paper_analytics.py',
    'tests/test_signal_audit.py',
    'tests/test_token_vault_atomic_cleanup.py'
)
foreach ($test in $checks) {
    if (-not (Test-Path (Join-Path $root $test))) {
        throw ('Required paper test missing: ' + $test)
    }
}
# Avoid passing Kite or Telegram secrets to even a synthetic test process.
$old = @{}
$keys = @(Get-ChildItem Env: | Where-Object {
    $_.Name -match '^(KITE|ZERODHA|BROKER|TELEGRAM|TOKEN_|PAPER_|ALERTS_|AWS_|GCP_)'
})
foreach ($v in $keys) {
    $old[$v.Name] = $v.Value
    Remove-Item -Path ('Env:' + $v.Name)
}
try {
    $env:ALERTS_ENABLED='false'
    $env:PAPER_AUTOTRADE_ENABLED='false'
    $env:PAPER_DASHBOARD_ENABLED='false'
    Push-Location $root
    try {
        & $PythonExe -m pytest -q --tb=short @checks
        if ($LASTEXITCODE -ne 0) { throw 'No-cost Windows paper smoke tests FAILED.' }
        & $PythonExe -m compileall -q cloud_alerts tests
        if ($LASTEXITCODE -ne 0) { throw 'Python bytecode syntax compilation FAILED.' }
        Write-Output 'WINDOWS_PAPER_SMOKE_PASS (Linux security/full suite remains separately required)'
    }
    finally {
        Pop-Location
    }
}
finally {
    foreach ($name in @('ALERTS_ENABLED','PAPER_AUTOTRADE_ENABLED','PAPER_DASHBOARD_ENABLED')) {
        Remove-Item -Path ('Env:' + $name) -ErrorAction SilentlyContinue
    }
    foreach ($item in $old.GetEnumerator()) {
        Set-Item -Path ('Env:' + $item.Key) -Value $item.Value
    }
}
