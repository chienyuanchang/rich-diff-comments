'use strict';

const { test, expect } = require('@playwright/test');
const {
  setupAdoExtensionPage,
  waitForAdoReady,
  userThreadCount,
  SOURCE_COMMIT,
  COMMON_COMMIT,
} = require('./_helpers');
const fixtures = require('./fixtures/sources');

const EXPECTED_STOP_COUNT = 9;

function requestsEndingWith(server, suffix) {
  return server.requests.filter((request) =>
    request.method === 'GET' && request.pathname.endsWith(suffix)
  );
}

test.describe('ADO PR-wide Changes', () => {
  test('loads the latest cumulative inventory and groups every Markdown lifecycle', async ({ page }) => {
    const { server, pageErrors } = await setupAdoExtensionPage(page);
    const state = await page.evaluate(() => window.ADORC_probe.changes());

    expect(state.iterationId).toBe(2);
    expect(state.changedMarkdownFiles).toHaveLength(5);
    expect(state.changedMarkdownFiles.map((change) => change.type)).toEqual([
      'edit', 'edit', 'add', 'delete', 'rename'
    ]);
    expect(state.changedMarkdownFiles.map((change) => change.path)).toEqual([
      fixtures.DESIGN_PATH,
      fixtures.OTHER_PATH,
      fixtures.NEW_PATH,
      fixtures.DELETED_PATH,
      fixtures.RENAMED_PATH,
    ]);
    expect(state.stops).toHaveLength(EXPECTED_STOP_COUNT);
    await expect(page.locator('.adrc-sidebar-change-card')).toHaveCount(EXPECTED_STOP_COUNT);
    const groups = page.locator('.adrc-sidebar-change-list > .adrc-sidebar-file-group');
    await expect(groups).toHaveCount(5);
    await expect(groups).toHaveText([
      'docs/design.md',
      'docs/other.md',
      'docs/new.md',
      'docs/deleted.md',
      'docs/renamed.md',
    ]);
    await expect(page.locator('.adrc-sidebar-change-card[data-lifecycle="add"]')).toHaveCount(1);
    await expect(page.locator('.adrc-sidebar-change-card[data-lifecycle="delete"]')).toHaveCount(1);
    await expect(page.locator('.adrc-sidebar-change-card[data-lifecycle="rename"]')).toHaveCount(3);
    await expect(page.locator('.adrc-sidebar-change-card[data-path="/src/ignored.js"]')).toHaveCount(0);
    await expect(page.locator('.adrc-sidebar-change-card[data-path="/docs/now-text.txt"]')).toHaveCount(0);
    await expect(page.locator('[data-count="changes"]')).toHaveText(String(EXPECTED_STOP_COUNT));
    await expect(page.locator('.adrc-sidebar-changes-count span')).toHaveText(`1/3 (${EXPECTED_STOP_COUNT})`);

    const iterationRequests = requestsEndingWith(server, '/iterations');
    const changeRequests = requestsEndingWith(server, '/iterations/2/changes');
    expect(iterationRequests).toHaveLength(1);
    expect(changeRequests).toHaveLength(1);
    const changesUrl = new URL(changeRequests[0].url);
    expect(changesUrl.searchParams.get('$compareTo')).toBe('0');
    expect(changesUrl.searchParams.get('$top')).toBe('2000');
    expect(changesUrl.searchParams.get('$skip')).toBe('0');
    expect(server.requests.some((request) => request.url.includes('ignored.js'))).toBe(false);
    const itemRequests = server.requests.filter((request) => request.pathname.endsWith('/items'));
    expect(itemRequests.some((request) => new URL(request.url).searchParams.get('versionDescriptor.version') === SOURCE_COMMIT)).toBe(true);
    expect(itemRequests.some((request) => new URL(request.url).searchParams.get('versionDescriptor.version') === COMMON_COMMIT)).toBe(true);
    expect(pageErrors).toEqual([]);
  });

  test('cross-file hunk click reuses the Preview container and lands on the live block', async ({ page }) => {
    const { server } = await setupAdoExtensionPage(page);
    await page.evaluate(() => { window.__initialChangesPreview = window.__ADO_FIXTURE__.preview; });

    await page.locator(`.adrc-sidebar-change-card[data-path="${fixtures.OTHER_PATH}"]`).click();
    await waitForAdoReady(page, fixtures.OTHER_PATH, userThreadCount(server.threads));

    expect(new URL(page.url()).searchParams.get('path')).toBe(fixtures.OTHER_PATH);
    expect(await page.evaluate(() => window.__initialChangesPreview === window.__ADO_FIXTURE__.preview)).toBe(true);
    expect(server.pageLoads).toBe(1);
    await expect(page.locator('.markdown-preview-container h1')).toContainText('Other Document');
    await expect(page.locator('.markdown-preview-container .adrc-change-target-pulse')).toHaveCount(1);
    await expect(page.locator('.adrc-sidebar-changes-count span')).toHaveText(`1/1 (${EXPECTED_STOP_COUNT})`);
    expect((await page.evaluate(() => window.ADORC_probe.viewMode())).pendingChangeJump).toBeNull();
  });

  test('NEW FILE is one summary card and opens at the top of its Preview', async ({ page }) => {
    const { server } = await setupAdoExtensionPage(page);
    const cards = page.locator(`.adrc-sidebar-change-card[data-path="${fixtures.NEW_PATH}"]`);
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText('NEW FILE');

    await cards.click();
    await waitForAdoReady(page, fixtures.NEW_PATH, userThreadCount(server.threads));
    await expect(page.locator('.markdown-preview-container h1')).toContainText('Brand New Guide');
    await expect(page.locator('.markdown-preview-container .adrc-change-target-pulse')).toHaveCount(1);
    await expect(page.locator('.adrc-sidebar-changes-count span')).toHaveText(`1/1 (${EXPECTED_STOP_COUNT})`);
  });

  test('DELETED summary activates the native row without attempting impossible Preview restoration', async ({ page }) => {
    const { server } = await setupAdoExtensionPage(page);
    const card = page.locator(`.adrc-sidebar-change-card[data-path="${fixtures.DELETED_PATH}"]`);
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('DELETED');
    await card.click();

    await expect.poll(() => new URL(page.url()).searchParams.get('path')).toBe(fixtures.DELETED_PATH);
    await expect(page.locator('.markdown-preview-container:visible')).toHaveCount(0);
    await expect(page.locator('.adrc-sidebar')).toBeVisible();
    await expect(page.locator('.adrc-sidebar-changes-count span')).toHaveText(`1/1 (${EXPECTED_STOP_COUNT})`);
    const mode = await page.evaluate(() => window.ADORC_probe.viewMode());
    expect(mode.pendingChangeJump).toBeNull();
    expect(mode.restore.phase).toBe('idle');

    // The last initialized Preview still belongs to DESIGN while the deleted
    // route has none. A subsequent card must honor the route and navigate back,
    // not mistake that stale cache for an already-active target.
    await page.locator(`.adrc-sidebar-change-card[data-path="${fixtures.DESIGN_PATH}"]`).first().click();
    await waitForAdoReady(page, fixtures.DESIGN_PATH, userThreadCount(server.threads));
    await expect(page.locator('.markdown-preview-container h1')).toContainText('Design Review');
    await expect(page.locator('.markdown-preview-container .adrc-change-target-pulse')).toHaveCount(1);
  });

  test('RENAMED summary shows old and new paths and keeps content hunks', async ({ page }) => {
    const { server } = await setupAdoExtensionPage(page);
    const cards = page.locator(`.adrc-sidebar-change-card[data-path="${fixtures.RENAMED_PATH}"]`);
    await expect(cards).toHaveCount(3);
    const summary = page.locator(
      `.adrc-sidebar-change-card[data-path="${fixtures.RENAMED_PATH}"][data-stop-type="summary"]`
    );
    await expect(summary).toHaveCount(1);
    await expect(summary).toContainText(`${fixtures.OLD_RENAMED_PATH} → ${fixtures.RENAMED_PATH}`);

    await summary.click();
    await waitForAdoReady(page, fixtures.RENAMED_PATH, userThreadCount(server.threads));
    await expect(page.locator('.markdown-preview-container h1')).toContainText('Renamed Notes');
    await expect(page.locator('.adrc-sidebar-changes-count span')).toHaveText(`1/3 (${EXPECTED_STOP_COUNT})`);
  });

  test('global boundary and wrapping keys cross files without changing the selected pane', async ({ page }) => {
    const { server } = await setupAdoExtensionPage(page);
    await page.keyboard.press('3');
    await page.keyboard.press('Shift+]');
    await waitForAdoReady(page, fixtures.RENAMED_PATH, userThreadCount(server.threads));
    await expect.poll(() => page.evaluate(() => window.ADORC_probe.sidebar().activeChangeIndex))
      .toBe(EXPECTED_STOP_COUNT - 1);
    await expect(page.locator('.adrc-sidebar-changes-count span')).toHaveText(`3/3 (${EXPECTED_STOP_COUNT})`);
    await expect(page.locator('.adrc-sidebar-tab[data-tab="outline"]')).toHaveClass(/adrc-sidebar-tab-active/);

    await page.keyboard.press(']');
    await waitForAdoReady(page, fixtures.DESIGN_PATH, userThreadCount(server.threads));
    await expect.poll(() => page.evaluate(() => window.ADORC_probe.sidebar().activeChangeIndex)).toBe(0);
    await expect(page.locator('.adrc-sidebar-changes-count span')).toHaveText(`1/3 (${EXPECTED_STOP_COUNT})`);
    await expect(page.locator('.adrc-sidebar-tab[data-tab="outline"]')).toHaveClass(/adrc-sidebar-tab-active/);
  });

  test('one source failure becomes an isolated UNAVAILABLE card', async ({ page }) => {
    await setupAdoExtensionPage(page, {
      sourceFailures: { [`${SOURCE_COMMIT}:${fixtures.OTHER_PATH}`]: 503 },
    });

    const unavailable = page.locator(
      `.adrc-sidebar-change-card.adrc-sidebar-change-unavailable[data-path="${fixtures.OTHER_PATH}"]`
    );
    await expect(unavailable).toHaveCount(1);
    await expect(unavailable).toContainText('UNAVAILABLE');
    await expect(unavailable).toContainText('503');
    await expect(page.locator('.adrc-sidebar-change-card')).toHaveCount(EXPECTED_STOP_COUNT);
    expect((await page.evaluate(() => window.ADORC_probe.sidebar())).changesStatus).toBe('ready');
    await expect(page.locator('.adrc-sidebar-thread-card')).toHaveCount(3);
  });

  test('the catalog survives Preview file switches without refetching inventory', async ({ page }) => {
    const { server } = await setupAdoExtensionPage(page);
    expect(requestsEndingWith(server, '/iterations')).toHaveLength(1);
    expect(requestsEndingWith(server, '/iterations/2/changes')).toHaveLength(1);

    await page.evaluate((path) => window.__ADO_FIXTURE__.openPath(path), fixtures.OTHER_PATH);
    await waitForAdoReady(page, fixtures.OTHER_PATH, userThreadCount(server.threads));
    await page.evaluate((path) => window.__ADO_FIXTURE__.openPath(path), fixtures.NEW_PATH);
    await waitForAdoReady(page, fixtures.NEW_PATH, userThreadCount(server.threads));

    await expect(page.locator('.adrc-sidebar-change-card')).toHaveCount(EXPECTED_STOP_COUNT);
    expect(requestsEndingWith(server, '/iterations')).toHaveLength(1);
    expect(requestsEndingWith(server, '/iterations/2/changes')).toHaveLength(1);
  });
});
