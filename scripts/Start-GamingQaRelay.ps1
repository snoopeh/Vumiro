param([int]$Port = 8787,[string]$BindAddress = '0.0.0.0',[string]$KitDirectory)
$ErrorActionPreference = 'Stop'
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Choose a TCP port from 1024 through 65535.' }
$parsed = $null
if (![Net.IPAddress]::TryParse($BindAddress,[ref]$parsed)) { throw 'BindAddress must be an IP address.' }
if (!$KitDirectory) { $KitDirectory = $PSScriptRoot }
$kit = [IO.Path]::GetFullPath($KitDirectory)
$node = Join-Path $kit 'runtime/node.exe'; $relay = Join-Path $kit 'relay'; $entry = Join-Path $relay 'GamingQaRelay.mjs'
if (!(Test-Path -LiteralPath $node) -or !(Test-Path -LiteralPath $entry)) { throw 'This kit does not include its Node/Worker relay runtime. Rebuild with relay enabled.' }
$env:WRANGLER_SEND_METRICS = 'false'; $env:CI = 'true'
Write-Host "LOCAL QA relay on ${BindAddress}:$Port. Keep this window open; type stop and Enter to stop it."
Write-Host 'On the other PC use ws://<this-PC-private-IPv4>:<port>/call-signaling.'
Write-Host 'Allow this listener only on a trusted private Windows network if Firewall asks.'
Push-Location $relay
try { & $node $entry --root $relay --host $BindAddress --port $Port --state (Join-Path $kit 'relay-state'); if ($LASTEXITCODE -ne 0) { throw 'LOCAL QA relay exited with an error.' } }
finally { Pop-Location }
