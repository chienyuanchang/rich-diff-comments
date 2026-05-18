# Prepare a release folder under releases/<version>/ for Chrome and Edge
# submission.
#
# Run from the repository root.
#
# Usage:
#   .\.github\skills\rdc-publish-check\scripts\release-prep.ps1
#       Builds the zip (via package.ps1), creates releases/<version>/,
#       moves the zip in, and generates CHROME_SUBMISSION.md and
#       EDGE_SUBMISSION.md from templates with the current version + the
#       matching CHANGELOG entry baked in.
#
#   .\.github\skills\rdc-publish-check\scripts\release-prep.ps1 -Force
#       Overwrites releases/<version>/ if it already exists.
#
#   .\.github\skills\rdc-publish-check\scripts\release-prep.ps1 -SkipBuild
#       Skips running package.ps1 (assumes rdc-<version>.zip already
#       exists at the extension root or already in the release folder).

[CmdletBinding()]
param(
  [switch]$Force,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$skillDir = (Resolve-Path (Join-Path $scriptDir "..")).Path
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
    if ($LASTEXITCODE -ne 0) {
      throw "package.ps1 failed (exit $LASTEXITCODE)"
    }
  }

  if (-not (Test-Path $zipAtRoot)) {
    throw "expected $zipAtRoot does not exist. Re-run without -SkipBuild, or build manually first."
  }

  Move-Item -Force $zipAtRoot (Join-Path $releaseDir $zipName)
  Write-Host "  moved zip -> $releaseDir\$zipName"

  # ── Extract the matching CHANGELOG entry ─────────────────────────────
  $changelogSnippet = ""
  if (Test-Path "CHANGELOG.md") {
    $cl = Get-Content "CHANGELOG.md" -Raw
    # Match `## [<version>] — <date>` (em-dash) through the next `## ` heading.
    $pattern = '(?ms)^##\s*\[' + [regex]::Escape($version) + '\][^\n]*\n(.*?)(?=^##\s|\z)'
    $m = [regex]::Match($cl, $pattern)
    if ($m.Success) {
      $changelogSnippet = $m.Groups[1].Value.Trim()
    } else {
      Write-Host "  [WARN] no CHANGELOG entry found for $version" -ForegroundColor Yellow
      $changelogSnippet = "_See [CHANGELOG.md](../../CHANGELOG.md) — entry for $version was not auto-extracted._"
    }
  } else {
    $changelogSnippet = "_No CHANGELOG.md found at repo root._"
  }

  # ── Render templates ─────────────────────────────────────────────────
  $templates = @{
    "CHROME_SUBMISSION.md" = Join-Path $skillDir "templates\CHROME_SUBMISSION.md"
    "EDGE_SUBMISSION.md"   = Join-Path $skillDir "templates\EDGE_SUBMISSION.md"
  }

  foreach ($outName in $templates.Keys) {
    $tmplPath = $templates[$outName]
    if (-not (Test-Path $tmplPath)) {
      throw "template missing: $tmplPath"
    }
    $content = Get-Content $tmplPath -Raw
    $content = $content.Replace("{{VERSION}}", $version)
    $content = $content.Replace("{{CHANGELOG}}", $changelogSnippet)

    $outPath = Join-Path $releaseDir $outName
    Set-Content -Path $outPath -Value $content -Encoding UTF8
    Write-Host "  wrote $outPath"
  }

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
  Write-Host "  1. Upload $releaseDir\$zipName to the Chrome Web Store Developer Console"
  Write-Host "  2. Paste sections from $releaseDir\CHROME_SUBMISSION.md into the listing form"
  Write-Host "  3. Repeat for Edge Add-ons using $releaseDir\EDGE_SUBMISSION.md"
}
finally {
  Pop-Location
}
