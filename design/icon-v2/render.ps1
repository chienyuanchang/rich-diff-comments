# Render icon.svg -> PNGs at the sizes Chrome / Edge / store listings require.
#
# Strategy:
#   1. Render the master 1024x1024 PNG from icon.svg using headless Chrome or Edge
#      (no external dependencies required on a typical Windows dev box).
#   2. Downscale to the smaller sizes via System.Drawing with high-quality bicubic.
#      Headless Chrome unreliably renders very small window sizes (it produced
#      blank output at 16 / 128 px), so downscaling from the master is more
#      robust and keeps every size pixel-consistent.
#
# Usage:
#   ./render.ps1                  # writes to ../../icons/  (replaces shipped icons)
#   ./render.ps1 -OutDir preview  # writes to ./preview/   (review before replacing)

[CmdletBinding()]
param(
    [string]$OutDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..\icons')).Path
)

$ErrorActionPreference = 'Stop'
$svg   = Join-Path $PSScriptRoot 'icon.svg'
$sizes = 1024, 300, 128, 48, 32, 16

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }

# 1. Locate a headless browser to rasterize the SVG master.
$browser = $null
foreach ($p in @(
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
)) {
    if (Test-Path $p) { $browser = $p; break }
}
if (-not $browser) { throw 'Need Chrome or Edge installed to rasterize the SVG.' }

# 2. Wrap the SVG in a transparent HTML page so headless Chrome can screenshot it.
$wrapper = Join-Path $PSScriptRoot '_render_wrapper.html'
@'
<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent;}
img{display:block;width:100vw;height:100vh;}
</style></head>
<body><img src="icon.svg"></body></html>
'@ | Set-Content -Path $wrapper -Encoding UTF8

try {
    $uri = ([Uri](Resolve-Path $wrapper).Path).AbsoluteUri
    $masterPath = Join-Path $OutDir 'icon-1024.png'
    Write-Host "-> $masterPath (1024px, headless $(Split-Path $browser -Leaf))"
    & $browser --headless=new --disable-gpu --hide-scrollbars `
        --default-background-color=00000000 --force-device-scale-factor=1 `
        "--screenshot=$masterPath" '--window-size=1024,1024' $uri 2>&1 | Out-Null
    if (-not (Test-Path $masterPath)) { throw "Headless browser did not produce $masterPath" }

    # 3. Downscale to all other sizes from the 1024 master.
    Add-Type -AssemblyName System.Drawing
    $src = [System.Drawing.Image]::FromFile($masterPath)
    try {
        foreach ($s in $sizes | Where-Object { $_ -ne 1024 }) {
            $out = Join-Path $OutDir ("icon-{0}.png" -f $s)
            Write-Host "-> $out (${s}px, bicubic downscale)"
            $bmp = New-Object System.Drawing.Bitmap $s, $s
            $g = [System.Drawing.Graphics]::FromImage($bmp)
            try {
                $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $g.Clear([System.Drawing.Color]::Transparent)
                $g.DrawImage($src, 0, 0, $s, $s)
            } finally {
                $g.Dispose()
            }
            $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
            $bmp.Dispose()
        }
    } finally {
        $src.Dispose()
    }
} finally {
    Remove-Item $wrapper -ErrorAction SilentlyContinue
}

Write-Host "`nDone. Sanity-check the 16px render -- it's the one that matters most."
