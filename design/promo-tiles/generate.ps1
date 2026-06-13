# Regenerate the Chrome Web Store promo tiles using the new icon + new name.
#
# Composes each tile from:
#   - dark radial-gradient background (matches existing tile style)
#   - new app icon (design/logo/icon-1024.png) centered horizontally near top
#   - "Markdown PR Comments" headline (white) + "for GitHub" (GitHub blue)
#   - tagline in light gray
#
# Sizes generated (per Chrome Web Store + Edge Add-ons):
#   small-440x280.png    (Chrome small promo tile)
#   small-tile-880x560.png    (2x retina)
#   marquee-1400x560.png    (Chrome marquee)
#   large-tile-2800x1120.png    (2x retina marquee)
#
# ──────────────────────────────────────────────────────────────────────
# Redesign brief (open — feedback from 2026-06 review):
#
#   Problems with the current tiles:
#     1. The near-black radial-gradient background (RGB 18,28,48 → 6,10,22)
#        does not match the icon's visual language. The icon is a solid
#        GitHub-blue (#0969da) speech bubble on transparent — sitting it
#        against navy-black reads as two unrelated visual systems glued
#        together, not one brand.
#     2. The on-tile tagline (the small grey line rendered below the
#        "Markdown PR Comments / for GitHub" headline) is too long and
#        too small to do its job. Current text:
#          "Inline review comments on GitHub PR rich-diff (rendered markdown)."
#        At 13–30 px on a busy gradient it's read-by-nobody at thumbnail
#        size, yet it eats space the headline could use and dilutes the
#        message instead of sharpening it.
#     3. The tile under-uses text *and* over-uses it at the same time —
#        sparse where it should be confident (no clear single message)
#        and verbose where it should be silent (long tagline).
#
#   Recommended direction (not yet implemented; tracked in
#   docs/FEATURES.md → Distribution):
#     • Background: pick a palette that harmonises with the icon. Either
#       (a) a GitHub-blue tint that the icon emerges from with a subtle
#       highlight/shadow, or (b) an off-white / Primer canvas (#f6f8fa)
#       so the blue icon pops as the hero. Avoid the current near-black.
#     • Tagline: shorten dramatically, in the same verb-led voice as the
#       store short description ("Comment, reply, resolve, and collapse
#       sections directly in GitHub PR rich-diff (rendered markdown)").
#       Goal is a one-glance read at thumbnail size — if a reviewer can't
#       parse it in ~1 second, it's not doing its job and the headline
#       should be doing more work instead. Candidate taglines, all ≤ 7
#       words and verb-led, ordered roughly by recommendation:
#          "Comment, reply, resolve in rendered markdown."   (6 words)
#          "Inline comments on GitHub PR rich-diff."          (6 words)
#          "Comment on rendered markdown in GitHub PRs."      (7 words)
#          "Comment. Reply. Resolve. In rich-diff."           (5 words)
#       Headline ("Markdown PR Comments / for GitHub") already carries
#       the product name — the tagline only needs to add *what it does*,
#       not re-state where it does it. If a tagline can't beat the
#       headline on read-time, cut it entirely and let the icon + name
#       carry the tile.
#     • Use text sparingly overall. Don't over-communicate (whole feature
#       list) and don't under-communicate (just the icon with no name).
#       The small promo tile especially has to work at 220×140 in the
#       store carousel — everything below ~24 px effective size is
#       decoration.
#
#   Don't change without re-checking: Chrome / Edge sizing rules
#   (440×280, 1400×560 and the 2× retina pair) are fixed by the stores.
# ──────────────────────────────────────────────────────────────────────

[CmdletBinding()]
param(
    [string]$IconPath = "C:\Local\local_repos\rich-diff-comments\design\logo\icon-1024.png",
    [string]$OutDir   = "C:\Local\local_repos\rich-diff-comments\design\promo-tiles"
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $IconPath)) { throw "Icon not found: $IconPath" }
$icon = [System.Drawing.Image]::FromFile($IconPath)

# Tile spec: width, height, icon size, headline pt, sub pt, tagline pt, line-spacing
$tiles = @(
    @{ Name = "small-440x280.png";       W = 440;  H = 280;  Icon = 96;  H1 = 24; H2 = 24; T = 13; Pad = 18; ShowTagline = $true },
    @{ Name = "small-tile-880x560.png";  W = 880;  H = 560;  Icon = 192; H1 = 48; H2 = 48; T = 26; Pad = 36; ShowTagline = $true },
    @{ Name = "marquee-1400x560.png";    W = 1400; H = 560;  Icon = 280; H1 = 60; H2 = 60; T = 30; Pad = 48; ShowTagline = $true; Layout = "horizontal" },
    @{ Name = "large-tile-2800x1120.png";W = 2800; H = 1120; Icon = 560; H1 = 120; H2 = 120; T = 60; Pad = 96; ShowTagline = $true; Layout = "horizontal" }
)

foreach ($t in $tiles) {
    $bmp = New-Object System.Drawing.Bitmap $t.W, $t.H
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

    # Background: dark radial gradient (centre slightly lighter)
    $bgRect = New-Object System.Drawing.Rectangle 0, 0, $t.W, $t.H
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddRectangle($bgRect)
    $pathBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush $path
    $pathBrush.CenterPoint = New-Object System.Drawing.PointF ($t.W / 2), ($t.H / 2)
    $pathBrush.CenterColor = [System.Drawing.Color]::FromArgb(255, 18, 28, 48)
    $pathBrush.SurroundColors = ,([System.Drawing.Color]::FromArgb(255, 6, 10, 22))
    $g.FillRectangle($pathBrush, $bgRect)
    $pathBrush.Dispose()
    $path.Dispose()

    $layout = if ($t.ContainsKey('Layout')) { $t.Layout } else { 'vertical' }

    if ($layout -eq 'horizontal') {
        # Icon on left, text block on right
        $iconY = [int](($t.H - $t.Icon) / 2)
        $iconX = [int]($t.W * 0.10)
        $g.DrawImage($icon, $iconX, $iconY, $t.Icon, $t.Icon)

        $textX = $iconX + $t.Icon + [int]($t.Pad * 1.5)
        $textW = $t.W - $textX - $t.Pad
        $headlineFont = New-Object System.Drawing.Font 'Segoe UI', $t.H1, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
        $subFont      = New-Object System.Drawing.Font 'Segoe UI', $t.H2, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
        $tagFont      = New-Object System.Drawing.Font 'Segoe UI', $t.T,  ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)

        $whiteBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
        $blueBrush  = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 88, 166, 255))
        $grayBrush  = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 180, 190, 210))

        # Stack headline / sub / tagline vertically, anchored to vertical centre
        $line1 = "Markdown PR Comments"
        $line2 = "for GitHub"
        $tagline = "Inline review comments on GitHub PR rich-diff (rendered markdown)."
        $lineGap = [int]($t.H1 * 0.15)
        $tagGap  = [int]($t.H1 * 0.6)
        $h1H = [int]($t.H1 * 1.25)
        $h2H = [int]($t.H2 * 1.25)
        $tH  = [int]($t.T * 1.45)
        $totalH = $h1H + $lineGap + $h2H + $tagGap + $tH
        $yStart = [int](($t.H - $totalH) / 2)

        $sf = New-Object System.Drawing.StringFormat
        $sf.Alignment = [System.Drawing.StringAlignment]::Near
        $g.DrawString($line1, $headlineFont, $whiteBrush, [single]$textX, [single]$yStart, $sf)
        $g.DrawString($line2, $subFont, $blueBrush, [single]$textX, [single]($yStart + $h1H + $lineGap), $sf)
        $g.DrawString($tagline, $tagFont, $grayBrush, (New-Object System.Drawing.RectangleF $textX, ($yStart + $h1H + $lineGap + $h2H + $tagGap), $textW, ($tH * 2)), $sf)
    } else {
        # Icon centred at top, text below
        $iconX = [int](($t.W - $t.Icon) / 2)
        $iconY = $t.Pad
        $g.DrawImage($icon, $iconX, $iconY, $t.Icon, $t.Icon)

        $headlineFont = New-Object System.Drawing.Font 'Segoe UI', $t.H1, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
        $subFont      = New-Object System.Drawing.Font 'Segoe UI', $t.H2, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
        $tagFont      = New-Object System.Drawing.Font 'Segoe UI', $t.T,  ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)

        $whiteBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
        $blueBrush  = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 88, 166, 255))
        $grayBrush  = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 180, 190, 210))

        $sf = New-Object System.Drawing.StringFormat
        $sf.Alignment = [System.Drawing.StringAlignment]::Center
        $sf.LineAlignment = [System.Drawing.StringAlignment]::Near

        $line1 = "Markdown PR Comments"
        $line2 = "for GitHub"
        $tagline = "Inline review comments on GitHub PR rich-diff`n(rendered markdown)."

        $textY = $iconY + $t.Icon + [int]($t.Pad * 0.9)
        $g.DrawString($line1, $headlineFont, $whiteBrush, (New-Object System.Drawing.RectangleF 0, $textY, $t.W, ($t.H1 * 1.5)), $sf)
        $textY += [int]($t.H1 * 1.3)
        $g.DrawString($line2, $subFont, $blueBrush, (New-Object System.Drawing.RectangleF 0, $textY, $t.W, ($t.H2 * 1.5)), $sf)
        $textY += [int]($t.H2 * 1.6)
        $g.DrawString($tagline, $tagFont, $grayBrush, (New-Object System.Drawing.RectangleF 0, $textY, $t.W, ($t.T * 3.5)), $sf)
    }

    $out = Join-Path $OutDir $t.Name
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $g.Dispose()
    Write-Host "wrote $out"
}

$icon.Dispose()
Write-Host "`nDone."
