param(
    [Parameter(Mandatory=$true)][string]$SourceRoot,
    [Parameter(Mandatory=$true)][string]$ApplicationDirectory
)
$ErrorActionPreference = 'Stop'
$source = [IO.Path]::GetFullPath($SourceRoot)
$app = [IO.Path]::GetFullPath($ApplicationDirectory)
New-Item -ItemType Directory -Path $app -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $source 'THIRD-PARTY.md') -Destination (Join-Path $app 'THIRD-PARTY.md') -Force
$noticeSets = @{
    'windows' = @('WINTUN-LICENSE.txt','VIGEMBUS-LICENSE.txt','payloads.json')
    'controller-art' = @('LICENSE-CC0.txt','PROVENANCE.md')
}
foreach ($group in $noticeSets.Keys) {
    $destination = Join-Path $app ('notices/' + $group)
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    foreach ($filename in $noticeSets[$group]) {
        Copy-Item -LiteralPath (Join-Path $source ('vendor/' + $group + '/' + $filename)) -Destination (Join-Path $destination $filename) -Force
    }
}
