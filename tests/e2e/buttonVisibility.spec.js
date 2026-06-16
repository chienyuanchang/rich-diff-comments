/**
 * E2E: + button visibility tests.
 *
 * Regression net for the v1.5.1 bug class where a `+` button is *attached*
 * (the DOM has the element, `attachCommentButtons()` ran) but *invisible*
 * because no CSS rule pulls it inside its host's bounding box. jsdom can't
 * catch this — it doesn't compute layout, and `:hover` doesn't fire there.
 * A real headless Chromium does both.
 *
 * What this file pins:
 *   • On hover over a body block (paragraph, heading, list item), a +
 *     button becomes visible.
 *   • On hover over a YAML frontmatter `<th>` row, a + button becomes
 *     visible AND sits inside the row's bounding box. (This is the
 *     specific bug from v1.5.1.)
 *   • Same for `<td>` rows.
 *   • The button's bounding box has positive width × height (would catch
 *     `display: none` or zero-sized regressions).
 */
const { test, expect } = require('@playwright/test');
const { setupExtensionPage } = require('./_helpers');
const fixtures = require('./fixtures/sources');

const fm = fixtures.yamlFrontmatter;

test.describe('+ button visibility', () => {
  test.beforeEach(async ({ page }) => {
    await setupExtensionPage(page, 'yaml-frontmatter', {
      rawSource: { [fm.path]: fm.source },
    });
  });

  test('hovering a body H1 reveals the + button', async ({ page }) => {
    const h1 = page.locator('h1', { hasText: 'Test Design Doc' });
    await expect(h1).toBeVisible();
    await h1.hover();
    // The + button lives inside the hovered host (`.grdc-hoverable`).
    const btn = h1.locator('.grdc-comment-btn');
    await expect(btn).toBeVisible();
    const box = await btn.boundingBox();
    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });

  test('hovering a frontmatter <th> (key cell) reveals the + button INSIDE the cell — regression for v1.5.1', async ({ page }) => {
    // Pre v1.5.1 fix: <th>.grdc-hoverable had no positioning override, so
    // the inherited `.grdc-comment-btn { left: -30px }` placed the + 30px
    // to the LEFT of the cell — off-screen for a narrow key column.
    //
    // Use a strict role selector to pick exactly the `feature` row's <th>
    // — plain text-contains matching ambiguously matches the `related` row
    // too (whose `note:` value mentions the word `feature`).
    const keyCell = page.getByRole('rowheader', { name: 'feature', exact: true });
    await expect(keyCell).toBeVisible();
    await keyCell.hover();
    const btn = keyCell.locator('.grdc-comment-btn');
    await expect(btn).toBeVisible();
    const btnBox = await btn.boundingBox();
    const cellBox = await keyCell.boundingBox();
    expect(btnBox, '+ button must have a bounding box').not.toBeNull();
    expect(btnBox.width).toBeGreaterThan(0);
    expect(btnBox.height).toBeGreaterThan(0);
    // The button must be inside (or at least overlapping with) the cell's
    // bounding box — not off to the left as in the pre-fix bug.
    expect(btnBox.x + btnBox.width, '+ must extend INTO the cell, not sit to its left').toBeGreaterThan(cellBox.x);
    expect(btnBox.x, '+ must not be more than 5px to the LEFT of the cell').toBeGreaterThanOrEqual(cellBox.x - 5);
  });

  test('every frontmatter row (4 rows) gets a + button on hover', async ({ page }) => {
    const rows = page.locator('table.rich-diff-level-one > tbody > tr');
    await expect(rows).toHaveCount(4);
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      await row.hover();
      const btn = row.locator('.grdc-comment-btn');
      await expect(btn, `row ${i} must have a + button visible on hover`).toBeVisible();
    }
  });

  test('a + button title attribute encodes the correct file:line for body H1', async ({ page }) => {
    // Belt-and-suspenders: even if visibility works, the click would post
    // to the wrong line if the title (which is what the comment box header
    // reads from) holds a stale line number.
    const h1 = page.locator('h1', { hasText: 'Test Design Doc' });
    await h1.hover();
    const btn = h1.locator('.grdc-comment-btn');
    const title = await btn.getAttribute('title');
    expect(title).toContain(fm.path + ':' + fm.expected.h1Line);
  });

  test('button is hidden when not hovering (CSS opacity:0 default)', async ({ page }) => {
    // Default state: the + is in the DOM but `opacity: 0`. Hovering
    // raises opacity to 1. We don't use `toBeVisible()` here (which
    // returns true for opacity:0 elements that occupy space) — we
    // check computed opacity directly.
    //
    // Read the unhovered state before any hover happens (Playwright
    // doesn't simulate a real mouse position by default — page loads
    // with no element under the cursor).
    const h1 = page.locator('h1', { hasText: 'Test Design Doc' });
    await expect(h1).toBeVisible();
    const opacityBeforeHover = await h1.locator('.grdc-comment-btn').evaluate((el) => {
      return window.getComputedStyle(el).opacity;
    });
    expect(opacityBeforeHover).toBe('0');

    await h1.hover();
    // The `+` button transitions opacity 0 → 1 over 0.15s. Don't pin the
    // exact final value (which would race the transition); just verify
    // hover starts revealing it.
    const opacityAfterHover = await h1.locator('.grdc-comment-btn').evaluate((el) => {
      return parseFloat(window.getComputedStyle(el).opacity);
    });
    expect(opacityAfterHover).toBeGreaterThan(0);
  });
});
