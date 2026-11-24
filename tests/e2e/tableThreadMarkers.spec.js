'use strict';

const { test, expect } = require('@playwright/test');
const { setupExtensionPage, setupFixture, gotoPRPage, injectExtension, waitForInit } = require('./_helpers');

const table = (page) => page.locator('.markdown-body table').last();
const fixtures = require('./fixtures/sources');

function makeThread(id, body, options) {
  const opts = options || {};
  return {
    id: String(id),
    subjectType: opts.startLine ? 'MULTI_LINE' : 'LINE',
    isResolved: !!opts.isResolved,
    viewerCanReply: true,
    viewerCanResolve: true,
    commentsData: {
      comments: [{
        databaseId: id * 10,
        body,
        author: { login: 'reviewer', avatarUrl: '' },
        createdAt: opts.createdAt || `2026-09-23T10:${String(id).padStart(2, '0')}:00.000Z`,
      }],
    },
  };
}

function routeDataWithTableThreads() {
  return {
    diffSummaries: [{
      path: fixtures.yamlFrontmatter.path,
      pathDigest: 'test1',
      changeType: 'MODIFIED',
      markersMap: {
        R24: { threads: [{ id: '104' }] },
        R26: {
          threads: [
            { id: '101' },
            { id: '102' },
            { id: '103', start: 'R24' },
          ],
        },
      },
    }],
    markers: {
      threads: {
        101: makeThread(101, 'First thread on the data row.', { createdAt: '2026-09-23T10:01:00.000Z' }),
        102: makeThread(102, 'Resolved thread on the same row.', {
          isResolved: true,
          createdAt: '2026-09-23T10:02:00.000Z',
        }),
        103: makeThread(103, 'Range thread from the header through the data row.', {
          startLine: 24,
          createdAt: '2026-09-23T10:00:00.000Z',
        }),
        // A thread with no visible comments must not create a marker.
        104: {
          id: '104',
          subjectType: 'LINE',
          isResolved: false,
          commentsData: { comments: [] },
        },
      },
    },
  };
}

test.describe('GitHub table-row thread markers', () => {
  test('marks exact rows and cycles through visible conversations', async ({ page }) => {
    await setupExtensionPage(page, 'yaml-frontmatter', {
      rawSource: { [fixtures.yamlFrontmatter.path]: fixtures.yamlFrontmatter.source },
      routeData: routeDataWithTableThreads(),
    });

    const table = page.locator('.markdown-body table').last();
    const headerRow = table.locator('thead tr:not(.grdc-thread-row)');
    const dataRow = table.locator('tbody tr:not(.grdc-thread-row)');
    const headerMarker = headerRow.locator('.grdc-table-thread-marker');
    const dataMarker = dataRow.locator('.grdc-table-thread-marker');

    await expect(headerMarker).toHaveCount(1);
    await expect(headerMarker).toHaveAttribute('aria-label', 'Open the review thread on this table row');
    await expect(dataMarker).toHaveCount(1);
    await expect(dataMarker).toHaveAttribute('aria-label', 'Open review threads on this table row; 3 threads');
    await expect(dataMarker).toHaveAttribute('data-count', '3');
    await expect(dataRow.locator(':scope > td').first().locator('.grdc-comment-btn')).toHaveCount(1);
    await expect(dataRow).toContainText('2026');
    // Threads sit in a full-width row right under the row they belong to.
    await expect(dataRow.locator('xpath=following-sibling::tr[1]')).toHaveClass('grdc-thread-row');
    await expect(table.locator('tbody tr.grdc-thread-row .grdc-existing-thread')).toHaveCount(2);
    // The header→data-row range thread starts at the header row.
    await expect(table.locator('thead tr.grdc-thread-row .grdc-existing-thread[data-grdc-thread-id="103"]')).toHaveCount(1);

    await dataMarker.click();
    await expect(page.locator('.grdc-thread-badge[data-grdc-thread-id="103"]')).toBeFocused();
    await dataMarker.press('Enter');
    await expect(page.locator('.grdc-thread-badge[data-grdc-thread-id="101"]')).toBeFocused();
    await dataMarker.press('Enter');
    const resolvedBadge = page.locator('.grdc-thread-badge[data-grdc-thread-id="102"]');
    await expect(resolvedBadge).toBeFocused();
    await expect(resolvedBadge.locator('xpath=..').locator('.grdc-thread-body')).toBeVisible();

    await expect(page.locator('.grdc-existing-thread[data-grdc-thread-id="104"]')).toHaveCount(0);
  });

  test('a table GitHub shows as replaced is merged into one table with the edited cell marked', async ({ page }) => {
    await setupFixture(page, 'yaml-frontmatter', {
      rawSource: { [fixtures.yamlFrontmatter.path]: fixtures.yamlFrontmatter.source },
      routeData: routeDataWithTableThreads(),
    });
    await gotoPRPage(page);
    await page.evaluate(() => {
      // GitHub's shape for an edited table: the old table in <del>, the new one in <ins>.
      const table = document.querySelector('.markdown-body table:last-of-type');
      const old = table.cloneNode(true);
      old.querySelector('tbody td:nth-child(2)').textContent = 'Old Author';
      const del = document.createElement('del');
      const ins = document.createElement('ins');
      del.append(old);
      table.before(del, ins);
      ins.append(table);
    });
    await injectExtension(page);
    await waitForInit(page);

    const body = page.locator('.markdown-body');
    await expect(body.locator('table')).toHaveCount(2); // frontmatter + the merged table
    const dataRow = body.locator('table').last().locator('tbody tr:not(.grdc-thread-row)');
    await expect(dataRow).toHaveCount(1);
    await expect(dataRow.locator('td').nth(1).locator('del')).toHaveText('Old Author');
    await expect(dataRow.locator('td').nth(1).locator('ins')).toHaveText('Test User');
    await expect(body.locator('table').last().locator('thead del, thead ins')).toHaveCount(0);
    await expect(dataRow.locator('.grdc-comment-btn')).toHaveCount(1);
    await expect(table(page).locator('tr.grdc-thread-row .grdc-existing-thread')).toHaveCount(3);
  });
});
