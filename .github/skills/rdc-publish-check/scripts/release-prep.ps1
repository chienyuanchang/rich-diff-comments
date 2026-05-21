# Prepare a release folder under releases/<version>/ containing the
# packaged zip for Chrome / Edge submission.
#
# Submission copy (titles, descriptions, justifications, reviewer notes,
# search terms, "what's new") is maintained directly in the canonical
# docs at .github/skills/rdc-publish-check/templates/CHROME_SUBMISSION.md
# and .github/skills/rdc-publish-check/templates/EDGE_SUBMISSION.md.
# Update those in-place each release (bump {{VERSION}}, update
# {{CHANGELOG}}, fill submission notes); the git history of those two
# files is the audit trail for what was submitted when.
#
# Run from the repository root.
#
# Usage:
#   .\.github\skills\rdc-publish-check\scripts\release-prep.ps1
#       Builds the zip (via package.ps1), creates releases/<version>/,
#       moves the zip in.
#
#   .\.github\skills\rdc-publish-check\scripts\release-prep.ps1 -Force
#       Overwrites releases/<version>/ if it already exists.
#
#   .\.github\skills\rdc-publish-check\scripts\release-prep.ps1 -SkipBuild
#       Skips running package.ps1 (assumes rdc-<version>.zip already
#       exists at the extension root).

[CmdletBinding()]
param(
  [switch]$Force,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = (Resolve-Path (Join-Path $scriptDir "..\..\..\..")).Path
Push-Location $root

try {
  # ── Read version ──────────────────────────────────────────────────────
  if (-not (Test-Path "manifest.json")) {
    throw "manifest.json not found at $root"
  }
  $manifest = Get-Content "manifest.json" -Raw | ConvertFrom-Json
  $version = $manifest.version
  Write-Host "Preparing release artifacts for v$version" -ForegroundColor Cyan

  $releaseDir = Join-Path "releases" $version
  if (Test-Path $releaseDir) {
    if ($Force) {
      Write-Host "  removing existing $releaseDir (--Force)" -ForegroundColor Yellow
      Remove-Item -Recurse -Force $releaseDir
    } else {
      throw "releases/$version already exists. Re-run with -Force to overwrite."
    }
  }
  New-Item -ItemType Directory -Path $releaseDir | Out-Null
  Write-Host "  created $releaseDir"

  # ── Build (or locate) the zip ────────────────────────────────────────
  $zipName = "rdc-$version.zip"
  $zipAtRoot = Join-Path $root $zipName

  if (-not $SkipBuild) {
    Write-Host "  building $zipName via .\scripts\package.ps1" -ForegroundColor Cyan
    & (Join-Path $root "scripts\package.ps1") | Out-Host
    if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne $null) {
      throw "package.ps1 failed (exit $LASTEXITCODE)"
    }
  }

  if (-not (Test-Path $zipAtRoot)) {
    throw "expected $zipAtRoot does not exist. Re-run without -SkipBuild, or build manually first."
  }

  Move-Item -Force $zipAtRoot (Join-Path $releaseDir $zipName)
  Write-Host "  moved zip -> $releaseDir\$zipName"

  # ── Done ─────────────────────────────────────────────────────────────
  Write-Host ""
  Write-Host "Release folder ready: $releaseDir" -ForegroundColor Green
  Write-Host "  Contents:" -ForegroundColor DarkGray
  Get-ChildItem $releaseDir | ForEach-Object {
    $size = if ($_.PSIsContainer) { "" } else { " ($([math]::Round($_.Length / 1KB, 1)) KB)" }
    Write-Host "    $($_.Name)$size" -ForegroundColor DarkGray
  }
  Write-Host ""
  Write-Host "Next steps:"
  Write-Host "  1. Verify the canonical submission docs are up to date for v$version :"
  Write-Host "       .github\skills\rdc-publish-check\templates\CHROME_SUBMISSION.md"
  Write-Host "       .github\skills\rdc-publish-check\templates\EDGE_SUBMISSION.md"
  Write-Host "     (version stamp, changelog block, submission notes.)"
  Write-Host "  2. Upload $releaseDir\$zipName to the Chrome Web Store Developer Console;"
  Write-Host "     paste sections from the Chrome template into the listing form."
  Write-Host "  3. Repeat for Edge Add-ons using the Edge template."
}
finally {
  Pop-Location
}

