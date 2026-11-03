'use strict';

const { test, expect } = require('@playwright/test');
const { setupFixture, gotoPRPage, injectExtension, waitForInit } = require('./_helpers');
const fixtures = require('./fixtures/sources');

const tableThreads = [
  { id: '201', line: 13, resolved: true },
  { id: '202', line: 17 },
  { id: '203', line: 20, startLine: 17, resolved: true },
  { id: '204', line: 24, resolved: true },
  { id: '205', line: 26, resolved: true },
  { id: '206', line: 26 },
];

function makeRouteData(path, pathDigest, threads) {
  const markersMap = {};
  const threadData = {};
  for (const thread of threads) {
    const key = `R${thread.line}`;
    if (!markersMap[key]) markersMap[key] = { threads: [] };
    markersMap[key].threads.push({
      id: thread.id,
      ...(thread.startLine ? { start: `R${thread.startLine}` } : {}),
    });
    threadData[thread.id] = {
      id: thread.id,
      subjectType: thread.startLine ? 'MULTI_LINE' : 'LINE',
      isResolved: !!thread.resolved,
      viewerCanReply: true,
      viewerCanResolve: true,
      commentsData: { comments: [{
        databaseId: Number(thread.id) * 10,
        body: `Conversation ${thread.id}.`,
        author: { login: 'reviewer', avatarUrl: '' },
        createdAt: '2026-11-02T12:00:00Z',
      }] },
    };
  }
  return {
    headOid: 'a'.repeat(40),
    diffSummaries: [{ path, pathDigest, changeType: 'MODIFIED', markersMap }],
    markers: { threads: threadData },
  };
}

async function setupReview(page, { code = false, savedFilter = false, extraFile = false, allResolved = false } = {}) {
  const fixture = code ? fixtures.codeMarkers : fixtures.yamlFrontmatter;
  const threads = code ? [
    { id: '301', line: 4 },
    { id: '302', line: 4, resolved: true },
    { id: '303', line: 6, resolved: true },
    { id: '304', line: 5, startLine: 4 },
  ] : tableThreads.map((thread) => ({ ...thread, resolved: allResolved || !!thread.resolved }));
  const routeData = makeRouteData(fixture.path, code ? 'code1' : 'test1', threads);
  if (extraFile) {
    const extra = makeRouteData('docs/second.md', 'second', [{ id: '801', line: 13, resolved: true }]);
    routeData.diffSummaries.push(...extra.diffSummaries);
    Object.assign(routeData.markers.threads, extra.markers.threads);
  }
  await setupFixture(page, code ? 'code-markers' : 'yaml-frontmatter', {
    rawSource: { [fixture.path]: fixture.source, 'docs/second.md': fixture.source },
    routeData,
  });
  await gotoPRPage(page);
  await page.evaluate((saved) => {
    localStorage.setItem('grdc_sidebar_pos', JSON.stringify({ left: 720, top: 8 }));
    localStorage.setItem('grdc_sidebar_unresolved_only', saved ? '1' : '0');
    const removed = document.createElement('p');
    removed.id = 'review-removed';
    removed.className = 'removed';
    removed.textContent = 'Removed document prose.';
    document.querySelector('.markdown-body').appendChild(removed);
    window.__reviewFixtureHTML = document.querySelector('[data-tagsearch-path]').innerHTML;
  }, savedFilter);
  await injectExtension(page);
  await waitForInit(page);
  return routeData;
}

function thread(page, id) {
  return page.locator(`.grdc-existing-thread[data-grdc-thread-id="${id}"]`);
}

async function openThreads(page) {
  await page.getByRole('tab', { name: 'Threads', exact: true }).click();
}

async function setViewOption(page, name, checked) {
  await page.getByRole('button', { name: 'View options', exact: true }).click();
  await page.getByRole('checkbox', { name, exact: true }).setChecked(checked);
  await page.keyboard.press('Escape');
}

test('Unresolved only hides resolved inline threads, range highlights, and resolved-only table markers', async ({ page }) => {
  await setupReview(page);
  await openThreads(page);
  const dataMarker = page.locator('.markdown-body table').last().locator('tbody .grdc-table-thread-marker');
  const headerMarker = page.locator('.markdown-body table').last().locator('thead .grdc-table-thread-marker');
  await expect(dataMarker).toHaveAttribute('data-thread-ids', '205,206');
  await expect(headerMarker).toHaveCount(1);
  await expect(page.locator('.grdc-thread-range').first()).toBeVisible();
  await thread(page, '201').locator('.grdc-thread-badge').click();
  await expect(thread(page, '201').locator('.grdc-thread-body')).toBeVisible();

  await setViewOption(page, 'Show resolved comments', false);
  for (const id of ['201', '203', '204', '205']) await expect(thread(page, id)).toBeHidden();
  for (const id of ['202', '206']) await expect(thread(page, id)).toBeVisible();
  await expect(page.locator('.grdc-thread-range')).toHaveCount(0);
  await expect(headerMarker).toHaveCount(0);
  await expect(dataMarker).toHaveAttribute('data-thread-ids', '206');
  await expect(dataMarker).toHaveAttribute('aria-label', 'Open the review thread on this table row');
  await expect(dataMarker).not.toHaveAttribute('data-count');
  await expect(page.locator('.grdc-sidebar-list .grdc-sidebar-card')).toHaveCount(2);
  await expect(page.locator('.grdc-sidebar-count')).toHaveText('1/2');
  await expect(page.getByRole('tab', { name: 'Threads', exact: true })).toHaveAttribute('aria-selected', 'true');
  await dataMarker.click();
  await expect(thread(page, '206').locator('.grdc-thread-badge')).toBeFocused();
  await dataMarker.press('Enter');
  await expect(thread(page, '206').locator('.grdc-thread-badge')).toBeFocused();
  await page.keyboard.press('j');
  await expect(page.locator('.grdc-thread-resolved .grdc-thread-flash')).toHaveCount(0);

  await setViewOption(page, 'Show resolved comments', true);
  await expect(thread(page, '201').locator('.grdc-thread-body')).toBeVisible();
  await expect(thread(page, '205').locator('.grdc-thread-body')).toBeHidden();
  await expect(headerMarker).toHaveCount(1);
  await expect(dataMarker).toHaveAttribute('data-count', '2');
  await expect(page.locator('.grdc-sidebar-list .grdc-sidebar-card')).toHaveCount(6);
  await expect(page.locator('.grdc-thread-range').first()).toBeVisible();
});

test('code markers count and cycle only unresolved conversations while filtered', async ({ page }) => {
  await setupReview(page, { code: true });
  await openThreads(page);
  const line4 = page.locator('.grdc-code-line-thread-marker[data-line="4"]');
  const line6 = page.locator('.grdc-code-line-thread-marker[data-line="6"]');
  await expect(line4).toHaveAttribute('data-count', '3');
  await expect(line6).toHaveCount(1);
  await setViewOption(page, 'Show resolved comments', false);
  await expect(line4).toHaveAttribute('data-count', '2');
  await expect(line4).toHaveAttribute('data-thread-ids', '301,304');
  await expect(line6).toHaveCount(0);
  await expect(thread(page, '302')).toBeHidden();
  await expect(thread(page, '303')).toBeHidden();
  await line4.click();
  await expect(thread(page, '301').locator('.grdc-thread-badge')).toBeFocused();
  await line4.press('Enter');
  await expect(thread(page, '304').locator('.grdc-thread-badge')).toBeFocused();
  await setViewOption(page, 'Show resolved comments', true);
  await expect(line6).toHaveCount(1);
  await expect(line4).toHaveAttribute('data-count', '3');
});

test('the collapsed funnel and persisted filter also apply to newly rendered files', async ({ page }) => {
  await setupReview(page, { savedFilter: true, extraFile: true });
  await expect(thread(page, '201')).toBeHidden();
  await page.locator('.grdc-sidebar-collapse').click();
  const funnel = page.getByRole('button', { name: 'View options', exact: true });
  await expect(funnel).toHaveAttribute('data-filtered', 'true');
  await setViewOption(page, 'Show resolved comments', true);
  await expect(thread(page, '201')).toBeVisible();
  await setViewOption(page, 'Show resolved comments', false);
  await expect(thread(page, '201')).toBeHidden();
  await page.evaluate(() => {
    const file = document.createElement('div');
    file.id = 'diff-second';
    file.dataset.tagsearchPath = 'docs/second.md';
    file.innerHTML = window.__reviewFixtureHTML;
    document.getElementById('files').appendChild(file);
  });
  await expect(thread(page, '801')).toHaveCount(1);
  await expect(thread(page, '801')).toBeHidden();
  await expect(thread(page, '202')).toBeVisible();
  await expect(funnel).toHaveAttribute('data-filtered', 'true');
  await expect(page.locator('.grdc-sidebar')).toHaveClass(/grdc-sidebar-collapsed/);
  await setViewOption(page, 'Show resolved comments', true);
  await expect(thread(page, '801')).toBeVisible();
});

test('resolving while filtered updates inline visibility, markers, and Outline counts immediately', async ({ page }) => {
  const routeData = await setupReview(page);
  const mutations = [];
  await page.route('https://github.com/test-owner/test-repo/pull/1/page_data/*resolve_thread', async (route) => {
    const id = route.request().postDataJSON().threadId;
    const resolved = route.request().url().endsWith('/resolve_thread');
    routeData.markers.threads[id].isResolved = resolved;
    mutations.push({ id, resolved });
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await openThreads(page);
  await setViewOption(page, 'Show resolved comments', false);
  const overview = page.locator('.grdc-sidebar-outline-label').filter({ hasText: 'Overview' });
  await expect(overview.locator('.grdc-sidebar-outline-count')).toHaveText('1 💬');
  await thread(page, '202').getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(thread(page, '202')).toBeHidden();
  await expect(overview.locator('.grdc-sidebar-outline-count')).toHaveCount(0);
  await expect(page.locator('.grdc-sidebar-list .grdc-sidebar-card')).toHaveCount(1);
  await thread(page, '206').getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(thread(page, '206')).toBeHidden();
  await expect(page.locator('.grdc-table-thread-marker')).toHaveCount(0);
  await expect(page.locator('.grdc-sidebar-count')).toHaveText('0/0');
  await expect(page.locator('.grdc-sidebar-list')).toContainText('All threads on this page are resolved.');
  expect(mutations).toEqual([{ id: '202', resolved: true }, { id: '206', resolved: true }]);
  await setViewOption(page, 'Show resolved comments', true);
  await expect(thread(page, '202')).toBeVisible();
  await expect(thread(page, '202').locator('.grdc-thread-body')).toBeHidden();
  await thread(page, '202').locator('.grdc-thread-badge').click();
  await thread(page, '202').getByRole('button', { name: 'Unresolve', exact: true }).click();
  await setViewOption(page, 'Show resolved comments', false);
  await expect(thread(page, '202')).toBeVisible();
  await expect(overview.locator('.grdc-sidebar-outline-count')).toHaveText('1 💬');
});

test('a failed resolve leaves the unresolved thread visible with explicit error feedback', async ({ page }) => {
  await setupReview(page);
  await page.route('https://github.com/test-owner/test-repo/pull/1/page_data/resolve_thread', (route) =>
    route.fulfill({ status: 500, body: 'Resolve failed' }));
  await openThreads(page);
  await setViewOption(page, 'Show resolved comments', false);
  await thread(page, '202').getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(thread(page, '202')).toBeVisible();
  await expect(thread(page, '202').locator('.grdc-error')).toContainText('HTTP 500');
  await expect(page.locator('.grdc-sidebar-list .grdc-sidebar-card')).toHaveCount(2);
});

test('filtering preserves drafts and remains independent of Hide removed content', async ({ page }) => {
  await setupReview(page);
  await openThreads(page);
  await thread(page, '202').getByRole('button', { name: 'Reply', exact: true }).click();
  const draft = thread(page, '202').locator('textarea');
  await draft.fill('Unresolved draft stays intact.');
  const viewOptions = page.getByRole('button', { name: 'View options', exact: true });
  await expect(page.locator('#review-removed')).toBeVisible();
  await setViewOption(page, 'Show removed content', false);
  await expect(page.locator('#review-removed')).toBeHidden();
  await setViewOption(page, 'Show resolved comments', false);
  await expect(draft).toHaveValue('Unresolved draft stays intact.');
  await expect(thread(page, '201')).toBeHidden();
  await expect(viewOptions).toHaveAttribute('data-filtered', 'true');
  await setViewOption(page, 'Show resolved comments', true);
  await expect(thread(page, '201')).toBeVisible();
  await expect(draft).toHaveValue('Unresolved draft stays intact.');
  await expect(viewOptions).toHaveAttribute('data-filtered', 'true');
  await expect(page.locator('#review-removed')).toBeHidden();
  await setViewOption(page, 'Show removed content', true);
  await expect(page.locator('#review-removed')).toBeVisible();
  await setViewOption(page, 'Show resolved comments', false);
  await expect(thread(page, '201')).toBeHidden();
  await expect(page.locator('#review-removed')).toBeVisible();
  await expect(draft).toHaveValue('Unresolved draft stays intact.');
});

test('an all-resolved review keeps the filter reachable and restores every conversation', async ({ page }) => {
  await setupReview(page, { allResolved: true, savedFilter: true });
  await openThreads(page);
  await expect(page.locator('.grdc-existing-thread:visible')).toHaveCount(0);
  await expect(page.locator('.grdc-sidebar-list .grdc-sidebar-card')).toHaveCount(0);
  await expect(page.locator('.grdc-table-thread-marker')).toHaveCount(0);
  await expect(page.locator('.grdc-thread-range')).toHaveCount(0);
  await setViewOption(page, 'Show resolved comments', true);
  await expect(page.locator('.grdc-existing-thread:visible')).toHaveCount(6);
  await expect(page.locator('.grdc-sidebar-list .grdc-sidebar-card')).toHaveCount(6);
});
