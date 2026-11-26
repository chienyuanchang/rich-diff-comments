'use strict';

const { test, expect } = require('@playwright/test');
const { setupFixture, gotoPRPage, injectExtension, waitForInit } = require('./_helpers');
const notes = require('../../extensions/github/releaseNotes');

async function setup(page, { collapsed = false, editing = false, nativeDraft = false, seen } = {}) {
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
  await page.evaluate(({ collapsed, editing, nativeDraft, seen }) => {
    if (collapsed) localStorage.setItem('grdc_sidebar_collapsed', '1');
    if (seen) localStorage.setItem('grdc_release_notes_seen', seen);
    if (editing || nativeDraft) {
      const textarea = document.createElement('textarea');
      if (editing) textarea.className = 'grdc-editor-textarea';
      if (nativeDraft) textarea.className = 'native-draft';
      textarea.value = 'Draft';
      document.body.appendChild(textarea);
      if (editing) textarea.focus();
    }
  }, { collapsed, editing, nativeDraft, seen });
  await injectExtension(page);
  await waitForInit(page);
}

test('unread feature notes appear once and can be reopened after dismissal', async ({ page }) => {
  await setup(page, { seen: '1.15.0' });
  const button = page.getByRole('button', { name: "What's new — unread" });
  const panel = page.getByRole('region', { name: "What's new" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(`Version ${notes.version}`);
  const selectedTab = await page.locator('.grdc-sidebar-tab[aria-selected="true"]').getAttribute('data-grdc-tab');
  await panel.getByRole('button', { name: 'Got it' }).click();
  await expect(panel).toBeHidden();
  await expect(button).toHaveCount(0);
  await expect(page.locator('.grdc-sidebar-tab[aria-selected="true"]')).toHaveAttribute('data-grdc-tab', selectedTab);
  expect(await page.evaluate(() => localStorage.getItem('grdc_release_notes_seen'))).toBe(notes.version);

  await gotoPRPage(page, { unreadReleaseNotes: true });
  await injectExtension(page);
  await waitForInit(page);
  await expect(page.getByRole('region', { name: "What's new" })).toBeHidden();
  await page.getByRole('button', { name: "What's new", exact: true }).click();
  await expect(page.getByRole('region', { name: "What's new" })).toBeVisible();
});

test('a fresh installation shows the latest announcement', async ({ page }) => {
  await setup(page);
  const panel = page.getByRole('region', { name: "What's new", includeHidden: true });
  const button = page.getByRole('button', { name: "What's new — unread" });
  await expect(panel).toBeVisible();
  await page.locator('.grdc-sidebar-collapse').click();
  await expect(panel).toBeHidden();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  await expect(panel).toBeVisible();
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
  await page.getByRole('region', { name: "What's new" }).getByRole('button', { name: 'Got it' }).click();
  await expect(other.getByRole('button', { name: "What's new", exact: true })).toBeVisible();
  await expect(other.getByRole('button', { name: "What's new — unread" })).toHaveCount(0);
});
