/**
 * E2E: line-mapping behavior end-to-end.
 *
 * The unit tests (tests/lineMap.test.js) already cover the per-file
 * `mapBlocksToSourceLines()` against jsdom fixtures. This spec runs the
 * same kind of assertions but through the FULL extension flow in a real
 * browser:
 *
 *   1. The extension's MutationObserver / init pipeline runs.
 *   2. `fetchRawSource()` fetches the (stubbed) raw markdown.
 *   3. `buildLineMap()` walks the rendered DOM and stores per-block lines.
 *   4. `attachCommentButtons()` injects the + buttons whose `title=` attr
 *      contains `file:line` — that's what we observe here.
 *
 * If the e2e mapping drifts but the unit tests still pass, something in
 * the integration layer (route data, blob fetch, MutationObserver, init
 * ordering) broke. This file catches that class of bug.
 */
const { test, expect } = require('@playwright/test');
const { setupExtensionPage } = require('./_helpers');
const fixtures = require('./fixtures/sources');

const fm = fixtures.yamlFrontmatter;

/**
 * Pull the source-line number out of a + button's title attribute.
 * Title shape: "Comment on <path>:<line>\nDrag down to another + ..."
 */
async function lineFromTitle(locator) {
  const title = await locator.getAttribute('title');
  if (!title) return null;
  const m = title.match(/:(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

test.describe('line mapping (end-to-end through the extension pipeline)', () => {
  test.beforeEach(async ({ page }) => {
    await setupExtensionPage(page, 'yaml-frontmatter', {
      rawSource: { [fm.path]: fm.source },
    });
  });

  test('body H1 anchors to its real source line (regression for v1.5.1)', async ({ page }) => {
    // Before the v1.5.1 frontmatter fix, an H1 after frontmatter could be
    // anchored as far away as the file's last line because the YAML
    // table's text substring-matched body content downstream. Here we
    // verify the H1 lands on the line it actually occupies in source.
    const h1 = page.locator('h1', { hasText: 'Test Design Doc' });
    await h1.hover();
    const line = await lineFromTitle(h1.locator('.grdc-comment-btn'));
    expect(line).toBe(fm.expected.h1Line);
  });

  test('body H2 sections anchor to their real source lines', async ({ page }) => {
    const overview = page.locator('h2', { hasText: 'Overview' });
    await overview.hover();
    expect(await lineFromTitle(overview.locator('.grdc-comment-btn'))).toBe(fm.expected.overviewH2Line);

    const changeLog = page.locator('h2', { hasText: 'Change Log' });
    await changeLog.hover();
    expect(await lineFromTitle(changeLog.locator('.grdc-comment-btn'))).toBe(fm.expected.changeLogH2Line);
  });

  test('frontmatter top-level keys map to their YAML source lines (2-col layout)', async ({ page }) => {
    // Each `<th>feature</th>` row → comment posts on source line 2 etc.
    for (const [key, expectedLine] of Object.entries(fm.expected.frontmatterRowLines)) {
      const cell = page.getByRole('rowheader', { name: key, exact: true });
      await cell.hover();
      const line = await lineFromTitle(cell.locator('.grdc-comment-btn'));
      expect(line, `frontmatter key "${key}"`).toBe(expectedLine);
    }
  });

  test('body list items anchor to their real source lines', async ({ page }) => {
    const firstBullet = page.locator('li', { hasText: 'First overview bullet' });
    await firstBullet.hover();
    const line = await lineFromTitle(firstBullet.locator('.grdc-comment-btn'));
    expect(line).toBe(fm.expected.firstBulletLine);
  });

  test('extension attaches a sensible number of + buttons after init', async ({ page }) => {
    // The setup helper already waited for the init event. We don't need
    // to force a re-init — just observe the static DOM consequence: a
    // `.grdc-comment-btn` per commentable block.
    //
    // Sanity floor: at least 4 frontmatter rows + H1 + 2 H2s = 7.
    // Real number for this fixture is higher (bullets, change-log row,
    // body paragraphs). We don't pin an exact count — it'd be fragile to
    // fixture tweaks.
    const buttonCount = await page.locator('.grdc-comment-btn').count();
    expect(buttonCount).toBeGreaterThanOrEqual(7);
  });
});
