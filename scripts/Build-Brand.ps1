param([string]$Output = (Join-Path $PSScriptRoot '../ScreenTask.Client/Brand/vumiro.ico'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$images = @()
foreach ($size in @(16,24,32,48,64,128,256)) {
    $bitmap = New-Object Drawing.Bitmap ($size * 4), ($size * 4)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.ScaleTransform(($size * 4 / 256.0), ($size * 4 / 256.0))
    $tile = New-Object Drawing.Drawing2D.GraphicsPath
    $tile.AddArc(8,8,106,106,180,90); $tile.AddArc(142,8,106,106,270,90)
    $tile.AddArc(142,142,106,106,0,90); $tile.AddArc(8,142,106,106,90,90); $tile.CloseFigure()
    $back = New-Object Drawing.SolidBrush ([Drawing.ColorTranslator]::FromHtml('#0b0b0c'))
    $graphics.FillPath($back,$tile)
    $left = New-Object Drawing.Drawing2D.GraphicsPath
    $left.StartFigure(); $left.AddBezier(32,62,29,56,32,52,38,52); $left.AddLine(38,52,79,52)
    $left.AddBezier(79,52,94,52,102,59,109,70); $left.AddLine(109,70,166,167); $left.AddLine(166,167,151,190)
    $left.AddBezier(151,190,137,207,110,204,97,185); $left.CloseFigure()
    $leftBrush = New-Object Drawing.Drawing2D.LinearGradientBrush ([Drawing.Point]::new(40,52)), ([Drawing.Point]::new(160,200)), ([Drawing.ColorTranslator]::FromHtml('#ff675f')), ([Drawing.ColorTranslator]::FromHtml('#d70e25'))
    $graphics.FillPath($leftBrush,$left)
    $right = New-Object Drawing.Drawing2D.GraphicsPath
    $right.StartFigure(); $right.AddLine(112,147,162,68); $right.AddBezier(162,68,169,57,178,52,191,52)
    $right.AddLine(191,52,225,52); $right.AddBezier(225,52,232,52,235,57,230,65); $right.AddLine(230,65,157,185)
    $right.AddBezier(157,185,145,205,122,210,105,197); $right.AddLine(105,197,88,176); $right.AddBezier(88,176,99,180,104,160,112,147); $right.CloseFigure()
    $rightBrush = New-Object Drawing.Drawing2D.LinearGradientBrush ([Drawing.Point]::new(215,55)), ([Drawing.Point]::new(110,205)), ([Drawing.ColorTranslator]::FromHtml('#ff5958')), ([Drawing.ColorTranslator]::FromHtml('#c60d23'))
    $graphics.FillPath($rightBrush,$right)
    $scaled = New-Object Drawing.Bitmap $size,$size
    $scaledGraphics = [Drawing.Graphics]::FromImage($scaled)
    $scaledGraphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $scaledGraphics.DrawImage($bitmap,0,0,$size,$size)
    $stream = New-Object IO.MemoryStream
    $scaled.Save($stream,[Drawing.Imaging.ImageFormat]::Png)
    $images += ,@($size,$stream.ToArray())
    foreach ($item in @($graphics,$scaledGraphics,$bitmap,$scaled,$stream,$tile,$left,$right,$back,$leftBrush,$rightBrush)) { $item.Dispose() }
}
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
