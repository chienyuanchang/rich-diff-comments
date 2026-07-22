# Usage:  .\scripts\package.ps1 [-Target github|ado] [-Output path/to/rdc.zip]
#
# Builds a publish-ready zip for Chrome Web Store / Edge Add-ons.
#
# Runs dev-sync.ps1 first to ensure the target folder has the latest
# shared src/lib/*.js and PRIVACY.md mirrored in, then packages
# extensions/<target>/ so the zip contents are exactly what Chrome sees
# when the folder is dev-loaded.
#
# See docs/PUBLISHING.md for the surrounding workflow.

param(
  [ValidateSet('github', 'ado')]
  [string]$Target = 'github',
  [string]$Output
)

$root = Split-Path -Parent $PSScriptRoot
$targetDir = Join-Path $root "extensions\$Target"

if (-not (Test-Path $targetDir)) {
  Write-Error "Target folder does not exist: $targetDir"
  exit 1
}

# Refresh mirrored files (src/lib, PRIVACY.md) before packaging.
& (Join-Path $PSScriptRoot 'dev-sync.ps1') -Target $Target
if (-not $?) {
  Write-Error "dev-sync.ps1 failed"
  exit 1
}

Push-Location $targetDir
try {
  $manifest = Get-Content "manifest.json" -Raw | ConvertFrom-Json

  if (-not $Output) {
    # Default output lands at repo root (same as before the refactor).
    $Output = Join-Path $root "rdc-$($manifest.version).zip"
  } elseif (-not [System.IO.Path]::IsPathRooted($Output)) {
    # Relative -Output paths resolve against the repo root, not the target folder.
    $Output = Join-Path $root $Output
  }

  if (Test-Path $Output) { Remove-Item $Output }

  # Everything Chrome / Edge expects at the zip top level.
  #   manifest.json / content.js / styles.css / icons/  ← physically moved here
  #   src/lib/*.js / PRIVACY.md                          ← mirrored by dev-sync
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
  Write-Host "Built $Output ($([math]::Round($size / 1KB, 1)) KB) from extensions\$Target"
  Write-Host "  Contents:" -ForegroundColor DarkGray
  $include | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
}
finally {
  Pop-Location
}
