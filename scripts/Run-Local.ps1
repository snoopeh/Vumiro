param([switch]$SkipTests, [switch]$LocalService)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$output = Join-Path $root 'dist/local-qa'
$logs = Join-Path $output 'logs'
$web = Join-Path $root 'Vumiro.Client/WebServer'
$executable = Join-Path $output 'Vumiro.exe'
$qaService = if ($LocalService) { 'ws://127.0.0.1:8787/call-signaling' } else { $null }

function Invoke-LocalCheck([string]$name, [string]$command, [string[]]$arguments, [string]$logName) {
    $log = Join-Path $logs $logName
    Write-Host "$name..."
    & $command @arguments *> $log
    if ($LASTEXITCODE -ne 0) {
        Get-Content -LiteralPath $log -Tail 40 | Write-Host
        throw "$name failed. Full output: $log"
    }
}

try {
    foreach ($command in @('dotnet', 'node')) {
        if (!(Get-Command $command -ErrorAction SilentlyContinue)) { throw "$command is required. See docs/LOCAL-DEVELOPMENT.md." }
    }
    New-Item -ItemType Directory -Path $logs -Force | Out-Null
    if ($LocalService) {
        try {
            $serviceResponse = Invoke-WebRequest -Uri 'http://127.0.0.1:8787/friends.html' -UseBasicParsing -TimeoutSec 3
            if ($serviceResponse.StatusCode -ne 200) { throw 'Unexpected service response.' }
        } catch {
            throw 'Local signaling is unavailable at 127.0.0.1:8787. Start the local Worker first; see docs/LOCAL-DEVELOPMENT.md, then rerun with -LocalService.'
        }
    }
    Push-Location $root
    try {
        foreach ($file in (Get-ChildItem -LiteralPath $web -Filter '*.js' -File)) {
            Invoke-LocalCheck "Syntax: $($file.Name)" 'node' @('--check', $file.FullName) 'syntax.log'
        }
        if (!$SkipTests) {
            Invoke-LocalCheck 'Client regressions' 'node' @('--test', 'tests/*.test.mjs') 'client-tests.log'
            Invoke-LocalCheck 'Native invariants' 'dotnet' @('run', '--project', 'tests/OAuthCallbackChecks/OAuthCallbackChecks.csproj', '-c', 'Release') 'native-tests.log'
            Invoke-LocalCheck 'Desktop notification payloads' 'dotnet' @('run', '--project', 'tests/NativeNotificationChecks/NativeNotificationChecks.csproj', '-c', 'Release') 'notification-tests.log'
            Invoke-LocalCheck 'Native nudge and resize regressions' 'dotnet' @('run', '--project', 'tests/NativeWindowChecks/NativeWindowChecks.csproj', '-c', 'Release') 'window-tests.log'
            Invoke-LocalCheck 'Local service isolation' 'dotnet' @('run', '--project', 'tests/LocalQaServiceChecks/LocalQaServiceChecks.csproj', '-c', 'Release') 'local-service-tests.log'
            Invoke-LocalCheck 'Startup updater regressions' 'dotnet' @('run', '--project', 'tests/ClientUpdateChecks/ClientUpdateChecks.csproj', '-c', 'Release') 'updater-tests.log'
            Invoke-LocalCheck 'Native audio recovery regressions' 'dotnet' @('run', '--project', 'tests/NativeAudioSmoke/NativeAudioSmoke.csproj', '-c', 'Release', '--', '--self-test') 'audio-tests.log'
            Invoke-LocalCheck 'Diagnostic retention and export' 'dotnet' @('run', '--project', 'tests/ClientDiagnosticsChecks/ClientDiagnosticsChecks.csproj', '-c', 'Release') 'diagnostics-tests.log'
        }
        # Stop only this checkout's QA executable. Installed copies use other paths.
        foreach ($process in (Get-Process -Name Vumiro -ErrorAction SilentlyContinue)) {
            try {
                if (![String]::Equals($process.Path, $executable, [StringComparison]::OrdinalIgnoreCase)) { continue }
                Write-Host 'Closing this checkout''s previous LOCAL QA window...'
                if (!$process.CloseMainWindow() -or !$process.WaitForExit(10000)) {
                    throw 'Close this LOCAL QA window and rerun the launcher. It may still be starting.'
                }
            } finally { $process.Dispose() }
        }
        Invoke-LocalCheck 'Incremental native build' 'dotnet' @('build', 'Vumiro.Client/Vumiro.Client.csproj', '-c', 'Debug', '-o', $output, '--nologo') 'build.log'
        if (!(Test-Path -LiteralPath $executable -PathType Leaf)) { throw 'Build did not produce Vumiro.exe.' }

        $workspaceHash = [Security.Cryptography.SHA256]::Create()
        try { $workspace = ([BitConverter]::ToString($workspaceHash.ComputeHash([Text.Encoding]::UTF8.GetBytes($root.ToUpperInvariant())))).Replace('-', '').Substring(0, 12) }
        finally { $workspaceHash.Dispose() }
        $data = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) ('Vumiro/LocalQA/' + $workspace)
        New-Item -ItemType Directory -Path $data -Force | Out-Null
        $statusFile = Join-Path $data 'local-qa-status.json'
        if (Test-Path -LiteralPath $statusFile -PathType Leaf) { Remove-Item -LiteralPath $statusFile }
        $label = 'working tree'
        if (Get-Command git -ErrorAction SilentlyContinue) {
            $commit = & git rev-parse --short HEAD
            if ($LASTEXITCODE -eq 0) {
                $label = $commit
                if (& git status --porcelain) { $label += ' + working tree' }
            }
        }
        $start = New-Object Diagnostics.ProcessStartInfo
        $start.FileName = $executable
        $start.WorkingDirectory = $output
        $start.UseShellExecute = $false
        $start.EnvironmentVariables['VUMIRO_DEV_WEB_ROOT'] = $web
        $start.EnvironmentVariables['VUMIRO_DEV_DATA_ROOT'] = $data
        $start.EnvironmentVariables['VUMIRO_DEV_LABEL'] = $label
        $start.EnvironmentVariables.Remove('VUMIRO_DEV_SIGNALING_URL')
        if ($LocalService) { $start.EnvironmentVariables['VUMIRO_DEV_SIGNALING_URL'] = $qaService }
        $start.EnvironmentVariables['WEBVIEW2_USER_DATA_FOLDER'] = Join-Path $data 'ClientBrowser'
        $app = [Diagnostics.Process]::Start($start)
        $receipt = Join-Path $output 'launch.json'
        @{ processId = $app.Id; source = $root; label = $label; webRoot = $web; dataRoot = $data; executable = $executable; signalingOverride = $qaService } |
            ConvertTo-Json | Set-Content -LiteralPath $receipt -Encoding UTF8
        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        $ready = $false
        while ([DateTime]::UtcNow -lt $deadline) {
            if ($app.HasExited) { throw 'LOCAL QA exited before loading its interface.' }
            $state = $null
            if (Test-Path -LiteralPath $statusFile -PathType Leaf) {
                try { $state = Get-Content -LiteralPath $statusFile -Raw | ConvertFrom-Json } catch { }
            }
            if ($state -and $state.processId -eq $app.Id) {
                if ($state.state -eq 'error') { throw ('LOCAL QA startup failed: ' + $state.message) }
                if ($state.state -eq 'ready') { $ready = $true; break }
            }
            Start-Sleep -Milliseconds 200
        }
        if (!$ready) { throw "LOCAL QA did not report a loaded interface within 30 seconds. Startup status: $statusFile" }
        Write-Host "LOCAL QA ready: $label (PID $($app.Id))"
        Write-Host 'Web edits: click Reload UI in the app. Native edits: rerun Local QA.cmd.'
        Write-Host "Isolated profile: $data"
        if ($LocalService) { Write-Host "Local signaling override: $qaService (local peers only)" }
        Write-Host "Logs: $logs"
        Write-Host 'No version bump, Git push, release tag or publication was performed.'
    } finally { Pop-Location }
} catch {
    Write-Host ('LOCAL QA failed: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
