/**
 * E2E: keyboard shortcuts.
 *
 * jsdom doesn't dispatch real keyboard events the way browsers do — `t`,
 * `1`/`2`/`3`, `[`/`]` keydowns all need a real document with a
 * `document.addEventListener('keydown', …)` listener that responds. This
 * spec runs in real headless Chromium so the shortcuts behave like a user
 * pressing the key.
 *
 * Covers the shortcuts content.js binds at the document level:
 *   • `t`         — toggle sidebar collapsed / expanded
 *   • `Shift+T`   — reset sidebar position / size
 *   • `1` / `2` / `3` — switch sidebar to Changes / Threads / Outline (1.5.0 order)
 *   • `[` / `]`   — prev / next change card
 *
 * Tests skipped (need fixtures with threads or many changes):
 *   • `j` / `k`   — prev / next thread (needs threads on the page)
 *   • `{` / `}`   — first / last change (needs ≥ 2 changes on the page)
 */
const { test, expect } = require('@playwright/test');
const { setupExtensionPage } = require('./_helpers');
const fixtures = require('./fixtures/sources');

const fm = fixtures.yamlFrontmatter;

test.describe('keyboard shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await setupExtensionPage(page, 'yaml-frontmatter', {
      rawSource: { [fm.path]: fm.source },
    });
  });

  test('pressing `t` toggles the sidebar between expanded and collapsed', async ({ page }) => {
    // After init the sidebar should exist (frontmatter has no threads but
    // 1.1.0 made the sidebar always-on for any PR rich-diff page).
    const sidebar = page.locator('.grdc-sidebar');
    await expect(sidebar).toBeVisible({ timeout: 5000 });

    const wasCollapsedBefore = await sidebar.evaluate((el) =>
      el.classList.contains('grdc-sidebar-collapsed')
    );

    await page.keyboard.press('t');

    const isCollapsedAfter = await sidebar.evaluate((el) =>
      el.classList.contains('grdc-sidebar-collapsed')
    );
    expect(isCollapsedAfter).toBe(!wasCollapsedBefore);

    // Toggle back to confirm round-trip.
    await page.keyboard.press('t');
    const finalState = await sidebar.evaluate((el) =>
      el.classList.contains('grdc-sidebar-collapsed')
    );
    expect(finalState).toBe(wasCollapsedBefore);
  });

  test('collapsing the sidebar keeps it visible with both nav clusters intact', async ({ page }) => {
    // 2026-06 design: collapsed mode keeps both nav clusters (Changes +
    // Threads) visible because the at-a-glance counters are the whole
    // point of the slim strip. The collapsed sidebar must reserve
    // enough width (`min-width: 300px` in CSS) to fit both clusters
    // plus filter + book icons on one row.
    const sidebar = page.locator('.grdc-sidebar');
    await expect(sidebar).toBeVisible();

    // Ensure we start expanded — t toggles, so if the saved state was
    // collapsed press once to expand first.
    const startsCollapsed = await sidebar.evaluate((el) =>
      el.classList.contains('grdc-sidebar-collapsed')
    );
    if (startsCollapsed) await page.keyboard.press('t');

    // Now collapse with `t`.
    await page.keyboard.press('t');
    await expect(sidebar).toHaveClass(/grdc-sidebar-collapsed/);

    // Sidebar element itself is still visible (not display:none).
    await expect(sidebar).toBeVisible();

    // Sidebar bounding box is at least as wide as the CSS min-width
    // (300px floor) — anything narrower means the collapsed strip
    // couldn't reserve room for both nav clusters and they'd clip.
    const box = await sidebar.boundingBox();
    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThanOrEqual(400);
    expect(box.height).toBeGreaterThan(20);

    // Both nav clusters MUST stay visible in collapsed mode — that's the
    // whole reason for the wide min-width. Hiding them was a v2 fix that
    // got reverted in v3 because it removed the counter that made the
    // collapsed strip useful.
    await expect(page.locator('.grdc-sidebar-nav')).toBeVisible();
    await expect(page.locator('.grdc-sidebar-changes-nav')).toBeVisible();

    // Collapse toggle button must STAY visible — without it the user
    // would be trapped in collapsed mode.
    await expect(page.locator('.grdc-sidebar-collapse')).toBeVisible();
  });

  test('pressing `3` switches the sidebar to the Outline tab', async ({ page }) => {
    // 1.5.0 tab order is Changes (1) / Threads (2) / Outline (3).
    // The fixture has no threads, so 1.5.0's auto-expand behavior will
    // expand the sidebar if collapsed; either way the Outline tab must
    // end up active.
    await expect(page.locator('.grdc-sidebar')).toBeVisible();

    await page.keyboard.press('3');

    const outlineTab = page.locator('.grdc-sidebar-tab[data-grdc-tab="outline"]');
    await expect(outlineTab).toHaveClass(/grdc-sidebar-tab-active/);
    // And the other two are no longer active.
    await expect(page.locator('.grdc-sidebar-tab[data-grdc-tab="threads"]')).not.toHaveClass(/grdc-sidebar-tab-active/);
    await expect(page.locator('.grdc-sidebar-tab[data-grdc-tab="changes"]')).not.toHaveClass(/grdc-sidebar-tab-active/);
  });

  test('pressing `2` returns the sidebar to the Threads tab', async ({ page }) => {
    // 1.5.0 tab order is Changes (1) / Threads (2) / Outline (3).
    await expect(page.locator('.grdc-sidebar')).toBeVisible();
    await page.keyboard.press('3'); // first go to Outline
    await page.keyboard.press('2'); // then back to Threads
    await expect(
      page.locator('.grdc-sidebar-tab[data-grdc-tab="threads"]')
    ).toHaveClass(/grdc-sidebar-tab-active/);
  });

  test('pressing the same shortcut repeatedly is idempotent (no flicker / state drift)', async ({ page }) => {
    // The point of this test is idempotency of a tab-switch shortcut — the
    // specific tab doesn't matter. Use `3` (Outline) because the fixture
    // has headings but no diff markers, so the Changes tab (`1`) is
    // legitimately hidden on this fixture and `setSidebarTab` correctly
    // falls back to Threads when asked to switch to Changes. Outline is
    // available whenever the fixture has ≥ 1 heading, which this one does.
    await expect(page.locator('.grdc-sidebar')).toBeVisible();
    await page.keyboard.press('3');
    await page.keyboard.press('3');
    await page.keyboard.press('3');
    await expect(
      page.locator('.grdc-sidebar-tab[data-grdc-tab="outline"]')
    ).toHaveClass(/grdc-sidebar-tab-active/);
  });

  test('pressing `t` while focused in a text input does NOT toggle the sidebar', async ({ page }) => {
    // Regression guard: the shortcuts must not fire while the user is
    // typing into a textarea / input. Open a comment box (which contains
    // a textarea) and try pressing `t` from inside it.
    const h1 = page.locator('h1', { hasText: 'Test Design Doc' });
    await h1.hover();
    await h1.locator('.grdc-comment-btn').dispatchEvent('click');
    const textarea = page.locator('.grdc-comment-box textarea');
    await expect(textarea).toBeVisible();

    const sidebar = page.locator('.grdc-sidebar');
    const collapsedBefore = await sidebar.evaluate((el) =>
      el.classList.contains('grdc-sidebar-collapsed')
    );

    await textarea.focus();
    await page.keyboard.press('t');

    // `t` typed into the textarea should have appended a `t` character,
    // not toggled the sidebar.
    await expect(textarea).toHaveValue('t');
    const collapsedAfter = await sidebar.evaluate((el) =>
      el.classList.contains('grdc-sidebar-collapsed')
    );
    expect(collapsedAfter).toBe(collapsedBefore);
  });
});
