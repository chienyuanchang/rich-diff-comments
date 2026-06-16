/**
 * E2E: clicking + opens a comment box anchored to the right block.
 *
 * What this covers that the unit tests can't:
 *   • Real `:hover` revealing the +
 *   • Real `click` event dispatch on the +
 *   • `openCommentBox()` actually mounting `.grdc-comment-box` into the DOM
 *   • The box's `path · line` header showing the correct file + source line
 *   • The line-number input is editable (the user can adjust before submit)
 *   • Hover-leave-hover doesn't duplicate the box (each + click closes any
 *     previously-open box)
 *
 * We don't actually submit comments here — that would require stubbing the
 * GitHub review-comment endpoint. The post path is exercised by the
 * `responses.test.js` unit tests against captured response shapes.
 *
 * Implementation note: many of the `+` buttons live at `position: absolute;
 * left: -30px` so they hang in the left gutter of their host (paragraphs,
 * headings). That position is geometrically OUTSIDE the host's bounding
 * box, which makes Playwright's actionability check reject `.click()` with
 * "element is outside of the viewport" — even though a real user can see
 * and click it just fine. We use `dispatchEvent('click')` instead, which
 * skips the geometry check. Visibility is already proven in the separate
 * `buttonVisibility.spec.js` suite.
 */
const { test, expect } = require('@playwright/test');
const { setupExtensionPage } = require('./_helpers');
const fixtures = require('./fixtures/sources');

const fm = fixtures.yamlFrontmatter;

// Helper: hover the host so :hover reveals the +, then dispatch a click on
// the + via JS to bypass Playwright's geometry-based actionability check.
async function hoverAndClick(host) {
  await host.hover();
  await host.locator('.grdc-comment-btn').dispatchEvent('click');
}

test.describe('+ click → comment box', () => {
  test.beforeEach(async ({ page }) => {
    await setupExtensionPage(page, 'yaml-frontmatter', {
      rawSource: { [fm.path]: fm.source },
    });
  });

  test('clicking + on the body H1 opens a comment box anchored to that line', async ({ page }) => {
    const h1 = page.locator('h1', { hasText: 'Test Design Doc' });
    await hoverAndClick(h1);

    // The box should mount somewhere in the page (typically right after
    // the host element). We don't care WHERE — just that it's there.
    const box = page.locator('.grdc-comment-box');
    await expect(box).toBeVisible();

    // The header inside the box shows the file path and the source line.
    const header = box.locator('.grdc-line-info');
    await expect(header).toContainText(fm.path);

    // The line-number input is pre-filled with the H1's source line.
    const lineInput = box.locator('.grdc-line-input');
    await expect(lineInput).toHaveValue(String(fm.expected.h1Line));
  });

  test('clicking + on a frontmatter <th> opens a box for that YAML key line', async ({ page }) => {
    // Regression: pre v1.5.1 there was no + on <th> at all; even after the
    // CSS fix, the click→box wiring could still drift. Pin it.
    const areaKey = page.getByRole('rowheader', { name: 'area', exact: true });
    await hoverAndClick(areaKey);

    const box = page.locator('.grdc-comment-box');
    await expect(box).toBeVisible();
    await expect(box.locator('.grdc-line-info')).toContainText(fm.path);
    await expect(box.locator('.grdc-line-input')).toHaveValue(String(fm.expected.frontmatterRowLines.area));
  });

  test('the line-number input in the box is editable (lets the user override)', async ({ page }) => {
    // The contract: a + on line N pre-fills the input with N, but the
    // user can pick a different line before clicking Comment. Useful when
    // the text-match landed approximately and the user wants the exact
    // line.
    const h1 = page.locator('h1', { hasText: 'Test Design Doc' });
    await hoverAndClick(h1);

    const lineInput = page.locator('.grdc-comment-box .grdc-line-input');
    await expect(lineInput).toHaveValue(String(fm.expected.h1Line));
    await lineInput.fill('12');
    await expect(lineInput).toHaveValue('12');
  });

  test('clicking a second + closes the first comment box (no duplicates)', async ({ page }) => {
    // openCommentBox() removes any existing .grdc-comment-box before
    // creating a new one. Verify only one box ever exists at a time.
    const h1 = page.locator('h1', { hasText: 'Test Design Doc' });
    await hoverAndClick(h1);
    await expect(page.locator('.grdc-comment-box')).toHaveCount(1);

    const overview = page.locator('h2', { hasText: 'Overview' });
    await hoverAndClick(overview);
    await expect(page.locator('.grdc-comment-box')).toHaveCount(1);
    // ...and the visible box is the one for the OVERVIEW H2, not the H1.
    await expect(page.locator('.grdc-comment-box .grdc-line-input')).toHaveValue(String(fm.expected.overviewH2Line));
  });

  test('the comment box exposes a Markdown textarea for the user to type into', async ({ page }) => {
    const h1 = page.locator('h1', { hasText: 'Test Design Doc' });
    await hoverAndClick(h1);

    // The textarea selector lives inside the box; we don't care about its
    // exact class — just that one exists and accepts input.
    const textarea = page.locator('.grdc-comment-box textarea');
    await expect(textarea).toBeVisible();
    await textarea.fill('Looks great, but consider X.');
    await expect(textarea).toHaveValue('Looks great, but consider X.');
  });
});
