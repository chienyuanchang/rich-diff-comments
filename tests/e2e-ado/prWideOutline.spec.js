'use strict';

const { test, expect } = require('@playwright/test');
const {
  setupAdoExtensionPage,
  waitForAdoReady,
  waitForOutlineReady,
  userThreadCount,
} = require('./_helpers');
const fixtures = require('./fixtures/sources');

const FILE_COUNT = 5;
const HEADING_COUNT = 8;

async function setupOutline(page) {
  const result = await setupAdoExtensionPage(page);
  await waitForOutlineReady(page, FILE_COUNT, HEADING_COUNT);
  await page.keyboard.press('3');
  return result;
}

test.describe('ADO PR-wide Outline', () => {
  test('shows every Markdown file immediately in stable native tree order', async ({ page }) => {
    const { pageErrors } = await setupOutline(page);
    const files = page.locator('.adrc-outline-file');
    await expect(files).toHaveCount(FILE_COUNT);
    await expect(files.locator('.adrc-outline-file-text')).toHaveText([
      'docs/design.md',
      'docs/other.md',
      'docs/new.md',
      'docs/deleted.md',
      'docs/renamed.md',
    ]);
    await expect(page.locator('.adrc-outline-row')).toHaveCount(HEADING_COUNT);
    await expect(page.locator('[data-count="outline"]')).toHaveText(String(HEADING_COUNT));
    await expect(files.nth(0)).toHaveClass(/adrc-outline-file-current/);
    await expect(files.nth(1)).not.toHaveClass(/adrc-outline-file-current/);
    expect(pageErrors).toEqual([]);
  });

  test('attributes thread counts to headings without leaking between files', async ({ page }) => {
    await setupOutline(page);
    const architecture = page.locator(
      `.adrc-outline-row[data-path="${fixtures.DESIGN_PATH}"]`,
      { hasText: 'Architecture' }
    );
    const implementation = page.locator(
      `.adrc-outline-row[data-path="${fixtures.DESIGN_PATH}"]`,
      { hasText: 'Implementation' }
    );
    const otherTitle = page.locator(
      `.adrc-outline-row[data-path="${fixtures.OTHER_PATH}"]`,
      { hasText: 'Other Document' }
    );
    await expect(architecture.locator('.adrc-outline-thread-count')).toHaveText('1 💬');
    await expect(implementation.locator('.adrc-outline-thread-count')).toHaveText('1 💬');
    await expect(otherTitle.locator('.adrc-outline-thread-count')).toHaveText('1 💬');
    await expect(page.locator('.adrc-outline-thread-count')).toHaveCount(3);
  });

  test('clicking a cached cross-file heading preserves Preview and lands on its live row', async ({ page }) => {
    const { server } = await setupOutline(page);
    await page.evaluate(() => { window.__initialOutlinePreview = window.__ADO_FIXTURE__.preview; });
    const notes = page.locator(
      `.adrc-outline-row[data-path="${fixtures.OTHER_PATH}"]`,
      { hasText: 'Notes' }
    );
    await notes.locator('.adrc-outline-label').click();
    await waitForAdoReady(page, fixtures.OTHER_PATH, userThreadCount(server.threads));
    await waitForOutlineReady(page, FILE_COUNT, HEADING_COUNT);

    expect(new URL(page.url()).searchParams.get('path')).toBe(fixtures.OTHER_PATH);
    expect(await page.evaluate(() => window.__initialOutlinePreview === window.__ADO_FIXTURE__.preview)).toBe(true);
    expect(server.pageLoads).toBe(1);
    await expect(page.locator('.markdown-preview-container h2', { hasText: 'Notes' })).toBeVisible();
    await expect(notes).toHaveClass(/adrc-outline-active/);
    await expect(page.locator('.adrc-outline-file').nth(0)).not.toHaveClass(/adrc-outline-file-current/);
    await expect(page.locator('.adrc-outline-file').nth(1)).toHaveClass(/adrc-outline-file-current/);
    expect((await page.evaluate(() => window.ADORC_probe.viewMode())).pendingOutlineJump).toBeNull();
  });

  test('keeps all file groups in place across repeated Preview switches', async ({ page }) => {
    const { server } = await setupOutline(page);
    const expected = ['docs/design.md', 'docs/other.md', 'docs/new.md', 'docs/deleted.md', 'docs/renamed.md'];

    await page.locator(`.adrc-outline-file[data-path="${fixtures.NEW_PATH}"]`).click();
    await waitForAdoReady(page, fixtures.NEW_PATH, userThreadCount(server.threads));
    await waitForOutlineReady(page, FILE_COUNT, HEADING_COUNT);
    await expect(page.locator('.adrc-outline-file-text')).toHaveText(expected);

    await page.locator(`.adrc-outline-file[data-path="${fixtures.DESIGN_PATH}"]`).click();
    await waitForAdoReady(page, fixtures.DESIGN_PATH, userThreadCount(server.threads));
    await waitForOutlineReady(page, FILE_COUNT, HEADING_COUNT);
    await expect(page.locator('.adrc-outline-file-text')).toHaveText(expected);
    await expect(page.locator('.adrc-outline-row')).toHaveCount(HEADING_COUNT);
  });

  test('per-row collapse mirrors the active document and hides descendant outline rows', async ({ page }) => {
    await setupOutline(page);
    const designTitle = page.locator(
      `.adrc-outline-row[data-path="${fixtures.DESIGN_PATH}"]`,
      { hasText: 'Design Review' }
    );
    await designTitle.locator('.adrc-outline-chevron').click();

    await expect(page.locator('.markdown-preview-container h1', { hasText: 'Design Review' }))
      .toHaveClass(/adrc-section-collapsed/);
    await expect(page.locator('.markdown-preview-container p', { hasText: 'This document explains' }))
      .toHaveClass(/adrc-collapsed-hidden/);
    await expect(page.locator(`.adrc-outline-row[data-path="${fixtures.DESIGN_PATH}"]`)).toHaveCount(1);
    await expect(page.locator(`.adrc-outline-row[data-path="${fixtures.OTHER_PATH}"]`)).toHaveCount(2);

    await designTitle.locator('.adrc-outline-chevron').click();
    await expect(page.locator(`.adrc-outline-row[data-path="${fixtures.DESIGN_PATH}"]`)).toHaveCount(4);
  });

  test('cached fold intent is applied when another file is opened', async ({ page }) => {
    const { server } = await setupOutline(page);
    const otherTitle = page.locator(
      `.adrc-outline-row[data-path="${fixtures.OTHER_PATH}"]`,
      { hasText: 'Other Document' }
    );
    await otherTitle.locator('.adrc-outline-chevron').click();
    await expect(page.locator(`.adrc-outline-row[data-path="${fixtures.OTHER_PATH}"]`)).toHaveCount(1);

    await otherTitle.locator('.adrc-outline-label').click();
    await waitForAdoReady(page, fixtures.OTHER_PATH, userThreadCount(server.threads));
    await waitForOutlineReady(page, FILE_COUNT, HEADING_COUNT);
    await expect(page.locator('.markdown-preview-container h1', { hasText: 'Other Document' }))
      .toHaveClass(/adrc-section-collapsed/);
    await expect(page.locator('.markdown-preview-container h2', { hasText: 'Notes' }))
      .toHaveClass(/adrc-collapsed-hidden/);
  });

  test('bulk Fold H2 and Expand all stay synchronized with the active file', async ({ page }) => {
    await setupOutline(page);
    await page.locator('.adrc-outline-fold-level[data-level="2"]').click();
    await expect(page.locator('.markdown-preview-container h2.adrc-section-collapsed')).toHaveCount(3);

    const state = await page.evaluate(() => window.ADORC_probe.outline());
    const design = state.files.find((file) => file.path === '/docs/design.md');
    expect(design.headings.filter((heading) => heading.level === 2 && heading.collapsed)).toHaveLength(3);

    await page.locator('.adrc-outline-expand-all').click();
    await expect(page.locator('.markdown-preview-container h2.adrc-section-collapsed')).toHaveCount(0);
    await expect(page.locator(`.adrc-outline-row[data-path="${fixtures.DESIGN_PATH}"]`)).toHaveCount(4);
  });

  test('deleted files show state without entering the Preview retry loop', async ({ page }) => {
    await setupOutline(page);
    const deleted = page.locator(`.adrc-outline-file[data-path="${fixtures.DELETED_PATH}"]`);
    await expect(deleted).toContainText('DELETED');
    await expect(deleted.locator('.adrc-outline-file-badge-deleted')).toHaveCount(1);
    await deleted.click();

    await expect.poll(() => new URL(page.url()).searchParams.get('path')).toBe(fixtures.DELETED_PATH);
    await expect(page.locator('.markdown-preview-container:visible')).toHaveCount(0);
    expect((await page.evaluate(() => window.ADORC_probe.viewMode())).pendingOutlineJump).toBeNull();
  });
});
