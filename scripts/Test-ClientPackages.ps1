param([Parameter(Mandatory = $true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$output = [IO.Path]::GetFullPath($OutputDirectory)

$frozenV1211 = @(
    'Vumiro.exe','Vumiro.exe.config','Vumiro.Updater.exe','Vumiro.Updater.exe.config',
    'Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll',
    'README.md','COPYING','THIRD-PARTY.md','WEBVIEW2-LICENSE.txt','WEBVIEW2-NOTICE.txt',
    'WebServer/call.html','WebServer/call-client.js','WebServer/friends.html','WebServer/friends-client.js',
    'WebServer/local-profile.js','WebServer/peer-profile.js'
)

function Read-Manifest([string]$name) {
    return @(Get-Content -LiteralPath (Join-Path $PSScriptRoot $name) | Where-Object { $_ -and !$_.StartsWith('#') })
}

function Assert-SameEntries([string]$label, [string[]]$actual, [string[]]$expected) {
    $actualSorted = @($actual | Sort-Object)
    $expectedSorted = @($expected | Sort-Object)
    if (($actualSorted -join "`n") -ne ($expectedSorted -join "`n")) {
        $missing = @($expectedSorted | Where-Object { $_ -notin $actualSorted }) -join ', '
        $extra = @($actualSorted | Where-Object { $_ -notin $expectedSorted }) -join ', '
        throw "$label differs. Missing: [$missing]. Extra: [$extra]."
    }
}

function Read-ZipEntries([string]$archive) {
    if ((Get-Item -LiteralPath $archive).Length -gt 16L * 1024 * 1024) { throw "Archive exceeds the client download limit: $archive" }
    $stream = [IO.File]::OpenRead($archive)
    $zip = New-Object IO.Compression.ZipArchive $stream, ([IO.Compression.ZipArchiveMode]::Read), $false
    try {
        if ($zip.Entries.Count -gt 32) { throw "Archive exceeds the legacy entry limit: $archive" }
        $entries = @($zip.Entries | ForEach-Object { $_.FullName })
        if ($entries | Where-Object { $_.EndsWith('/') -or $_.Contains('\') }) { throw "Archive has a non-canonical entry: $archive" }
        if (@($entries | Sort-Object -Unique).Count -ne $entries.Count) { throw "Archive has duplicate entries: $archive" }
        [long]$total = 0
        foreach ($entry in $zip.Entries) {
            if ((($entry.ExternalAttributes -shr 16) -band 0xf000) -eq 0xa000 -or ($entry.ExternalAttributes -band 0x400) -ne 0) {
                throw "Archive contains a linked entry: $($entry.FullName)"
            }
            if ($entry.Length -gt 32L * 1024 * 1024) { throw "Archive entry exceeds the legacy size limit: $($entry.FullName)" }
            $total += $entry.Length
        }
        if ($total -gt 64L * 1024 * 1024) { throw "Archive exceeds the legacy unpacked size limit: $archive" }
        return $entries
    } finally { $zip.Dispose(); $stream.Dispose() }
}

Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$legacyManifest = Read-Manifest 'windows-package-v1.txt'
$completeManifest = Read-Manifest 'windows-package-v2.txt'
Assert-SameEntries 'The frozen 1.21.1 bridge manifest' $legacyManifest $frozenV1211
Assert-SameEntries 'The complete-only additions' @($completeManifest | Where-Object { $_ -notin $legacyManifest }) @('PRIVACY.md','WebServer/account-client.js','WebServer/identity-recovery.js','WebServer/auth.html')

$installer = Get-Content -Raw -LiteralPath (Join-Path $root 'Vumiro.Client/ClientUpdateInstaller.cs')
$allowlist = [regex]::Match($installer, '(?s)Allowed\s*=.*?new\[\]\s*\{(?<body>.*?)\}\s*,\s*StringComparer\.Ordinal').Groups['body'].Value
if (!$allowlist) { throw 'Could not read the current updater allowlist.' }
$allowedEntries = @([regex]::Matches($allowlist, '"(?<path>[^"]+)"') | ForEach-Object { $_.Groups['path'].Value })
Assert-SameEntries 'Current updater allowlist' $allowedEntries $completeManifest

$legacyArchive = Join-Path $output 'Vumiro-win-x64.zip'
$completeArchive = Join-Path $output 'Vumiro-win-x64-v2.zip'
foreach ($archive in @($legacyArchive, $completeArchive)) {
    if (!(Test-Path -LiteralPath $archive -PathType Leaf)) { throw "Missing package: $archive" }
}
Assert-SameEntries 'Legacy archive' (Read-ZipEntries $legacyArchive) $legacyManifest
Assert-SameEntries 'Complete archive' (Read-ZipEntries $completeArchive) $completeManifest

$checksumRows = @(Get-Content -LiteralPath (Join-Path $output 'SHA256SUMS.txt'))
if ($checksumRows.Count -ne 2) { throw 'SHA256SUMS.txt must contain exactly two packages.' }
foreach ($archive in @($legacyArchive, $completeArchive)) {
    $name = [IO.Path]::GetFileName($archive)
    $expected = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($checksumRows -notcontains "$expected  $name") { throw "Checksum is missing or invalid for $name." }
}

[xml]$project = Get-Content -LiteralPath (Join-Path $root 'Vumiro.Client/Vumiro.Client.csproj')
$projectVersion = [Version]([string]$project.Project.PropertyGroup.Version)
$expectedVersion = [Version]::new($projectVersion.Major, $projectVersion.Minor, $projectVersion.Build, 0)
$temporaryRoot = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) ('vumiro-package-test-' + [Guid]::NewGuid().ToString('N'))))
if (!$temporaryRoot.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()), [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe package test directory.' }
try {
    New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
    foreach ($pair in @(@($legacyArchive, 'legacy'), @($completeArchive, 'complete'))) {
        $destination = Join-Path $temporaryRoot $pair[1]
        [IO.Compression.ZipFile]::ExtractToDirectory($pair[0], $destination)
        foreach ($executable in @('Vumiro.exe','Vumiro.Updater.exe')) {
            $identity = [Reflection.AssemblyName]::GetAssemblyName((Join-Path $destination $executable))
            if ($identity.Version -ne $expectedVersion) { throw "$($pair[1]) $executable has version $($identity.Version), expected $expectedVersion." }
        }
    }
    $legacy = Join-Path $temporaryRoot 'legacy'
    if (Test-Path -LiteralPath (Join-Path $legacy 'WebServer/account-client.js') -PathType Leaf) { throw 'Legacy bridge unexpectedly contains account-client.js.' }
    if (Test-Path -LiteralPath (Join-Path $legacy 'WebServer/identity-recovery.js') -PathType Leaf) { throw 'Legacy bridge unexpectedly contains identity-recovery.js.' }
    if (Test-Path -LiteralPath (Join-Path $legacy 'WebServer/auth.html') -PathType Leaf) { throw 'Legacy bridge unexpectedly contains auth.html.' }
    if (Test-Path -LiteralPath (Join-Path $legacy 'PRIVACY.md') -PathType Leaf) { throw 'Legacy bridge unexpectedly contains PRIVACY.md.' }
    $legacyHtml = Get-Content -Raw -LiteralPath (Join-Path $legacy 'WebServer/friends.html')
    if ($legacyHtml.Contains('<script src="/account-client.js"></script>') -or
        $legacyHtml.Contains('<script src="/identity-recovery.js"></script>') -or
        !$legacyHtml.Contains('<details id="accountDetails" hidden>')) { throw 'Legacy bridge does not hide unavailable account controls.' }
    $complete = Join-Path $temporaryRoot 'complete'
    if (!(Test-Path -LiteralPath (Join-Path $complete 'WebServer/account-client.js') -PathType Leaf) -or
        !(Test-Path -LiteralPath (Join-Path $complete 'WebServer/identity-recovery.js') -PathType Leaf) -or
        !(Test-Path -LiteralPath (Join-Path $complete 'WebServer/auth.html') -PathType Leaf) -or
        !(Test-Path -LiteralPath (Join-Path $complete 'PRIVACY.md') -PathType Leaf)) { throw 'Complete package is missing its completion markers.' }
    $completeHtml = Get-Content -Raw -LiteralPath (Join-Path $complete 'WebServer/friends.html')
    if (!$completeHtml.Contains('<script src="/account-client.js"></script>') -or
        !$completeHtml.Contains('<script src="/identity-recovery.js"></script>') -or
        !$completeHtml.Contains('<details id="accountDetails">')) { throw 'Complete package does not enable account controls.' }
    foreach ($file in (Get-ChildItem -LiteralPath (Join-Path $root 'Vumiro.Client/WebServer') -File | Where-Object { $_.Extension -in '.html', '.js' })) {
        $packaged = Join-Path $complete ('WebServer/' + $file.Name)
        if (!(Test-Path -LiteralPath $packaged -PathType Leaf) -or
            [IO.File]::ReadAllText($packaged).Replace("`r`n", "`n") -cne [IO.File]::ReadAllText($file.FullName).Replace("`r`n", "`n")) {
            throw "Packaged UI does not match source: $($file.Name)"
        }
    }
} finally {
    if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force }
}

$updates = Get-Content -Raw -LiteralPath (Join-Path $root 'Vumiro.Client/ClientUpdates.cs')
if ($updates -notmatch 'AssetName\s*=\s*"Vumiro-win-x64-v2\.zip"' -or
    $updates -notmatch 'WebServer"\s*,\s*"identity-recovery\.js"' -or
    $updates -notmatch 'release\.Version\s*==\s*current\s*&&\s*!CompletePackageInstalled\(\)') {
    throw 'The client does not select the complete package for the same-version bridge completion.'
}

Write-Output 'Windows package transition validated: 1.21.1 bridge and complete v2 package are consistent.'
