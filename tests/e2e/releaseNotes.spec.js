'use strict';

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { REPO_ROOT, setupFixture, gotoPRPage, injectExtension, waitForInit } = require('./_helpers');
const { recentChangelog } = require('../../src/lib/changelog');
const notes = require('../../extensions/github/releaseNotes');
const releases = recentChangelog(fs.readFileSync(path.join(REPO_ROOT, 'CHANGELOG.md'), 'utf8'), notes.announcementVersion);

async function setup(page, { collapsed = false, editing = false, nativeDraft = false, patchRelease = false, badChangelog = false, imageChangelog = false, seen } = {}) {
  await setupFixture(page, 'removed-content', {
    rawSource: { 'docs/visibility.md': '# Visibility example\n\nKept new words ending.\n', 'docs/deleted.md': '' },
    routeData: {
      headOid: 'a'.repeat(40),
      comparison: { headOid: 'a'.repeat(40), baseOid: 'b'.repeat(40) },
      diffSummaries: [
        { path: 'docs/visibility.md', pathDigest: 'visibility', changeType: 'MODIFIED', markersMap: {} },
        { path: 'docs/deleted.md', pathDigest: 'deleted', changeType: 'REMOVED', markersMap: {} },
      ],
      markers: { threads: {} },
    },
  });
  await gotoPRPage(page, { unreadReleaseNotes: true });
  await page.evaluate(({ collapsed, editing, nativeDraft, patchRelease, badChangelog, imageChangelog, seen, announcementVersion }) => {
    if (collapsed) localStorage.setItem('grdc_sidebar_collapsed', '1');
    if (seen) localStorage.setItem('grdc_release_notes_seen', seen);
    if (patchRelease || badChangelog || imageChangelog) {
      Object.defineProperty(window, 'GRDC_CHANGELOG', {
        configurable: true,
        set(value) {
          if (patchRelease) {
            value = [
              '# Changelog',
              '## [Unreleased]',
              '## [99.0.1] - 2026-12-01',
              '### Fixed',
              '- A small fix.',
              `## [${announcementVersion}] - 2026-11-25`,
              '### Added',
              '- Feature update.',
              '## [1.0.0]',
              '- Older release.',
              '## [0.9.0]',
              '- Older release.',
              '## [0.8.0]',
              '- Older release.',
            ].join('\n\n');
          } else if (badChangelog) {
            value = '# Changelog';
          } else {
            value = value.replace(/### Added\r?\n/, '$&\n- ![Screenshot](https://changelog.invalid/example.png)\n');
          }
          Object.defineProperty(window, 'GRDC_CHANGELOG', { value, configurable: true });
        },
      });
    }
    if (editing || nativeDraft) {
      const textarea = document.createElement('textarea');
      if (editing) textarea.className = 'grdc-editor-textarea';
      if (nativeDraft) textarea.className = 'native-draft';
      textarea.value = 'Draft';
      document.body.appendChild(textarea);
      if (editing) textarea.focus();
    }
  }, { collapsed, editing, nativeDraft, patchRelease, badChangelog, imageChangelog, seen, announcementVersion: notes.announcementVersion });
  await injectExtension(page);
  await waitForInit(page);
}

test('unread feature notes appear once and can be reopened after dismissal', async ({ page }) => {
  await setup(page, { seen: '1.15.0' });
  const button = page.getByRole('button', { name: "What's new — unread" });
  const panel = page.getByRole('region', { name: "What's new" });
  await expect(panel).toBeVisible();
  const headings = panel.getByRole('heading', { level: 3 });
  await expect(headings).toHaveCount(5);
  await expect(headings).toHaveText(releases.map((release) => release.title));
  const sections = panel.locator('.grdc-release-notes-history > section');
  for (let i = 0; i < releases.length; i++) {
    const bullets = releases[i].body.split('\n')
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2).replace(/\*\*|`/g, ''));
    await expect(sections.nth(i).locator('li')).toHaveText(bullets);
  }
  const selectedTab = await page.locator('.grdc-sidebar-tab[aria-selected="true"]').getAttribute('data-grdc-tab');
  await button.click();
  await expect(page.getByRole('button', { name: "What's new", exact: true })).toBeVisible();
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: "Close What's new" }).click();
  await expect(panel).toBeHidden();
  await expect(page.locator('.grdc-sidebar-tab[aria-selected="true"]')).toHaveAttribute('data-grdc-tab', selectedTab);
  expect(await page.evaluate(() => localStorage.getItem('grdc_release_notes_seen'))).toBe(notes.announcementVersion);

  await gotoPRPage(page, { unreadReleaseNotes: true });
  await injectExtension(page);
  await waitForInit(page);
  await expect(page.getByRole('region', { name: "What's new" })).toBeHidden();
  await page.getByRole('button', { name: "What's new", exact: true }).click();
  await expect(page.getByRole('region', { name: "What's new" })).toBeVisible();
});

test('all five releases remain scrollable while the close button stays available', async ({ page }) => {
  await setup(page);
  const sidebar = page.locator('.grdc-sidebar');
  const panel = page.getByRole('region', { name: "What's new" });
  const history = panel.locator('.grdc-release-notes-history');
  const close = panel.getByRole('button', { name: "Close What's new" });
  await sidebar.evaluate((element) => { element.style.height = '180px'; });
  await expect.poll(() => history.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  const closeBox = await close.boundingBox();
  expect(closeBox.width).toBeGreaterThanOrEqual(24);
  expect(closeBox.height).toBeGreaterThanOrEqual(24);
  await history.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(panel.getByRole('heading', { name: releases.at(-1).title })).toBeInViewport();
  expect((await close.boundingBox()).y).toBe(closeBox.y);
  await close.click();
  await expect(panel).toBeHidden();
});

test('closing an automatic announcement marks it as read', async ({ page }) => {
  await setup(page, { seen: '1.15.0' });
  const panel = page.getByRole('region', { name: "What's new" });
  await panel.getByRole('button', { name: "Close What's new" }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByRole('button', { name: "What's new", exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('grdc_release_notes_seen'))).toBe(notes.announcementVersion);
  await gotoPRPage(page, { unreadReleaseNotes: true });
  await injectExtension(page);
  await waitForInit(page);
  await expect(page.getByRole('region', { name: "What's new", includeHidden: true })).toBeHidden();
});

test('a bug-fix-only release appears in history without another announcement', async ({ page }) => {
  await setup(page, { seen: notes.announcementVersion, patchRelease: true });
  const panel = page.getByRole('region', { name: "What's new", includeHidden: true });
  await expect(panel).toBeHidden();
  await page.getByRole('button', { name: "What's new", exact: true }).click();
  await expect(panel.getByRole('heading', { level: 3 })).toHaveCount(5);
  await expect(panel.getByRole('heading', { level: 3 }).first()).toContainText('Version 99.0.1');
  expect(await page.evaluate(() => localStorage.getItem('grdc_release_notes_seen'))).toBe(notes.announcementVersion);
});

test('a missing changelog is reported without breaking the sidebar', async ({ page }) => {
  await setup(page, { badChangelog: true });
  const panel = page.getByRole('region', { name: "What's new" });
  await expect(panel.getByRole('alert')).toContainText('Could not load the changelog');
  await panel.getByRole('button', { name: "Close What's new" }).click();
  await expect(page.getByRole('tab', { name: 'Changes', exact: true })).toBeVisible();
});

test('opening changelog images never triggers an external request', async ({ page }) => {
  const requests = [];
  await page.route('https://changelog.invalid/**', (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  await setup(page, { imageChangelog: true });
  const panel = page.getByRole('region', { name: "What's new" });
  await expect(panel).toContainText('Screenshot (https://changelog.invalid/example.png)');
  await expect(panel.locator('img')).toHaveCount(0);
  expect(requests).toEqual([]);
});

test('a fresh installation shows the latest announcement', async ({ page }) => {
  await setup(page);
  const panel = page.getByRole('region', { name: "What's new", includeHidden: true });
  let button = page.getByRole('button', { name: "What's new — unread" });
  await expect(panel).toBeVisible();
  await page.locator('.grdc-sidebar-collapse').click();
  await expect(panel).toBeHidden();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  await expect(panel).toBeVisible();
  button = page.getByRole('button', { name: "What's new", exact: true });
  await expect(button).toBeVisible();
  await panel.getByRole('button', { name: "Close What's new" }).click();
  await expect(panel).toBeHidden();
});

test('collapsed sidebar keeps the notice unread until opened explicitly', async ({ page }) => {
  await setup(page, { collapsed: true });
  const panel = page.getByRole('region', { name: "What's new", includeHidden: true });
  await expect(panel).toBeHidden();
  const button = page.getByRole('button', { name: "What's new — unread" });
  await button.click();
  await expect(panel).toBeVisible();
  await expect(page.locator('.grdc-sidebar')).not.toHaveClass(/grdc-sidebar-collapsed/);
});

test('an active draft is not interrupted by the automatic announcement', async ({ page }) => {
  await setup(page, { editing: true });
  await expect(page.getByRole('region', { name: "What's new", includeHidden: true })).toBeHidden();
  await expect(page.getByRole('button', { name: "What's new — unread" })).toBeVisible();
  await expect(page.locator('.grdc-editor-textarea')).toHaveValue('Draft');
});

test('an unfocused native draft also prevents an automatic announcement', async ({ page }) => {
  await setup(page, { nativeDraft: true });
  await expect(page.getByRole('region', { name: "What's new", includeHidden: true })).toBeHidden();
  await expect(page.getByRole('button', { name: "What's new — unread" })).toBeVisible();
  await expect(page.locator('.native-draft')).toHaveValue('Draft');
});

test('dismissal clears the unread indicator in another open PR tab', async ({ page }) => {
  await setup(page);
  const other = await page.context().newPage();
  await setup(other);
  await page.getByRole('button', { name: "What's new — unread" }).click();
  await expect(other.getByRole('button', { name: "What's new", exact: true })).toBeVisible();
  await expect(other.getByRole('button', { name: "What's new — unread" })).toHaveCount(0);
});
