'use strict';

const { test, expect } = require('@playwright/test');
const {
  setupFixture,
  gotoPRPage,
  injectExtension,
  waitForInit,
} = require('./_helpers');
const fixtures = require('./fixtures/sources');

function makeComment(databaseId, body, url) {
  return {
    databaseId,
    body,
    url,
    author: { login: 'reviewer', avatarUrl: '' },
    createdAt: '2026-09-23T12:00:00.000Z',
  };
}

function routeDataWithCommentLinks() {
  return {
    diffSummaries: [{
      path: fixtures.yamlFrontmatter.path,
      pathDigest: 'test1',
      changeType: 'MODIFIED',
      markersMap: {
        R24: { threads: [{ id: '201' }] },
        R26: { threads: [{ id: '202' }] },
      },
    }],
    markers: {
      threads: {
        201: {
          id: '201',
          subjectType: 'LINE',
          commentsData: {
            comments: [makeComment(
              7001,
              '**Comment** with `raw` Markdown.\n\n- First item\n- Second item',
              'https://github.com/test-owner/test-repo/pull/1#discussion_r7001'
            )],
          },
        },
        202: {
          id: '202',
          subjectType: 'LINE',
          commentsData: {
            comments: [makeComment(7002, 'Comment requiring a fallback URL.', '')],
          },
        },
      },
    },
  };
}

async function setupCommentActionsPage(page) {
  await setupFixture(page, 'yaml-frontmatter', {
    rawSource: { [fixtures.yamlFrontmatter.path]: fixtures.yamlFrontmatter.source },
    routeData: routeDataWithCommentLinks(),
  });
  await gotoPRPage(page);
  await page.evaluate(() => {
    window.__grdcCopiedText = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text) => { window.__grdcCopiedText = text; },
      },
    });
  });
  await injectExtension(page);
  await waitForInit(page);
}

test.describe('GitHub rendered comment actions', () => {
  test('copies canonical and fallback links for any visible comment', async ({ page }) => {
    await setupCommentActionsPage(page);

    const canonicalComment = page.locator('.grdc-thread-comment[data-grdc-comment-dbid="7001"]');
    const fallbackComment = page.locator('.grdc-thread-comment[data-grdc-comment-dbid="7002"]');
    const canonicalButton = canonicalComment.locator('.grdc-comment-copy-link');
    const fallbackButton = fallbackComment.locator('.grdc-comment-copy-link');

    await expect(canonicalButton).toHaveText('Copy link');
    await expect(fallbackButton).toHaveText('Copy link');
    // Neither fixture comment belongs to the signed-in fixture viewer, but
    // Copy link must remain available while owner-only Edit/Delete stay hidden.
    await expect(canonicalComment.locator('.grdc-comment-edit-link, .grdc-comment-delete-link')).toHaveCount(0);

    await canonicalButton.click();
    await expect(canonicalButton).toHaveText('Copied!');
    await expect.poll(() => page.evaluate(() => window.__grdcCopiedText)).toBe(
      'https://github.com/test-owner/test-repo/pull/1#discussion_r7001'
    );

    await fallbackButton.click();
    await expect(fallbackButton).toHaveText('Copied!');
    await expect.poll(() => page.evaluate(() => window.__grdcCopiedText)).toBe(
      'https://github.com/test-owner/test-repo/pull/1#discussion_r7002'
    );
  });

  test('shows clear failure feedback when clipboard access is rejected', async ({ page }) => {
    await setupCommentActionsPage(page);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async () => { throw new Error('denied'); } },
      });
    });

    const button = page.locator('.grdc-thread-comment[data-grdc-comment-dbid="7001"] .grdc-comment-copy-link');
    await button.click();
    await expect(button).toHaveText('Copy failed');
    await expect(button).toHaveAttribute('title', 'Could not copy comment link');
  });

  test('copies the exact raw Markdown body for every visible comment', async ({ page }) => {
    await setupCommentActionsPage(page);

    const canonicalComment = page.locator('.grdc-thread-comment[data-grdc-comment-dbid="7001"]');
    const fallbackComment = page.locator('.grdc-thread-comment[data-grdc-comment-dbid="7002"]');
    const canonicalButton = canonicalComment.locator('.grdc-comment-copy-markdown');
    const fallbackButton = fallbackComment.locator('.grdc-comment-copy-markdown');

    await expect(canonicalButton).toHaveText('Copy Markdown');
    await expect(fallbackButton).toHaveText('Copy Markdown');
    await expect(canonicalComment.locator('.grdc-comment-edit-link, .grdc-comment-delete-link')).toHaveCount(0);

    await canonicalButton.click();
    await expect(canonicalButton).toHaveText('Copied!');
    await expect.poll(() => page.evaluate(() => window.__grdcCopiedText)).toBe(
      '**Comment** with `raw` Markdown.\n\n- First item\n- Second item'
    );

    await fallbackButton.click();
    await expect(fallbackButton).toHaveText('Copied!');
    await expect.poll(() => page.evaluate(() => window.__grdcCopiedText)).toBe(
      'Comment requiring a fallback URL.'
    );
  });

  test('shows clear Copy Markdown failure feedback when clipboard access is rejected', async ({ page }) => {
    await setupCommentActionsPage(page);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async () => { throw new Error('denied'); } },
      });
    });

    const button = page.locator('.grdc-thread-comment[data-grdc-comment-dbid="7001"] .grdc-comment-copy-markdown');
    await button.click();
    await expect(button).toHaveText('Copy failed');
    await expect(button).toHaveAttribute('title', 'Could not copy comment Markdown');
  });
});
