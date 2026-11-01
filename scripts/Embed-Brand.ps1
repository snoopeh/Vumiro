$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$font = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $root 'ScreenTask.Client/Brand/Sora-latin.woff2')))
$fontStyle = "/* vumiro-sora:start */`n@font-face{font-family:Sora;font-style:normal;font-weight:400 700;font-display:swap;src:url(data:font/woff2;base64,$font) format('woff2')}`n/* vumiro-sora:end */"
$icon = [Uri]::EscapeDataString([IO.File]::ReadAllText((Join-Path $root 'ScreenTask.Client/Brand/vumiro.svg')))
foreach ($name in @('friends.html','call.html')) {
    $path = Join-Path $root ('ScreenTask/WebServer/' + $name)
    $html = [IO.File]::ReadAllText($path)
    if ($html.Contains('/* vumiro-sora:start */')) {
        $html = [regex]::Replace($html, '/\* vumiro-sora:start \*/[\s\S]*?/\* vumiro-sora:end \*/', [Text.RegularExpressions.MatchEvaluator]{ param($match) $fontStyle })
    } else { $html = $html.Replace('<style>', "<style>`n$fontStyle`n") }
    $html = $html.Replace('font:14px/1.5 "Segoe UI",system-ui,sans-serif', 'font:14px/1.5 Sora,"Segoe UI",system-ui,sans-serif')
    if (!$html.Contains('data-vumiro-icon')) { $html = $html.Replace('</head>', ('<link data-vumiro-icon rel="icon" type="image/svg+xml" href="data:image/svg+xml,' + $icon + '"></head>')) }
    [IO.File]::WriteAllText($path, $html, (New-Object Text.UTF8Encoding($false)))
}
Write-Output 'Embedded the licensed Sora font in the existing Vumiro client assets.'
