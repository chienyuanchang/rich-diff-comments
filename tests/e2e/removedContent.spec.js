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

async function toggleRemovedContent(page) {
  await page.getByRole('button', { name: 'View options', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Show removed content', exact: true }).click();
  await page.keyboard.press('Escape');
}

test('hides deletions reversibly without disturbing additions, tables, code, or comment anchors', async ({ page }) => {
  await setup(page);
  const toggle = page.getByRole('button', { name: 'View options', exact: true });
  await expect(toggle).toHaveAttribute('data-filtered', 'false');
  const hiddenIds = ['old-inline', 'old-block', 'empty-paragraph', 'old-item', 'old-cell', 'old-row', 'empty-row', 'old-code', 'deletion-only', 'deleted-file-content'];
  for (const id of hiddenIds) await expect(page.locator(`#${id}`)).toBeVisible();
  const button = page.locator('#mixed > .grdc-comment-btn');
  const anchorTitle = await button.getAttribute('title');
  expect(anchorTitle).toMatch(/^Comment on docs\/visibility.md:\d+/);
  await toggleRemovedContent(page);
  await expect(toggle).toHaveAttribute('data-filtered', 'true');
  for (const id of hiddenIds) await expect(page.locator(`#${id}`)).toBeHidden();
  for (const id of ['mixed', 'new-inline', 'kept-parent', 'kept-item', 'mixed-row', 'partial-row', 'empty-cell', 'code', 'authored-strike']) {
    await expect(page.locator(`#${id}`)).toBeVisible();
  }
  await expect(page.locator('#new-inline')).toHaveCSS('text-decoration-line', 'underline');
  await expect(button).toHaveAttribute('title', anchorTitle);
  await expect(page.locator('.grdc-existing-thread')).toHaveCount(1);
  await toggleRemovedContent(page);
  for (const id of hiddenIds) await expect(page.locator(`#${id}`)).toBeVisible();
  await expect(button).toHaveAttribute('title', anchorTitle);
});

test('Changes cards and keyboard navigation skip deletion-only targets', async ({ page }) => {
  await setup(page);
  await toggleRemovedContent(page);
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
  const toggle = page.getByRole('button', { name: 'View options', exact: true });
  await toggleRemovedContent(page);
  await expect(page.locator('#empty-paragraph')).toBeHidden();
  await page.getByRole('tab', { name: 'Threads', exact: true }).click();
  await page.locator('.grdc-sidebar-list .grdc-sidebar-card').click();
  await expect(page.locator('#empty-paragraph')).toBeVisible();
  await expect(page.locator('#old-inline')).toBeHidden();
  await expect(page.locator('#old-block')).toBeHidden();
  await expect(toggle).toHaveAttribute('data-filtered', 'true');
});

test('new rich diffs inherit the mode and another pull request resets it', async ({ page }) => {
  await setup(page);
  await toggleRemovedContent(page);
  await page.evaluate(() => {
    const file = document.createElement('div');
    file.id = 'diff-later';
    file.dataset.tagsearchPath = 'docs/visibility.md';
    file.innerHTML = '<div class="prose-diff"><div class="markdown-body"><p id="later">Kept <del id="later-old">old</del><ins>new words</ins> ending.</p></div></div>';
    document.getElementById('files').appendChild(file);
    history.pushState(null, '', '/test-owner/test-repo/pull/1/changes?file=docs/visibility.md');
  });
  await expect(page.locator('#later-old')).toBeHidden();
  await expect(page.getByRole('button', { name: 'View options', exact: true })).toHaveAttribute('data-filtered', 'true');
  await page.evaluate(() => {
    history.pushState(null, '', '/test-owner/test-repo/pull/2/files');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByRole('button', { name: 'View options', exact: true })).toHaveAttribute('data-filtered', 'false');
  await expect(page.locator('#later-old')).toBeVisible();
});

test('View options preserves the original toolbar flow at minimum and expanded widths', async ({ page }) => {
  await setup(page);
  const toggle = page.getByRole('button', { name: 'View options', exact: true });
  let originalOffset;
  for (const collapsed of [false, true]) {
    if (collapsed) await page.locator('.grdc-sidebar-collapse').click();
    for (const width of [480, 640]) {
      await page.locator('.grdc-sidebar').evaluate((sidebar, value) => {
        sidebar.style.width = `${value}px`;
        sidebar.style.left = '500px';
      }, width);
      const headerBox = await page.locator('.grdc-sidebar-header').boundingBox();
      const separatorBox = await page.locator('.grdc-sidebar-header > .grdc-sidebar-separator').last().boundingBox();
      const buttonBox = await toggle.boundingBox();
      expect(buttonBox.width).toBe(24);
      expect(buttonBox.height).toBe(24);
      expect(buttonBox.x - separatorBox.x - separatorBox.width).toBe(8);
      expect(headerBox.x + headerBox.width - buttonBox.x - buttonBox.width).toBeGreaterThanOrEqual(20);
      await expect(page.locator('.grdc-sidebar-header')).toHaveCSS('column-gap', '8px');
      await expect(page.locator('.grdc-sidebar-header')).toHaveCSS('padding-left', '8px');
      await expect(page.locator('.grdc-sidebar-header')).toHaveCSS('padding-right', '8px');
      await expect(toggle).toHaveCSS('margin-right', '12px');
      const offset = buttonBox.x - headerBox.x;
      if (originalOffset === undefined) originalOffset = offset;
      expect(offset).toBe(originalOffset);
    }
  }
  await toggleRemovedContent(page);
  await expect(page.locator('#old-block')).toBeHidden();
});

for (const theme of [
  { name: 'light', accent: '#0969da', color: 'rgb(9, 105, 218)' },
  { name: 'dark', accent: '#2f81f7', color: 'rgb(47, 129, 247)' },
]) {
  test(`View options indicates hidden content in the ${theme.name} theme`, async ({ page }) => {
    await setup(page);
    await page.evaluate((accent) => {
      document.documentElement.style.setProperty('--fgColor-accent', accent);
      document.documentElement.style.setProperty('--fgColor-onEmphasis', '#ffffff');
    }, theme.accent);
    const funnel = page.getByRole('button', { name: 'View options', exact: true });
    for (const collapsed of [false, true]) {
      if (collapsed) await page.locator('.grdc-sidebar-collapse').click();
      await page.mouse.move(20, 700);
      await expect(page.locator('.grdc-sidebar')).toHaveCSS('min-width', '480px');
      for (const option of ['Show removed content', 'Show resolved comments']) {
        const button = funnel;
        const inactiveBox = await button.boundingBox();
        expect(inactiveBox.width).toBe(24);
        expect(inactiveBox.height).toBe(24);
        await expect(button).toHaveAttribute('data-filtered', 'false');
        await expect(button).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expect(button).toHaveCSS('color', 'rgb(255, 255, 255)');
        await button.hover();
        await expect(button).not.toHaveCSS('background-color', 'rgb(255, 255, 255)');
        await button.click();
        await page.getByRole('checkbox', { name: option, exact: true }).uncheck();
        await page.keyboard.press('Escape');
        const activeBox = await button.boundingBox();
        expect(activeBox.width).toBe(24);
        expect(activeBox.height).toBe(24);
        await expect(button).toHaveAttribute('data-filtered', 'true');
        await expect(button).toHaveCSS('background-color', 'rgb(255, 255, 255)');
        await expect(button).toHaveCSS('color', theme.color);
        await page.mouse.move(20, 700);
        await button.focus();
        await expect(button).toHaveCSS('background-color', 'rgb(255, 255, 255)');
        await expect(button).toHaveCSS('color', theme.color);
        await button.hover();
        await page.mouse.down();
        await expect(button).toHaveCSS('background-color', 'rgb(255, 255, 255)');
        await expect(button).toHaveCSS('color', theme.color);
        await page.mouse.up();
        await page.getByRole('checkbox', { name: option, exact: true }).check();
        await page.keyboard.press('Escape');
        await expect(button).toHaveAttribute('data-filtered', 'false');
        await page.mouse.move(20, 700);
      }
    }
  });
}

test('toggling preserves an open comment draft and its source-line target', async ({ page }) => {
  await setup(page);
  await page.locator('#mixed').hover();
  await page.locator('#mixed > .grdc-comment-btn').click();
  const draft = page.locator('.grdc-comment-box textarea');
  const line = page.locator('.grdc-comment-box .grdc-line-input');
  const targetLine = await line.inputValue();
  await draft.fill('Draft stays intact.');
  await toggleRemovedContent(page);
  await expect(draft).toHaveValue('Draft stays intact.');
  await expect(line).toHaveValue(targetLine);
  await toggleRemovedContent(page);
  await expect(draft).toHaveValue('Draft stays intact.');
  await expect(line).toHaveValue(targetLine);
});

test('deletion-only views clear cached Changes stops instead of navigating hidden content', async ({ page }) => {
  await setup(page, { deletionsOnly: true });
  await toggleRemovedContent(page);
  await page.getByRole('tab', { name: 'Changes', exact: true }).click();
  await expect(page.locator('.grdc-sidebar-changes-list')).toContainText('No added or modified content to navigate');
  expect(await page.evaluate(() => document.querySelector('.grdc-sidebar')._grdcChangeBlocks.length)).toBe(0);
  await page.keyboard.press(']');
  await expect(page.locator('.grdc-change-flash')).toHaveCount(0);
});

test('View options supports keyboard access and outside dismissal without changing settings', async ({ page }) => {
  await setup(page);
  const button = page.getByRole('button', { name: 'View options', exact: true });
  const menu = page.getByRole('dialog', { name: 'View options', exact: true });
  await expect(button).toHaveAttribute('title', 'View options');
  await expect(page.locator('.grdc-sidebar-hide-removed, .grdc-sidebar-filter-cb')).toHaveCount(0);
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  const removed = page.getByRole('checkbox', { name: 'Show removed content', exact: true });
  const resolved = page.getByRole('checkbox', { name: 'Show resolved comments', exact: true });
  await expect(removed).toBeChecked();
  await expect(resolved).toBeChecked();
  await expect(removed).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(resolved).toBeFocused();
  await page.keyboard.press('Space');
  await expect(resolved).not.toBeChecked();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(button).toHaveAttribute('data-filtered', 'true');
  await button.click();
  await page.mouse.click(10, 700);
  await expect(menu).toBeHidden();
  await button.click();
  await expect(resolved).not.toBeChecked();
  await expect(removed).toBeChecked();
});

test('View options is not clipped by the collapsed sidebar or viewport edges', async ({ page }) => {
  await setup(page);
  await page.locator('.grdc-sidebar-collapse').click();
  await page.locator('.grdc-sidebar').evaluate((sidebar) => {
    sidebar.style.left = `${window.innerWidth - sidebar.offsetWidth}px`;
    sidebar.style.top = `${window.innerHeight - sidebar.offsetHeight}px`;
  });
  await page.getByRole('button', { name: 'View options', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'View options', exact: true });
  const box = await menu.boundingBox();
  const viewport = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(8);
  expect(box.y).toBeGreaterThanOrEqual(8);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 8);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 8);
  await page.getByRole('checkbox', { name: 'Show removed content', exact: true }).uncheck();
  await expect(page.locator('#old-block')).toBeHidden();
});
