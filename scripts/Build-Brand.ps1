param([string]$Output = (Join-Path $PSScriptRoot '../Vumiro.Client/Brand/vumiro.ico'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$images = @()
# The raster master is rendered from Brand/vumiro.svg and shared with Linux.
$sourcePath = Join-Path $PSScriptRoot '../Vumiro.Client/Brand/vumiro.png'
$sourceImage = [Drawing.Image]::FromFile([IO.Path]::GetFullPath($sourcePath))
try {
    foreach ($size in @(16,24,32,48,64,128,256)) {
        $scaled = New-Object Drawing.Bitmap $size,$size
        $graphics = [Drawing.Graphics]::FromImage($scaled)
        $stream = New-Object IO.MemoryStream
        try {
            $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $graphics.DrawImage($sourceImage,0,0,$size,$size)
            $scaled.Save($stream,[Drawing.Imaging.ImageFormat]::Png)
            $images += ,@($size,$stream.ToArray())
        } finally {
            $stream.Dispose(); $graphics.Dispose(); $scaled.Dispose()
        }
    }
} finally { $sourceImage.Dispose() }
$outputPath = [IO.Path]::GetFullPath($Output)
$file = [IO.File]::Create($outputPath)
$writer = New-Object IO.BinaryWriter $file
try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$images.Count)
    $offset = 6 + 16 * $images.Count
    foreach ($entry in $images) {
        $dimension = if ($entry[0] -eq 256) { 0 } else { $entry[0] }
        $writer.Write([byte]$dimension); $writer.Write([byte]$dimension); $writer.Write([byte]0); $writer.Write([byte]0)
        $writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$entry[1].Length); $writer.Write([uint32]$offset)
        $offset += $entry[1].Length
    }
    foreach ($entry in $images) { $writer.Write([byte[]]$entry[1]) }
} finally { $writer.Dispose() }
Write-Output "Vumiro icon ready: $outputPath"
