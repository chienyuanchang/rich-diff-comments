const { test, expect } = require('@playwright/test');
const { setupExtensionPage } = require('./_helpers');
const sources = require('./fixtures/sources');

const fixture = sources.yamlFrontmatter;

// Minimal stand-in for GitHub's sticky files toolbar row ("All commits …
// N / M viewed"), shaped like the captured markup: a <section> with hashed
// class names, a sr-only <h2>, then left and right control groups.
async function addFilesToolbar(page) {
  await page.evaluate(() => {
    const section = document.createElement('section');
    section.className = 'stickyHeader__OQ39Id updatedHeaderToolbar__5Xcutd';
    section.style.cssText = 'position:sticky;top:0;z-index:1;display:flex;justify-content:space-between;align-items:center;height:48px;background:#fff';
    section.innerHTML = `
      <h2 class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden">Pull request toolbar</h2>
      <div id="left-group" style="width:200px;height:28px">All commits</div>
      <div id="right-group" style="width:150px;height:28px">1 / 6 viewed</div>`;
    document.body.prepend(section);
    const spacer = document.createElement('div');
    spacer.style.height = '3000px';
    document.body.appendChild(spacer);
  });
}

async function boxes(page) {
  return page.evaluate(() => {
    const r = (el) => el.getBoundingClientRect().toJSON();
    return {
      header: r(document.querySelector('.grdc-sidebar-header')),
      row: r(document.querySelector('section[class*="updatedHeaderToolbar__"]')),
      left: r(document.getElementById('left-group')),
      right: r(document.getElementById('right-group')),
    };
  });
}

function expectInsideRowGap({ header, row, left, right }) {
  expect(header.width).toBeGreaterThan(200); // collapsed strip still shows its controls
  expect(header.top).toBeGreaterThanOrEqual(row.top);
  expect(header.bottom).toBeLessThanOrEqual(row.bottom);
  expect(header.left).toBeGreaterThanOrEqual(left.right);
  expect(header.right).toBeLessThanOrEqual(right.left);
}

test('the bar docks into the files toolbar row, follows it, and can be undocked and re-docked', async ({ page }) => {
  await setupExtensionPage(page, 'yaml-frontmatter', {
    rawSource: { [fixture.path]: fixture.source },
  });
  await addFilesToolbar(page);
  const sidebar = page.locator('.grdc-sidebar');

  // Shift+T clears the helper's stored floating position → docked.
  await page.keyboard.press('Shift+T');
  await page.locator('.grdc-sidebar-collapse').click();
  await expect(sidebar).toHaveClass(/grdc-sidebar-docked/);
  expectInsideRowGap(await boxes(page));

  // Scrolling keeps it in the sticky row.
  await page.mouse.wheel(0, 1200);
  await expect.poll(async () => (await boxes(page)).row.top).toBe(0);
  await page.waitForTimeout(50);
  expectInsideRowGap(await boxes(page));

  // Dragging the bar undocks it and remembers where it was dropped.
  const { header } = await boxes(page);
  await page.mouse.move(header.left + 2, header.top + 2);
  await page.mouse.down();
  await page.mouse.move(header.left + 2, header.top + 302, { steps: 5 });
  await page.mouse.up();
  await expect(sidebar).not.toHaveClass(/grdc-sidebar-docked/);
  expect(await page.evaluate(() => localStorage.getItem('grdc_sidebar_pos'))).not.toBeNull();
  expect((await boxes(page)).header.top).toBeGreaterThan(250);

  // Shift+T docks it back.
  await page.keyboard.press('Shift+T');
  await expect(sidebar).toHaveClass(/grdc-sidebar-docked/);
  await page.locator('.grdc-sidebar-collapse').click();
  expectInsideRowGap(await boxes(page));
});
