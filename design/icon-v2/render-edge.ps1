# Render icon.svg → PNGs at multiple sizes.
# Uses Microsoft Edge in headless mode to rasterize the SVG (works without
# ImageMagick/Inkscape on Windows since Edge ships with the OS).
# Then downsamples the master PNG to the smaller sizes via System.Drawing.

[CmdletBinding()]
param(
    [string]$SvgPath  = "C:\Local\local_repos\rich-diff-comments\design\icon-v2\icon.svg",
    [string]$IconsDir = "C:\Local\local_repos\rich-diff-comments\icons",
    [string]$LogoDir  = "C:\Local\local_repos\rich-diff-comments\design\logo"
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edge)) { $edge = "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe" }
if (-not (Test-Path $edge)) { throw "msedge.exe not found." }

# 1. Render master PNG (1024×1024) via Edge headless screenshot.
$masterPng = Join-Path $LogoDir "icon-1024.png"
$svgUri = "file:///" + ($SvgPath -replace '\\','/')

Write-Host "→ rendering master 1024×1024 via Edge headless..."
& $edge --headless=new --disable-gpu --hide-scrollbars `
    "--window-size=1024,1024" `
    "--default-background-color=00000000" `
    "--screenshot=$masterPng" `
    $svgUri | Out-Null

if (-not (Test-Path $masterPng)) { throw "Edge failed to produce $masterPng" }
Write-Host "  wrote $masterPng"

# 2. Downsample to all requested sizes.
$source = [System.Drawing.Image]::FromFile($masterPng)

$targets = @(
    @{ Size = 300; Dir = $LogoDir },
    @{ Size = 128; Dir = $IconsDir },
    @{ Size = 48;  Dir = $IconsDir },
    @{ Size = 32;  Dir = $IconsDir },
    @{ Size = 16;  Dir = $IconsDir }
)

foreach ($t in $targets) {
    $s = $t.Size
    $dest = Join-Path $t.Dir ("icon-{0}.png" -f $s)
    $bmp = New-Object System.Drawing.Bitmap $s, $s
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.DrawImage($source, 0, 0, $s, $s)
    $g.Dispose()
    $bmp.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "  wrote $dest"
}

$source.Dispose()
Write-Host "`nDone."
