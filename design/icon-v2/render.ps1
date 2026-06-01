# Render icon.svg → PNGs at the sizes Chrome / Edge require.
# Requires ImageMagick (`magick`) or Inkscape (`inkscape`) on PATH.
#
# Usage:
#   ./render.ps1                 # writes to ../../icons/  (replaces shipped icons)
#   ./render.ps1 -OutDir preview # writes to ./preview/   (review before replacing)

[CmdletBinding()]
param(
    [string]$OutDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..\icons')).Path
)

$ErrorActionPreference = 'Stop'
$svg   = Join-Path $PSScriptRoot 'icon.svg'
$sizes = 16, 32, 48, 128, 1024

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }

$tool = $null
if   (Get-Command magick   -ErrorAction SilentlyContinue) { $tool = 'magick' }
elseif (Get-Command inkscape -ErrorAction SilentlyContinue) { $tool = 'inkscape' }
else { throw 'Need ImageMagick (magick) or Inkscape (inkscape) on PATH.' }

foreach ($s in $sizes) {
    $out = Join-Path $OutDir ("icon-{0}.png" -f $s)
    Write-Host "→ $out ($($s)px, $tool)"
    if ($tool -eq 'magick') {
        & magick -background none -density 1024 $svg -resize "${s}x${s}" $out
    } else {
        & inkscape $svg --export-type=png --export-filename=$out -w $s -h $s | Out-Null
    }
}

Write-Host "`nDone. Sanity-check the 16px render — it's the one that matters most."
