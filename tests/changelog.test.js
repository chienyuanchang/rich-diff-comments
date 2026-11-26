'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { recentChangelog } = require('../src/lib/changelog');

const released = ['1.15.0', '1.14.0', '1.13.0', '1.12.0', '1.11.0']
  .map((version) => `## [${version}] \u2014 2026-01-01\n\n### Fixed\n\n- Complete notes for ${version}.\n`)
  .join('\n');

test('includes complete unreleased notes and the four preceding releases', () => {
  const markdown = `# Changelog\r\n\r\n## [Unreleased]\r\n\r\n### Added\r\n\r\n- New feature.\r\n\r\n### Fixed\r\n\r\n- Full fix details.\r\n\r\n${released}`;
  const releases = recentChangelog(markdown, '1.16.0');
  assert.deepEqual(releases.map((release) => release.title), [
    'Version 1.16.0 (unreleased)',
    'Version 1.15.0 \u2014 2026-01-01',
    'Version 1.14.0 \u2014 2026-01-01',
    'Version 1.13.0 \u2014 2026-01-01',
    'Version 1.12.0 \u2014 2026-01-01',
  ]);
  assert.equal(releases[0].body, '### Added\n\n- New feature.\n\n### Fixed\n\n- Full fix details.');
  assert.equal(releases[4].body, '### Fixed\n\n- Complete notes for 1.12.0.');
});

test('skips an empty unreleased section and shows five published releases', () => {
  const releases = recentChangelog(`# Changelog\n\n## [Unreleased]\n\n### Added\n\n### Fixed\n\n${released}`, '1.15.0');
  assert.equal(releases.length, 5);
  assert.equal(releases[0].title, 'Version 1.15.0 \u2014 2026-01-01');
  assert.equal(releases[4].title, 'Version 1.11.0 \u2014 2026-01-01');
});

test('does not label an unreleased patch as an already published feature version', () => {
  const markdown = `## [Unreleased]\n\n### Fixed\n\n- Patch in progress.\n\n${released}`;
  const releases = recentChangelog(markdown, '1.15.0');
  assert.equal(releases[0].title, 'Unreleased');
  assert.equal(releases[1].title, 'Version 1.15.0 \u2014 2026-01-01');
});

test('rejects missing or malformed changelog data explicitly', () => {
  assert.throws(() => recentChangelog('', '1.16.0'), /missing or empty/);
  assert.throws(() => recentChangelog('# Changelog', '1.16.0'), /no release entries/);
  assert.throws(() => recentChangelog('## [1.16.0]\n\n### Added', '1.16.0'), /has no details/);
  assert.throws(() => recentChangelog(released, ''), /Announcement version is missing/);
});
