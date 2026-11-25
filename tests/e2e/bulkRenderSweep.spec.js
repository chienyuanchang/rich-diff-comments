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
    markersMap: index === 0 ? { R3: { threads: [{ id: 'bulk-thread' }] } } : {},
  })),
  markers: {
    threads: {
      'bulk-thread': {
        id: 'bulk-thread',
        subjectType: 'LINE',
        viewerCanReply: true,
        viewerCanResolve: true,
        commentsData: {
          comments: [{
            databaseId: 9001,
            body: 'Thread loaded after bulk rich-diff rendering.',
            author: { login: 'reviewer', avatarUrl: '' },
            createdAt: '2026-10-16T10:00:00.000Z',
          }],
        },
      },
    },
  },
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
    window.__indeterminateProgress = [];
    window.__indeterminateProgressMoved = false;
    window.__blockedShortcutCount = 0;
    const observer = new MutationObserver(() => {
      const status = document.querySelector('.grdc-render-overlay-status');
      const progress = document.querySelector('.grdc-render-overlay-progress');
      if (status && !window.__renderProgress.includes(status.textContent)) {
        window.__renderProgress.push(status.textContent);
      }
      if (status && progress && progress.classList.contains('grdc-render-overlay-progress-indeterminate') &&
          !window.__indeterminateProgress.includes(status.textContent)) {
        window.__indeterminateProgress.push(status.textContent);
        if (!window.__indeterminateProgressMotionStarted) {
          window.__indeterminateProgressMotionStarted = true;
          const indicator = progress.querySelector('span');
          const initialTransform = getComputedStyle(indicator).transform;
          setTimeout(() => {
            window.__indeterminateProgressMoved =
              initialTransform !== getComputedStyle(indicator).transform;
          }, 150);
        }
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    window.__renderProgressObserver = observer;
  });
  await page.evaluate(() => document.querySelector('.grdc-sidebar-render-md').click());
  await expect(page.locator('.grdc-render-overlay')).toBeVisible();
}

test('selected Markdown auto-renders only when enabled and follows the latest selection', async ({ page }) => {
  await setupBulkRenderPage(page);
  await page.evaluate(() => {
    history.replaceState(null, '', '?mode=virtualization');
    const nav = document.createElement('nav');
    nav.innerHTML = '<a href="#diff-bulk0" title="docs/first.md">First</a>' +
      '<a href="#diff-bulk1" title="docs/second.md">Second</a>';
    document.body.prepend(nav);
    nav.lastElementChild.addEventListener('click', () => {
      setTimeout(() => {
        const mount = document.getElementById('lazy-file-mount');
        if (!mount.querySelector('#diff-second')) {
          mount.appendChild(document.getElementById('second-file-template').content.cloneNode(true));
        }
      }, 400);
    });
  });
  const first = page.getByRole('link', { name: 'First', exact: true });
  const second = page.getByRole('link', { name: 'Second', exact: true });
  await first.click();
  await expect(page.locator('#diff-first .prose-diff')).toHaveCount(0);
  await page.getByRole('button', { name: /^View options/ }).click();
  await page.getByRole('checkbox', { name: 'Render Markdown when selected' }).check();
  await page.keyboard.press('Escape');

  await second.click();
  await first.click();
  await expect(page.locator('#diff-first .prose-diff')).toHaveCount(1);
  await expect(page.locator('#diff-second')).toBeVisible();
  await page.waitForTimeout(600);
  await expect(page.locator('#diff-second .prose-diff')).toHaveCount(0);
  await expect(page.locator('.grdc-render-overlay')).toHaveCount(0);
  await expect(page.locator('.grdc-existing-thread')).toHaveCount(1);
  await second.click();
  await expect(page.locator('#diff-second .prose-diff')).toHaveCount(1);
});

test('a fast newer selection is not pulled back when an earlier auto-render finishes', async ({ page }) => {
  await setupBulkRenderPage(page);
  await page.evaluate(() => {
    document.body.style.paddingBottom = '3000px';
    const mount = document.getElementById('lazy-file-mount');
    if (!mount.querySelector('#diff-second')) {
      mount.appendChild(document.getElementById('second-file-template').content.cloneNode(true));
    }
    const nav = document.createElement('nav');
    nav.style.position = 'fixed';
    nav.style.top = '0';
    nav.style.zIndex = '10000';
    nav.innerHTML = '<a href="#diff-bulk0" title="docs/first.md">First</a> ' +
      '<a href="#diff-bulk1" title="docs/second.md">Second</a>';
    document.body.prepend(nav);
    nav.lastElementChild.addEventListener('click', (event) => {
      event.preventDefault();
      document.getElementById('diff-second').scrollIntoView({ block: 'start' });
    });
    nav.firstElementChild.addEventListener('click', (event) => {
      event.preventDefault();
      document.getElementById('diff-first').scrollIntoView({ block: 'start' });
    });
  });
  await page.getByRole('button', { name: /^View options/ }).click();
  await page.getByRole('checkbox', { name: 'Render Markdown when selected' }).check();
  await page.keyboard.press('Escape');

  await page.getByRole('link', { name: 'First', exact: true }).click();
  await expect(page.locator('#diff-first .prose-diff')).toHaveCount(1);
  await page.getByRole('link', { name: 'Second', exact: true }).click();
  const secondTop = await page.evaluate(() => window.scrollY);
  expect(secondTop).toBeGreaterThan(1000);
  await page.waitForTimeout(900);
  expect(Math.abs(await page.evaluate(() => window.scrollY) - secondTop)).toBeLessThan(200);
});

test('a newer file selection finishes its smooth scroll during auto-render refresh', async ({ page }) => {
  await setupBulkRenderPage(page);
  await page.evaluate(() => {
    document.body.style.paddingBottom = '3000px';
    document.querySelector('.file-spacer').style.height = '6500px';
    window.scrollTo(0, 500);
  });
  await expect(page.locator('#diff-second')).toBeVisible();
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    const nav = document.createElement('nav');
    nav.style.cssText = 'position: fixed; top: 0; z-index: 10000';
    nav.innerHTML = '<a href="#diff-bulk0" title="docs/first.md">First</a> ' +
      '<a href="#diff-bulk1" title="docs/second.md">Second</a>';
    nav.addEventListener('click', (event) => {
      event.preventDefault();
      const target = event.target.title === 'docs/first.md' ? 'diff-first' : 'diff-second';
      document.getElementById(target).scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    document.body.prepend(nav);
  });
  await page.getByRole('button', { name: /^View options/ }).click();
  await page.getByRole('checkbox', { name: 'Render Markdown when selected' }).check();
  await page.keyboard.press('Escape');

  await page.getByRole('link', { name: 'First', exact: true }).click();
  await expect(page.locator('#diff-first .prose-diff')).toHaveCount(1);
  await page.getByRole('link', { name: 'Second', exact: true }).click();
  await expect(page.locator('#diff-second .prose-diff')).toHaveCount(1);
  await expect.poll(async () => page.locator('#diff-second').evaluate(el => Math.abs(el.getBoundingClientRect().top)), {
    timeout: 3000,
  }).toBeLessThan(20);
  await page.waitForTimeout(500);
  expect(Math.abs(await page.locator('#diff-second').evaluate(el => el.getBoundingClientRect().top))).toBeLessThan(20);

  await page.locator('#diff-second .markdown-body').evaluate((body) => {
    body.appendChild(document.createElement('p'));
  });
  await page.evaluate(() => window.scrollTo({ top: 3000, behavior: 'instant' }));
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(3000, 0);
});

test('a manually selected source view stays in source when the file is selected again', async ({ page }) => {
  await setupBulkRenderPage(page);
  await page.evaluate(() => {
    const nav = document.createElement('a');
    nav.href = '#diff-bulk0';
    nav.title = 'docs/first.md';
    nav.textContent = 'Select first file';
    document.body.prepend(nav);
    const header = document.querySelector('#diff-first .file-header');
    const source = document.createElement('button');
    source.setAttribute('aria-label', 'Display the source diff');
    source.textContent = 'Source';
    source.addEventListener('click', () => {
      document.querySelector('#diff-first .prose-diff')?.remove();
      header.querySelector('[aria-label="Display the rich diff"]').setAttribute('aria-pressed', 'false');
    });
    header.appendChild(source);
  });
  await page.getByRole('button', { name: /^View options/ }).click();
  await page.getByRole('checkbox', { name: 'Render Markdown when selected' }).check();
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Select first file' }).click();
  await expect(page.locator('#diff-first .prose-diff')).toHaveCount(1);
  await page.getByRole('button', { name: 'Display the source diff' }).click();
  await expect(page.locator('#diff-first .prose-diff')).toHaveCount(0);
  await page.getByRole('link', { name: 'Select first file' }).click();
  await page.waitForTimeout(500);
  await expect(page.locator('#diff-first .prose-diff')).toHaveCount(0);
});

test('bulk render discovers lazy-mounted files and reports real progress', async ({ page }) => {
  await setupBulkRenderPage(page);
  await expect(page.locator('.grdc-existing-thread')).toHaveCount(0);
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
  await page.locator('.grdc-sidebar-collapse').click();
  await expect(page.locator('.grdc-sidebar')).toHaveClass(/grdc-sidebar-collapsed/);

  await startSweep(page);
  await expect(page.locator('.grdc-render-overlay')).toHaveCount(0, { timeout: 8000 });

  await expect(page.locator('button[aria-label="Display the rich diff"][aria-pressed="true"]')).toHaveCount(2);
  await expect(page.locator('.prose-diff')).toHaveCount(2);
  const progress = await page.evaluate(() => window.__renderProgress);
  expect(progress.some((text) => /Discovering Markdown files: \d+ of 2/.test(text))).toBe(true);
  expect(progress.some((text) => /Rendering Markdown files as rich diff: 2 of 2/.test(text))).toBe(true);
  expect(progress.some((text) => /Finishing rich diff: \d+ of 2/.test(text))).toBe(true);
  expect(progress).toContain('Loading review threads…');
  const indeterminateProgress = await page.evaluate(() => window.__indeterminateProgress);
  expect(indeterminateProgress.some((text) => /Finishing rich diff: \d+ of 2/.test(text))).toBe(true);
  expect(indeterminateProgress).toContain('Loading review threads…');
  expect(await page.evaluate(() => window.__indeterminateProgressMoved)).toBe(true);
  await expect(page.locator('.grdc-existing-thread')).toHaveCount(1);
  await expect(page.locator('.grdc-sidebar-list .grdc-sidebar-card')).toHaveCount(1);
  await expect.poll(() => page.locator('#diff-second').evaluate((container) => (
    Math.round(container.getBoundingClientRect().top)
  ))).toBe(startingPosition.fileTop);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(startingPosition.scrollY);
  await expect(page.locator('.grdc-sidebar')).toHaveClass(/grdc-sidebar-collapsed/);
  await expect(page.locator('.grdc-sidebar-tab[data-grdc-tab="outline"]')).toHaveClass(/grdc-sidebar-tab-active/);
  expect(await page.evaluate(() => localStorage.getItem('grdc_sidebar_collapsed'))).toBe('1');

  await page.locator('.grdc-sidebar-collapse').click();
  await expect(page.locator('.grdc-sidebar-pane-outline')).toBeVisible();
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
