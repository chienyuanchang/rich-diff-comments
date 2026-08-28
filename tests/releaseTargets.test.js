'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

const packageScript = read('scripts', 'package.ps1');
const syncScript = read('scripts', 'dev-sync.ps1');
const preflightScript = read('.github', 'skills', 'rdc-publish-check', 'scripts', 'preflight.ps1');
const prepScript = read('.github', 'skills', 'rdc-publish-check', 'scripts', 'release-prep.ps1');
const releaseScript = read('.github', 'skills', 'rdc-publish-check', 'scripts', 'github-release.ps1');
const promoScript = read('design', 'promo-tiles', 'generate.ps1');

const githubManifest = JSON.parse(read('extensions', 'github', 'manifest.json'));
const adoManifest = JSON.parse(read('extensions', 'ado', 'manifest.json'));

test('release scripts require an explicit supported target contract', () => {
  for (const [name, script] of [
    ['package.ps1', packageScript],
    ['preflight.ps1', preflightScript],
    ['release-prep.ps1', prepScript],
    ['github-release.ps1', releaseScript]
  ]) {
    assert.match(script, /\[ValidateSet\('github', 'ado'\)\]/, `${name} must support only github and ado targets`);
    assert.match(script, /\[string\]\$Target\s*=\s*'github'/, `${name} must preserve GitHub as the backward-compatible default`);
  }
  assert.match(promoScript, /\[ValidateSet\('github', 'ado'\)\]/);
  assert.match(promoScript, /\[string\]\$Target = 'github'/);
  assert.match(promoScript, /Join-Path \$PSScriptRoot 'ado'/);
  assert.match(promoScript, /design\\logo\\ado\\icon-1024\.png/);
});

test('ADO package and release folder names cannot collide with GitHub artifacts', () => {
  assert.match(packageScript, /if \(\$Target -eq 'github'\) \{ 'rdc' \} else \{ "rdc-\$Target" \}/);
  assert.match(prepScript, /Join-Path \(Join-Path 'releases' \$Target\) \$version/);
  assert.match(prepScript, /\$artifactStem = if \(\$Target -eq 'github'\) \{ 'rdc' \} else \{ "rdc-\$Target" \}/);
  assert.match(releaseScript, /"releases\\\$Target\\\$version"/);
  assert.match(releaseScript, /\$artifactStem = if \(\$Target -eq 'github'\) \{ 'rdc' \} else \{ "rdc-\$Target" \}/);
});

test('ADO sync and audit use the ADO-specific privacy policy and changelog', () => {
  assert.match(syncScript, /if \(\$Target -eq 'ado'\) \{ 'PRIVACY_ADO\.md' \} else \{ 'PRIVACY\.md' \}/);
  assert.match(preflightScript, /if \(\$Target -eq 'ado'\) \{ 'CHANGELOG_ADO\.md' \} else \{ 'CHANGELOG\.md' \}/);
  assert.match(releaseScript, /if \(\$Target -eq 'ado'\) \{ 'CHANGELOG_ADO\.md' \} else \{ 'CHANGELOG\.md' \}/);
  assert.match(preflightScript, /src\\adapters\\\*\.js/);
  assert.match(preflightScript, /packaged manifest identity differs from extensions\/\$Target\/manifest\.json/);
  assert.match(preflightScript, /packaged host permissions match the \$Target target/);
  assert.match(preflightScript, /all declared icons are in the zip/);
  assert.match(preflightScript, /target privacy policy is in the zip/);
  assert.match(preflightScript, /\$testResult -join "`n"/);
  assert.match(preflightScript, /if \(\$testText -match '\(\?m\)\\bpass\\s\+\(\\d\+\)'\)/);
  assert.match(preflightScript, /else \{ 'all tests' \}/);
});

test('ADO release uses a target-qualified tag and submission documents', () => {
  assert.match(releaseScript, /if \(\$Target -eq 'github'\) \{ "v\$version" \} else \{ "\$Target-v\$version" \}/);
  assert.match(preflightScript, /if \(\$Target -eq 'github'\) \{ 'v' \} else \{ "\$Target-v" \}/);
  assert.match(prepScript, /CHROME_SUBMISSION\$templateSuffix\.md/);
  assert.match(prepScript, /EDGE_SUBMISSION\$templateSuffix\.md/);
  assert.equal(fs.existsSync(path.join(ROOT, '.github', 'skills', 'rdc-publish-check', 'templates', 'CHROME_SUBMISSION_ADO.md')), true);
  assert.equal(fs.existsSync(path.join(ROOT, '.github', 'skills', 'rdc-publish-check', 'templates', 'EDGE_SUBMISSION_ADO.md')), true);
});

test('GitHub and ADO manifests remain separately scoped', () => {
  assert.deepEqual(githubManifest.host_permissions, ['https://github.com/*']);
  assert.deepEqual(adoManifest.host_permissions, [
    'https://dev.azure.com/*',
    'https://*.visualstudio.com/*'
  ]);
  assert.equal(adoManifest.version, '1.0.0');
  assert.match(adoManifest.name, /Azure DevOps/);
  assert.doesNotMatch(githubManifest.name, /Azure DevOps/);

  for (const size of [16, 32, 48, 128]) {
    const png = fs.readFileSync(path.join(ROOT, 'extensions', 'ado', 'icons', `icon-${size}.png`));
    assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
    assert.equal(png.readUInt32BE(16), size, `ADO ${size}px icon width`);
    assert.equal(png.readUInt32BE(20), size, `ADO ${size}px icon height`);
  }
  for (const size of [300, 1024]) {
    const png = fs.readFileSync(path.join(ROOT, 'design', 'logo', 'ado', `icon-${size}.png`));
    assert.equal(png.readUInt32BE(16), size, `ADO ${size}px logo width`);
    assert.equal(png.readUInt32BE(20), size, `ADO ${size}px logo height`);
  }
  for (const [name, width, height] of [
    ['small-440x280.png', 440, 280],
    ['small-tile-880x560.png', 880, 560],
    ['marquee-1400x560.png', 1400, 560],
    ['large-tile-2800x1120.png', 2800, 1120]
  ]) {
    const png = fs.readFileSync(path.join(ROOT, 'design', 'promo-tiles', 'ado', name));
    assert.equal(png.readUInt32BE(16), width, `${name} width`);
    assert.equal(png.readUInt32BE(20), height, `${name} height`);
  }

  const iconSource = read('design', 'icon-v2', 'icon-ado.svg');
  assert.match(iconSource, /Fluent blue outer bubble\/frame \(#0078d4\)/);
  assert.match(iconSource, /White message interior/);
  assert.match(iconSource, /Fluent blue "M" and down arrow/);
});

test('ADO store forms disclose the correct public privacy policy and first-release package', () => {
  for (const templateName of ['CHROME_SUBMISSION_ADO.md', 'EDGE_SUBMISSION_ADO.md']) {
    const template = read('.github', 'skills', 'rdc-publish-check', 'templates', templateName);
    assert.match(template, /rdc-ado-1\.0\.0\.zip/);
    assert.match(template, /PRIVACY_ADO\.md/);
    assert.match(template, /https:\/\/dev\.azure\.com\/\*/);
    assert.match(template, /https:\/\/\*\.visualstudio\.com\/\*/);
    assert.match(template, /not affiliated with, endorsed by, sponsored by, or otherwise connected to Microsoft Corporation/i);
  }
});
