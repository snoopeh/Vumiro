$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$harness = Join-Path $PSScriptRoot 'ConnectionHarness/bin/Release/net48/ConnectionHarness.exe'
$ffmpeg = Join-Path $root 'dist/published-1.11.1/ffmpeg.exe'
$artifacts = Join-Path $PSScriptRoot 'artifacts/video-quality'
New-Item -ItemType Directory -Path $artifacts -Force | Out-Null
Add-Type -AssemblyName System.Drawing
$source = Join-Path $artifacts 'source.png'
$bitmap = [Drawing.Bitmap]::new(1920, 1080)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$font = [Drawing.Font]::new('Consolas', 11, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
try {
    $graphics.Clear([Drawing.Color]::FromArgb(24, 26, 30))
    for ($row = 0; $row -lt 68; $row++) {
        $text = ('{0:D3}  ScreenTask: readable desktop text | public int Quality = 90; // ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789 ' -f $row) * 3
        $graphics.DrawString($text, $font, [Drawing.Brushes]::White, 3, 3 + $row * 15)
    }
    $bitmap.Save($source, [Drawing.Imaging.ImageFormat]::Png)
} finally { $font.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }

$scores = @{}
foreach ($quality in @(30, 90)) {
    $options = (& $harness --encoder-options libx264 $quality 20).Split(' ', [StringSplitOptions]::RemoveEmptyEntries)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot obtain application encoder options.' }
    $output = Join-Path $artifacts "quality-$quality.mp4"
    & $ffmpeg -hide_banner -loglevel error -y -loop 1 -framerate 30 -i $source -t 1 -an -c:v libx264 @options -pix_fmt yuv420p -g 15 -bf 0 $output
    if ($LASTEXITCODE -ne 0) { throw "Encoder rejected quality $quality options." }
    $measurement = (& $ffmpeg -hide_banner -i $output -i $source -filter_complex '[0:v][1:v]ssim' -frames:v 1 -f null - 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0 -or $measurement -notmatch 'All:([0-9.]+)') { throw "Cannot measure text fidelity: $measurement" }
    $scores[$quality] = [double]::Parse($Matches[1], [Globalization.CultureInfo]::InvariantCulture)
    & $ffmpeg -hide_banner -loglevel error -y -i $output -frames:v 1 (Join-Path $artifacts "quality-$quality.png")
}
if ($scores[90] -le $scores[30] + 0.02) { throw "Video quality did not materially preserve text detail: $($scores | Out-String)" }
Write-Output "PASS: actual software-encoded small-text fidelity improves from SSIM $($scores[30]) to $($scores[90]); samples: $artifacts"
