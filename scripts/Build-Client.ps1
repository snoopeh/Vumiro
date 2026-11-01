param([string]$OutputDirectory = (Join-Path $PSScriptRoot '../dist/vumiro-1.19.0'))
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$output = [IO.Path]::GetFullPath($OutputDirectory)
$package = Join-Path $output 'Vumiro'
if (Test-Path -LiteralPath $package) { throw "Output already exists: $package" }
$build = Join-Path $output 'build'
Push-Location $root
try {
    dotnet build Vumiro.Client/Vumiro.Client.csproj -c Release -o $build --nologo
    if ($LASTEXITCODE -ne 0) { throw 'Client build failed.' }
    $updaterBuild = Join-Path $output 'updater-build'
    dotnet build Vumiro.Client.Updater/Vumiro.Client.Updater.csproj -c Release -o $updaterBuild --nologo
    if ($LASTEXITCODE -ne 0) { throw 'Client updater build failed.' }
    New-Item -ItemType Directory -Path $package | Out-Null
    foreach ($name in @('Vumiro.exe','Vumiro.exe.config','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll')) {
        Copy-Item -LiteralPath (Join-Path $build $name) -Destination $package
    }
    foreach ($name in @('Vumiro.Updater.exe','Vumiro.Updater.exe.config')) {
        Copy-Item -LiteralPath (Join-Path $updaterBuild $name) -Destination $package
    }
    $loader = Get-ChildItem $build -Filter WebView2Loader.dll -Recurse -File | Where-Object { $_.FullName -match '(^|[\\/])(x64|win-x64)([\\/]|$)' } | Select-Object -First 1
    if (!$loader) { throw 'x64 WebView2 loader is missing.' }
    Copy-Item -LiteralPath $loader.FullName -Destination (Join-Path $package 'WebView2Loader.dll')
    Copy-Item -LiteralPath (Join-Path $build 'WebServer') -Destination $package -Recurse
    Copy-Item COPYING, THIRD-PARTY.md -Destination $package
    Copy-Item docs/CLIENT.md -Destination (Join-Path $package 'README.md')
    $nugetRoot = if ($env:NUGET_PACKAGES) { $env:NUGET_PACKAGES } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.nuget/packages' }
    $sdk = Join-Path $nugetRoot 'microsoft.web.webview2/1.0.4314.35'
    Copy-Item -LiteralPath (Join-Path $sdk 'LICENSE.txt') -Destination (Join-Path $package 'WEBVIEW2-LICENSE.txt')
    Copy-Item -LiteralPath (Join-Path $sdk 'NOTICE.txt') -Destination (Join-Path $package 'WEBVIEW2-NOTICE.txt')
    Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
    $archive = Join-Path $output 'Vumiro-win-x64.zip'
    $archiveStream = [IO.File]::Open($archive, [IO.FileMode]::CreateNew)
    $zip = New-Object IO.Compression.ZipArchive $archiveStream, ([IO.Compression.ZipArchiveMode]::Create), $false
    try {
        foreach ($file in (Get-ChildItem -LiteralPath $package -Recurse -File | Sort-Object FullName)) {
            # Windows PowerShell's legacy ZipFile can write backslashes. The
            # updater accepts canonical forward-slash entry names.
            $entry = $file.FullName.Substring($package.Length + 1).Replace('\', '/')
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $entry, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    } finally { $zip.Dispose(); $archiveStream.Dispose() }
    $digest = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath (Join-Path $output 'SHA256SUMS.txt') -Value "$digest  Vumiro-win-x64.zip" -Encoding ascii
    Write-Output "Vumiro ready: $archive"
} finally { Pop-Location }
