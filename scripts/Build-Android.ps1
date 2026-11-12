param(
    [switch]$InstallDependencies,
    [switch]$Install,
    [string]$DeviceId,
    [string]$AndroidSdkDirectory = $(if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android/Sdk' }),
    [string]$JavaSdkDirectory = $(if ($env:JAVA_HOME) { $env:JAVA_HOME } else { Join-Path $env:LOCALAPPDATA 'Microsoft/OpenJDK' })
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$project = Join-Path $root 'Vumiro.Android/Vumiro.Android.csproj'
$output = Join-Path $root 'dist/android'
$logs = Join-Path $output 'logs'
New-Item -ItemType Directory -Path $logs -Force | Out-Null

function Invoke-AndroidStep([string]$Name, [string]$Command, [string[]]$Arguments) {
    Write-Host "$Name..."
    $log = Join-Path $logs ($Name + '.log')
    & $Command @Arguments *> $log
    if ($LASTEXITCODE -ne 0) {
        Get-Content -LiteralPath $log -Tail 30 | Write-Host
        throw "$Name failed. See $log"
    }
}

Push-Location $root
try {
    foreach ($command in @('dotnet','node')) { if (!(Get-Command $command -ErrorAction SilentlyContinue)) { throw "$command is required." } }
    if ($InstallDependencies) {
        Invoke-AndroidStep 'workload' 'dotnet' @('workload','install','android')
        Invoke-AndroidStep 'sdk' 'dotnet' @('build',$project,'-t:InstallAndroidDependencies',"-p:AndroidSdkDirectory=$AndroidSdkDirectory","-p:JavaSdkDirectory=$JavaSdkDirectory",'-p:AcceptAndroidSdkLicenses=True')
    }
    if (!(Test-Path -LiteralPath (Join-Path $AndroidSdkDirectory 'platform-tools/adb.exe'))) { throw 'Android SDK missing. Run with -InstallDependencies, or set -AndroidSdkDirectory.' }
    if (!(Test-Path -LiteralPath (Join-Path $JavaSdkDirectory 'bin/java.exe'))) { throw 'JDK missing. Run with -InstallDependencies, or set -JavaSdkDirectory.' }
    $tests = @(Get-ChildItem -LiteralPath (Join-Path $root 'tests') -Filter 'android-*.test.mjs' -File | Select-Object -ExpandProperty FullName)
    Invoke-AndroidStep 'web-tests' 'node' (@('--test') + $tests)
    Invoke-AndroidStep 'host-tests' 'dotnet' @('run','--project','tests/AndroidHostChecks/AndroidHostChecks.csproj')
    Invoke-AndroidStep 'assets' 'node' @('scripts/Prepare-AndroidAssets.mjs')
    # Build a standalone debug-signed APK. Fast deployment would require a
    # developer runtime pushed separately and is unsuitable for QA handoff.
    Invoke-AndroidStep 'build' 'dotnet' @('build',$project,'-c','Debug','--nologo','-p:EmbedAssembliesIntoApk=True','-p:AndroidUseSharedRuntime=False',"-p:AndroidSdkDirectory=$AndroidSdkDirectory","-p:JavaSdkDirectory=$JavaSdkDirectory")
    $apk = Get-ChildItem -LiteralPath (Join-Path $root 'Vumiro.Android/bin/Debug') -Recurse -Filter '*-Signed.apk' -File | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if (!$apk) { throw 'Build produced no signed QA APK.' }
    $artifact = Join-Path $output 'Vumiro-Android-QA.apk'
    Copy-Item -LiteralPath $apk.FullName -Destination $artifact -Force
    $revision = (& git rev-parse HEAD).Trim()
    $dirty = [bool](& git status --porcelain)
    $receipt = @{source=$root;revision=$revision;workingTree=$dirty;apk=$artifact;sha256=(Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant();configuration='Debug';standalone=$true;builtAt=[DateTime]::UtcNow.ToString('o')}
    $receipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'build.json') -Encoding utf8
    if ($Install) {
        $adb = Join-Path $AndroidSdkDirectory 'platform-tools/adb.exe'
        $selector = @(); if ($DeviceId) { $selector = @('-s',$DeviceId) }
        Invoke-AndroidStep 'install' $adb ($selector + @('install','-r',$artifact))
        Invoke-AndroidStep 'launch' $adb ($selector + @('shell','monkey','-p','com.vumiro.android.qa','-c','android.intent.category.LAUNCHER','1'))
    }
    Write-Host "Android QA APK: $artifact"
    Write-Host "Receipt: $(Join-Path $output 'build.json')"
    Write-Host 'Debug build only. No store upload, source push or production deployment.'
} finally { Pop-Location }
