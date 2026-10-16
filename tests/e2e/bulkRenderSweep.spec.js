'use strict';

const { test, expect } = require('@playwright/test');
const {
  setupFixture,
  gotoPRPage,
  injectExtension,
  waitForInit,
} = require('./_helpers');

const paths = ['docs/first.md', 'docs/second.md'];
const rawSource = {
  [paths[0]]: '# First\n\nRendered content.\n',
  [paths[1]]: '# Second\n\nRendered content.\n',
};
const routeData = {
  diffSummaries: paths.map((path, index) => ({
    path,
    pathDigest: `bulk${index}`,
    changeType: 'MODIFIED',
  })),
  comparison: { fullDiff: { headOid: 'a'.repeat(40) } },
};

async function setupBulkRenderPage(page) {
  await setupFixture(page, 'bulk-render', { rawSource, routeData });
  await gotoPRPage(page);
  await injectExtension(page);
  await waitForInit(page);
  await expect(page.locator('.grdc-sidebar-render-md')).toBeVisible();
}

async function startSweep(page) {
  await page.evaluate(() => {
    window.__renderProgress = [];
    window.__blockedShortcutCount = 0;
    const observer = new MutationObserver(() => {
      const status = document.querySelector('.grdc-render-overlay-status');
      if (status && !window.__renderProgress.includes(status.textContent)) {
        window.__renderProgress.push(status.textContent);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.__renderProgressObserver = observer;
  });
  await page.evaluate(() => document.querySelector('.grdc-sidebar-render-md').click());
  await expect(page.locator('.grdc-render-overlay')).toBeVisible();
}

test('bulk render discovers lazy-mounted files and reports real progress', async ({ page }) => {
  await setupBulkRenderPage(page);
  await page.evaluate(() => {
    window.__bulkFirstRenderedHeight = 1600;
    window.__bulkRenderDelay = 150;
    window.__bulkRenderedGrowthDelay = 250;
    document.body.style.paddingBottom = '1200px';
    window.scrollTo(0, 500);
  });
  await expect(page.locator('#diff-second')).toBeVisible();
  const startingPosition = await page.evaluate(() => {
    const container = document.querySelector('#diff-second');
    window.scrollTo(0, window.scrollY + container.getBoundingClientRect().top - 120);
    return {
      scrollY: window.scrollY,
      fileTop: Math.round(container.getBoundingClientRect().top),
    };
  });

  await startSweep(page);
  await expect(page.locator('.grdc-render-overlay')).toHaveCount(0, { timeout: 5000 });

  await expect(page.locator('button[aria-label="Display the rich diff"][aria-pressed="true"]')).toHaveCount(2);
  await expect(page.locator('.prose-diff')).toHaveCount(2);
  const progress = await page.evaluate(() => window.__renderProgress);
  expect(progress.some((text) => /Discovering Markdown files: \d+ of 2/.test(text))).toBe(true);
  expect(progress.some((text) => /Rendering Markdown files as rich diff: 2 of 2/.test(text))).toBe(true);
  expect(progress.some((text) => /Finishing rich diff: \d+ of 2/.test(text))).toBe(true);
  await expect.poll(() => page.locator('#diff-second').evaluate((container) => (
    Math.round(container.getBoundingClientRect().top)
  ))).toBe(startingPosition.fileTop);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(startingPosition.scrollY);
});

test('Cancel stops the sweep, blocks navigation shortcuts, and restores scroll', async ({ page }) => {
  await setupBulkRenderPage(page);
  await page.evaluate(() => window.scrollTo(0, 180));
  const startingScroll = await page.evaluate(() => window.scrollY);
  await page.evaluate(() => {
    window.__bulkMountThreshold = 30000;
    document.querySelector('.file-spacer').style.height = '32000px';
  });

  await startSweep(page);
  await page.evaluate(() => {
    document.addEventListener('keydown', () => { window.__blockedShortcutCount++; }, true);
  });
  await page.keyboard.press('Tab');
  await expect(page.locator('.grdc-render-overlay-cancel')).toBeFocused();
  await page.evaluate(() => { window.__blockedShortcutCount = 0; });
  await page.keyboard.press(']');
  expect(await page.evaluate(() => window.__blockedShortcutCount)).toBe(0);

  await page.locator('.grdc-render-overlay-cancel').click();
  await expect(page.locator('.grdc-render-overlay')).toHaveCount(0);
  await expect(page.locator('button[aria-label="Display the rich diff"][aria-pressed="true"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(startingScroll);
});

test('Escape cancels the sweep', async ({ page }) => {
  await setupBulkRenderPage(page);
  await startSweep(page);

  await page.keyboard.press('Escape');
  await expect(page.locator('.grdc-render-overlay')).toHaveCount(0);
  await expect(page.locator('button[aria-label="Display the rich diff"][aria-pressed="true"]')).toHaveCount(0);
});
