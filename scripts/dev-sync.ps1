# scripts/dev-sync.ps1
#
# Copies the shared source-of-truth files into an extension target folder
# so Chrome / Edge can load the folder directly. Runs before package.ps1
# and any time you edit src/lib/* while an extension is dev-loaded.
#
# Why: Chromium requires all files a manifest references to live at or
# below the manifest's folder. Our shared src/lib/*.js and PRIVACY.md
# live at the repo root as the single source of truth. This script
# mirrors them into extensions/<target>/ at build/dev time. The mirrored
# copies are git-ignored via .gitignore.
#
# Usage:
#   .\scripts\dev-sync.ps1                    # syncs the github target (default)
#   .\scripts\dev-sync.ps1 -Target github
#   .\scripts\dev-sync.ps1 -Target ado        # (future - target folder must exist)
#
# Exit codes: 0 on success, non-zero on failure.

param(
  [ValidateSet('github', 'ado')]
  [string]$Target = 'github'
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$targetDir = Join-Path $root "extensions\$Target"

if (-not (Test-Path $targetDir)) {
  Write-Error "Target folder does not exist: $targetDir"
  exit 1
}

Push-Location $root
try {
  # src/lib mirror
  $srcLib = Join-Path $root 'src\lib'
  $dstLib = Join-Path $targetDir 'src\lib'

  if (-not (Test-Path $srcLib)) {
    Write-Error "Source folder does not exist: $srcLib"
    exit 1
  }

  if (Test-Path $dstLib) {
    Remove-Item -Recurse -Force $dstLib
  }
  New-Item -ItemType Directory -Path $dstLib -Force | Out-Null

  $libFiles = Get-ChildItem -Path $srcLib -Filter '*.js' -File
  foreach ($f in $libFiles) {
    Copy-Item -Path $f.FullName -Destination $dstLib -Force
  }

  $suffix = if ($libFiles.Count -ne 1) { 's' } else { '' }
  $relDst = $dstLib.Replace($root, '.')
  Write-Host "[dev-sync] $Target : $($libFiles.Count) src/lib file$suffix copied -> $relDst"

  # PRIVACY.md mirror
  $srcPrivacy = Join-Path $root 'PRIVACY.md'
  if (Test-Path $srcPrivacy) {
    Copy-Item -Path $srcPrivacy -Destination (Join-Path $targetDir 'PRIVACY.md') -Force
    Write-Host "[dev-sync] $Target : PRIVACY.md copied"
  } else {
    Write-Warning "[dev-sync] PRIVACY.md not found at repo root - extension will ship without it"
  }
}
finally {
  Pop-Location
}
