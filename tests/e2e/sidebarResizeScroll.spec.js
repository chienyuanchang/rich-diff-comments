const { test, expect } = require('@playwright/test');
const { setupExtensionPage } = require('./_helpers');
const sources = require('./fixtures/sources');

const fixture = sources.yamlFrontmatter;

for (const [tabName, selector] of [
  ['changes', '.grdc-sidebar-changes-list'],
  ['threads', '.grdc-sidebar-list'],
  ['outline', '.grdc-sidebar-outline-tree'],
]) {
  test(`resizing locks the ${tabName} scrollbar position`, async ({ page }) => {
    await setupExtensionPage(page, 'yaml-frontmatter', {
      rawSource: { [fixture.path]: fixture.source },
    });

    const initialScrollTop = await page.evaluate(({ tabName, selector }) => {
      const sidebar = document.querySelector('.grdc-sidebar');
      const tab = sidebar.querySelector(`.grdc-sidebar-tab[data-grdc-tab="${tabName}"]`);
      tab.hidden = false;
      tab.click();
      sidebar.style.width = '482px';
      sidebar.style.height = '300px';

      const scroller = sidebar.querySelector(selector);
      scroller.innerHTML = '';
      for (let i = 0; i < 50; i += 1) {
        const row = document.createElement('div');
        row.textContent = `${tabName} row ${i}`;
        row.style.height = '28px';
        scroller.appendChild(row);
      }
      scroller.scrollTop = 233;

      const rect = sidebar.getBoundingClientRect();
      sidebar.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        button: 0,
        clientX: rect.right - 2,
        clientY: rect.bottom - 2,
      }));

      // Simulate a size change plus the scrollTop adjustment browser scroll
      // anchoring can make while card text reflows.
      sidebar.style.width = '620px';
      sidebar.style.height = '420px';
      scroller.scrollTop = 360;
      return 233;
    }, { tabName, selector });

    await expect.poll(() => page.locator(selector).evaluate((el) => el.scrollTop))
      .toBe(initialScrollTop);

    // Scrollbar track auto-repeat can continue without another size change.
    // The live scroll listener must still snap it back during the gesture.
    await page.locator(selector).evaluate((el) => { el.scrollTop = 500; });
    await expect.poll(() => page.locator(selector).evaluate((el) => el.scrollTop))
      .toBe(initialScrollTop);

    await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
    await expect(page.locator(selector)).toHaveJSProperty('scrollTop', initialScrollTop);

    // Releasing the mouse removes the lock; normal user scrolling resumes.
    await page.locator(selector).evaluate((el) => { el.scrollTop = 500; });
    await expect(page.locator(selector)).toHaveJSProperty('scrollTop', 500);
  });
}
