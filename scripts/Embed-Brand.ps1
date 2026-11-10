$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$font = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $root 'Vumiro.Client/Brand/Sora-latin.woff2')))
$fontStyle = "/* vumiro-sora:start */`n@font-face{font-family:Sora;font-style:normal;font-weight:400 700;font-display:swap;src:url(data:font/woff2;base64,$font) format('woff2')}`n/* vumiro-sora:end */"
$icon = [Uri]::EscapeDataString([IO.File]::ReadAllText((Join-Path $root 'Vumiro.Client/Brand/vumiro.svg')))
foreach ($name in @('friends.html','call.html')) {
    $path = Join-Path $root ('Vumiro.Client/WebServer/' + $name)
    $html = [IO.File]::ReadAllText($path)
    if ($html.Contains('/* vumiro-sora:start */')) {
        $html = [regex]::Replace($html, '/\* vumiro-sora:start \*/[\s\S]*?/\* vumiro-sora:end \*/', [Text.RegularExpressions.MatchEvaluator]{ param($match) $fontStyle })
    } else { $html = $html.Replace('<style>', "<style>`n$fontStyle`n") }
    $html = $html.Replace('font:14px/1.5 "Segoe UI",system-ui,sans-serif', 'font:14px/1.5 Sora,"Segoe UI",system-ui,sans-serif')
    [IO.File]::WriteAllText($path, $html, (New-Object Text.UTF8Encoding($false)))
}
$outfit = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $root 'Vumiro.Client/Brand/Outfit-latin.woff2')))
$outfitStyle = "/* vumiro-outfit:start */`n@font-face{font-family:Outfit;font-style:normal;font-weight:100 900;font-display:swap;src:url(data:font/woff2;base64,$outfit) format('woff2')}`n/* vumiro-outfit:end */"
foreach ($name in @('friends.html','auth.html')) {
    $path = Join-Path $root ('Vumiro.Client/WebServer/' + $name)
    $html = [IO.File]::ReadAllText($path)
    if ($html.Contains('/* vumiro-outfit:start */')) {
        $html = [regex]::Replace($html, '/\* vumiro-outfit:start \*/[\s\S]*?/\* vumiro-outfit:end \*/', [Text.RegularExpressions.MatchEvaluator]{ param($match) $outfitStyle })
    } else { $html = $html.Replace('<style>', "<style>`n$outfitStyle`n") }
    [IO.File]::WriteAllText($path, $html, (New-Object Text.UTF8Encoding($false)))
}
# Keep compact marks, full lockups and favicons synchronized with the approved vectors.
[xml]$markDocument = [IO.File]::ReadAllText((Join-Path $root 'Vumiro.Client/Brand/vumiro-v.svg'))
[xml]$logoDocument = [IO.File]::ReadAllText((Join-Path $root 'Vumiro.Client/Brand/vumiro-logo.svg'))
function Get-BrandArtwork([xml]$document) {
    $artwork = ($document.DocumentElement.ChildNodes | Where-Object { $_.LocalName -eq 'g' } | ForEach-Object { $_.OuterXml }) -join ''
    return [regex]::Replace($artwork, ' id="[^"]*"', '')
}
$definitions = $markDocument.DocumentElement.SelectSingleNode('*[local-name()="defs"]').OuterXml
$sprite = '<svg data-vumiro-brand width="0" height="0" style="position:absolute" aria-hidden="true">' + $definitions +
    '<symbol id="vumiro-mark" viewBox="' + $markDocument.DocumentElement.GetAttribute('viewBox') + '">' + (Get-BrandArtwork $markDocument) + '</symbol>' +
    '<symbol id="vumiro-wordmark" viewBox="' + $logoDocument.DocumentElement.GetAttribute('viewBox') + '">' + (Get-BrandArtwork $logoDocument) + '</symbol></svg>'
$favicon = '<link data-vumiro-icon rel="icon" type="image/svg+xml" href="data:image/svg+xml,' + $icon + '">'
foreach ($name in @('friends.html','auth.html','call.html')) {
    $path = Join-Path $root ('Vumiro.Client/WebServer/' + $name)
    $html = [IO.File]::ReadAllText($path)
    $html = [regex]::Replace($html, '<svg\b[^>]*data-vumiro-brand[^>]*>[\s\S]*?</svg>', '')
    $html = [regex]::Replace($html, '<svg\b[^>]*>\s*<symbol id="vumiro-mark"[\s\S]*?</svg>', '')
    $html = [regex]::Replace($html, '<body\b[^>]*>', [Text.RegularExpressions.MatchEvaluator]{ param($match) $match.Value + $sprite })
    $html = [regex]::Replace($html, '<link\b[^>]*data-vumiro-icon[^>]*>', '')
    $html = $html.Replace('</head>', $favicon + '</head>')
    [IO.File]::WriteAllText($path, $html, (New-Object Text.UTF8Encoding($false)))
}
Write-Output 'Embedded the licensed fonts, approved Blade V artwork, wordmark and favicons.'
