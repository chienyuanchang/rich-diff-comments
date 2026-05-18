<#
.SYNOPSIS
  Tag the current commit and create a GitHub Release with the packaged zip,
  a SHA256 checksum, and release notes auto-extracted from CHANGELOG.md.

.DESCRIPTION
  Run after `release-prep.ps1` has produced `releases/<version>/rdc-<version>.zip`.
  This script:
    1. Reads the version from manifest.json.
    2. Verifies the zip exists at the expected path.
    3. Creates an annotated git tag `v<version>` if one doesn't exist locally.
    4. Pushes the tag to `origin` (skip with -SkipPush).
    5. Extracts the matching `## [<version>]` section from CHANGELOG.md into
       `releases/<version>/RELEASE_NOTES.md`.
    6. Generates a SHA256 of the zip into `releases/<version>/rdc-<version>.zip.sha256`.
    7. Calls `gh release create` with the zip + checksum attached and the
       extracted notes as the release body.

  Requires the GitHub CLI (`gh`) to be installed and authenticated against the
  account that owns the repo. Run `gh auth login` first if needed.

.PARAMETER SkipPush
  Don't `git push` the tag. Useful for dry runs.

.PARAMETER SkipRelease
  Stop after preparing the notes + checksum + tag, don't call `gh release create`.
  Useful if you want to inspect RELEASE_NOTES.md before the release goes live.

.PARAMETER Force
  Overwrite an existing RELEASE_NOTES.md / .sha256 file in the release folder.

.PARAMETER Draft
  Create the GitHub Release as a draft (visible only to maintainers until published).

.EXAMPLE
  .\.github\skills\rdc-publish-check\scripts\github-release.ps1
  Tag, push, and publish the release.

.EXAMPLE
  .\.github\skills\rdc-publish-check\scripts\github-release.ps1 -Draft
  Tag, push, and publish as a draft for manual review before going live.

.EXAMPLE
  .\.github\skills\rdc-publish-check\scripts\github-release.ps1 -SkipRelease
  Just prepare the notes + checksum + tag locally, don't touch GitHub.
#>
[CmdletBinding()]
param(
  [switch]$SkipPush,
  [switch]$SkipRelease,
  [switch]$Force,
  [switch]$Draft
)

$ErrorActionPreference = 'Stop'

# Find repo root (script lives at .github/skills/rdc-publish-check/scripts/)
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')
Set-Location $repoRoot

$manifestPath = Join-Path $repoRoot 'manifest.json'
if (-not (Test-Path $manifestPath)) {
  throw "manifest.json not found at $manifestPath"
}
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$version = $manifest.version
$tag = "v$version"

Write-Host "Preparing GitHub Release for $tag" -ForegroundColor Cyan

$releaseDir = Join-Path $repoRoot "releases\$version"
$zipPath = Join-Path $releaseDir "rdc-$version.zip"
if (-not (Test-Path $zipPath)) {
  throw "Zip not found at $zipPath. Run release-prep.ps1 first."
}
Write-Host "  zip: $zipPath ($([math]::Round((Get-Item $zipPath).Length / 1KB, 1)) KB)"

# --- Extract release notes from CHANGELOG.md ---
$notesPath = Join-Path $releaseDir 'RELEASE_NOTES.md'
if ((Test-Path $notesPath) -and -not $Force) {
  Write-Host "  notes: reusing existing $notesPath (use -Force to regenerate)"
} else {
  $changelog = Get-Content (Join-Path $repoRoot 'CHANGELOG.md') -Raw
  $escapedVersion = [regex]::Escape($version)
  $pattern = "(?ms)(^## \[$escapedVersion\][^\n]*\n.*?)(?=^## \[|\z)"
  if ($changelog -notmatch $pattern) {
    throw "No '## [$version]' section found in CHANGELOG.md. Add an entry before releasing."
  }
  $matches[1].TrimEnd() | Out-File -Encoding utf8 $notesPath
  Write-Host "  notes: wrote $notesPath"
}

# --- Generate SHA256 ---
$shaPath = "$zipPath.sha256"
if ((Test-Path $shaPath) -and -not $Force) {
  Write-Host "  sha256: reusing existing $shaPath (use -Force to regenerate)"
} else {
  (Get-FileHash $zipPath -Algorithm SHA256).Hash | Out-File -Encoding ascii $shaPath
  Write-Host "  sha256: wrote $shaPath"
}

# --- Create git tag ---
$existingTag = git tag --list $tag
if ($existingTag) {
  Write-Host "  tag: $tag already exists locally, skipping create"
} else {
  git tag -a $tag -m "$tag - see CHANGELOG.md" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "git tag failed" }
  Write-Host "  tag: created $tag"
}

# --- Push tag ---
if ($SkipPush) {
  Write-Host "  push: skipped (-SkipPush)"
} else {
  $remoteTags = git ls-remote --tags origin "refs/tags/$tag" 2>$null
  if ($remoteTags) {
    Write-Host "  push: $tag already on origin, skipping"
  } else {
    git push origin $tag
    if ($LASTEXITCODE -ne 0) { throw "git push failed" }
    Write-Host "  push: pushed $tag to origin"
  }
}

# --- Create GitHub Release ---
if ($SkipRelease) {
  Write-Host ""
  Write-Host "Skipped GitHub Release creation (-SkipRelease)." -ForegroundColor Yellow
  Write-Host "To publish manually, run:" -ForegroundColor Yellow
  Write-Host "  gh release create $tag $zipPath $shaPath --title `"$tag`" --notes-file $notesPath" -ForegroundColor Yellow
  return
}

# Confirm gh is installed and authenticated
$ghCheck = & gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "gh CLI is not authenticated. Run 'gh auth login' first, then re-run this script." -ForegroundColor Red
  Write-Host "Make sure to log in with the account that owns the repo (not your work / EMU account)." -ForegroundColor Red
  exit 1
}

# Check if a release for this tag already exists
$existingRelease = & gh release view $tag 2>&1
if ($LASTEXITCODE -eq 0) {
  Write-Host ""
  Write-Host "A GitHub Release for $tag already exists." -ForegroundColor Yellow
  Write-Host "Delete it manually with 'gh release delete $tag' if you want to recreate." -ForegroundColor Yellow
  exit 0
}

$ghArgs = @('release', 'create', $tag, $zipPath, $shaPath,
            '--title', "$tag",
            '--notes-file', $notesPath)
if ($Draft) { $ghArgs += '--draft' }

Write-Host ""
Write-Host "Creating GitHub Release..."
& gh @ghArgs
if ($LASTEXITCODE -ne 0) { throw "gh release create failed" }

Write-Host ""
Write-Host "Release published." -ForegroundColor Green
Write-Host "Next: submit the same zip to the Chrome Web Store and Edge Add-ons." -ForegroundColor Cyan
