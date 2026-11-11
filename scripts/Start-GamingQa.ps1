param(
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$')][string]$Profile = 'host',
    [string]$SignalingUrl = 'ws://127.0.0.1:8787/call-signaling',
    [string]$KitDirectory
)
$ErrorActionPreference = 'Stop'
if (!$KitDirectory) { $KitDirectory = $PSScriptRoot }
$kit = [IO.Path]::GetFullPath($KitDirectory)
$executable = Join-Path $kit 'app/Vumiro.exe'
if (!(Test-Path -LiteralPath $executable -PathType Leaf) -or !(Test-Path -LiteralPath (Join-Path $kit 'qa-kit.json'))) { throw 'Run this launcher from a complete private QA kit.' }
$service = $null
if (![Uri]::TryCreate($SignalingUrl,[UriKind]::Absolute,[ref]$service) -or $service.Scheme -notin @('ws','wss') -or $service.UserInfo -or $service.AbsolutePath -ne '/call-signaling' -or $service.Query -or $service.Fragment) { throw 'Use a ws:// or wss:// signaling URL ending in /call-signaling, without credentials or query.' }
if ($service.Scheme -eq 'ws' -and !$service.IsLoopback) {
    $ip = $null
    $private = [Net.IPAddress]::TryParse($service.Host,[ref]$ip) -and $ip.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork
    if ($private) { $bytes = $ip.GetAddressBytes(); $private = $bytes[0] -eq 10 -or ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or ($bytes[0] -eq 192 -and $bytes[1] -eq 168) }
    if (!$private) { throw 'Unencrypted QA signaling must use loopback or an explicit private IPv4 address. Use wss:// for other hosts.' }
}
$data = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) ('Vumiro/GamingQA/' + $Profile)
New-Item -ItemType Directory -Path $data -Force | Out-Null
$start = New-Object Diagnostics.ProcessStartInfo
$start.FileName = $executable; $start.WorkingDirectory = Split-Path $executable; $start.UseShellExecute = $false
$start.EnvironmentVariables['VUMIRO_DEV_WEB_ROOT'] = Join-Path $kit 'app/WebServer'
$start.EnvironmentVariables['VUMIRO_DEV_DATA_ROOT'] = $data
$start.EnvironmentVariables['VUMIRO_DEV_LABEL'] = "gaming kit / $Profile"
$start.EnvironmentVariables['VUMIRO_DEV_SIGNALING_URL'] = $service.AbsoluteUri
$start.EnvironmentVariables['WEBVIEW2_USER_DATA_FOLDER'] = Join-Path $data 'ClientBrowser'
# The QA app uses its secure virtual origin. This process-only flag permits an
# explicitly selected private ws relay; installed/release app settings are untouched.
if ($service.Scheme -eq 'ws') { $start.EnvironmentVariables['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = '--allow-running-insecure-content' }
$app = [Diagnostics.Process]::Start($start)
@{ processId=$app.Id; profile=$Profile; dataRoot=$data; signalingUrl=$service.AbsoluteUri; localQa=$true } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $data 'gaming-qa-launch.json') -Encoding UTF8
Write-Host "LOCAL QA profile '$Profile' launched (PID $($app.Id)). Service: $($service.AbsoluteUri)"
Write-Host 'Native checks and Windows setup run only when you click their corresponding action.'
$app.Dispose()
