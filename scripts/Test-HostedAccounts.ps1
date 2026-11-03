#requires -Version 5.1
<#
.SYNOPSIS
Tests hosted account routes using one disposable, email-confirmed synthetic user.
.DESCRIPTION
Uses an existing Supabase legacy service-role JWT, read from a secure prompt or
the clipboard. Never logs or saves credentials. Clipboard input is cleared after
reading. Provider email delivery and interactive OAuth are separate launch checks.
.EXAMPLE
.\scripts\Test-HostedAccounts.ps1 -AuthUrl https://project-ref.supabase.co -ReadAdminKeyFromClipboard
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$AuthUrl,
    [string]$ServiceUrl = 'https://vumiro-rooms.vumiro-signaling.workers.dev',
    [switch]$ReadAdminKeyFromClipboard
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:stage = 'Validate configuration'
$script:http = $null
$script:adminKey = $null
$script:clientKey = $null
$script:fixtureId = $null
$script:fixtureEmail = $null
$script:fixturePassword = $null
$script:session = $null
$script:primary = $null
$script:workerEnrolled = $false
$script:workerDeletionAccepted = $false
$failed = $false

function Start-Stage([string]$Name) {
    $script:stage = $Name
    Write-Output "STAGE: $Name"
}
function Pass-Stage { Write-Output "PASS: $script:stage" }
function Require([bool]$Condition) {
    if (-not $Condition) { throw 'Hosted account check failed.' }
}
function ConvertTo-UtcTicks($Value) {
    if ($Value -is [DateTimeOffset]) { return $Value.UtcDateTime.Ticks }
    if ($Value -is [DateTime]) { return ([DateTimeOffset]$Value).UtcDateTime.Ticks }
    return [DateTimeOffset]::Parse([string]$Value, [Globalization.CultureInfo]::InvariantCulture).UtcDateTime.Ticks
}
function Decode-JwtPart([string]$Part) {
    Require ($Part -cmatch '^[A-Za-z0-9_-]+$')
    $text = $Part.Replace('-', '+').Replace('_', '/')
    $text += '=' * ((4 - $text.Length % 4) % 4)
    return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($text)) | ConvertFrom-Json
}
function New-RandomPassword {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return 'Vm!9aZ' + [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}
function Invoke-Json([string]$Url, [string]$Method = 'GET', [hashtable]$Headers = @{}, $Body = $null) {
    $message = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::new($Method), $Url)
    $response = $null
    try {
        foreach ($name in $Headers.Keys) { [void]$message.Headers.TryAddWithoutValidation($name, [string]$Headers[$name]) }
        if ($null -ne $Body) {
            $json = ConvertTo-Json -InputObject $Body -Depth 20 -Compress
            $message.Content = [Net.Http.StringContent]::new($json, [Text.Encoding]::UTF8, 'application/json')
        }
        $response = $script:http.SendAsync($message).GetAwaiter().GetResult()
        $text = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        $data = $null
        if ($text) { try { $data = ConvertFrom-Json -InputObject $text } catch { $data = $null } }
        return [pscustomobject]@{ Status = [int]$response.StatusCode; Data = $data }
    } finally {
        if ($null -ne $response) { $response.Dispose() }
        $message.Dispose()
    }
}
function Invoke-Admin([string]$Path, [string]$Method = 'GET', $Body = $null) {
    return Invoke-Json "$AuthUrl/auth/v1/admin/$Path" $Method @{ apikey = $script:adminKey; Authorization = "Bearer $script:adminKey" } $Body
}
function Get-FixtureSession {
    $result = Invoke-Json "$AuthUrl/auth/v1/token?grant_type=password" 'POST' @{ apikey = $script:clientKey } @{ email = $script:fixtureEmail; password = $script:fixturePassword }
    Require ($result.Status -eq 200 -and $null -ne $result.Data)
    Require ($result.Data.user.id -ceq $script:fixtureId)
    return $result.Data
}
function Invoke-Account([string]$Path, [string]$Method = 'GET', $Body = $null, $Device = $script:primary, [string]$AccessToken = '') {
    if (-not $AccessToken) { $AccessToken = $script:session.access_token }
    $headers = @{ Authorization = "Bearer $AccessToken"; 'X-Vumiro-Device' = $Device.Id }
    if ($Device.Token) { $headers['X-Vumiro-Device-Token'] = $Device.Token }
    return Invoke-Json "$ServiceUrl/api/v1/account/$Path" $Method $headers $Body
}
function Register-Device {
    $device = [pscustomobject]@{ Id = [guid]::NewGuid().ToString(); Token = '' }
    # A connection failure can occur after the Worker has committed its write.
    $script:workerEnrolled = $true
    $result = Invoke-Account 'devices/register' 'POST' $null $device
    Require ($result.Status -eq 201)
    Require ($result.Data.deviceToken -cmatch '^[0-9a-f]{64}$')
    $device.Token = $result.Data.deviceToken
    return $device
}

try {
    Start-Stage 'Validate configuration'
    $AuthUrl = $AuthUrl.TrimEnd('/')
    $ServiceUrl = $ServiceUrl.TrimEnd('/')
    Require ($AuthUrl -cmatch '^https://([a-z0-9-]+)\.supabase\.co$')
    $projectRef = $Matches[1]
    $serviceUri = [uri]$ServiceUrl
    Require ($serviceUri.IsAbsoluteUri -and $serviceUri.Scheme -eq 'https' -and -not $serviceUri.UserInfo -and $serviceUri.AbsolutePath -eq '/' -and -not $serviceUri.Query -and -not $serviceUri.Fragment)
    Add-Type -AssemblyName System.Net.Http
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $script:http = [Net.Http.HttpClient]::new($handler)
    $script:http.Timeout = [TimeSpan]::FromSeconds(30)
    Pass-Stage

    Start-Stage 'Read admin credential'
    if ($ReadAdminKeyFromClipboard) {
        try { $script:adminKey = [string](Get-Clipboard -Raw) } finally { Set-Clipboard -Value '' }
    } else {
        $secureKey = Read-Host 'Supabase legacy service-role JWT' -AsSecureString
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
        try { $script:adminKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secureKey.Dispose() }
    }
    $script:adminKey = $script:adminKey.Trim()
    Require ($script:adminKey -cmatch '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')
    $parts = $script:adminKey.Split('.')
    $adminHeader = Decode-JwtPart $parts[0]
    $adminClaims = Decode-JwtPart $parts[1]
    Require ($adminHeader.alg -ceq 'HS256' -and $adminClaims.role -ceq 'service_role' -and $adminClaims.ref -ceq $projectRef)
    if ($adminClaims.PSObject.Properties.Name -contains 'exp') {
        Require ([long]$adminClaims.exp -gt [DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
    }
    Pass-Stage

    Start-Stage 'Read service configuration'
    $configuration = Invoke-Json "$ServiceUrl/api/v1/account/config"
    Require ($configuration.Status -eq 200 -and $configuration.Data.serviceEnabled -eq $true)
    Require ($configuration.Data.authUrl.TrimEnd('/') -ceq $AuthUrl)
    $script:clientKey = [string]$configuration.Data.publishableKey
    Require (-not [string]::IsNullOrWhiteSpace($script:clientKey))
    Pass-Stage

    Start-Stage 'Create disposable account'
    $script:fixtureEmail = "vumiro-smoke-$([guid]::NewGuid().ToString('N'))@example.invalid"
    $script:fixturePassword = New-RandomPassword
    $created = Invoke-Admin 'users' 'POST' @{ email = $script:fixtureEmail; password = $script:fixturePassword; email_confirm = $true }
    Require ($created.Status -ge 200 -and $created.Status -lt 300 -and $null -ne $created.Data)
    $createdId = [string]$created.Data.id
    Require ($createdId -match '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' -and $created.Data.email -ceq $script:fixtureEmail)
    # Assign only after checking the synthetic email so cleanup cannot target an
    # existing account from an unexpected provider response.
    $script:fixtureId = $createdId
    Pass-Stage

    Start-Stage 'Password login and asymmetric session'
    $script:session = Get-FixtureSession
    $sessionHeader = Decode-JwtPart $script:session.access_token.Split('.')[0]
    Require ($sessionHeader.alg -cin @('ES256', 'RS256'))
    Require (-not [string]::IsNullOrWhiteSpace($sessionHeader.kid))
    Pass-Stage

    Start-Stage 'Refresh session'
    $refreshed = Invoke-Json "$AuthUrl/auth/v1/token?grant_type=refresh_token" 'POST' @{ apikey = $script:clientKey } @{ refresh_token = $script:session.refresh_token }
    Require ($refreshed.Status -eq 200 -and $refreshed.Data.user.id -ceq $script:fixtureId)
    $script:session = $refreshed.Data
    Pass-Stage

    Start-Stage 'Enroll primary and secondary devices'
    $script:primary = Register-Device
    $secondary = Register-Device
    Pass-Stage

    Start-Stage 'Require device credentials'
    $withoutCredential = [pscustomobject]@{ Id = $script:primary.Id; Token = '' }
    $wrongCredential = [pscustomobject]@{ Id = $script:primary.Id; Token = ('0' * 64) }
    Require ((Invoke-Account 'data' 'GET' $null $withoutCredential).Status -eq 403)
    Require ((Invoke-Account 'data' 'GET' $null $wrongCredential).Status -eq 403)
    $initial = Invoke-Account 'data'
    Require ($initial.Status -eq 200 -and $initial.Data.revision -eq 0 -and $null -eq $initial.Data.data)
    Pass-Stage

    Start-Stage 'Write and read account snapshot'
    $snapshot = @{
        version = 1; profile = @{ name = 'Vumiro smoke fixture'; username = ''; avatar = '' }
        friends = @(); blocked = @(); settings = @{ fps = 60; audio = $true }
        privacyNoticeVersion = $configuration.Data.privacyNoticeVersion
        privacyNoticeAcceptedAt = [DateTime]::UtcNow.ToString('o')
    }
    $written = Invoke-Account 'data' 'PUT' @{ snapshot = $snapshot; expectedRevision = 0 }
    Require ($written.Status -eq 200 -and $written.Data.revision -eq 1)
    $read = Invoke-Account 'data'
    Require ($read.Status -eq 200 -and $read.Data.revision -eq 1 -and $read.Data.data.profile.name -ceq $snapshot.profile.name)
    Pass-Stage

    Start-Stage 'Reject stale snapshot revision'
    $conflict = Invoke-Account 'data' 'PUT' @{ snapshot = $snapshot; expectedRevision = 0 }
    Require ($conflict.Status -eq 409)
    Pass-Stage

    Start-Stage 'Export account identity'
    $export = Invoke-Account 'export'
    Require ($export.Status -eq 200 -and $export.Data.account.id -ceq $script:fixtureId -and $export.Data.account.email -ceq $script:fixtureEmail)
    Pass-Stage
    Start-Stage 'Export snapshot revision'
    Require ($export.Data.sync.revision -eq 1)
    Pass-Stage
    Start-Stage 'Export linked devices'
    Require (@($export.Data.devices).Count -eq 2)
    Pass-Stage
    Start-Stage 'Export privacy notice records'
    Require (@($export.Data.noticeRecords).Count -eq 1)
    Require ($export.Data.noticeRecords[0].version -ceq $snapshot.privacyNoticeVersion)
    Pass-Stage
    Start-Stage 'Export privacy acknowledgement timestamp'
    # PowerShell 7 may deserialize ISO timestamps into DateTime automatically.
    # Compare the instant without culture-dependent string conversions.
    Require ((ConvertTo-UtcTicks $export.Data.noticeRecords[0].acceptedAt) -eq (ConvertTo-UtcTicks $snapshot.privacyNoticeAcceptedAt))
    Pass-Stage

    Start-Stage 'Restore snapshot on secondary device'
    $restored = Invoke-Account 'data' 'GET' $null $secondary
    Require ($restored.Status -eq 200 -and $restored.Data.currentDevice -ceq $secondary.Id -and $restored.Data.revision -eq 1)
    Require ($restored.Data.data.profile.name -ceq $snapshot.profile.name -and $restored.Data.data.settings.fps -eq 60)
    Pass-Stage

    Start-Stage 'Revoke secondary device'
    # Get fresh password authentication for this security operation.
    $script:session = Get-FixtureSession
    $revoked = Invoke-Account 'devices/revoke' 'POST' @{ deviceId = $secondary.Id }
    Require ($revoked.Status -eq 200)
    Require ((Invoke-Account 'data' 'GET' $null $secondary).Status -in @(401, 403))
    Require ((Invoke-Account 'devices/register' 'POST' $null $secondary).Status -eq 403)
    Pass-Stage

    Start-Stage 'Delete disposable account through Worker'
    $deleted = Invoke-Account 'data' 'DELETE'
    if ($deleted.Status -in @(200, 202)) { $script:workerDeletionAccepted = $true }
    Require ($deleted.Status -eq 200 -and $deleted.Data.ok -eq $true)
    Pass-Stage

    Start-Stage 'Verify provider deletion and tombstone'
    Require ((Invoke-Admin "users/$script:fixtureId").Status -eq 404)
    Require ((Invoke-Account 'data').Status -eq 410)
    Pass-Stage
} catch {
    # Never emit the exception/response: provider failures can contain credentials.
    Write-Output "FAIL: $script:stage"
    $failed = $true
} finally {
    if ($script:fixtureId) {
        Start-Stage 'Clean up disposable account'
        try {
            if ($script:workerEnrolled -and -not $script:workerDeletionAccepted) {
                # The fixture owns every device used here. Remove Worker rows before
                # deleting its provider identity, preserving a retry path on failure.
                for ($attempt = 0; $attempt -lt 3 -and -not $script:workerDeletionAccepted; $attempt++) {
                    try {
                        if ($null -eq $script:primary -or -not $script:primary.Token) {
                            $script:session = Get-FixtureSession
                            $script:primary = Register-Device
                        }
                        $cleanup = Invoke-Account 'data' 'DELETE'
                        if ($cleanup.Status -in @(200, 202, 410)) { $script:workerDeletionAccepted = $true }
                        elseif ($cleanup.Status -eq 401) { $script:session = Get-FixtureSession }
                    } catch { }
                }
                Require $script:workerDeletionAccepted
            }
            $removed = Invoke-Admin "users/$script:fixtureId" 'DELETE'
            Require ($removed.Status -in @(200, 204, 404))
            Require ((Invoke-Admin "users/$script:fixtureId").Status -eq 404)
            Pass-Stage
        } catch { Write-Output "FAIL: $script:stage"; $failed = $true }
    }
    if ($null -ne $script:http) { $script:http.Dispose() }
    $script:adminKey = $null
    $script:clientKey = $null
    $script:session = $null
    $script:fixturePassword = $null
    $script:primary = $null
    $secondary = $null
    $parts = $null
}

if ($failed) { Write-Output 'FAIL: Hosted account smoke test'; exit 1 }
Write-Output 'PASS: Hosted account smoke test'
exit 0
