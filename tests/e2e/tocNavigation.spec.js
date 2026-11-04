const { test, expect } = require('@playwright/test');
const { setupExtensionPage, setupFixture, gotoPRPage, injectExtension, waitForInit } = require('./_helpers');
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

  test('an unresolved heading hash is retried when its rich-diff heading mounts', async ({ page }) => {
    await page.evaluate(() => { location.hash = 'late-section'; });
    await expect(page).toHaveURL(/#late-section$/);
    const initialized = waitForInit(page);
    await page.evaluate(() => {
      const heading = document.createElement('h2');
      heading.textContent = 'Late section';
      heading.style.marginTop = '1600px';
      document.querySelector('.markdown-body').append(heading);
    });
    await initialized;
    await waitForHeadingAtStickyOffset(page, 'Late section');
  });

  test('a new review path can follow its heading hash after an earlier navigation', async ({ page }) => {
    await page.locator('#toc-overview').click();
    await waitForHeadingAtStickyOffset(page, 'Overview');
    const initialized = waitForInit(page);
    await page.evaluate(() => {
      history.pushState(history.state, '', location.pathname.replace(/\/files$/, '/changes') + '#change-log');
    });
    await initialized;
    await waitForHeadingAtStickyOffset(page, 'Change Log');
  });
});

for (const deletion of ['last comment', 'reply']) {
  test(`deleting a ${deletion} does not replay a previously visited heading hash`, async ({ page }) => {
    const comments = [{
      databaseId: 7001,
      body: 'Original discussion.',
      author: { login: 'reviewer' },
      createdAt: '2026-11-03T19:00:00Z',
    }];
    if (deletion === 'reply') comments.push({
      databaseId: 7002,
      body: 'Reply to delete.',
      author: { login: 'reviewer' },
      createdAt: '2026-11-03T19:01:00Z',
    });
    const routeData = {
      diffSummaries: [{
        path: fixture.path,
        pathDigest: 'test1',
        changeType: 'MODIFIED',
        markersMap: { R19: { threads: [{ id: '201' }] } },
      }],
      markers: { threads: {
        201: { id: '201', subjectType: 'LINE', commentsData: { comments } },
      } },
    };
    await setupFixture(page, 'yaml-frontmatter', {
      rawSource: { [fixture.path]: fixture.source },
      routeData,
    });
    const targetDbId = deletion === 'reply' ? 7002 : 7001;
    await page.route(`**/page_data/review_comments/${targetDbId}`, async (route) => {
      expect(route.request().method()).toBe('DELETE');
      if (deletion === 'reply') comments.pop();
      else delete routeData.markers.threads[201];
      await route.fulfill({ status: 204 });
    });
    await gotoPRPage(page);
    await page.evaluate((initialHash) => {
      document.cookie = 'dotcom_user=reviewer; path=/';
      const root = document.querySelector('.markdown-body');
      root.style.paddingLeft = '48px';
      root.style.paddingBottom = '1000px';
      const heading = Array.from(root.querySelectorAll('h2'))
        .find((element) => element.textContent.includes('Change Log'));
      heading.style.marginTop = '1600px';
      const toc = document.createElement('nav');
      toc.innerHTML = '<a id="delete-test-toc" href="#change-log">Change Log</a>';
      root.prepend(toc);
      if (initialHash) history.replaceState(history.state, '', '#change-log');
    }, deletion === 'last comment');
    await injectExtension(page);
    await waitForInit(page);
    if (deletion === 'reply') await page.locator('#delete-test-toc').click();
    await expect(page).toHaveURL(/#change-log$/);
    await waitForHeadingAtStickyOffset(page, 'Change Log');

    await page.getByRole('tab', { name: 'Threads', exact: true }).click();
    await page.locator('.grdc-sidebar-list .grdc-sidebar-card').click();
    const deleteButton = page.locator(`[data-grdc-comment-dbid="${targetDbId}"] .grdc-comment-delete-link`);
    await expect(deleteButton).toBeInViewport();
    const beforeDelete = await page.evaluate(() => {
      window.fixtureAnchorScrolls = [];
      const scrollTo = window.scrollTo.bind(window);
      const hashHeading = Array.from(document.querySelectorAll('.markdown-body h2'))
        .find((heading) => heading.textContent.includes('Change Log'));
      window.scrollTo = (...args) => {
        const anchorTop = Math.max(0, window.scrollY + hashHeading.getBoundingClientRect().top - 120);
        if (typeof args[0] === 'object' && args[0].behavior && Math.abs(args[0].top - anchorTop) < 4) {
          window.fixtureAnchorScrolls.push(args[0]);
        }
        scrollTo(...args);
      };
      return window.scrollY;
    });
    page.once('dialog', (dialog) => dialog.accept());
    const rebuilt = waitForInit(page);
    await deleteButton.click();
    await rebuilt;
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await page.evaluate(() => window.fixtureAnchorScrolls)).toEqual([]);
    expect(Math.abs(await page.evaluate(() => window.scrollY) - beforeDelete)).toBeLessThan(200);
    await expect(page.locator(`[data-grdc-comment-dbid="${targetDbId}"]`)).toHaveCount(0);
    await expect(page.locator('.grdc-existing-thread')).toHaveCount(deletion === 'reply' ? 1 : 0);
    await expect(page).toHaveURL(/#change-log$/);
  });
}
