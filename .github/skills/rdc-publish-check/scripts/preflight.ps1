# Pre-publish audit for Markdown PR Comments for GitHub.
#
# Run from the repository root.
#
# Usage:
#   .\.github\skills\rdc-publish-check\scripts\preflight.ps1
#   .\.github\skills\rdc-publish-check\scripts\preflight.ps1 -Verbose
#   .\.github\skills\rdc-publish-check\scripts\preflight.ps1 -VerifyZip .\rdc-1.0.0.zip
#
# Exits 0 if all checks pass, non-zero otherwise.

[CmdletBinding()]
param(
  [string]$VerifyZip
)

$ErrorActionPreference = "Stop"

# Locate the extension root (two parents up from this script).
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = (Resolve-Path (Join-Path $scriptDir "..\..\..\..")).Path
Push-Location $root

$issues = @()
$warnings = @()

function Pass($msg) { Write-Host "  [OK]   $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "  [FAIL] $msg" -ForegroundColor Red; $script:issues += $msg }
function Warn($msg) { Write-Host "  [WARN] $msg" -ForegroundColor Yellow; $script:warnings += $msg }
function Section($title) { Write-Host ""; Write-Host "== $title ==" -ForegroundColor Cyan }

try {
  Section "Manifest"

  if (-not (Test-Path "manifest.json")) {
    Fail "manifest.json not found at $root"
    throw "Missing manifest"
  }

  $manifest = Get-Content "manifest.json" -Raw | ConvertFrom-Json
  $version = $manifest.version
  Pass "version: $version"
  Pass "name: $($manifest.name)"

  if (-not $manifest.description) { Fail "manifest.description is empty" }
  if (-not $manifest.icons -or -not $manifest.icons."128") {
    Warn "manifest.icons.128 not declared — Chrome's store listing uses the dashboard-uploaded icon, but a declared 128px icon is recommended for the in-browser extensions list"
  }

  # ── VerifyZip mode short-circuits the rest of the checks ──────────────
  if ($VerifyZip) {
    Section "Verify zip: $VerifyZip"
    if (-not (Test-Path $VerifyZip)) {
      Fail "zip not found: $VerifyZip"
      throw "Missing zip"
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $VerifyZip).Path)
    try {
      $entries = $zip.Entries | ForEach-Object { $_.FullName }
      Write-Verbose ("zip entries:`n" + ($entries -join "`n"))

      if ($entries -notcontains "manifest.json") {
        Fail "manifest.json not at zip top level (Chrome rejects nested manifests)"
      } else {
        Pass "manifest.json is at zip top level"
      }

      # Must include all content_scripts.js entries
      foreach ($cs in $manifest.content_scripts) {
        foreach ($js in $cs.js) {
          $normalized = $js -replace '\\', '/'
          if ($entries -notcontains $normalized) {
            Fail "content_scripts entry missing from zip: $js"
          }
        }
      }
      Pass "all content_scripts.js entries are in the zip"

      # Forbidden dev-only entries
      $forbidden = @('tests/', 'docs/', 'test_md_files/', 'design/', 'node_modules/', 'package.json', 'package-lock.json', '.git/', 'local-only/', '_local_only/', '.github/')
      foreach ($f in $forbidden) {
        $hit = $entries | Where-Object { $_ -like "$f*" }
        if ($hit) {
          Fail "dev-only path leaked into zip: $f (found $($hit.Count) entr$(if ($hit.Count -eq 1) { 'y' } else { 'ies' }))"
        }
      }
      if (-not $issues) { Pass "no dev-only paths leaked into zip" }
    }
    finally {
      $zip.Dispose()
    }

    # Skip remaining checks
    Section "Summary"
    if ($issues) {
      Write-Host "$($issues.Count) FAILURE(s)" -ForegroundColor Red
      exit 1
    } else {
      Write-Host "zip looks good" -ForegroundColor Green
      exit 0
    }
  }

  # ── Permissions audit (the rule that rejected 1.0.2) ──────────────────
  Section "Permissions audit"

  $perms = @($manifest.permissions | Where-Object { $_ -and $_.ToString().Trim() })
  if ($perms.Count -eq 0) {
    Pass "no permissions declared (good — minimum necessary)"
  } else {
    foreach ($p in $perms) {
      # Generate plausible chrome.* API patterns for this permission.
      # Most permissions correspond to a chrome.<perm>.* namespace, but a
      # few have aliases (e.g. activeTab is gated by chrome.tabs.* AND
      # chrome.scripting.executeScript). Keep the pattern broad and let
      # a human review the matches if needed.
      $patterns = switch -Regex ($p) {
        '^activeTab$'    { 'chrome\.(tabs|scripting)\.' ; break }
        '^scripting$'    { 'chrome\.scripting\.'        ; break }
        '^storage$'      { 'chrome\.storage\.'          ; break }
        '^cookies$'      { 'chrome\.cookies\.'          ; break }
        '^webRequest$'   { 'chrome\.webRequest\.'       ; break }
        '^notifications$'{ 'chrome\.notifications\.'    ; break }
        '^tabs$'         { 'chrome\.tabs\.'             ; break }
        '^contextMenus$' { 'chrome\.contextMenus\.'     ; break }
        '^alarms$'       { 'chrome\.alarms\.'           ; break }
        default          { "chrome\.${p}\." }
      }

      $hit = Select-String -Path "content.js","src\lib\*.js" -Pattern $patterns 2>$null `
        | Where-Object { $_.Line -notmatch '^\s*//' -and $_.Line -notmatch '^\s*\*' }

      if ($hit) {
        $where = ($hit | Select-Object -First 3 | ForEach-Object { "$($_.Filename):$($_.LineNumber)" }) -join ", "
        Pass "permission '$p' is used ($where$(if ($hit.Count -gt 3) { ", +$($hit.Count - 3) more" }))"
      } else {
        Fail "permission '$p' is declared but no matching chrome.* call found in code — this is the violation that rejected 1.0.2"
      }
    }
  }

  # host_permissions: must have at least one fetch() to a matching origin.
  $hostPerms = @($manifest.host_permissions | Where-Object { $_ -and $_.ToString().Trim() })
  if ($hostPerms.Count -eq 0) {
    Warn "no host_permissions declared — content script same-origin fetches may be blocked"
  } else {
    foreach ($hp in $hostPerms) {
      # Strip the URL pattern to a host substring (e.g. https://github.com/* -> github.com)
      $hpHost = $hp -replace '^https?://', '' -replace '/.*$', '' -replace '\*\.?', ''
      if (-not $hpHost) { continue }
      $hit = Select-String -Path "content.js","src\lib\*.js" -Pattern "fetch\([^)]*${hpHost}|fetch\([^)]*['""]/" 2>$null `
        | Where-Object { $_.Line -notmatch '^\s*//' -and $_.Line -notmatch '^\s*\*' }
      if ($hit) {
        Pass "host_permission '$hp' is used by fetch() ($($hit.Count) call$(if ($hit.Count -ne 1) { 's' }))"
      } else {
        Warn "host_permission '$hp' present but no fetch() call to '$hpHost' detected (review manually)"
      }
    }
  }

  # ── Required files ───────────────────────────────────────────────────
  Section "Required files"

  $required = @("manifest.json", "content.js", "styles.css", "PRIVACY.md")
  foreach ($r in $required) {
    if (Test-Path $r) { Pass "$r exists" } else { Fail "$r missing" }
  }

  # All content_scripts.js entries must exist
  foreach ($cs in $manifest.content_scripts) {
    foreach ($js in $cs.js) {
      if (Test-Path $js) { Pass "content_scripts entry: $js" } else { Fail "content_scripts entry missing: $js" }
    }
  }

  # All declared icons must exist
  if ($manifest.icons) {
    foreach ($size in $manifest.icons.PSObject.Properties.Name) {
      $iconPath = $manifest.icons.$size
      if (Test-Path $iconPath) { Pass "icon $size : $iconPath" } else { Fail "icon $size missing: $iconPath" }
    }
  }

  # ── Tests ────────────────────────────────────────────────────────────
  Section "Tests"

  if (Test-Path "tests") {
    $testFiles = Get-ChildItem "tests\*.test.js" -ErrorAction SilentlyContinue
    if ($testFiles) {
      Write-Verbose "running $($testFiles.Count) test files"
      $testResult = & node --test ($testFiles.FullName) 2>&1
      $testExit = $LASTEXITCODE
      if ($testExit -eq 0) {
        $passCount = ($testResult | Select-String -Pattern '^# pass (\d+)' | ForEach-Object { $_.Matches[0].Groups[1].Value }) -join ""
        Pass "test suite passed ($passCount tests)"
      } else {
        Fail "test suite failed (exit $testExit) — run 'node --test tests/*.test.js' to see details"
        Write-Verbose ($testResult -join "`n")
      }
    } else {
      Warn "tests/ directory exists but no *.test.js files found"
    }
  } else {
    Warn "no tests/ directory"
  }

  # ── Version sanity ──────────────────────────────────────────────────
  Section "Version sanity"

  # Look for a matching CHANGELOG entry
  if (Test-Path "CHANGELOG.md") {
    $changelog = Get-Content "CHANGELOG.md" -Raw
    if ($changelog -match "##\s*\[$([regex]::Escape($version))\]") {
      Pass "CHANGELOG.md has an entry for $version"
    } else {
      Warn "CHANGELOG.md has no entry for $version — add a '## [$version] — <date>' section before publishing"
    }
  } else {
    Warn "no CHANGELOG.md at repo root"
  }

  # Compare against git tags (vX.Y.Z) if any
  $tags = & git tag --list "v*" 2>$null
  if ($tags) {
    $latestTag = ($tags | ForEach-Object { $_.TrimStart('v') } | Sort-Object { [version]$_ } -ErrorAction SilentlyContinue) `
      | Select-Object -Last 1
    if ($latestTag) {
      try {
        $cmp = [version]$version - [version]$latestTag
      } catch {
        $cmp = $null
      }
      if ([version]$version -gt [version]$latestTag) {
        Pass "manifest version $version is greater than latest tag v$latestTag"
      } elseif ([version]$version -eq [version]$latestTag) {
        Warn "manifest version $version matches latest tag v$latestTag — bump before publishing (Chrome rejects duplicate versions)"
      } else {
        Fail "manifest version $version is BELOW latest tag v$latestTag — Chrome will reject upload"
      }
    }
  } else {
    Write-Verbose "no v* git tags found, skipping tag comparison"
  }
}
finally {
  Pop-Location
}

# ── Summary ────────────────────────────────────────────────────────────
Section "Summary"

if ($issues.Count -eq 0 -and $warnings.Count -eq 0) {
  Write-Host "READY TO PACKAGE" -ForegroundColor Green
  Write-Host "Next step: .\scripts\package.ps1"
  exit 0
} elseif ($issues.Count -eq 0) {
  Write-Host "READY TO PACKAGE (with $($warnings.Count) warning(s) — review above)" -ForegroundColor Yellow
  Write-Host "Next step: .\scripts\package.ps1"
  exit 0
} else {
  Write-Host "$($issues.Count) FAILURE(s) — fix before packaging:" -ForegroundColor Red
  $issues | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  exit 1
}
