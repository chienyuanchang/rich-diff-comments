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
const { setupExtensionPage, setupFixture, gotoPRPage, injectExtension, waitForInit, FAKE_HEAD_OID } = require('./_helpers');
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

for (const format of ['embedded JSON', 'serialized rawLines']) {
  test(`blob ${format} preserves exact source lines and the posted line`, async ({ page }) => {
    const lines = Array(493).fill('');
    lines[0] = '# Source format regression';
    lines[441] = '## Authored Strikethrough Visibility';
    lines[458] = 'Raw HTML variants: <del>authored HTML del text</del> and <s>authored HTML s text</s>.';
    lines[492] = 'Final source paragraph.';
    const logs = [];
    const errors = [];
    page.on('console', (message) => logs.push(message.text()));
    page.on('pageerror', (error) => errors.push(error.message));
    await setupFixture(page, 'yaml-frontmatter', {
      routeData: {
        comparison: {
          headOid: FAKE_HEAD_OID,
          baseOid: 'b'.repeat(40),
          fullDiff: { headOid: FAKE_HEAD_OID },
        },
      },
    });
    const literal = JSON.stringify(lines).replace(/</g, format === 'serialized rawLines' ? '\\x3C' : '\\u003c');
    const script = format === 'embedded JSON'
      ? `<script type="application/json" data-target="react-app.embeddedData">{"payload":{"blob":{"rawLines":${literal}}}}</script>`
      : `<script type="module">const $R = []; const data = {blob: {rawLines: $R[395] = ${literal}, stylingDirectives: $R[396] = {format: "compact"}}}; globalThis.blobScriptExecuted = true;</script>`;
    await page.route(`https://github.com/test-owner/test-repo/blob/${FAKE_HEAD_OID}/**`, (route) =>
      route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body>${script}</body></html>` })
    );
    let payload;
    await page.route('**/page_data/create_review_comment', async (route) => {
      payload = route.request().postDataJSON();
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ thread: {
          id: '901',
          commentsData: { comments: [{
            databaseId: 9001,
            body: 'Correct source anchor.',
            author: { login: 'reviewer' },
            createdAt: '2026-11-03T19:00:00Z',
          }] },
        } }),
      });
    });
    await gotoPRPage(page);
    await page.locator('.markdown-body').evaluate((body) => {
      body.style.marginLeft = '48px';
      body.innerHTML = '<h1>Source format regression</h1>'
        + '<h2>Authored Strikethrough Visibility</h2>'
        + '<p id="authored-html">Raw HTML variants: <span class="github-user-del rich-diff-level-one">authored HTML del text</span> and <s class="rich-diff-level-one">authored HTML s text</s>.</p>'
        + '<p id="last-source-line">Final source paragraph.</p>';
    });
    await injectExtension(page);
    await waitForInit(page);
    for (const [selector, expected] of [['h1', 1], ['h2', 442], ['#authored-html', 459], ['#last-source-line', 493]]) {
      expect(await lineFromTitle(page.locator(`${selector} > .grdc-comment-btn`))).toBe(expected);
    }
    expect(logs.some((log) => /source-matched: true/.test(log))).toBe(true);
    expect(logs.some((log) => /no recognizable raw source/.test(log))).toBe(false);
    expect(await page.evaluate(() => window.blobScriptExecuted)).toBeUndefined();
    await page.locator('#authored-html').hover();
    await page.locator('#authored-html > .grdc-comment-btn').click();
    const box = page.locator('.grdc-comment-box');
    await box.locator('textarea').fill('Correct source anchor.');
    await box.getByRole('button', { name: 'Comment', exact: true }).click();
    await expect(box.locator('.grdc-success')).toHaveText('✓ Comment posted');
    expect(payload).toMatchObject({
      path: fm.path,
      line: 459,
      side: 'right',
      positioning: { type: 'line', line: 459 },
    });
    expect(errors).toEqual([]);
  });
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
