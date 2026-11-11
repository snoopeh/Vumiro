param(
    [string]$OutputDirectory,
    [switch]$WithoutRelay,
    [switch]$SkipChecks
)
$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
if (!$OutputDirectory) { $OutputDirectory = Join-Path $repository ('dist/gaming-qa-kit-' + (Get-Date -Format 'yyyyMMdd-HHmmss')) }
$kit = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $kit) { throw 'Choose a new output directory; existing QA kits are preserved.' }
foreach ($tool in @('dotnet','node')) { if (!(Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is required on the builder computer." } }
New-Item -ItemType Directory -Path $kit -Force | Out-Null
Push-Location $repository
try {
    if (!$SkipChecks) {
        foreach ($project in @('GamingDiagnosticsChecks','GamingServiceChecks','GamingHostChecks','GamingLanChecks')) {
            & dotnet run --project "tests/$project/$project.csproj"
            if ($LASTEXITCODE -ne 0) { throw "$project failed." }
        }
    }
    $app = Join-Path $kit 'app'
    & dotnet build Vumiro.Client/Vumiro.Client.csproj -c Debug -o $app --nologo
    if ($LASTEXITCODE -ne 0) { throw 'Private Debug build failed.' }
    & (Join-Path $PSScriptRoot 'Copy-GamingQaNotices.ps1') -SourceRoot $repository -ApplicationDirectory $app
    $kitWeb = Join-Path $app 'WebServer'; New-Item -ItemType Directory -Path $kitWeb -Force | Out-Null
    foreach ($asset in (Get-ChildItem -LiteralPath (Join-Path $repository 'Vumiro.Client/WebServer') -Force)) { Copy-Item -LiteralPath $asset.FullName -Destination $kitWeb -Recurse -Force }
    foreach ($script in @('Start-GamingQa.ps1','Start-GamingQaRelay.ps1')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $script) -Destination (Join-Path $kit $script) }
    Copy-Item -LiteralPath (Join-Path $repository 'docs/GAMING-QA.md') -Destination (Join-Path $kit 'README.md')
    if (!$WithoutRelay) {
        $worker = Join-Path $repository 'cloudflare'
        if (!(Test-Path -LiteralPath (Join-Path $worker 'node_modules/wrangler/bin/wrangler.js'))) {
            Push-Location $worker
            try { & npm.cmd ci --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'Builder relay dependency installation failed.' } }
            finally { Pop-Location }
        }
        & node (Join-Path $worker 'prepare-assets.mjs')
        if ($LASTEXITCODE -ne 0) { throw 'Relay asset preparation failed.' }
        $relay = Join-Path $kit 'relay'; New-Item -ItemType Directory -Path $relay | Out-Null
        foreach ($entry in (Get-ChildItem -LiteralPath $worker -File | Where-Object { $_.Name -match '\.(js|json|jsonc|mjs)$' -and $_.Name -notmatch '\.test\.' })) { Copy-Item -LiteralPath $entry.FullName -Destination $relay }
        foreach ($folder in @('node_modules','public','migrations')) { Copy-Item -LiteralPath (Join-Path $worker $folder) -Destination (Join-Path $relay $folder) -Recurse }
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'GamingQaRelay.mjs') -Destination (Join-Path $relay 'GamingQaRelay.mjs')
        $runtime = Join-Path $kit 'runtime'; New-Item -ItemType Directory -Path $runtime | Out-Null
        $nodePath = (Get-Command node -CommandType Application | Select-Object -First 1).Source
        Copy-Item -LiteralPath $nodePath -Destination (Join-Path $runtime 'node.exe')
        $nodeVersion = (& $nodePath --version).Trim()
        if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v[0-9]+\.[0-9]+\.[0-9]+$') { throw 'Could not identify the bundled Node runtime version.' }
        $nodeLicense = @('LICENSE','LICENSE.txt') | ForEach-Object { Join-Path (Split-Path $nodePath) $_ } | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
        if ($nodeLicense) { Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $runtime 'NODE-LICENSE.txt') }
        else { Invoke-WebRequest -Uri "https://raw.githubusercontent.com/nodejs/node/$nodeVersion/LICENSE" -OutFile (Join-Path $runtime 'NODE-LICENSE.txt') -UseBasicParsing }
    }
    '@echo off' + "`r`n" + 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-GamingQa.ps1" -Profile host %*' | Set-Content -LiteralPath (Join-Path $kit 'Gaming Host.cmd') -Encoding ASCII
    '@echo off' + "`r`n" + 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-GamingQa.ps1" -Profile guest %*' | Set-Content -LiteralPath (Join-Path $kit 'Gaming Guest.cmd') -Encoding ASCII
    '@echo off' + "`r`n" + 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-GamingQaRelay.ps1" %*' | Set-Content -LiteralPath (Join-Path $kit 'Gaming Relay.cmd') -Encoding ASCII
    @{ localQa = $true; productionDeployment = $false; createdUtc = [DateTime]::UtcNow.ToString('o'); relayBundled = !$WithoutRelay; source = $repository } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $kit 'qa-kit.json') -Encoding UTF8
    Get-FileHash -LiteralPath (Join-Path $app 'Vumiro.exe'),(Join-Path $app 'Vumiro.Updater.exe') -Algorithm SHA256 | Format-Table | Out-String | Set-Content -LiteralPath (Join-Path $kit 'BUILD-HASHES.txt')
    Write-Host "Private LOCAL QA kit: $kit"
    Write-Host 'Copy the entire folder to both Windows PCs. Read README.md. Nothing was published.'
} finally { Pop-Location }
