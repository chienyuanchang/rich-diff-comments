# Usage:  .\scripts\package.ps1 [-Output path/to/rdc.zip]
#
# Builds a publish-ready zip for Chrome Web Store / Edge Add-ons.
# See docs/PUBLISHING.md for the surrounding workflow.

param([string]$Output)

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  $manifest = Get-Content "manifest.json" -Raw | ConvertFrom-Json
  if (-not $Output) {
    $Output = "rdc-$($manifest.version).zip"
  }
  if (Test-Path $Output) { Remove-Item $Output }

  $include = @(
    "manifest.json",
    "content.js",
    "styles.css",
    "src",
    "icons",
    "PRIVACY.md"
  ) | Where-Object { Test-Path $_ }

  Compress-Archive -Path $include -DestinationPath $Output -Force

  $size = (Get-Item $Output).Length
  Write-Host "Built $Output ($([math]::Round($size / 1KB, 1)) KB)"
  Write-Host "  Contents:" -ForegroundColor DarkGray
  $include | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
}
finally {
  Pop-Location
}
