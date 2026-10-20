# User-logon task only. Reads protected trading .env via Python's read-only parser.
# HMAC secret lives as DPAPI ciphertext in a user-private LOCALAPPDATA config.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ConfigPath)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
try {
    if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { throw 'Agent config missing' }
    $cfg = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($cfg.schema -ne 'nifty-local-token-relay-v1') { throw 'Agent configuration schema mismatch' }
    $secure = ConvertTo-SecureString -String $cfg.hmac_dpapi
    $bstr = [IntPtr]::Zero
    try {
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        $env:TOKEN_RELAY_HMAC_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    }
    $env:KITE_API_KEY = [string]$cfg.kite_api_key
    $env:KITE_ALERT_TOKEN_ENDPOINT = [string]$cfg.token_endpoint
    # Invoke only the versioned source outside the protected trading directory.
    Push-Location -LiteralPath ([string]$cfg.source_dir)
    try {
        & ([string]$cfg.python_path) -m cloud_alerts.token_sender --env-file ([string]$cfg.protected_env_file) --watch
        if ($LASTEXITCODE -ne 0) { throw 'Read-only token watcher stopped with an error' }
    } finally {
        Pop-Location
    }
} catch {
    # No credentials, token values, HMAC or raw exception text in log output.
    Write-Error 'Read-only token relay unavailable; check the approved host, login and user task configuration.'
    exit 2
} finally {
    Remove-Item Env:TOKEN_RELAY_HMAC_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:KITE_ALERT_TOKEN_ENDPOINT -ErrorAction SilentlyContinue
    Remove-Item Env:KITE_API_KEY -ErrorAction SilentlyContinue
}
