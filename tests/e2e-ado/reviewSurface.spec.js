'use strict';

const { test, expect } = require('@playwright/test');
const {
  setupAdoExtensionPage,
  matchingRequests,
} = require('./_helpers');
const fixtures = require('./fixtures/sources');

async function clickCommentButton(host) {
  await host.hover();
  await host.locator('.adrc-comment-btn').dispatchEvent('click');
}

test.describe('ADO rendered review surface', () => {
  test('initializes through mocked ADO REST, maps lines, and builds all navigation panes', async ({ page }) => {
    const { pageErrors } = await setupAdoExtensionPage(page);
    const preview = page.locator('.markdown-preview-container');

    // Injected collapse/comment buttons become part of the heading's
    // accessible name, so select the host by DOM text rather than pinning an
    // exact post-injection ARIA name.
    const h1 = preview.locator('h1', { hasText: 'Design Review' });
    await expect(h1).toBeVisible();
    const button = h1.locator('.adrc-comment-btn');
    await expect(button).toHaveAttribute('title', new RegExp(`${fixtures.DESIGN_PATH}:1`));
    expect(await button.evaluate((element) => getComputedStyle(element).opacity)).toBe('0');
    await h1.hover();
    await expect.poll(async () => Number(await button.evaluate((element) => getComputedStyle(element).opacity)))
      .toBeGreaterThan(0);

    const tableHeader = preview.locator('th', { hasText: 'Area' }).first();
    await tableHeader.hover();
    const tableButton = tableHeader.locator('.adrc-comment-btn');
    const [cellBox, buttonBox] = await Promise.all([tableHeader.boundingBox(), tableButton.boundingBox()]);
    expect(cellBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();
    expect(buttonBox.x).toBeGreaterThanOrEqual(cellBox.x - 2);
    expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(cellBox.x + cellBox.width + 2);

    await expect(page.locator('.adrc-thread-badge')).toHaveCount(2);
    await expect(page.locator('.adrc-sidebar-thread-card')).toHaveCount(3);
    await expect(page.locator('[data-count="threads"]')).toHaveText('3');
    await expect(page.getByText('The source branch was updated.')).toHaveCount(0);

    const state = await page.evaluate(() => window.ADORC_probe.sidebar());
    expect(state.currentFile).toBe(fixtures.DESIGN_PATH);
    expect(state.threadCount).toBe(3);
    expect(state.outlineCount).toBe(4);
    expect(state.changeCount).toBeGreaterThanOrEqual(2);
    expect(state.changesStatus).toBe('ready');
    await expect(page.locator('.adrc-sidebar-change-card')).toHaveCount(state.changeCount);

    expect(pageErrors).toEqual([]);
  });

  test('posts a single-line comment with the exact ADO thread payload and refreshes the UI', async ({ page }) => {
    const { server } = await setupAdoExtensionPage(page);
    const h1 = page.locator('.markdown-preview-container h1', { hasText: 'Design Review' });
    await clickCommentButton(h1);

    const editor = page.locator('.adrc-compose-editor');
    await expect(editor).toBeVisible();
    await expect(editor.locator('.adrc-editor-header')).toContainText(`${fixtures.DESIGN_PATH}:1`);
    await editor.locator('textarea').fill('**Looks good** from the ADO browser test.');
    await editor.locator('.adrc-editor-tab[data-tab="preview"]').click();
    await expect(editor.locator('.adrc-editor-preview strong')).toHaveText('Looks good');
    await editor.locator('.adrc-editor-submit').click();

    await expect.poll(() => matchingRequests(server, 'POST', '/threads').length).toBe(1);
    const request = matchingRequests(server, 'POST', '/threads')[0];
    expect(request.body.comments[0].content).toBe('**Looks good** from the ADO browser test.');
    expect(request.body.threadContext).toEqual({
      filePath: fixtures.DESIGN_PATH,
      rightFileStart: { line: 1, offset: 1 },
      rightFileEnd: { line: 1, offset: 1 },
    });

    await expect(page.locator('.adrc-thread-badge')).toHaveCount(3);
    await expect(page.locator('[data-count="threads"]')).toHaveText('4');
  });

  test('tracks individual source lines inside an ADO-rendered code fence', async ({ page }) => {
    await setupAdoExtensionPage(page);
    const pre = page.locator('.markdown-preview-container pre');
    const button = pre.locator('.adrc-comment-btn');
    const box = await pre.boundingBox();
    expect(box).not.toBeNull();

    await pre.dispatchEvent('mousemove', { clientX: box.x + 8, clientY: box.y + 13 });
    await expect(button).toHaveAttribute('data-adrc-line', '17');
    await pre.dispatchEvent('mousemove', {
      clientX: box.x + 8,
      clientY: box.y + box.height - 13,
    });
    await expect(button).toHaveAttribute('data-adrc-line', '18');
    await expect(button).toHaveAttribute('title', `Comment on ${fixtures.DESIGN_PATH}:18`);

    await button.dispatchEvent('click');
    const editor = page.locator('.adrc-compose-editor');
    await expect(editor.locator('.adrc-line-input')).toHaveValue('18');
    await expect(editor.locator('.adrc-line-input')).toHaveAttribute('min', '17');
    await expect(editor.locator('.adrc-line-input')).toHaveAttribute('max', '18');
  });

  test('drags between rendered blocks and posts a normalized multi-line ADO range', async ({ page }) => {
    const { server } = await setupAdoExtensionPage(page);
    const startHost = page.locator('.markdown-preview-container p', { hasText: 'The worker uses a durable queue.' });
    const endHost = page.locator('.markdown-preview-container li', { hasText: 'Retry failed work' });
    const startButton = startHost.locator('.adrc-comment-btn');

    await endHost.scrollIntoViewIfNeeded();
    await startHost.hover();
    const startBox = await startButton.boundingBox();
    const endBox = await endHost.boundingBox();
    expect(startBox).not.toBeNull();
    expect(endBox).not.toBeNull();

    const startPoint = {
      clientX: startBox.x + startBox.width / 2,
      clientY: startBox.y + startBox.height / 2,
    };
    // The circular button hangs in a gutter. Dispatch directly to its host
    // (as the GitHub fixture tests do for gutter clicks), then use real mouse
    // movement/drop for document.elementFromPoint range resolution.
    await startButton.dispatchEvent('mousedown', Object.assign({ button: 0 }, startPoint));
    const endPoint = {
      clientX: endBox.x + endBox.width / 2,
      clientY: endBox.y + endBox.height / 2,
    };
    await page.mouse.move(endPoint.clientX, endPoint.clientY, { steps: 8 });
    await expect(page.locator('body')).toHaveClass(/adrc-dragging/);
    expect(await page.evaluate(({ x, y }) =>
      document.elementFromPoint(x, y)?.closest('.adrc-hoverable')?.dataset.adrcLine,
    { x: endPoint.clientX, y: endPoint.clientY })).toBe('9');
    await endHost.dispatchEvent('mouseup', Object.assign({ button: 0, bubbles: true }, endPoint));

    const editor = page.locator('.adrc-compose-editor');
    await expect(editor).toBeVisible();
    await expect(editor.locator('.adrc-line-input-start')).toHaveValue('7');
    await expect(editor.locator('.adrc-line-input-end')).toHaveValue('9');
    await editor.locator('textarea').fill('Range comment from the ADO fixture.');
    await editor.locator('textarea').press('Control+Enter');

    await expect.poll(() => matchingRequests(server, 'POST', '/threads').length).toBe(1);
    const context = matchingRequests(server, 'POST', '/threads')[0].body.threadContext;
    expect(context.filePath).toBe(fixtures.DESIGN_PATH);
    expect(context.rightFileStart).toEqual({ line: 7, offset: 1 });
    expect(context.rightFileEnd).toEqual({ line: 9, offset: 1 });
    await expect(page.locator('.adrc-range-permanent')).not.toHaveCount(0);
  });

  test('posts a reply and re-renders the updated comment count', async ({ page }) => {
    const { server } = await setupAdoExtensionPage(page);
    const panel = page.locator('.adrc-thread-panel[data-thread-id="101"]');
    await expect(panel).toBeVisible();

    await panel.locator('.adrc-thread-reply').click();
    const textarea = panel.locator('.adrc-reply-editor textarea');
    await textarea.fill('Reply created through the fixture API.');
    await textarea.press('Control+Enter');

    await expect.poll(() => matchingRequests(server, 'POST', '/threads/101/comments').length).toBe(1);
    expect(matchingRequests(server, 'POST', '/threads/101/comments')[0].body.content)
      .toBe('Reply created through the fixture API.');
    await expect(page.locator('.adrc-thread-badge[data-thread-id="101"]')).toContainText('2 comments');
    await expect(page.locator('.adrc-thread-panel[data-thread-id="101"] .adrc-thread-comment')).toHaveCount(2);
  });

  test('resolves an active thread and collapses its inline panel', async ({ page }) => {
    const { server } = await setupAdoExtensionPage(page);
    const panel = page.locator('.adrc-thread-panel[data-thread-id="101"]');
    await panel.locator('.adrc-thread-toggle-status').click();

    await expect.poll(() => matchingRequests(server, 'PATCH', '/threads/101').length).toBe(1);
    expect(matchingRequests(server, 'PATCH', '/threads/101')[0].body).toEqual({ status: 2 });
    await expect(page.locator('.adrc-thread-badge[data-thread-id="101"]')).toHaveAttribute('data-status', 'fixed');
    await expect(page.locator('.adrc-thread-badge[data-thread-id="101"]')).toContainText('resolved');
    await expect(page.locator('.adrc-thread-panel[data-thread-id="101"]')).toHaveCount(0);
  });

  test('edits an own comment and displays the server-updated Markdown', async ({ page }) => {
    const { server } = await setupAdoExtensionPage(page);
    const panel = page.locator('.adrc-thread-panel[data-thread-id="101"]');
    const edit = panel.locator('.adrc-edit-comment');
    await expect(edit).toBeVisible();
    await edit.click();

    const editor = panel.locator('.adrc-inline-edit-editor');
    await editor.locator('textarea').fill('Edited with **browser coverage**.');
    await editor.locator('.adrc-editor-submit').click();

    await expect.poll(() => matchingRequests(server, 'PATCH', '/threads/101/comments/1').length).toBe(1);
    await expect(page.locator('.adrc-thread-panel[data-thread-id="101"] .adrc-thread-comment-body strong'))
      .toHaveText('browser coverage');
    await expect(page.locator('.adrc-thread-panel[data-thread-id="101"] .adrc-thread-comment-edited'))
      .toContainText('edited');
  });

  test('requires inline confirmation before deleting an own comment', async ({ page }) => {
    const { server } = await setupAdoExtensionPage(page);
    const panel = page.locator('.adrc-thread-panel[data-thread-id="101"]');
    const deleteButton = panel.locator('.adrc-delete-comment');
    await deleteButton.click();
    await expect(deleteButton).toHaveText('Confirm delete');
    expect(matchingRequests(server, 'DELETE', '/threads/101/comments/1')).toHaveLength(0);

    await deleteButton.click();
    await expect.poll(() => matchingRequests(server, 'DELETE', '/threads/101/comments/1').length).toBe(1);
    await expect(page.locator('.adrc-thread-panel[data-thread-id="101"] .adrc-thread-comment-deleted'))
      .toHaveText('(This comment was deleted.)');
    await expect(page.locator('.adrc-thread-badge[data-thread-id="101"]')).toContainText('0 comments');
  });
});
