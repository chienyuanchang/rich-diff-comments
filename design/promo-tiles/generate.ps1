# Regenerate the Chrome Web Store promo tiles using the new icon + new name.
#
# Composes each tile from:
#   - GitHub-blue radial-gradient background (matches the icon's `#0969da`
#     so the whole tile reads as one brand system)
#   - white rounded-rect badge behind the icon (icon is same-colour as the
#     background and would otherwise disappear); soft drop shadow for lift
#   - new app icon (design/logo/icon-1024.png) centered on the badge
#   - "Markdown PR Comments" headline (white) + "for GitHub" (light blue)
#   - short verb-led tagline in light gray
#
# Sizes generated (per Chrome Web Store + Edge Add-ons):
#   small-440x280.png    (Chrome small promo tile)
#   small-tile-880x560.png    (2x retina)
#   marquee-1400x560.png    (Chrome marquee)
#   large-tile-2800x1120.png    (2x retina marquee)
#
# ──────────────────────────────────────────────────────────────────────
# Redesign history:
#
#   2026-06 (initial review feedback): the original near-black background
#   (RGB 18,28,48 → 6,10,22) clashed with the solid-blue speech-bubble
#   icon. Tagline was 9 words at 13–30 px — unreadable at thumbnail size.
#
#   2026-06 (this rev): swapped background to GitHub-blue radial gradient
#   (`#388bfd` centre → `#0969da` edges) so the icon's own blue blends
#   into the same palette. Added a white rounded-rect badge behind the
#   icon with a 16% corner radius and a soft drop shadow — without this,
#   the same-colour icon would disappear into the background. Headline
#   stayed white for clarity against the saturated blue; sub line went
#   to a lighter blue tint (rgb 220,235,255) so it reads as a secondary
#   note. Tagline shortened to one of the verb-led candidates from the
#   original brief: "Comment, reply, resolve in rendered markdown." —
#   6 words, mirrors the store short description, readable at small size.
#
#   Future iterations to consider (not blocking):
#     • Per-tile tagline visibility — the small 440×280 tile is already
#       getting tight; consider dropping the tagline on it entirely so
#       the icon + name carry the tile at carousel size.
#     • Tile-B headline re-cut: make "Markdown PR" enormous as the new
#       short brand prefix and demote "Comments for GitHub" to subtitle.
#       Would mirror the manifest name's hierarchy more directly.
#     • Light-mode variant of the same palette (off-white canvas with
#       blue accents) for stores that test against light backgrounds
#       only — A/B test signal would tell us if it lifts conversion.
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

    # Background: pure white canvas. The brand colour comes from the
    # icon and from the perimeter frame below — no gradient or fill
    # needed in the body. Reads cleanly at any size and lets the icon's
    # GitHub-blue do the heavy lifting visually.
    $whiteBg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
    $g.FillRectangle($whiteBg, 0, 0, $t.W, $t.H)
    $whiteBg.Dispose()

    # Perimeter frame in GitHub blue. Width scales with tile size so the
    # frame stays visually proportional from 440×280 up to 2800×1120 —
    # a fixed value would look chunky on small tiles and invisible on the
    # marquee. ~2.5% of tile width is the "confident brand frame" weight;
    # halving to ~1.2% reads as a hairline that gets lost at thumbnail
    # size, doubling to ~5% starts looking like a poster border. Inset
    # by half the pen width so the frame sits flush with the canvas
    # edge rather than getting clipped.
    $frameWidth = [Math]::Max(6, [int]($t.W * 0.025))
    $framePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 9, 105, 218)), $frameWidth
    $inset = [int]($frameWidth / 2)
    $g.DrawRectangle($framePen, $inset, $inset, ($t.W - $frameWidth), ($t.H - $frameWidth))
    $framePen.Dispose()

    $layout = if ($t.ContainsKey('Layout')) { $t.Layout } else { 'vertical' }

    if ($layout -eq 'horizontal') {
        # Icon on left, text block on right — no badge, icon sits directly
        # on the white canvas.
        $iconY = [int](($t.H - $t.Icon) / 2)
        $iconX = [int]($t.W * 0.10)
        $g.DrawImage($icon, $iconX, $iconY, $t.Icon, $t.Icon)

        $textX = $iconX + $t.Icon + [int]($t.Pad * 1.5)
        $textW = $t.W - $textX - $t.Pad
        $headlineFont = New-Object System.Drawing.Font 'Segoe UI', $t.H1, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
        $subFont      = New-Object System.Drawing.Font 'Segoe UI', $t.H2, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
        $tagFont      = New-Object System.Drawing.Font 'Segoe UI', $t.T,  ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)

        # Text palette: near-black headline + GitHub-blue sub + mid-grey
        # tagline. Matches GitHub's own Primer palette (`--fgColor-default`,
        # `--fgColor-accent`, `--fgColor-muted`) so the tile reads as
        # "native GitHub" branding rather than custom-coloured marketing.
        $whiteBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 31, 35, 40))
        $blueBrush  = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 9, 105, 218))
        $grayBrush  = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 87, 96, 106))

        # Stack headline / sub / tagline vertically, anchored to vertical centre
        $line1 = "Markdown PR Comments"
        $line2 = "for GitHub"
        $tagline = "Comment, reply, resolve in rendered markdown."
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
        # Icon centred near top, text below — no badge, icon sits directly
        # on the white canvas. Icon position is computed AFTER the text
        # block so we know where the headline starts, then the icon is
        # placed in the vertical centre of the gap between the top edge
        # of the tile and the top of the headline. This gives the icon
        # breathing room from the frame instead of hugging the top edge
        # (the previous `iconY = $t.Pad` look read as "tile is unbalanced
        # — too much white at the bottom").
        $iconX = [int](($t.W - $t.Icon) / 2)
        # Provisional iconY (we'll recompute after we know textTop).
        $iconY = $t.Pad

        $headlineFont = New-Object System.Drawing.Font 'Segoe UI', $t.H1, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
        $subFont      = New-Object System.Drawing.Font 'Segoe UI', $t.H2, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
        $tagFont      = New-Object System.Drawing.Font 'Segoe UI', $t.T,  ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)

        $whiteBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 31, 35, 40))
        $blueBrush  = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 9, 105, 218))
        $grayBrush  = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 87, 96, 106))

        $sf = New-Object System.Drawing.StringFormat
        $sf.Alignment = [System.Drawing.StringAlignment]::Center
        $sf.LineAlignment = [System.Drawing.StringAlignment]::Near

        $line1 = "Markdown PR Comments"
        $line2 = "for GitHub"
        $tagline = "Comment, reply, resolve`nin rendered markdown."

        # Compute text-block height + place it anchored to the bottom
        # padding. Then put the icon in the vertical middle of the
        # remaining whitespace above the headline.
        $line1H = [int]($t.H1 * 1.3)
        $line2H = [int]($t.H2 * 1.6)
        $taglineH = [int]($t.T * 2.4)  # 2-line wrap × line-height
        $textBlockH = $line1H + $line2H + $taglineH
        # Anchor text block to bottom with a small extra-padding cushion
        # below the tagline (tagline gets ~1×Pad below it for breathing room).
        $textY = $t.H - $t.Pad - $textBlockH
        # Icon vertically centred in the whitespace above the headline.
        # Top of that whitespace is the frame-inset (we ignore the frame
        # itself when centring — visually the eye reads the WHITE region,
        # not the line); bottom is `textY`. Subtract icon height / 2 to
        # centre, then nudge DOWNWARD by ~Pad so the icon sits in the
        # lower half of the upper whitespace — closer to the headline it
        # introduces, with more breathing room above. (Reading order is
        # top→bottom and an icon glued near the bottom of its "card"
        # reads as a deliberate hand-off into the text below.)
        $iconY = [int](($textY - $t.Icon) / 2) + $t.Pad
        # Clamp so we never overlap the top frame or push into the headline.
        if ($iconY -lt $t.Pad) { $iconY = $t.Pad }
        if (($iconY + $t.Icon) -gt ($textY - [int]($t.Pad / 2))) {
            $iconY = $textY - $t.Icon - [int]($t.Pad / 2)
        }
        $g.DrawImage($icon, $iconX, $iconY, $t.Icon, $t.Icon)

        $g.DrawString($line1, $headlineFont, $whiteBrush, (New-Object System.Drawing.RectangleF 0, $textY, $t.W, ($t.H1 * 1.5)), $sf)
        $textY += $line1H
        $g.DrawString($line2, $subFont, $blueBrush, (New-Object System.Drawing.RectangleF 0, $textY, $t.W, ($t.H2 * 1.5)), $sf)
        $textY += $line2H
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
