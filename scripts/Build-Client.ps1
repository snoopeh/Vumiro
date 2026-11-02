param([string]$OutputDirectory = (Join-Path $PSScriptRoot '../dist/client-release'))
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $output) { throw "Output already exists: $output" }
$build = Join-Path $output 'build'
$updaterBuild = Join-Path $output 'updater-build'
$source = Join-Path $output 'package-source'

function Read-PackageManifest([string]$name) {
    $entries = @(Get-Content -LiteralPath (Join-Path $PSScriptRoot $name) | Where-Object { $_ -and !$_.StartsWith('#') })
    if (!$entries.Count -or @($entries | Sort-Object -Unique).Count -ne $entries.Count) { throw "Invalid package manifest: $name" }
    foreach ($entry in $entries) {
        if ($entry -notmatch '^[A-Za-z0-9][A-Za-z0-9._/-]*$' -or $entry.Contains('..') -or $entry.Contains('\')) {
            throw "Unsafe package path in ${name}: $entry"
        }
    }
    return $entries
}

function New-ClientArchive([string]$manifestName, [string]$stagingName, [string]$archiveName) {
    $staging = Join-Path $output $stagingName
    New-Item -ItemType Directory -Path $staging | Out-Null
    foreach ($entry in (Read-PackageManifest $manifestName)) {
        $relative = $entry.Replace('/', [IO.Path]::DirectorySeparatorChar)
        $from = Join-Path $source $relative
        if (!(Test-Path -LiteralPath $from -PathType Leaf)) { throw "Package source is missing: $entry" }
        $to = Join-Path $staging $relative
        $parent = Split-Path $to -Parent
        if (!(Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
        Copy-Item -LiteralPath $from -Destination $to
    }
    if ($manifestName -eq 'windows-package-v1.txt') {
        # The bridge must use the old file set, so hide account controls until
        # the same-version v2 package completes the installation.
        $htmlPath = Join-Path $staging 'WebServer/friends.html'
        $html = Get-Content -Raw -LiteralPath $htmlPath
        $updated = $html.Replace('<details id="accountDetails">', '<details id="accountDetails" hidden>')
        $updated = $updated.Replace('<script src="/account-client.js"></script>', '')
        $updated = $updated.Replace('<script src="/identity-recovery.js"></script>', '')
        if ($updated -eq $html -or $updated.Contains('<script src="/account-client.js"></script>') -or
            $updated.Contains('<script src="/identity-recovery.js"></script>') -or
            !$updated.Contains('<details id="accountDetails" hidden>')) { throw 'Could not prepare the legacy bridge interface.' }
        Set-Content -LiteralPath $htmlPath -Value $updated -Encoding UTF8 -NoNewline
    }

    $archive = Join-Path $output $archiveName
    $archiveStream = [IO.File]::Open($archive, [IO.FileMode]::CreateNew)
    $zip = New-Object IO.Compression.ZipArchive $archiveStream, ([IO.Compression.ZipArchiveMode]::Create), $false
    try {
        foreach ($file in (Get-ChildItem -LiteralPath $staging -Recurse -File | Sort-Object FullName)) {
            $entry = $file.FullName.Substring($staging.Length + 1).Replace('\', '/')
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $entry, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    } finally { $zip.Dispose(); $archiveStream.Dispose() }
    return $archive
}

Push-Location $root
try {
    dotnet build Vumiro.Client/Vumiro.Client.csproj -c Release -o $build --nologo
    if ($LASTEXITCODE -ne 0) { throw 'Client build failed.' }
    dotnet build Vumiro.Client.Updater/Vumiro.Client.Updater.csproj -c Release -o $updaterBuild --nologo
    if ($LASTEXITCODE -ne 0) { throw 'Client updater build failed.' }

    New-Item -ItemType Directory -Path $source | Out-Null
    foreach ($name in @('Vumiro.exe','Vumiro.exe.config','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll')) {
        Copy-Item -LiteralPath (Join-Path $build $name) -Destination $source
    }
    foreach ($name in @('Vumiro.Updater.exe','Vumiro.Updater.exe.config')) {
        Copy-Item -LiteralPath (Join-Path $updaterBuild $name) -Destination $source
    }
    $loader = Get-ChildItem $build -Filter WebView2Loader.dll -Recurse -File | Where-Object { $_.FullName -match '(^|[\\/])(x64|win-x64)([\\/]|$)' } | Select-Object -First 1
    if (!$loader) { throw 'x64 WebView2 loader is missing.' }
    Copy-Item -LiteralPath $loader.FullName -Destination (Join-Path $source 'WebView2Loader.dll')
    Copy-Item -LiteralPath (Join-Path $build 'WebServer') -Destination $source -Recurse
    Copy-Item COPYING, THIRD-PARTY.md -Destination $source
    Copy-Item docs/CLIENT.md -Destination (Join-Path $source 'README.md')
    Copy-Item docs/PRIVACY.md -Destination (Join-Path $source 'PRIVACY.md')
    $nugetRoot = if ($env:NUGET_PACKAGES) { $env:NUGET_PACKAGES } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.nuget/packages' }
    $sdk = Join-Path $nugetRoot 'microsoft.web.webview2/1.0.4314.35'
    Copy-Item -LiteralPath (Join-Path $sdk 'LICENSE.txt') -Destination (Join-Path $source 'WEBVIEW2-LICENSE.txt')
    Copy-Item -LiteralPath (Join-Path $sdk 'NOTICE.txt') -Destination (Join-Path $source 'WEBVIEW2-NOTICE.txt')

    Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
    $legacy = New-ClientArchive 'windows-package-v1.txt' 'legacy-package' 'Vumiro-win-x64.zip'
    $complete = New-ClientArchive 'windows-package-v2.txt' 'complete-package' 'Vumiro-win-x64-v2.zip'
    $checksums = @(@($legacy, $complete) | ForEach-Object {
        $digest = (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant()
        "$digest  $([IO.Path]::GetFileName($_))"
    })
    Set-Content -LiteralPath (Join-Path $output 'SHA256SUMS.txt') -Value $checksums -Encoding ascii
    Write-Output "Legacy bridge ready: $legacy"
    Write-Output "Complete package ready: $complete"
} finally { Pop-Location }
