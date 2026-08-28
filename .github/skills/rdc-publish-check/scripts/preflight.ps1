# Pre-publish audit for either separate Markdown PR Comments target.
#
# Run from the repository root.
#
# Usage:
#   .\.github\skills\rdc-publish-check\scripts\preflight.ps1
#   .\.github\skills\rdc-publish-check\scripts\preflight.ps1 -Target ado -Verbose
#   .\.github\skills\rdc-publish-check\scripts\preflight.ps1 -Target ado -VerifyZip .\rdc-ado-1.0.0.zip
#
# Exits 0 if all checks pass, non-zero otherwise.

[CmdletBinding()]
param(
  [ValidateSet('github', 'ado')]
  [string]$Target = 'github',
  [string]$VerifyZip
)

$ErrorActionPreference = "Stop"

# Locate the extension root (two parents up from this script).
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = (Resolve-Path (Join-Path $scriptDir "..\..\..\..")).Path
$extPrefix = "extensions\$Target"
$extDir = Join-Path $root $extPrefix
if (-not (Test-Path $extDir)) {
  throw "Target folder does not exist: $extDir"
}

# Ensure the shared src/lib mirror and PRIVACY.md are up to date so
# path checks below find them.
& (Join-Path $root 'scripts\dev-sync.ps1') -Target $Target | Out-Null
if (-not $?) {
  throw "dev-sync.ps1 failed - can't audit an out-of-sync extension folder"
}

Push-Location $root

$issues = @()
$warnings = @()

function Pass($msg) { Write-Host "  [OK]   $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "  [FAIL] $msg" -ForegroundColor Red; $script:issues += $msg }
function Warn($msg) { Write-Host "  [WARN] $msg" -ForegroundColor Yellow; $script:warnings += $msg }
function Section($title) { Write-Host ""; Write-Host "== $title ==" -ForegroundColor Cyan }

try {
  Section "Manifest"

  $manifestPath = Join-Path $extPrefix 'manifest.json'
  if (-not (Test-Path $manifestPath)) {
    Fail "$manifestPath not found"
    throw "Missing manifest"
  }

  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
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
      # Normalize path separators to forward slashes for cross-platform
      # comparison. Compress-Archive on Windows stores entries with
      # backslashes; manifest paths use forward slashes.
      $entries = $zip.Entries | ForEach-Object { $_.FullName -replace '\\', '/' }
      Write-Verbose ("zip entries:`n" + ($entries -join "`n"))

      if ($entries -notcontains "manifest.json") {
        Fail "manifest.json not at zip top level (Chrome rejects nested manifests)"
      } else {
        Pass "manifest.json is at zip top level"

        $manifestEntry = $zip.Entries | Where-Object { ($_.FullName -replace '\\', '/') -eq 'manifest.json' } | Select-Object -First 1
        $reader = New-Object System.IO.StreamReader($manifestEntry.Open())
        try {
          $zipManifest = $reader.ReadToEnd() | ConvertFrom-Json
        }
        finally {
          $reader.Dispose()
        }

        if ($zipManifest.name -eq $manifest.name -and $zipManifest.version -eq $manifest.version) {
          Pass "packaged manifest is $($manifest.name) v$($manifest.version)"
        } else {
          Fail "packaged manifest identity differs from extensions/$Target/manifest.json"
        }

        $sourceHosts = @($manifest.host_permissions) -join "`n"
        $zipHosts = @($zipManifest.host_permissions) -join "`n"
        if ($zipHosts -eq $sourceHosts) {
          Pass "packaged host permissions match the $Target target"
        } else {
          Fail "packaged host permissions do not match the $Target target"
        }
      }

      if ($zipManifest) {
        # Must include all manifest-declared scripts and styles.
        $declaredFilesMissing = $false
        foreach ($cs in $zipManifest.content_scripts) {
          foreach ($asset in @($cs.js) + @($cs.css)) {
            $normalized = $asset -replace '\\', '/'
            if ($entries -notcontains $normalized) {
              Fail "content_scripts entry missing from zip: $asset"
              $declaredFilesMissing = $true
            }
          }
        }
        if (-not $declaredFilesMissing) { Pass "all content_scripts entries are in the zip" }

        $iconsMissing = $false
        foreach ($size in $zipManifest.icons.PSObject.Properties.Name) {
          $iconPath = $zipManifest.icons.$size -replace '\\', '/'
          if ($entries -notcontains $iconPath) {
            Fail "declared $size px icon missing from zip: $iconPath"
            $iconsMissing = $true
          }
        }
        if (-not $iconsMissing) { Pass "all declared icons are in the zip" }
      }

      if ($entries -contains 'PRIVACY.md') {
        Pass "target privacy policy is in the zip"
      } else {
        Fail "PRIVACY.md missing from zip"
      }

      # Forbidden dev-only entries
      $forbidden = @('tests/', 'docs/', 'test_md_files/', 'design/', 'node_modules/', 'package.json', 'package-lock.json', 'playwright.config.js', 'test-results/', 'playwright-report/', '.git/', 'local-only/', '_local_only/', '.github/')
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

      $hit = Select-String -Path "$extPrefix\content.js","$extPrefix\src\lib\*.js","$extPrefix\src\adapters\*.js" -Pattern $patterns 2>$null `
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
      # ADO's adapter passes relative paths through named URL builders (for
      # example fetchImpl(threadsUrl(ctx), ...)). Because the content script
      # runs only on the manifest's matched service origins, those calls are
      # same-origin uses of each declared current/legacy ADO host pattern.
      $hit = Select-String -Path "$extPrefix\content.js","$extPrefix\src\lib\*.js","$extPrefix\src\adapters\*.js" -Pattern "fetch(?:Impl)?\([^)]*${hpHost}|fetch(?:Impl)?\([^)]*(?:['""]/|\b(?:url|[A-Za-z]+Url\())" 2>$null `
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
    $p = Join-Path $extPrefix $r
    if (Test-Path $p) { Pass "$p exists" } else { Fail "$p missing" }
  }

  # All content_scripts.js entries must exist under the target folder
  foreach ($cs in $manifest.content_scripts) {
    foreach ($js in $cs.js) {
      $p = Join-Path $extPrefix $js
      if (Test-Path $p) { Pass "content_scripts entry: $p" } else { Fail "content_scripts entry missing: $p" }
    }
  }

  # All declared icons must exist under the target folder
  if ($manifest.icons) {
    foreach ($size in $manifest.icons.PSObject.Properties.Name) {
      $iconPath = Join-Path $extPrefix $manifest.icons.$size
      if (Test-Path $iconPath) { Pass "icon $size : $iconPath" } else { Fail "icon $size missing: $iconPath" }
    }
  }

  # ── Tests ────────────────────────────────────────────────────────────
  Section "Tests"

  if (Test-Path "tests") {
    $testFiles = Get-ChildItem "tests\*.test.js" -ErrorAction SilentlyContinue
    if ($testFiles) {
      # Ensure jsdom (the only devDependency) is installed. The test suite
      # uses it for DOM-coupled tests (lineMap, buttonAttachment); without
      # `npm install` the tests fail with "Cannot find module 'jsdom'".
      if ((Test-Path "package.json") -and -not (Test-Path "node_modules\jsdom")) {
        Write-Verbose "node_modules/jsdom missing — running 'npm install'"
        & npm install --no-fund --no-audit --silent 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
          Fail "npm install failed — can't run the test suite. Run 'npm install' manually."
        }
      }

      Write-Verbose "running $($testFiles.Count) test files"
      $testResult = & node --test ($testFiles.FullName) 2>&1
      $testExit = $LASTEXITCODE
      if ($testExit -eq 0) {
        # Node 22 emitted "# pass N" while Node 24's spec reporter emits
        # "ℹ pass N". Accept both so the release summary keeps its count.
        $testText = $testResult -join "`n"
        $passCount = if ($testText -match '(?m)\bpass\s+(\d+)') { $matches[1] } else { $null }
        $passLabel = if ($passCount) { "$passCount tests" } else { 'all tests' }
        Pass "test suite passed ($passLabel)"
      } else {
        Fail "test suite failed (exit $testExit) — run 'npm test' to see details"
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
  $changelogPath = if ($Target -eq 'ado') { 'CHANGELOG_ADO.md' } else { 'CHANGELOG.md' }
  if (Test-Path $changelogPath) {
    $changelog = Get-Content $changelogPath -Raw
    if ($changelog -match "##\s*\[$([regex]::Escape($version))\]") {
      Pass "$changelogPath has an entry for $version"
    } else {
      Warn "$changelogPath has no entry for $version — add a '## [$version] — <date>' section before publishing"
    }
  } else {
    Warn "no $changelogPath at repo root"
  }

  # Compare against this target's tags. ADO uses ado-vX.Y.Z so its first 1.0.0
  # is independent from GitHub's existing v1.0.0 history.
  $tagPrefix = if ($Target -eq 'github') { 'v' } else { "$Target-v" }
  $tags = & git tag --list "$tagPrefix*" 2>$null
  if ($tags) {
    $latestTag = ($tags | ForEach-Object { $_.Substring($tagPrefix.Length) } | Sort-Object { [version]$_ } -ErrorAction SilentlyContinue) `
      | Select-Object -Last 1
    if ($latestTag) {
      try {
        $cmp = [version]$version - [version]$latestTag
      } catch {
        $cmp = $null
      }
      if ([version]$version -gt [version]$latestTag) {
        Pass "manifest version $version is greater than latest tag $tagPrefix$latestTag"
      } elseif ([version]$version -eq [version]$latestTag) {
        Warn "manifest version $version matches latest tag $tagPrefix$latestTag — bump before publishing (stores reject duplicate package versions)"
      } else {
        Fail "manifest version $version is BELOW latest tag $tagPrefix$latestTag — stores will reject upload"
      }
    }
  } else {
    Write-Verbose "no $tagPrefix* git tags found, skipping tag comparison"
  }
}
finally {
  Pop-Location
}

# ── Summary ────────────────────────────────────────────────────────────
Section "Summary"

if ($issues.Count -eq 0 -and $warnings.Count -eq 0) {
  Write-Host "READY TO PACKAGE" -ForegroundColor Green
  Write-Host "Next step: .\scripts\package.ps1 -Target $Target"
  exit 0
} elseif ($issues.Count -eq 0) {
  Write-Host "READY TO PACKAGE (with $($warnings.Count) warning(s) — review above)" -ForegroundColor Yellow
  Write-Host "Next step: .\scripts\package.ps1 -Target $Target"
  exit 0
} else {
  Write-Host "$($issues.Count) FAILURE(s) — fix before packaging:" -ForegroundColor Red
  $issues | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  exit 1
}
