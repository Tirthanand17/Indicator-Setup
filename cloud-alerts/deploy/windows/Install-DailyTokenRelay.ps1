# Phase 34: opt-in, read-only Windows user-logon token relay.
# This installer NEVER reads Kite token contents, starts a relay, or changes the
# protected .env. Actual installation requires BOTH switches shown below.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$SourceDir,
    [Parameter(Mandatory=$true)][string]$ProtectedEnvFile,
    [Parameter(Mandatory=$true)][string]$TokenEndpoint,
    [string]$PythonExe = 'python.exe',
    [switch]$Install,
    [switch]$ConfirmApprovedHost
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$taskName = 'NiftyReadOnlyDailyTokenRelay'
$agentDir = Join-Path $env:LOCALAPPDATA 'NiftyReadOnlyTokenRelay'

function Assert-CloudEndpoint([string]$url) {
    $parsed = $null
    if (-not [Uri]::TryCreate($url,[UriKind]::Absolute,[ref]$parsed)) {
        throw 'Invalid HTTPS endpoint'
    }
    if ($parsed.Scheme -ne 'https' -or $parsed.AbsolutePath -cne '/internal/token' -or
        $parsed.Port -ne 443 -or $parsed.UserInfo -or $parsed.Query -or $parsed.Fragment -or
        $parsed.Host -notmatch '^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$' -or
        $parsed.Host -match '(?i)\.(local|localhost|internal)$') {
        throw 'Use an explicitly approved public HTTPS FQDN with /internal/token on port 443'
    }
}
Assert-CloudEndpoint $TokenEndpoint
$source = (Resolve-Path -LiteralPath $SourceDir).ProviderPath
$protected = (Resolve-Path -LiteralPath $ProtectedEnvFile).ProviderPath
if (-not (Test-Path -LiteralPath (Join-Path $source 'cloud_alerts\token_sender.py') -PathType Leaf)) {
    throw 'SourceDir must contain cloud_alerts/token_sender.py'
}
if (-not (Test-Path -LiteralPath $protected -PathType Leaf)) {
    throw 'Existing protected .env is unavailable'
}
$protectedFolder = (Split-Path -Parent $protected).TrimEnd('\') + '\'
if (($source.TrimEnd('\') + '\').StartsWith($protectedFolder,[StringComparison]::OrdinalIgnoreCase)) {
    throw 'Relay files must not be installed within the protected trading folder'
}
$pythonCommand = Get-Command -Name $PythonExe -CommandType Application -ErrorAction Stop
$pythonPath = $pythonCommand.Source
$watcherSource = Join-Path $PSScriptRoot 'Watch-DailyToken.ps1'
if (-not (Test-Path -LiteralPath $watcherSource -PathType Leaf)) {
    throw 'Missing read-only watcher wrapper'
}
if (-not $Install -or -not $ConfirmApprovedHost) {
    Write-Output 'PLAN ONLY: no task installed, no credentials read, no HTTP requests sent.'
    Write-Output 'To install, verify HTTPS host and rerun with -Install -ConfirmApprovedHost.'
    return
}
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    throw 'Scheduled task already exists; manual review required before replacing it'
}
$key = Read-Host 'Kite API key (not the Kite API secret)' -ErrorAction Stop
if ([string]::IsNullOrWhiteSpace($key)) { throw 'Kite API key cannot be empty' }
$secureHmac = Read-Host 'Token relay HMAC secret (minimum 32 characters; input hidden)' -AsSecureString
$bstr = [IntPtr]::Zero
try {
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureHmac)
    $length = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Length
    if ($length -lt 32) { throw 'HMAC relay key is too short' }
} finally {
    if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
# ConvertFrom-SecureString uses user-scoped DPAPI on Windows when no -Key is supplied.
$encryptedHmac = ConvertFrom-SecureString -SecureString $secureHmac
$null = New-Item -ItemType Directory -Path $agentDir -Force
$userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
# Restrict the containing directory BEFORE creating either config or wrapper.
& icacls.exe $agentDir '/inheritance:r' '/grant:r' "${userId}:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Unable to restrict token-agent directory permissions' }
$runner = Join-Path $agentDir 'Watch-DailyToken.ps1'
$config = Join-Path $agentDir 'relay-config.json'
Copy-Item -LiteralPath $watcherSource -Destination $runner -ErrorAction Stop
@{
    schema = 'nifty-local-token-relay-v1'
    python_path = $pythonPath
    source_dir = $source
    protected_env_file = $protected
    token_endpoint = $TokenEndpoint
    kite_api_key = $key
    hmac_dpapi = $encryptedHmac
} | ConvertTo-Json -Compress | Set-Content -LiteralPath $config -Encoding UTF8
foreach ($file in @($config,$runner)) {
    & icacls.exe $file '/inheritance:r' '/grant:r' "${userId}:F" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Unable to restrict token-agent file permissions' }
}
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument (
    '-NoProfile -NonInteractive -File "' + $runner + '" -ConfigPath "' + $config + '"')
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -StartWhenAvailable
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -ErrorAction Stop | Out-Null
Write-Output 'Installed user-logon token watcher. It will start at the NEXT sign-in.'
Write-Output 'Daily Zerodha login is still required; no request was sent by the installer.'
Write-Output 'To disable: Disable-ScheduledTask -TaskName NiftyReadOnlyDailyTokenRelay'
