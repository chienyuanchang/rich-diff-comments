'use strict';

const { test, expect } = require('@playwright/test');
const { setupFixture, gotoPRPage, injectExtension, waitForInit } = require('./_helpers');

const source = [
  '# Visibility example', '',
  'Kept new words ending.', '',
  '- Kept parent', '  - Kept child', '',
  '| First | Second |', '| --- | --- |',
  '| new cell | kept cell |', '| | retained column |', '',
  '```', 'new code', 'kept code', '```', '',
  'Still here .', '', '~~Authored strikethrough~~',
].join('\n');

async function setup(page, { deletionsOnly = false } = {}) {
  await setupFixture(page, 'removed-content', {
    rawSource: { 'docs/visibility.md': source, 'docs/deleted.md': '' },
    routeData: {
      headOid: 'a'.repeat(40),
      diffSummaries: [
        { path: 'docs/visibility.md', pathDigest: 'visibility', changeType: 'MODIFIED', markersMap: { R3: { threads: [{ id: '201' }] } } },
        { path: 'docs/deleted.md', pathDigest: 'deleted', changeType: 'REMOVED', markersMap: {} },
      ],
      markers: { threads: {
        201: { id: '201', subjectType: 'LINE', commentsData: { comments: [
          { databaseId: 7001, body: 'Keep ~~this comment strike~~ intact.', author: { login: 'reviewer' }, createdAt: '2026-11-02T12:00:00Z' },
        ] } },
      } },
    },
  });
  await gotoPRPage(page);
  await page.evaluate(() => localStorage.setItem('grdc_sidebar_pos', JSON.stringify({ left: 720, top: 8 })));
  if (deletionsOnly) {
    await page.evaluate(() => {
      document.querySelectorAll('#diff-visibility ins').forEach((element) => {
        element.replaceWith(document.createTextNode(element.textContent));
      });
      document.getElementById('list').remove();
    });
  }
  await injectExtension(page);
  await waitForInit(page);
}

test('hides deletions reversibly without disturbing additions, tables, code, or comment anchors', async ({ page }) => {
  await setup(page);
  const toggle = page.getByRole('button', { name: 'Hide removed content', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  const hiddenIds = ['old-inline', 'old-block', 'empty-paragraph', 'old-item', 'old-cell', 'old-row', 'empty-row', 'old-code', 'deletion-only', 'deleted-file-content'];
  for (const id of hiddenIds) await expect(page.locator(`#${id}`)).toBeVisible();
  const button = page.locator('#mixed > .grdc-comment-btn');
  const anchorTitle = await button.getAttribute('title');
  expect(anchorTitle).toMatch(/^Comment on docs\/visibility.md:\d+/);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  for (const id of hiddenIds) await expect(page.locator(`#${id}`)).toBeHidden();
  for (const id of ['mixed', 'new-inline', 'kept-parent', 'kept-item', 'mixed-row', 'partial-row', 'empty-cell', 'code', 'authored-strike']) {
    await expect(page.locator(`#${id}`)).toBeVisible();
  }
  await expect(page.locator('#new-inline')).toHaveCSS('text-decoration-line', 'underline');
  await expect(button).toHaveAttribute('title', anchorTitle);
  await expect(page.locator('.grdc-existing-thread')).toHaveCount(1);
  await toggle.click();
  for (const id of hiddenIds) await expect(page.locator(`#${id}`)).toBeVisible();
  await expect(button).toHaveAttribute('title', anchorTitle);
});

test('Changes cards and keyboard navigation skip deletion-only targets', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Hide removed content', exact: true }).click();
  await page.getByRole('tab', { name: 'Changes', exact: true }).click();
  const cards = page.locator('.grdc-sidebar-changes-list .grdc-sidebar-card');
  const count = await cards.count();
  expect(count).toBeGreaterThan(0);
  await expect(page.locator('.grdc-sidebar-changes-list')).not.toContainText('Deleted paragraph');
  await expect(page.locator('.grdc-sidebar-changes-list')).not.toContainText('deleted.md');
  expect(await page.evaluate(() => document.querySelector('.grdc-sidebar')._grdcChangeBlocks.every(
    (block) => window.GRDC.classifyChangeKind(block) !== 'removed' && !block.closest('.grdc-removed-hidden')
  ))).toBe(true);
  for (let index = 0; index < count + 1; index++) await page.keyboard.press(']');
  expect(await page.evaluate(() => {
    const flashed = document.querySelectorAll('.grdc-change-flash');
    return Array.from(flashed).every((block) => !block.closest('.grdc-removed-hidden'));
  })).toBe(true);
});

test('Threads navigation reveals its removed context while keeping the mode active', async ({ page }) => {
  await setup(page);
  const toggle = page.getByRole('button', { name: 'Hide removed content', exact: true });
  await toggle.click();
  await expect(page.locator('#empty-paragraph')).toBeHidden();
  await page.getByRole('tab', { name: 'Threads', exact: true }).click();
  await page.locator('.grdc-sidebar-list .grdc-sidebar-card').click();
  await expect(page.locator('#empty-paragraph')).toBeVisible();
  await expect(page.locator('#old-inline')).toBeHidden();
  await expect(page.locator('#old-block')).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
});

test('new rich diffs inherit the mode and another pull request resets it', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Hide removed content', exact: true }).click();
  await page.evaluate(() => {
    const file = document.createElement('div');
    file.id = 'diff-later';
    file.dataset.tagsearchPath = 'docs/visibility.md';
    file.innerHTML = '<div class="prose-diff"><div class="markdown-body"><p id="later">Kept <del id="later-old">old</del><ins>new words</ins> ending.</p></div></div>';
    document.getElementById('files').appendChild(file);
    history.pushState(null, '', '/test-owner/test-repo/pull/1/changes?file=docs/visibility.md');
  });
  await expect(page.locator('#later-old')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Hide removed content', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => {
    history.pushState(null, '', '/test-owner/test-repo/pull/2/files');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByRole('button', { name: 'Hide removed content', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#later-old')).toBeVisible();
});

test('toggle remains inside the collapsed toolbar at its minimum width', async ({ page }) => {
  await setup(page);
  await page.locator('.grdc-sidebar-collapse').click();
  const toggle = page.getByRole('button', { name: 'Hide removed content', exact: true });
  const sidebarBox = await page.locator('.grdc-sidebar').boundingBox();
  const buttonBox = await toggle.boundingBox();
  expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(sidebarBox.x + sidebarBox.width);
  await toggle.click();
  await expect(page.locator('#old-block')).toBeHidden();
});

test('toggling preserves an open comment draft and its source-line target', async ({ page }) => {
  await setup(page);
  await page.locator('#mixed').hover();
  await page.locator('#mixed > .grdc-comment-btn').click();
  const draft = page.locator('.grdc-comment-box textarea');
  const line = page.locator('.grdc-comment-box .grdc-line-input');
  const targetLine = await line.inputValue();
  await draft.fill('Draft stays intact.');
  await page.getByRole('button', { name: 'Hide removed content', exact: true }).click();
  await expect(draft).toHaveValue('Draft stays intact.');
  await expect(line).toHaveValue(targetLine);
  await page.getByRole('button', { name: 'Hide removed content', exact: true }).click();
  await expect(draft).toHaveValue('Draft stays intact.');
  await expect(line).toHaveValue(targetLine);
});

test('deletion-only views clear cached Changes stops instead of navigating hidden content', async ({ page }) => {
  await setup(page, { deletionsOnly: true });
  await page.getByRole('button', { name: 'Hide removed content', exact: true }).click();
  await page.getByRole('tab', { name: 'Changes', exact: true }).click();
  await expect(page.locator('.grdc-sidebar-changes-list')).toContainText('No added or modified content to navigate');
  expect(await page.evaluate(() => document.querySelector('.grdc-sidebar')._grdcChangeBlocks.length)).toBe(0);
  await page.keyboard.press(']');
  await expect(page.locator('.grdc-change-flash')).toHaveCount(0);
});
