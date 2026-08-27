'use strict';

const { test, expect } = require('@playwright/test');
const { setupAdoExtensionPage } = require('./_helpers');

test.describe('ADO sidebar and keyboard navigation', () => {
  test.beforeEach(async ({ page }) => {
    await setupAdoExtensionPage(page);
  });

  test('switches all panes, keeps navigation while collapsed, and resets layout', async ({ page }) => {
    const sidebar = page.locator('.adrc-sidebar');
    await expect(sidebar.locator('.adrc-sidebar-tab[data-tab="changes"]')).toHaveClass(/adrc-sidebar-tab-active/);

    await page.keyboard.press('3');
    await expect(sidebar.locator('.adrc-sidebar-tab[data-tab="outline"]')).toHaveClass(/adrc-sidebar-tab-active/);
    await page.keyboard.press('2');
    await expect(sidebar.locator('.adrc-sidebar-tab[data-tab="threads"]')).toHaveClass(/adrc-sidebar-tab-active/);

    await page.keyboard.press('t');
    await expect(sidebar).toHaveClass(/adrc-sidebar-collapsed/);
    await expect(sidebar.locator('.adrc-sidebar-changes-nav')).toBeVisible();
    await expect(sidebar.locator('.adrc-sidebar-thread-nav')).toBeVisible();
    await expect(sidebar.locator('.adrc-sidebar-collapse')).toHaveAttribute('aria-expanded', 'false');

    await page.keyboard.press('Shift+T');
    await expect(sidebar).not.toHaveClass(/adrc-sidebar-collapsed/);
    await expect(sidebar.locator('.adrc-sidebar-tab[data-tab="threads"]')).toHaveClass(/adrc-sidebar-tab-active/);
    const state = await page.evaluate(() => JSON.parse(localStorage.getItem('adrc-sidebar-state-v1')));
    expect(state.visible).toBe(true);
    expect(state.collapsed).toBe(false);
    expect(state.tab).toBe('threads');
    expect(state.width).toBe(340);
    expect(state.height).toBe(480);
  });

  test('does not hijack sidebar shortcuts while the user is typing', async ({ page }) => {
    const sidebar = page.locator('.adrc-sidebar');
    const before = await page.evaluate(() => window.ADORC_probe.sidebar().state);
    const h1 = page.locator('.markdown-preview-container h1', { hasText: 'Design Review' });
    await h1.hover();
    await h1.locator('.adrc-comment-btn').dispatchEvent('click');

    const textarea = page.locator('.adrc-compose-editor textarea');
    await textarea.press('t');
    await textarea.press('1');
    await expect(textarea).toHaveValue('t1');

    const after = await page.evaluate(() => window.ADORC_probe.sidebar().state);
    expect(after.collapsed).toBe(before.collapsed);
    expect(after.tab).toBe(before.tab);
    await expect(sidebar.locator('.adrc-sidebar-tab[data-tab="changes"]')).toHaveClass(/adrc-sidebar-tab-active/);
  });

  test('walks current-file threads with j/k and boundary keys', async ({ page }) => {
    await page.keyboard.press('3');
    await page.keyboard.press('h');
    await expect.poll(() => page.evaluate(() => window.ADORC_probe.sidebar().activeThreadId)).toBe('101');

    await page.keyboard.press('j');
    await expect.poll(() => page.evaluate(() => window.ADORC_probe.sidebar().activeThreadId)).toBe('102');
    await expect(page.locator('.adrc-sidebar-thread-count span')).toHaveText('2/3');
    await expect(page.locator('.adrc-thread-panel[data-thread-id="102"]')).toBeVisible();

    await page.keyboard.press('k');
    await expect.poll(() => page.evaluate(() => window.ADORC_probe.sidebar().activeThreadId)).toBe('101');
    await expect(page.locator('.adrc-sidebar-thread-count span')).toHaveText('1/3');
    // Thread navigation preserves the pane the reviewer was using.
    await expect(page.locator('.adrc-sidebar-tab[data-tab="outline"]')).toHaveClass(/adrc-sidebar-tab-active/);
  });

  test('filters resolved threads without changing the PR-wide total', async ({ page }) => {
    await page.keyboard.press('2');
    const filter = page.locator('.adrc-sidebar-filter');
    await filter.click();

    await expect(page.locator('.adrc-sidebar-thread-card')).toHaveCount(2);
    await expect(page.locator('.adrc-sidebar-thread-card[data-thread-id="102"]')).toHaveCount(0);
    await expect(page.locator('[data-count="threads"]')).toHaveText('3');
    await expect(filter).toHaveAttribute('aria-pressed', 'true');
    const filtered = await page.evaluate(() => window.ADORC_probe.sidebar());
    expect(filtered.visibleThreadCount).toBe(2);

    await filter.click();
    await expect(page.locator('.adrc-sidebar-thread-card')).toHaveCount(3);
    await expect(filter).toHaveAttribute('aria-pressed', 'false');
  });

  test('keeps thread groups in stable file order while highlighting the current file', async ({ page }) => {
    await page.keyboard.press('2');
    const groups = page.locator('.adrc-sidebar-thread-list > .adrc-sidebar-file-group');
    await expect(groups).toHaveText(['docs/design.md', 'docs/other.md']);

    await page.locator('.adrc-sidebar-thread-card[data-thread-id="103"]').click();
    await expect.poll(() => new URL(page.url()).searchParams.get('path')).toBe('/docs/other.md');
    await expect(groups).toHaveText(['docs/design.md', 'docs/other.md']);
    await expect(groups.nth(0)).not.toHaveClass(/adrc-sidebar-file-current/);
    await expect(groups.nth(1)).toHaveClass(/adrc-sidebar-file-current/);
  });

  test('same-file change cards scroll the nested ADO content surface', async ({ page }) => {
    const changeCount = await page.evaluate(() => window.ADORC_probe.sidebar().changeCount);
    expect(changeCount).toBeGreaterThanOrEqual(2);

    const designCards = page.locator('.adrc-sidebar-change-card[data-path="/docs/design.md"]');
    await expect(designCards).toHaveCount(3);
    await designCards.nth(2).click();
    await expect.poll(() => page.evaluate(() => window.ADORC_probe.sidebar().activeChangeIndex))
      .toBe(2);
    await expect(page.locator('.adrc-sidebar-changes-count span')).toHaveText(`3/3 (${changeCount})`);
    await expect.poll(() => page.locator('#preview-scroll').evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await expect(page.locator('.markdown-preview-container .adrc-change-target-pulse')).toHaveCount(1);
  });

  test('folds heading sections and navigates through the Outline pane', async ({ page }) => {
    const architecture = page.locator('.markdown-preview-container h2', { hasText: 'Architecture' });
    const toggle = architecture.locator('.adrc-collapse-toggle');
    await toggle.dispatchEvent('click');
    await expect(architecture).toHaveClass(/adrc-section-collapsed/);
    await expect(page.locator('.markdown-preview-container p', { hasText: 'The worker uses a durable queue.' }))
      .toHaveClass(/adrc-collapsed-hidden/);

    await toggle.dispatchEvent('click');
    await expect(architecture).not.toHaveClass(/adrc-section-collapsed/);

    await page.keyboard.press('3');
    const implementation = page.locator('.adrc-outline-row', { hasText: 'Implementation' });
    await implementation.click();
    await expect(implementation).toHaveClass(/adrc-outline-active/);
    await expect.poll(() => page.locator('#preview-scroll').evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
  });

  test('drags the sidebar header and persists the resulting position', async ({ page }) => {
    const sidebar = page.locator('.adrc-sidebar');
    const spacer = sidebar.locator('.adrc-sidebar-header-spacer');
    const [before, spacerBox] = await Promise.all([sidebar.boundingBox(), spacer.boundingBox()]);
    expect(before).not.toBeNull();
    expect(spacerBox).not.toBeNull();

    await page.mouse.move(spacerBox.x + spacerBox.width / 2, spacerBox.y + spacerBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(spacerBox.x + spacerBox.width / 2 - 70, spacerBox.y + spacerBox.height / 2 + 35, { steps: 5 });
    await page.mouse.up();

    const after = await sidebar.boundingBox();
    expect(after.x).toBeLessThan(before.x - 40);
    expect(after.y).toBeGreaterThan(before.y + 20);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('adrc-sidebar-state-v1')));
    expect(stored.left).toBeCloseTo(after.x, 0);
    expect(stored.top).toBeCloseTo(after.y, 0);
  });
});
