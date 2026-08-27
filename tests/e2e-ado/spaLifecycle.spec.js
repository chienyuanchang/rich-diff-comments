'use strict';

const { test, expect } = require('@playwright/test');
const {
  setupAdoExtensionPage,
  waitForAdoReady,
  userThreadCount,
} = require('./_helpers');
const fixtures = require('./fixtures/sources');

test.describe('ADO SPA lifecycle and cross-file navigation', () => {
  test('opens a cross-file thread through the native tree row without reloading or leaving Preview', async ({ page }) => {
    const { server } = await setupAdoExtensionPage(page);
    await page.evaluate(() => { window.__initialAdoPreview = window.__ADO_FIXTURE__.preview; });
    await page.keyboard.press('2');

    await page.locator(`.adrc-sidebar-thread-card[data-path="${fixtures.OTHER_PATH}"]`).click();
    await waitForAdoReady(page, fixtures.OTHER_PATH, userThreadCount(server.threads));

    expect(new URL(page.url()).searchParams.get('path')).toBe(fixtures.OTHER_PATH);
    await expect(page.locator('.markdown-preview-container h1')).toContainText('Other Document');
    await expect(page.locator('.adrc-thread-badge[data-thread-id="103"]')).toHaveCount(1);
    await expect(page.locator('.adrc-thread-badge[data-thread-id="101"]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__initialAdoPreview === window.__ADO_FIXTURE__.preview)).toBe(true);
    expect(server.pageLoads).toBe(1);

    const mode = await page.evaluate(() => window.ADORC_probe.viewMode());
    expect(mode.previewVisible).toBe(true);
    expect(mode.pendingThreadJump).toBeNull();
    expect(mode.currentMode).toBe('preview');
  });

  test('reinitializes a reused Preview container without stale buttons, badges, headings, or duplicate sidebars', async ({ page }) => {
    const { server } = await setupAdoExtensionPage(page);

    await page.evaluate((path) => window.__ADO_FIXTURE__.openPath(path), fixtures.OTHER_PATH);
    await waitForAdoReady(page, fixtures.OTHER_PATH, userThreadCount(server.threads));
    await expect(page.locator('.markdown-preview-container h1')).toContainText('Other Document');
    await expect(page.locator('.markdown-preview-container .adrc-comment-btn')).toHaveCount(4);
    await expect(page.locator('.adrc-thread-badge')).toHaveCount(1);
    expect((await page.evaluate(() => window.ADORC_probe.sidebar())).outlineCount).toBe(2);

    await page.evaluate((path) => window.__ADO_FIXTURE__.openPath(path), fixtures.DESIGN_PATH);
    await waitForAdoReady(page, fixtures.DESIGN_PATH, userThreadCount(server.threads));
    await expect(page.locator('.markdown-preview-container h1')).toContainText('Design Review');
    await expect(page.locator('.adrc-thread-badge')).toHaveCount(2);
    await expect(page.locator('.adrc-sidebar')).toHaveCount(1);
    await expect(page.locator('.adrc-sidebar-launcher')).toHaveCount(1);

    const outline = await page.evaluate(() => window.ADORC_probe.outline());
    expect(outline.cachedFilePath).toBe(fixtures.DESIGN_PATH);
    expect(outline.headings.map((heading) => heading.text)).toEqual([
      'Design Review', 'Architecture', 'Implementation', 'Ownership'
    ]);
    expect(outline.staleHeadingCount).toBe(0);
  });

  test('rejects a slow prior-file source response after a rapid route switch', async ({ page }) => {
    const { server, logs } = await setupAdoExtensionPage(page);
    server.sourceDelays[`branch:${fixtures.OTHER_PATH}`] = 700;

    await page.evaluate((path) => window.__ADO_FIXTURE__.openPath(path), fixtures.OTHER_PATH);
    await expect.poll(() => server.requests.filter((request) => {
      if (request.method !== 'GET' || !request.pathname.endsWith('/items')) return false;
      const url = new URL(request.url);
      return url.searchParams.get('path') === fixtures.OTHER_PATH &&
        url.searchParams.get('versionDescriptor.versionType') === 'branch';
    }).length).toBe(1);

    await page.evaluate((path) => window.__ADO_FIXTURE__.openPath(path), fixtures.DESIGN_PATH);
    await expect.poll(() => server.completedSources.some((entry) =>
      entry.path === fixtures.OTHER_PATH && entry.versionType === 'branch'
    )).toBe(true);
    await waitForAdoReady(page, fixtures.DESIGN_PATH, userThreadCount(server.threads));

    const state = await page.evaluate(() => ({
      sidebar: window.ADORC_probe.sidebar(),
      outline: window.ADORC_probe.outline(),
      title: document.querySelector('.markdown-preview-container h1')?.textContent,
      buttonCount: document.querySelectorAll('.markdown-preview-container .adrc-comment-btn').length,
    }));
    expect(state.sidebar.currentFile).toBe(fixtures.DESIGN_PATH);
    expect(state.outline.cachedFilePath).toBe(fixtures.DESIGN_PATH);
    expect(state.title).toContain('Design Review');
    expect(state.buttonCount).toBeGreaterThan(4);
    expect(logs.filter((line) => line.includes('Initialized:') && line.includes(fixtures.OTHER_PATH)))
      .toHaveLength(0);
  });
});
