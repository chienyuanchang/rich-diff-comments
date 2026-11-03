const { test, expect } = require('@playwright/test');
const {
  setupFixture,
  gotoPRPage,
  injectExtension,
  waitForInit,
} = require('./_helpers');
const sources = require('./fixtures/sources');

const fixture = sources.yamlFrontmatter;

async function expectNextMarkdownAction(page) {
  await expect(page.locator('.grdc-sidebar-render-md')).toBeVisible();
  await expect(page.locator('.grdc-sidebar-render-md')).toHaveAttribute('aria-label', 'Switch next Markdown to rich diff');
  await expect(page.getByText(/Review Markdown files one at a time/i).first()).toBeVisible();
  await expect(page.getByText(/switch each file to rich diff as needed/i).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Switch next Markdown to rich diff' }).first()).toBeVisible();
}

test('mode=virtualization waits for a delayed file header before switching rich diff', async ({ page }) => {
  const paths = ['docs/first.md', 'docs/second.md'];
  await setupFixture(page, 'bulk-render', {
    rawSource: {
      [paths[0]]: '# First\n\nRendered content.\n',
      [paths[1]]: '# Second\n\nRendered content.\n',
    },
    routeData: {
      diffSummaries: paths.map((path, index) => ({
        path,
        pathDigest: index === 0 ? 'first' : 'second',
        changeType: 'MODIFIED',
        markersMap: {},
      })),
      markers: { threads: {} },
      headOid: 'a'.repeat(40),
    },
  });
  await gotoPRPage(page);
  await page.evaluate(() => {
    window.__bulkMountThreshold = Number.MAX_SAFE_INTEGER;
    history.replaceState(null, '', '/test-owner/test-repo/pull/1/changes?mode=virtualization#diff-first');
    const destination = document.createElement('a');
    destination.href = '#diff-second';
    destination.title = 'docs/second.md';
    destination.textContent = 'Second Markdown';
    destination.addEventListener('click', () => {
      const template = document.getElementById('second-file-template');
      const mount = document.getElementById('lazy-file-mount');
      if (template && mount && !document.getElementById('diff-second')) {
        const placeholder = document.createElement('div');
        placeholder.id = 'diff-second';
        placeholder.dataset.tagsearchPath = 'docs/second.md';
        mount.appendChild(placeholder);
        document.getElementById('diff-first')?.remove();
        setTimeout(() => {
          placeholder.replaceWith(template.content.cloneNode(true));
        }, 300);
      }
    });
    document.body.prepend(destination);
  });
  await injectExtension(page);
  await waitForInit(page);

  await expectNextMarkdownAction(page);
  await page.locator('.grdc-sidebar-tab[data-grdc-tab="threads"]').click();
  await page.locator('.grdc-sidebar-collapse').click();
  await expect(page.locator('.grdc-sidebar')).toHaveClass(/grdc-sidebar-collapsed/);
  await page.locator('.grdc-sidebar-render-md').click();

  await expect(page.locator('#diff-second button[aria-label="Display the rich diff"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#diff-second .prose-diff')).toBeVisible();
  await expect(page.locator('#diff-first')).toHaveCount(0);
  await expect(page.locator('.grdc-sidebar-render-md')).toBeDisabled();
  await expect(page.locator('.grdc-sidebar-render-md')).toHaveAttribute('aria-label', 'No later Markdown files remain');
  await expect(page.locator('.grdc-sidebar-render-md')).not.toHaveClass(/grdc-sidebar-switching/);
  await expect(page.locator('.grdc-sidebar-tab[data-grdc-tab="threads"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.grdc-sidebar')).toHaveClass(/grdc-sidebar-collapsed/);
  await expect(page.locator('.grdc-render-overlay')).toHaveCount(0);
});

test('single-file transition link remains a fallback large-PR signal', async ({ page }) => {
  await setupFixture(page, 'yaml-frontmatter', {
    rawSource: { [fixture.path]: fixture.source },
  });
  await gotoPRPage(page);
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.href = '/test-owner/test-repo/pull/1/changes?mode=single#diff-example';
    link.textContent = 'Switch to single file mode';
    document.body.prepend(link);
  });
  await injectExtension(page);
  await waitForInit(page);

  await expect(page.locator('.grdc-sidebar-render-md')).toBeDisabled();
  await expect(page.locator('.grdc-sidebar-render-md')).toHaveAttribute('aria-label', 'No later Markdown files remain');
  await expect(page.getByText('No later Markdown files remain in this pull request.').first()).toBeVisible();
});

test('failed next-file navigation remains retryable without starting a bulk sweep', async ({ page }) => {
  await setupFixture(page, 'yaml-frontmatter', {
    rawSource: { [fixture.path]: fixture.source },
    routeData: {
      diffSummaries: [
        { path: fixture.path, pathDigest: 'test1', changeType: 'MODIFIED', markersMap: {} },
        { path: 'docs/unreachable.md', changeType: 'MODIFIED', markersMap: {} },
      ],
      markers: { threads: {} },
      headOid: 'a'.repeat(40),
    },
  });
  await gotoPRPage(page);
  await page.evaluate(() => history.replaceState(null, '', '/test-owner/test-repo/pull/1/changes?mode=virtualization#diff-test1'));
  await injectExtension(page);
  await waitForInit(page);

  const button = page.getByRole('button', { name: 'Switch next Markdown to rich diff' }).first();
  await button.click();

  await expect(page.getByRole('button', { name: 'Try next Markdown again' }).first()).toBeEnabled();
  await expect(page.locator('.grdc-render-overlay')).toHaveCount(0);
  await expect(page.locator('button[aria-label="Display the rich diff"]')).toHaveCount(0);
});

test('tab selected while next Markdown loads remains selected', async ({ page }) => {
  const paths = ['docs/first.md', 'docs/second.md'];
  await setupFixture(page, 'bulk-render', {
    rawSource: {
      [paths[0]]: '# First\n',
      [paths[1]]: '# Second\n',
    },
    routeData: {
      diffSummaries: paths.map((path, index) => ({
        path,
        pathDigest: index === 0 ? 'first' : 'second',
        changeType: 'MODIFIED',
        markersMap: {},
      })),
      markers: { threads: {} },
      headOid: 'a'.repeat(40),
    },
  });
  await gotoPRPage(page);
  await page.evaluate(() => {
    window.__bulkMountThreshold = Number.MAX_SAFE_INTEGER;
    window.__bulkRenderDelay = 300;
    history.replaceState(null, '', '/test-owner/test-repo/pull/1/changes?mode=virtualization#diff-first');
    const destination = document.createElement('a');
    destination.href = '#diff-second';
    destination.title = 'docs/second.md';
    destination.addEventListener('click', () => {
      const template = document.getElementById('second-file-template');
      const mount = document.getElementById('lazy-file-mount');
      if (template && mount && !document.getElementById('diff-second')) {
        mount.appendChild(template.content.cloneNode(true));
      }
    });
    document.body.prepend(destination);
  });
  await injectExtension(page);
  await waitForInit(page);

  await page.locator('.grdc-sidebar-tab[data-grdc-tab="threads"]').click();
  await page.locator('.grdc-sidebar-render-md').click();
  await expect(page.locator('.grdc-sidebar-render-md')).toHaveClass(/grdc-sidebar-switching/);
  await page.locator('.grdc-sidebar-tab[data-grdc-tab="changes"]').click();

  await expect(page.locator('#diff-second .prose-diff')).toBeVisible();
  await expect(page.locator('.grdc-sidebar-tab[data-grdc-tab="changes"]')).toHaveAttribute('aria-selected', 'true');
});
