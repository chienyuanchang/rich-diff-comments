# Resize screenshots to store-listing dimensions.
#
# Both Chrome Web Store and Microsoft Edge Add-ons require screenshots at
# exactly 1280x800 (or 640x400). Captures taken on high-DPI displays often
# come out at 2x (e.g. 2560x1600), which need to be downscaled before upload.
#
# Run from the repository root.
#
# Usage:
#   .\.github\skills\rdc-publish-check\scripts\resize-screenshots.ps1
#       Resizes every *.png in design\screenshots\ to 1280x800 and writes
#       them to design\screenshots\1280x800\. Originals are preserved.
#
#   .\.github\skills\rdc-publish-check\scripts\resize-screenshots.ps1 -InputDir other\dir
#       Use a different source directory.
#
#   .\.github\skills\rdc-publish-check\scripts\resize-screenshots.ps1 -Width 640 -Height 400
#       Use a different target size (e.g. the smaller 640x400 store option).
#
#   .\.github\skills\rdc-publish-check\scripts\resize-screenshots.ps1 -Force
#       Overwrite existing files in the output folder.

[CmdletBinding()]
param(
  [string]$InputDir = "design\screenshots",
  [int]$Width = 1280,
  [int]$Height = 800,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = (Resolve-Path (Join-Path $scriptDir "..\..\..\..")).Path
Push-Location $root

try {
  if (-not (Test-Path $InputDir)) {
    throw "input directory not found: $InputDir (relative to $root)"
  }

  $targetName = "${Width}x${Height}"

  # Locate the source PNGs. Two supported layouts:
  #   (a) PNGs sit directly inside $InputDir
  #         design/screenshots/screenshot_1.png …
  #   (b) PNGs are organised by capture resolution in a subfolder
  #         design/screenshots/2560x1600/screenshot_1.png …
  #         design/screenshots/1280x800/screenshot_1.png   ← skip this (output)
  # Scan one level deep, excluding any folder whose name matches the target
  # output dimensions to avoid recursively re-processing previous output.
  $srcFiles = @(Get-ChildItem $InputDir -Filter "*.png" -File)
  if ($srcFiles.Count -eq 0) {
    $candidateDirs = Get-ChildItem $InputDir -Directory | Where-Object { $_.Name -ne $targetName }
    # Prefer the largest-dimension subfolder name as the canonical source
    $candidateDirs = $candidateDirs | Sort-Object { ($_.Name -split 'x' | Measure-Object -Maximum -Property Length).Maximum } -Descending
    foreach ($d in $candidateDirs) {
      $found = @(Get-ChildItem $d.FullName -Filter "*.png" -File)
      if ($found.Count -gt 0) {
        Write-Host "Using source subfolder: $($d.FullName.Substring($root.Length + 1))" -ForegroundColor DarkGray
        $srcFiles = $found
        break
      }
    }
  }

  if ($srcFiles.Count -eq 0) {
    Write-Host "No *.png files found in $InputDir (or any first-level subfolder)" -ForegroundColor Yellow
    return
  }

  $outDir = Join-Path $InputDir $targetName
  if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir | Out-Null
    Write-Host "  created $outDir" -ForegroundColor DarkGray
  }

  Add-Type -AssemblyName System.Drawing

  Write-Host "Resizing $($srcFiles.Count) screenshot(s) to ${Width}x${Height}:" -ForegroundColor Cyan
  $resized = 0
  $skipped = 0

  foreach ($f in $srcFiles) {
    $outPath = Join-Path $outDir $f.Name
    if ((Test-Path $outPath) -and -not $Force) {
      Write-Host "  [skip] $($f.Name) (already exists; pass -Force to overwrite)" -ForegroundColor DarkGray
      $skipped++
      continue
    }

    $src = [System.Drawing.Image]::FromFile($f.FullName)
    try {
      $srcW = $src.Width
      $srcH = $src.Height
      $bmp = New-Object System.Drawing.Bitmap $Width, $Height
      try {
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try {
          $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
          $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
          $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
          $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
          $g.DrawImage($src, 0, 0, $Width, $Height)
          $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
        }
        finally { $g.Dispose() }
      }
      finally { $bmp.Dispose() }
    }
    finally { $src.Dispose() }

    $newSize = (Get-Item $outPath).Length
    $note = if ($srcW -eq $Width -and $srcH -eq $Height) { "(already target size, just re-encoded)" } else { "from ${srcW}x${srcH}" }
    Write-Host ("  [ok]   {0,-28} {1:N1} KB  {2}" -f $f.Name, ($newSize / 1KB), $note) -ForegroundColor Green
    $resized++
  }

  Write-Host ""
  Write-Host "Output folder: $outDir" -ForegroundColor Cyan
  Write-Host "  $resized resized, $skipped skipped" -ForegroundColor DarkGray
  Write-Host ""
  Write-Host "Next: upload the files in $outDir to the store dashboards."
}
finally {
  Pop-Location
}
