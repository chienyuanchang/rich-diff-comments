const { test, expect } = require('@playwright/test');
const { setupExtensionPage } = require('./_helpers');
const sources = require('./fixtures/sources');

const fixture = sources.yamlFrontmatter;

async function waitForHeadingAtStickyOffset(page, headingText) {
  await page.waitForFunction((text) => {
    const heading = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
      .find((candidate) => candidate.textContent.includes(text));
    if (!heading) return false;
    const top = heading.getBoundingClientRect().top;
    return top >= 110 && top <= 130;
  }, headingText);
}

test.describe('rich-diff Table of Contents navigation', () => {
  test.beforeEach(async ({ page }) => {
    await setupExtensionPage(page, 'yaml-frontmatter', {
      rawSource: { [fixture.path]: fixture.source },
    });

    await page.evaluate(() => {
      const root = document.querySelector('.prose-diff .markdown-body');
      const overview = Array.from(root.querySelectorAll('h2'))
        .find((heading) => heading.textContent.includes('Overview'));
      const changeLog = Array.from(root.querySelectorAll('h2'))
        .find((heading) => heading.textContent.includes('Change Log'));

      const toc = document.createElement('nav');
      toc.id = 'fixture-toc';
      toc.innerHTML = [
        '<a id="toc-overview" href="#overview">Overview</a>',
        '<a id="toc-change-log" href="#change-log">Change Log</a>',
      ].join(' · ');
      root.insertBefore(toc, root.firstChild);

      root.style.paddingBottom = '1000px';
      overview.style.marginTop = '700px';
      changeLog.style.marginTop = '1400px';
    });
  });

  test('clicking the same TOC link repeatedly scrolls to its section', async ({ page }) => {
    const link = page.locator('#toc-change-log');

    await page.evaluate(() => {
      window.fixtureHashChanges = 0;
      window.addEventListener('hashchange', () => { window.fixtureHashChanges += 1; });
    });

    await link.click();
    await expect(page).toHaveURL(/#change-log$/);
    await waitForHeadingAtStickyOffset(page, 'Change Log');
    await expect.poll(() => page.evaluate(() => window.fixtureHashChanges)).toBe(0);

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(10);

    await link.click();
    await expect(page).toHaveURL(/#change-log$/);
    await waitForHeadingAtStickyOffset(page, 'Change Log');
  });

  test('one click follows a heading that moves after navigation starts', async ({ page }) => {
    await page.evaluate(() => {
      const changeLog = Array.from(document.querySelectorAll('h2'))
        .find((heading) => heading.textContent.includes('Change Log'));
      const shift = document.createElement('div');
      shift.id = 'late-layout-shift';
      changeLog.before(shift);
      window.addEventListener('scroll', function applyLateShift() {
        if (window.scrollY < 200) return;
        shift.style.height = '1200px';
        window.removeEventListener('scroll', applyLateShift);
      });
    });

    await page.locator('#toc-change-log').click();

    await expect(page.locator('#late-layout-shift')).toHaveCSS('height', '1200px');
    await waitForHeadingAtStickyOffset(page, 'Change Log');
  });

  test('different TOC links and browser history retain normal navigation', async ({ page }) => {
    await page.locator('#toc-change-log').click();
    await waitForHeadingAtStickyOffset(page, 'Change Log');

    await page.locator('#toc-overview').click();
    await expect(page).toHaveURL(/#overview$/);
    await waitForHeadingAtStickyOffset(page, 'Overview');

    await page.goBack();
    await expect(page).toHaveURL(/#change-log$/);
    await waitForHeadingAtStickyOffset(page, 'Change Log');
  });
});
