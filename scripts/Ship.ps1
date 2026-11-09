<#
.SYNOPSIS
Preview a client release, or publish its source commit and annotated release tag after human QA.
.EXAMPLE
./scripts/Ship.ps1 -Bump patch
.EXAMPLE
./scripts/Ship.ps1 -Bump patch -Publish -QaAccepted
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('patch', 'minor', 'major')]
    [string]$Bump,
    [switch]$Publish,
    [switch]$QaAccepted
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$metadataPaths = @(
    'Vumiro.Client/Vumiro.Client.csproj',
    'Vumiro.Client.Updater/Vumiro.Client.Updater.csproj',
    'Vumiro.Linux/package.json',
    'Vumiro.Linux/package-lock.json'
)
$mutationStarted = $false
$releaseTag = $null
$originalHead = $null
$releaseHead = $null

function Invoke-Native {
    param([string]$Command, [string[]]$Arguments, [string]$InputText, [switch]$AllowFailure, [switch]$HideFailureOutput)
    # Native stderr is an ErrorRecord in Windows PowerShell 5.1. Inspect the exit code explicitly.
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        if ($PSBoundParameters.ContainsKey('InputText')) {
            $lines = @($InputText | & $Command @Arguments 2>&1 | ForEach-Object { $_.ToString() })
        }
        else { $lines = @(& $Command @Arguments 2>&1 | ForEach-Object { $_.ToString() }) }
        $code = $LASTEXITCODE
    }
    finally { $ErrorActionPreference = $previousPreference }
    if ($code -ne 0 -and -not $AllowFailure) {
        $detail = ''
        if (-not $HideFailureOutput) { $detail = ": $($lines -join [Environment]::NewLine)" }
        throw "$Command failed with exit code $code$detail"
    }
    return [pscustomobject]@{ Code = $code; Output = ($lines -join [Environment]::NewLine) }
}

function Invoke-Git {
    param([string[]]$Arguments, [switch]$AllowFailure, [switch]$HideFailureOutput)
    return Invoke-Native -Command 'git' -Arguments (@('-C', $repository) + $Arguments) -AllowFailure:$AllowFailure -HideFailureOutput:$HideFailureOutput
}

function Read-MetadataFile {
    param([string]$RelativePath)
    $path = Join-Path $repository $RelativePath
    $bytes = [IO.File]::ReadAllBytes($path)
    $encoding = New-Object Text.UTF8Encoding($false, $true)
    $offset = 0
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) {
        $encoding = New-Object Text.UTF8Encoding($true, $true)
        $offset = 3
    }
    elseif ($bytes.Length -ge 2 -and $bytes[0] -eq 255 -and $bytes[1] -eq 254) {
        $encoding = [Text.Encoding]::Unicode
        $offset = 2
    }
    elseif ($bytes.Length -ge 2 -and $bytes[0] -eq 254 -and $bytes[1] -eq 255) {
        $encoding = [Text.Encoding]::BigEndianUnicode
        $offset = 2
    }
    return [pscustomobject]@{ Path = $path; Text = $encoding.GetString($bytes, $offset, $bytes.Length - $offset); Encoding = $encoding }
}

function Get-AlignedVersion {
    param([object[]]$Files)
    $versions = @()
    for ($index = 0; $index -lt 2; $index++) {
        $xml = [xml]$Files[$index].Text
        $nodes = @($xml.SelectNodes('//Version'))
        if ($nodes.Count -ne 1) { throw "Expected exactly one Version element in $($metadataPaths[$index])." }
        $versions += $nodes[0].InnerText.Trim()
    }
    # ConvertFrom-Json cannot read the lockfile's empty root key in PowerShell 5.1.
    # Base64 on stdin avoids Windows PowerShell's native quote rewriting and command length limit.
    $packageData = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Files[2].Text))
    $lockData = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Files[3].Text))
    $parseJson = @'
const data = require('node:fs').readFileSync(0, 'utf8').trim().split(':');
const pkg = JSON.parse(Buffer.from(data[0], 'base64').toString('utf8'));
const lock = JSON.parse(Buffer.from(data[1], 'base64').toString('utf8'));
console.log(JSON.stringify([pkg.version, lock.version, lock.packages[''].version]));
'@
    $jsonVersions = Invoke-Native -Command 'node' -Arguments @('-e', $parseJson) -InputText ($packageData + ':' + $lockData)
    $parsedVersions = $jsonVersions.Output | ConvertFrom-Json
    foreach ($version in $parsedVersions) { $versions += [string]$version }
    # Client release tags use stable numeric SemVer; prerelease/build suffixes need an explicit release policy.
    foreach ($version in $versions) {
        if ($version -cnotmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') {
            throw "Invalid stable semantic version: '$version'. Expected MAJOR.MINOR.PATCH without leading zeroes."
        }
        foreach ($part in $version.Split('.')) {
            if ([decimal]$part -gt 65534) { throw 'Release version components must be at most 65534 for native builds.' }
        }
    }
    if (@($versions | Select-Object -Unique).Count -ne 1) { throw 'All five release version values must match before shipping.' }
    return $versions[0]
}

function Test-ReleaseOrigin {
    # Inspect effective URLs too: insteadOf/pushInsteadOf must not redirect a release elsewhere.
    # Capture these values without printing them; rejected URLs may embed credentials.
    $fetch = Invoke-Git -Arguments @('remote', 'get-url', '--all', 'origin') -AllowFailure
    $push = Invoke-Git -Arguments @('remote', 'get-url', '--push', '--all', 'origin') -AllowFailure
    $fetchUrls = @($fetch.Output -split '\r?\n' | Where-Object { $_ })
    $pushUrls = @($push.Output -split '\r?\n' | Where-Object { $_ })
    if ($fetch.Code -ne 0 -or $push.Code -ne 0 -or $fetchUrls.Count -ne 1 -or $pushUrls.Count -ne 1) { return $false }
    $urls = $fetchUrls + $pushUrls
    foreach ($url in $urls) {
        if ($url -cnotmatch '^(https://github\.com/snoopeh/Vumiro(?:\.git)?/?|git@github\.com:snoopeh/Vumiro(?:\.git)?|ssh://git@github\.com/snoopeh/Vumiro(?:\.git)?/?)$') { return $false }
    }
    return $true
}

function Invoke-VersionCheck {
    param([string]$Tag)
    $checker = Join-Path $PSScriptRoot 'Check-ReleaseVersion.mjs'
    if (Test-Path -LiteralPath $checker) {
        $arguments = @($checker)
        if ($Tag) { $arguments += @('--tag', $Tag) }
        $null = Invoke-Native -Command 'node' -Arguments $arguments
    }
}

function Set-VersionText {
    param([string]$Text, [string]$Pattern, [string]$Version)
    $regex = New-Object Text.RegularExpressions.Regex($Pattern)
    if (-not $regex.IsMatch($Text)) { throw 'Unable to locate the version value without changing metadata formatting.' }
    return $regex.Replace($Text, [Text.RegularExpressions.MatchEvaluator]{ param($match) $match.Groups[1].Value + $Version + $match.Groups[3].Value }, 1)
}

Push-Location -LiteralPath $repository
try {
    $null = Get-Command git -ErrorAction Stop
    $null = Get-Command node -ErrorAction Stop
    $root = (Invoke-Git -Arguments @('rev-parse', '--show-toplevel')).Output
    if ([IO.Path]::GetFullPath($root) -ne $repository) { throw 'Ship.ps1 must live in the repository scripts directory.' }
    $originalHead = (Invoke-Git -Arguments @('rev-parse', 'HEAD')).Output
    $branch = (Invoke-Git -Arguments @('symbolic-ref', '--quiet', '--short', 'HEAD') -AllowFailure).Output
    $status = (Invoke-Git -Arguments @('status', '--porcelain=v1', '--untracked-files=all')).Output
    $files = @($metadataPaths | ForEach-Object { Read-MetadataFile $_ })
    $currentVersion = Get-AlignedVersion $files
    Invoke-VersionCheck
    $parts = @($currentVersion.Split('.') | ForEach-Object { [long]$_ })
    switch ($Bump) {
        'patch' { $parts[2]++ }
        'minor' { $parts[1]++; $parts[2] = 0 }
        'major' { $parts[0]++; $parts[1] = 0; $parts[2] = 0 }
    }
    $nextVersion = $parts -join '.'
    if (@($parts | Where-Object { $_ -gt 65534 }).Count -gt 0) { throw 'The next release version exceeds the native build limit of 65534 per component.' }
    $releaseTag = "client-v$nextVersion"
    $blockers = @()
    if ($branch -ne 'main') { $blockers += 'Publishing requires the main branch.' }
    if ($status) { $blockers += 'Publishing requires a clean worktree, including untracked files.' }
    if (-not (Test-ReleaseOrigin)) { $blockers += 'Publishing requires origin to point only to github.com/snoopeh/Vumiro.' }
    $existingTag = Invoke-Git -Arguments @('show-ref', '--verify', '--quiet', "refs/tags/$releaseTag") -AllowFailure
    if ($existingTag.Code -eq 0) { $blockers += "The next local tag $releaseTag already exists." }
    elseif ($existingTag.Code -ne 1) { throw 'Unable to inspect local release tags.' }

    Write-Output "Release plan: $currentVersion -> $nextVersion ($releaseTag)"
    Write-Output "Source before release: $originalHead"
    if (-not $Publish) {
        Write-Output 'PREVIEW ONLY: no files, commits, tags, or remote refs were changed. Remote checks were not requested.'
        foreach ($blocker in $blockers) { Write-Output "Publishing blocked: $blocker" }
        Write-Output 'After human QA acceptance, publish with: ./scripts/Ship.ps1 -Bump <patch|minor|major> -Publish -QaAccepted'
        exit 0
    }
    if (-not $QaAccepted) { throw 'Publishing requires explicit human QA acceptance: pass -QaAccepted after QA is accepted.' }
    if ($blockers.Count -gt 0) { throw ($blockers -join [Environment]::NewLine) }

    $remote = Invoke-Git -Arguments @('ls-remote', 'origin', 'refs/heads/main', "refs/tags/$releaseTag", "refs/tags/$releaseTag^{}") -HideFailureOutput
    $remoteLines = @($remote.Output -split '\r?\n' | Where-Object { $_ })
    $mainRef = @($remoteLines | Where-Object { $_ -match '\srefs/heads/main$' })
    if ($mainRef.Count -ne 1 -or ($mainRef[0] -split '\s+')[0] -ne $originalHead) {
        throw 'Remote origin main must equal local HEAD. Reconcile and push source before publishing.'
    }
    if (@($remoteLines | Where-Object { $_ -match '\srefs/tags/' }).Count -gt 0) { throw "The next remote tag $releaseTag already exists." }

    $javascript = (Invoke-Git -Arguments @('ls-files', '--cached', '--', '*.js', '*.cjs', '*.mjs')).Output
    foreach ($path in @($javascript -split '\r?\n' | Where-Object { $_ -and $_ -notmatch '(^|/)(node_modules|dist|bin|obj)/' })) {
        $null = Invoke-Native -Command 'node' -Arguments @('--check', (Join-Path $repository $path))
    }
    # Build all replacement text before touching any file. Preserve whitespace, newlines, and encoding.
    for ($index = 0; $index -lt 2; $index++) {
        $files[$index].Text = Set-VersionText $files[$index].Text '(<Version>\s*)([^<\s]+)(\s*</Version>)' $nextVersion
    }
    $jsonVersionPattern = '(?m)^(\s*"version"\s*:\s*")([^"]+)(")'
    $files[2].Text = Set-VersionText $files[2].Text $jsonVersionPattern $nextVersion
    $files[3].Text = Set-VersionText $files[3].Text $jsonVersionPattern $nextVersion
    $files[3].Text = Set-VersionText $files[3].Text '(?s)("packages"\s*:\s*\{\s*""\s*:\s*\{.*?"version"\s*:\s*")([^"]+)(")' $nextVersion
    $null = Get-AlignedVersion $files
    if ((Invoke-Git -Arguments @('rev-parse', 'HEAD')).Output -ne $originalHead -or (Invoke-Git -Arguments @('status', '--porcelain=v1', '--untracked-files=all')).Output) {
        throw 'The worktree or HEAD changed during preflight. Inspect it and retry.'
    }
    $mutationStarted = $true
    foreach ($file in $files) { [IO.File]::WriteAllText($file.Path, $file.Text, $file.Encoding) }
    Invoke-VersionCheck $releaseTag
    $null = Invoke-Git -Arguments (@('add', '--') + $metadataPaths)
    $null = Invoke-Git -Arguments (@('commit', '--only', '-m', "Release Vumiro $nextVersion", '--') + $metadataPaths)
    $releaseHead = (Invoke-Git -Arguments @('rev-parse', 'HEAD')).Output
    $null = Invoke-Git -Arguments @('tag', '-a', $releaseTag, '-m', "Vumiro $nextVersion", $releaseHead)
    $null = Invoke-Git -Arguments @('push', '--atomic', '--no-follow-tags', 'origin', "${releaseHead}:refs/heads/main", "refs/tags/${releaseTag}:refs/tags/$releaseTag") -HideFailureOutput
    Write-Output "Release source pushed: $releaseTag"
    Write-Output "Source SHA: $releaseHead"
    Write-Output 'Workflow: https://github.com/snoopeh/Vumiro/actions/workflows/client-release.yml'
    Write-Output 'GitHub Actions now builds and verifies the client packages. The hosted release is complete only after that workflow succeeds.'
}
catch {
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
    if ($mutationStarted) {
        $recoverySource = 'HEAD'
        if ($releaseHead) { $recoverySource = $releaseHead }
        Write-Output 'Release preparation stopped after local changes. No automatic rollback was attempted.'
        Write-Output "Inspect git status, git diff, git log -1, and git show-ref --verify refs/tags/$releaseTag. Original HEAD: $originalHead"
        Write-Output "Check remote state with: git ls-remote origin refs/heads/main refs/tags/$releaseTag"
        Write-Output 'If the release commit or tag is missing, finish the version commit and annotated tag after reviewing the diff.'
        Write-Output "If the local release commit and annotated tag are correct and remote main is still the original HEAD, retry: git push --atomic --no-follow-tags origin ${recoverySource}:refs/heads/main refs/tags/${releaseTag}:refs/tags/$releaseTag"
        Write-Output 'If the remote already contains both refs, inspect the workflow before taking further action. Never force push or reset to recover automatically.'
    }
    exit 1
}
finally { Pop-Location }
