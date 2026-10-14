'use strict';

const { test, expect } = require('@playwright/test');
const {
  setupAdoExtensionPage,
  waitForAdoReady,
  userThreadCount,
  SOURCE_COMMIT,
  FAKE_PR_FILES_URL,
  SECOND_PR_ID,
  SECOND_FAKE_PR_PATH,
  injectAdoExtension,
} = require('./_helpers');
const fixtures = require('./fixtures/sources');

test.describe('ADO SPA lifecycle and cross-file navigation', () => {
  test('reloads with clean PR-scoped state after an SPA switch to another pull request', async ({ page }) => {
    const { server } = await setupAdoExtensionPage(page);
    await page.keyboard.press('2');
    await expect(page.locator('.adrc-sidebar-thread-card')).toContainText([
      'Should this queue have a dead-letter policy?',
      'Retry and metrics behavior is now documented.',
      'Cross-file thread for navigation coverage.',
    ]);

    server.threads = [{
      id: 201,
      status: 'active',
      threadContext: {
        filePath: fixtures.DESIGN_PATH,
        rightFileStart: { line: 7, offset: 1 },
        rightFileEnd: { line: 7, offset: 1 },
      },
      comments: [{
        id: 1,
        parentCommentId: 0,
        commentType: 1,
        content: 'This thread belongs only to PR 43.',
        author: fixtures.OTHER_USER,
        publishedDate: '2026-09-15T12:00:00.000Z',
        lastContentUpdatedDate: '2026-09-15T12:00:00.000Z',
        isDeleted: false,
      }],
    }];
    server.prChanges = [
      { changeId: 43, changeTrackingId: 430, changeType: 'edit', item: { path: fixtures.DESIGN_PATH } },
    ];
    const requestBoundary = server.requests.length;

    await page.evaluate((nextPath) => {
      const expiresAt = Date.now() + 90000;
      const identity = window.ADORC_probe.prIdentity;
      sessionStorage.setItem('adrc-pending-thread-jump-v1', JSON.stringify({
        id: '101', path: '/docs/design.md', identity, expiresAt,
      }));
      sessionStorage.setItem('adrc-pending-change-jump-v1', JSON.stringify({
        key: 'pr-42-change', path: '/docs/design.md', identity, expiresAt,
      }));
      sessionStorage.setItem('adrc-pending-outline-jump-v1', JSON.stringify({
        key: 'pr-42-outline', path: '/docs/design.md', identity, expiresAt,
      }));
      sessionStorage.setItem('adrc-exact-route-fallback-v1', JSON.stringify({
        path: '/docs/design.md', identity, startedAt: Date.now(),
      }));
      sessionStorage.setItem('adrc-pr-session-catalog-v4', JSON.stringify({
        version: 1, identity, expiresAt,
      }));
      const url = new URL(location.href);
      url.pathname = nextPath;
      history.pushState({}, '', url.href);
    }, SECOND_FAKE_PR_PATH);

    await expect.poll(() => server.pageLoads, { timeout: 4000 }).toBe(2);
    expect(new URL(page.url()).pathname).toBe(SECOND_FAKE_PR_PATH);
    const cleared = await page.evaluate(() => [
      'adrc-pending-thread-jump-v1',
      'adrc-pending-change-jump-v1',
      'adrc-pending-outline-jump-v1',
      'adrc-exact-route-fallback-v1',
      'adrc-pr-session-catalog-v4',
    ].every((key) => sessionStorage.getItem(key) == null));
    expect(cleared).toBe(true);

    // Chromium reinjects manifest content scripts after the production reload;
    // the fixture mirrors that browser step explicitly.
    await injectAdoExtension(page);
    await waitForAdoReady(page, fixtures.DESIGN_PATH, userThreadCount(server.threads));
    expect(await page.evaluate(() => window.ADORC_probe.ctx.prId)).toBe(SECOND_PR_ID);
    await expect(page.locator('.adrc-sidebar-tab[data-tab="threads"]'))
      .toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.adrc-sidebar-thread-card')).toHaveCount(1);
    await expect(page.locator('.adrc-sidebar-thread-card')).toContainText('This thread belongs only to PR 43.');
    await expect(page.locator('.adrc-sidebar')).not.toContainText('Should this queue have a dead-letter policy?');

    const newPrRequests = server.requests.slice(requestBoundary);
    expect(newPrRequests.some((request) =>
      request.pathname.endsWith(`/pullRequests/${SECOND_PR_ID}/threads`)
    )).toBe(true);
    expect(newPrRequests.some((request) =>
      request.pathname.includes('/pullRequests/42/')
    )).toBe(false);
  });

  test('shows the sidebar immediately on Files and opens the first Markdown Preview', async ({ page }) => {
    const { server } = await setupAdoExtensionPage(page, {
      initialUrl: FAKE_PR_FILES_URL,
      hideInitialPreview: true,
      inventoryDelay: 1500,
      waitForReady: false,
    });

    await expect(page.locator('.adrc-sidebar')).toBeVisible({ timeout: 500 });
    await expect(page.locator('.adrc-sidebar-setup')).toBeVisible();
    await expect(page.locator('.adrc-sidebar-setup-message')).toHaveText('Finding changed Markdown files…');
    await expect(page.locator('.adrc-sidebar-open-preview')).toBeDisabled();
    const startup = await page.evaluate(() => window.ADORC_probe.startup());
    expect(startup.milliseconds.shell).toBeLessThan(200);
    expect(startup.milliseconds.inventory).toBeNull();

    await expect(page.locator('.adrc-sidebar-open-preview')).toBeEnabled({ timeout: 4000 });
    await page.locator('.adrc-sidebar-open-preview').click();
    await waitForAdoReady(page, fixtures.DESIGN_PATH, userThreadCount(server.threads));
    expect(new URL(page.url()).searchParams.get('path')).toBe(fixtures.DESIGN_PATH);
    await expect(page.locator('.markdown-preview-container h1')).toContainText('Design Review');
    await expect(page.locator('.adrc-sidebar-setup')).toBeHidden();
  });

  test('native TreeEx selection releases and re-releases a non-Markdown file lock', async ({ page }) => {
    const initialUrl = `${FAKE_PR_FILES_URL}&path=${encodeURIComponent(fixtures.NON_MARKDOWN_PATH)}`;
    const { server } = await setupAdoExtensionPage(page, {
      initialUrl,
      hideInitialPreview: true,
      keepInitialPathWithoutPreview: true,
      waitForReady: false,
    });
    await page.evaluate((path) => window.__ADO_FIXTURE__.enableSelectionLock(path), fixtures.NON_MARKDOWN_PATH);

    await expect(page.locator('.adrc-sidebar-open-preview')).toHaveText('Open Markdown Preview', { timeout: 4000 });
    await page.locator('.adrc-sidebar-open-preview').click();
    await waitForAdoReady(page, fixtures.DESIGN_PATH, userThreadCount(server.threads));

    expect(new URL(page.url()).searchParams.get('path')).toBe(fixtures.DESIGN_PATH);
    expect(await page.evaluate(() => window.__ADO_FIXTURE__.selectedPath())).toBe(fixtures.DESIGN_PATH);
    expect(server.pageLoads).toBe(1);
    expect((await page.evaluate(() => window.ADORC_probe.viewMode())).currentMode).toBe('preview');

    await page.locator('#tree-non-markdown').click();
    await expect.poll(() => new URL(page.url()).searchParams.get('path'))
      .toBe(fixtures.NON_MARKDOWN_PATH);
    expect(await page.evaluate(() => window.__ADO_FIXTURE__.selectedPath())).toBe(fixtures.NON_MARKDOWN_PATH);

    await page.keyboard.press('2');
    await page.locator(`.adrc-sidebar-thread-card[data-path="${fixtures.OTHER_PATH}"]`).click();
    await waitForAdoReady(page, fixtures.OTHER_PATH, userThreadCount(server.threads));

    expect(new URL(page.url()).searchParams.get('path')).toBe(fixtures.OTHER_PATH);
    expect(await page.evaluate(() => window.__ADO_FIXTURE__.selectedPath())).toBe(fixtures.OTHER_PATH);
    expect(server.pageLoads).toBe(1);
  });

  test('ignores a changed-file tree row whose name ends in preview while restoring Preview mode', async ({ page }) => {
    const decoyPath = '/resources/openapi/2026-06-01-preview';
    const initialUrl = `${FAKE_PR_FILES_URL}&path=${encodeURIComponent(fixtures.NON_MARKDOWN_PATH)}`;
    const { server } = await setupAdoExtensionPage(page, {
      initialUrl,
      hideInitialPreview: true,
      keepInitialPathWithoutPreview: true,
      waitForReady: false,
    });
    await page.evaluate(({ selectedPath, decoyPath }) => {
      window.__ADO_FIXTURE__.enableSelectionLock(selectedPath);
      // Real TreeEx accepts the extension's programmatic List-row click. Keep
      // that behavior for this decoy even though the fixture selection lock
      // otherwise rejects synthetic DOM fallbacks.
      document.querySelector('#tree-preview-suffix').addEventListener('click', () => {
        window.__ADO_FIXTURE__.openPath(decoyPath);
      });
    }, { selectedPath: fixtures.NON_MARKDOWN_PATH, decoyPath });

    await expect(page.locator('.adrc-sidebar-open-preview'))
      .toHaveText('Open Markdown Preview', { timeout: 4000 });
    await page.locator('.adrc-sidebar-open-preview').click();
    await waitForAdoReady(page, fixtures.DESIGN_PATH, userThreadCount(server.threads));

    expect(new URL(page.url()).searchParams.get('path')).toBe(fixtures.DESIGN_PATH);
    expect(await page.evaluate(() => window.__ADO_FIXTURE__.selectedPath())).toBe(fixtures.DESIGN_PATH);
    expect((await page.evaluate(() => window.ADORC_probe.viewMode())).currentMode).toBe('preview');
    expect(server.pageLoads).toBe(1);
  });

  test('immediate sidebar stays hidden outside the PR Files tab', async ({ page }) => {
    await setupAdoExtensionPage(page);
    await page.evaluate(() => {
      const url = new URL(location.href);
      url.searchParams.set('_a', 'overview');
      url.searchParams.delete('path');
      history.pushState({}, '', url.href);
    });
    await expect(page.locator('.adrc-sidebar')).toBeHidden({ timeout: 1500 });
    await expect(page.locator('.adrc-sidebar-launcher')).toHaveCount(0);
  });

  test('Preview action switches the selected Markdown file from Inline to Preview', async ({ page }) => {
    const { server } = await setupAdoExtensionPage(page, {
      hideInitialPreview: true,
      keepInitialPathWithoutPreview: true,
      waitForReady: false,
    });
    await expect(page.locator('.adrc-sidebar')).toBeVisible({ timeout: 500 });
    await expect(page.locator('.adrc-sidebar-open-preview')).toHaveText('Open Preview', { timeout: 4000 });
    await page.locator('.adrc-sidebar-open-preview').click();
    await waitForAdoReady(page, fixtures.DESIGN_PATH, userThreadCount(server.threads));
    await expect(page.locator('.markdown-preview-container h1')).toContainText('Design Review');
    expect((await page.evaluate(() => window.ADORC_probe.viewMode())).currentMode).toBe('preview');
  });

  test('book shortcut opens Outline and explains Markdown Preview restoration', async ({ page }) => {
    const { server } = await setupAdoExtensionPage(page, {
      hideInitialPreview: true,
      keepInitialPathWithoutPreview: true,
      waitForReady: false,
    });

    await page.locator('.adrc-sidebar-outline-shortcut').click();
    await expect(page.locator('.adrc-sidebar-tab[data-tab="outline"]'))
      .toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.adrc-sidebar-setup-message'))
      .toContainText('to Markdown Preview');
    await expect(page.locator('.adrc-sidebar-open-preview')).toHaveText('Opening Preview…');

    await waitForAdoReady(page, fixtures.DESIGN_PATH, userThreadCount(server.threads));
    await expect(page.locator('.adrc-sidebar-setup')).toBeHidden();
    expect((await page.evaluate(() => window.ADORC_probe.viewMode())).currentMode).toBe('preview');
  });

  test('orphaned Markdown pending jump releases the Preview action', async ({ page }) => {
    await setupAdoExtensionPage(page);
    await page.evaluate((stalePath) => {
      sessionStorage.setItem('adrc-pending-outline-jump-v1', JSON.stringify({
        key: null,
        path: stalePath,
        identity: window.ADORC_probe.prIdentity,
        requirePreview: true,
        expiresAt: Date.now() + 90000,
      }));
      window.__ADO_FIXTURE__.preview.style.display = 'none';
      window.__ADO_FIXTURE__.preview.innerHTML = '';
      document.querySelector('.fixture-view-mode').textContent = 'Inline';
    }, fixtures.OTHER_PATH);

    await expect(page.locator('.adrc-sidebar-open-preview')).toHaveText('Open Preview', { timeout: 2000 });
    expect((await page.evaluate(() => window.ADORC_probe.viewMode())).pendingOutlineJump).toBeNull();
  });

  test('current-file source failure keeps the sidebar visible with a Retry action', async ({ page }) => {
    const { server } = await setupAdoExtensionPage(page, {
      sourceFailures: { [fixtures.DESIGN_PATH]: 503 },
      waitForReady: false,
    });
    await expect(page.locator('.adrc-sidebar')).toBeVisible({ timeout: 500 });
    await expect(page.locator('.adrc-sidebar-open-preview')).toHaveText('Retry', { timeout: 4000 });
    await expect(page.locator('.adrc-sidebar-setup-message')).toContainText('Could not prepare');
    const startup = await page.evaluate(() => window.ADORC_probe.startup());
    expect(startup.previewStatus).toBe('error');
    expect(startup.previewError).toContain('503');

    delete server.sourceFailures[fixtures.DESIGN_PATH];
    await page.locator('.adrc-sidebar-open-preview').click();
    await waitForAdoReady(page, fixtures.DESIGN_PATH, userThreadCount(server.threads));
    await expect(page.locator('.adrc-sidebar-setup')).toBeHidden();
    expect((await page.evaluate(() => window.ADORC_probe.startup())).previewStatus).toBe('ready');
  });

  test('Files-page setup explains when the pull request has no changed Markdown', async ({ page }) => {
    await setupAdoExtensionPage(page, {
      initialUrl: FAKE_PR_FILES_URL,
      hideInitialPreview: true,
      prChanges: [],
      waitForReady: false,
    });

    await expect(page.locator('.adrc-sidebar')).toBeVisible({ timeout: 500 });
    await expect(page.locator('.adrc-sidebar-setup-message'))
      .toHaveText('No changed Markdown file is available in this pull request.', { timeout: 4000 });
    await expect(page.locator('.adrc-sidebar-open-preview')).toBeDisabled();
  });

  test('opens a cross-file thread through the native tree row without reloading or leaving Preview', async ({ page }) => {
    const { server } = await setupAdoExtensionPage(page);
    await page.evaluate(() => { window.__initialAdoPreview = window.__ADO_FIXTURE__.preview; });
    await page.keyboard.press('2');

    await page.locator(`.adrc-sidebar-thread-card[data-path="${fixtures.OTHER_PATH}"]`).click();
    await waitForAdoReady(page, fixtures.OTHER_PATH, userThreadCount(server.threads));

    expect(new URL(page.url()).searchParams.get('path')).toBe(fixtures.OTHER_PATH);
    await expect(page.locator('.markdown-preview-container h1')).toContainText('Other Document');
    await expect(page.locator('.adrc-thread-badge[data-thread-id="103"]')).toHaveCount(1);
    await expect(page.locator('.adrc-thread-badge[data-thread-id="101"]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__initialAdoPreview === window.__ADO_FIXTURE__.preview)).toBe(true);
    expect(server.pageLoads).toBe(1);

    const mode = await page.evaluate(() => window.ADORC_probe.viewMode());
    expect(mode.previewVisible).toBe(true);
    expect(mode.pendingThreadJump).toBeNull();
    expect(mode.currentMode).toBe('preview');
  });

  test('tree diagnostics distinguish duplicate basenames by reconstructed aria-level path', async ({ page }) => {
    await setupAdoExtensionPage(page);
    await page.evaluate(() => {
      const tree = document.querySelector('.fixture-tree');
      const rows = [
        ['probe-public', 'public', 1, true],
        ['probe-cu-cli', 'cu-cli', 2, true],
        ['probe-nested-security', 'SECURITY.md', 3, null],
        ['probe-root-security', 'SECURITY.md', 1, null],
        ['probe-unrelated', 'unrelated.md', 1, null],
      ];
      rows.forEach(([id, label, level, expanded]) => {
        const row = document.createElement('div');
        row.id = id;
        row.className = 'bolt-tree-row';
        row.setAttribute('role', 'treeitem');
        row.setAttribute('aria-level', String(level));
        if (expanded != null) row.setAttribute('aria-expanded', String(expanded));
        row.innerHTML = `<div class="bolt-tree-cell"><div class="bolt-table-cell-content"><span class="bolt-list-cell-text">${label}</span></div></div>`;
        tree.appendChild(row);
      });
    });

    const root = await page.evaluate(() => window.ADORC_probe.fileTargets('/SECURITY.md'));
    const nested = await page.evaluate(() => window.ADORC_probe.fileTargets('/public/cu-cli/SECURITY.md'));
    const missing = await page.evaluate(() => window.ADORC_probe.fileTargets('/issues/missing.md'));
    expect(root.map((entry) => entry.rowId)).toEqual(['probe-root-security']);
    expect(nested.map((entry) => entry.rowId)).toEqual(['probe-nested-security']);
    expect(missing).toEqual([]);
  });

  test('an orphaned nested README row cannot intercept root README navigation', async ({ page }) => {
    await setupAdoExtensionPage(page);
    await page.evaluate(() => {
      const tree = document.querySelector('.fixture-tree');
      const nested = document.createElement('div');
      nested.id = 'probe-orphaned-nested-readme';
      nested.className = 'bolt-tree-row';
      nested.setAttribute('role', 'treeitem');
      nested.setAttribute('aria-level', '2');
      nested.innerHTML = '<div class="bolt-tree-cell"><div class="bolt-table-cell-content"><span class="bolt-list-cell-text">README.md</span></div></div>';
      const root = document.createElement('div');
      root.id = 'probe-root-readme';
      root.className = 'bolt-tree-row';
      root.setAttribute('role', 'treeitem');
      root.setAttribute('aria-level', '1');
      root.innerHTML = '<div class="bolt-tree-cell"><div class="bolt-table-cell-content"><span class="bolt-list-cell-text">README.md</span></div></div>';
      tree.prepend(root);
      tree.prepend(nested);
    });

    const targets = await page.evaluate(() => window.ADORC_probe.fileTargets('/README.md'));
    expect(targets.map((entry) => entry.rowId)).toEqual(['probe-root-readme']);
  });

  test('an unmaterialized file row falls back to the exact same-PR route', async ({ page }) => {
    const { server } = await setupAdoExtensionPage(page);
    await page.evaluate(() => document.querySelector('#tree-other')?.remove());

    await Promise.all([
      page.waitForURL((url) => url.searchParams.get('path') === fixtures.OTHER_PATH),
      page.evaluate((path) => { void window.ADORC_probe.openFile(path); }, fixtures.OTHER_PATH),
    ]);
    expect(new URL(page.url()).searchParams.get('path')).toBe(fixtures.OTHER_PATH);
    await expect.poll(() => server.pageLoads).toBe(2);
    expect(server.pageLoads).toBe(2);
  });

  test('a pending change resumes after the exact-route reload fallback', async ({ page }) => {
    const threads = fixtures.defaultThreads();
    threads[0].comments[0].content =
      `@<${fixtures.MENTION_USER.localId.toUpperCase()}> please review this.`;
    const { server } = await setupAdoExtensionPage(page, { threads });
    const countRequests = (suffix) => server.requests.filter((request) =>
      request.method === 'GET' && request.pathname.endsWith(suffix)
    ).length;
    const before = {
      iterations: countRequests('/iterations'),
      changes: countRequests('/iterations/2/changes'),
      threads: countRequests('/threads'),
      items: countRequests('/items'),
    };
    await page.evaluate(() => document.querySelector('#tree-other')?.remove());

    await Promise.all([
      page.waitForURL((url) => url.searchParams.get('path') === fixtures.OTHER_PATH),
      page.locator(`.adrc-sidebar-change-card[data-path="${fixtures.OTHER_PATH}"]`).click(),
    ]);
    await page.evaluate(() => {
      window.__ADO_FIXTURE__.preview.style.display = 'none';
      window.__ADO_FIXTURE__.preview.innerHTML = '';
      document.querySelector('.fixture-view-mode').textContent = 'Inline';
    });
    await injectAdoExtension(page);
    await waitForAdoReady(page, fixtures.OTHER_PATH, userThreadCount(server.threads));
    await expect(page.locator('.markdown-preview-container .adrc-change-target-pulse')).toHaveCount(1);
    await page.keyboard.press('2');
    const mentionSnippet = page.locator(
      '.adrc-sidebar-thread-card[data-thread-id="101"] .adrc-sidebar-thread-snippet'
    );
    await expect(mentionSnippet).toContainText(`@${fixtures.MENTION_USER.displayName}`);
    await expect(mentionSnippet).not.toContainText(fixtures.MENTION_USER.localId);
    expect((await page.evaluate(() => window.ADORC_probe.viewMode())).currentMode).toBe('preview');
    expect((await page.evaluate(() => window.ADORC_probe.viewMode())).pendingChangeJump).toBeNull();
    expect(server.pageLoads).toBe(2);
    expect(countRequests('/iterations')).toBe(before.iterations);
    expect(countRequests('/iterations/2/changes')).toBe(before.changes);
    expect(countRequests('/threads')).toBe(before.threads);
    // The new document remaps only its active Preview source. It must not
    // download both source versions for every Markdown file again.
    expect(countRequests('/items')).toBe(before.items + 1);
  });

  test('a superseded tree lookup cannot reload or override the newer target', async ({ page }) => {
    const { server } = await setupAdoExtensionPage(page);
    await page.evaluate(({ first, second }) => {
      const staleRow = document.querySelector('#tree-other');
      staleRow.replaceWith(staleRow.cloneNode(true));
      void window.ADORC_probe.openFile(first);
      setTimeout(() => { void window.ADORC_probe.openFile(second); }, 50);
    }, { first: fixtures.OTHER_PATH, second: fixtures.NEW_PATH });

    await expect.poll(() => new URL(page.url()).searchParams.get('path'))
      .toBe(fixtures.NEW_PATH);
    await page.waitForTimeout(2100);
    expect(new URL(page.url()).searchParams.get('path')).toBe(fixtures.NEW_PATH);
    expect(server.pageLoads).toBe(1);
  });

  test('activates an exact TreeEx row whose consumer listens on mouse press', async ({ page }) => {
    const { server } = await setupAdoExtensionPage(page);
    await page.evaluate((path) => {
      const staleRow = document.querySelector('#tree-other');
      const row = staleRow.cloneNode(true);
      staleRow.replaceWith(row);
      row.addEventListener('mousedown', () => window.__ADO_FIXTURE__.openPath(path), { once: true });
    }, fixtures.OTHER_PATH);

    await page.evaluate((path) => window.ADORC_probe.openFile(path), fixtures.OTHER_PATH);
    await expect.poll(() => new URL(page.url()).searchParams.get('path'))
      .toBe(fixtures.OTHER_PATH);
    expect(server.pageLoads).toBe(1);
  });

  test('invokes the current TreeEx list dispatcher when DOM gestures are ignored', async ({ page }) => {
    const { server } = await setupAdoExtensionPage(page);
    await page.evaluate((path) => {
      const staleRow = document.querySelector('#tree-other');
      const row = staleRow.cloneNode(true);
      staleRow.replaceWith(row);
      row.closest('.fixture-tree').__reactProps$fixture = {
        onClick: (event) => {
          if (event.target.closest('[role="treeitem"]') === row) {
            window.__ADO_FIXTURE__.openPath(path);
          }
        }
      };
    }, fixtures.OTHER_PATH);

    await page.evaluate((path) => window.ADORC_probe.openFile(path), fixtures.OTHER_PATH);
    await expect.poll(() => new URL(page.url()).searchParams.get('path'), { timeout: 6000 })
      .toBe(fixtures.OTHER_PATH);
    expect(server.pageLoads).toBe(1);
  });

  test('a native tree click cancels a slow pending sidebar navigation', async ({ page }) => {
    const { server } = await setupAdoExtensionPage(page);
    await page.evaluate(() => {
      // Strip the fixture's activation listener so the extension remains in
      // its native activation retry window until the reviewer chooses a file.
      const staleRow = document.querySelector('#tree-other');
      staleRow.replaceWith(staleRow.cloneNode(true));
    });

    await page.locator(`.adrc-sidebar-change-card[data-path="${fixtures.OTHER_PATH}"]`).click();
    await page.waitForTimeout(100);
    await page.locator('#tree-deleted').click();

    await expect.poll(() => new URL(page.url()).searchParams.get('path'))
      .toBe(fixtures.DELETED_PATH);
    await expect(page.locator('.adrc-sidebar-setup')).toBeVisible();
    await expect(page.locator('.adrc-sidebar-open-preview')).toHaveText('Open Markdown Preview');
    expect((await page.evaluate(() => window.ADORC_probe.viewMode())).pendingChangeJump).toBeNull();

    // The canceled activation must not later win its retry race or invoke the
    // exact-route reload fallback for the stale sidebar target.
    await page.waitForTimeout(4500);
    expect(new URL(page.url()).searchParams.get('path')).toBe(fixtures.DELETED_PATH);
    expect(server.pageLoads).toBe(1);
  });

  test('expands an exact collapsed ancestor before activating its file', async ({ page }) => {
    const { server } = await setupAdoExtensionPage(page);
    await page.evaluate((path) => {
      const existing = document.querySelector('#tree-other');
      existing.setAttribute('aria-level', '2');
      existing.removeAttribute('aria-label');
      const tree = document.querySelector('.fixture-tree');
      const folder = document.createElement('div');
      folder.id = 'tree-docs-folder';
      folder.className = 'bolt-tree-row';
      folder.setAttribute('role', 'treeitem');
      folder.setAttribute('aria-level', '1');
      folder.setAttribute('aria-expanded', 'false');
      folder.innerHTML = '<div class="bolt-tree-cell"><div class="bolt-table-cell-content"><span class="bolt-tree-expand-button">›</span><span class="bolt-list-cell-text">docs</span></div></div>';
      folder.querySelector('.bolt-tree-expand-button').addEventListener('click', () => {
        folder.setAttribute('aria-expanded', 'true');
        folder.after(existing);
      });
      tree.insertBefore(folder, existing);
      existing.remove();
    }, fixtures.OTHER_PATH);

    const before = await page.evaluate((path) => window.ADORC_probe.fileTree(path), fixtures.OTHER_PATH);
    expect(before.ancestor, JSON.stringify(before, null, 2)).not.toBeNull();
    expect(before.ancestor.rowId).toBe('tree-docs-folder');
    expect(before.ancestor?.reconstructedPath).toBe('/docs');

    await page.evaluate((path) => { void window.ADORC_probe.openFile(path); }, fixtures.OTHER_PATH);
    await expect.poll(() => new URL(page.url()).searchParams.get('path')).toBe(fixtures.OTHER_PATH);
    await expect(page.locator('#tree-docs-folder')).toHaveAttribute('aria-expanded', 'true');
    expect(server.pageLoads).toBe(1);
  });

  test('materializes an offscreen virtualized tree row before using the reload fallback', async ({ page }) => {
    const { server } = await setupAdoExtensionPage(page);
    await page.evaluate((targetPath) => {
      document.querySelector('#tree-other')?.remove();
      const tree = document.querySelector('.fixture-tree');
      const scroller = document.createElement('div');
      scroller.id = 'virtual-tree-scroller';
      scroller.style.cssText = 'position:relative;height:72px;overflow-y:auto;overflow-x:hidden;';
      const canvas = document.createElement('div');
      canvas.style.cssText = 'position:relative;height:1152px;';
      scroller.appendChild(canvas);
      tree.appendChild(scroller);

      const targetIndex = 30;
      const render = () => {
        const start = Math.max(0, Math.floor(scroller.scrollTop / 32));
        canvas.replaceChildren();
        for (let index = start; index < Math.min(36, start + 4); index++) {
          const row = document.createElement('div');
          const isTarget = index === targetIndex;
          row.id = `virtual-row-${index}`;
          row.className = 'bolt-tree-row single-click-activation';
          row.setAttribute('role', 'treeitem');
          row.setAttribute('aria-level', '1');
          row.setAttribute('data-row-index', String(index));
          row.style.cssText = `position:absolute;left:0;right:0;top:${index * 32}px;height:32px;`;
          const label = isTarget ? targetPath.replace(/^\//, '') : `virtual/file-${index}.md`;
          row.innerHTML = `<div class="bolt-tree-cell"><div class="bolt-table-cell-content"><span class="bolt-list-cell-text">${label}</span></div></div>`;
          if (isTarget) row.addEventListener('click', () => window.__ADO_FIXTURE__.openPath(targetPath));
          canvas.appendChild(row);
        }
      };
      scroller.addEventListener('scroll', render);
      render();
    }, fixtures.OTHER_PATH);

    await page.evaluate((path) => { void window.ADORC_probe.openFile(path); }, fixtures.OTHER_PATH);
    await expect.poll(() => new URL(page.url()).searchParams.get('path')).toBe(fixtures.OTHER_PATH);
    await waitForAdoReady(page, fixtures.OTHER_PATH, userThreadCount(server.threads));
    expect(server.pageLoads).toBe(1);
    await expect(page.locator('#virtual-row-30')).toHaveCount(1);
  });

  test('a recycled connected tree row cannot redirect navigation to a folder', async ({ page }) => {
    const { server } = await setupAdoExtensionPage(page);
    const recycledFolder = '/public/sdk/resources/openapi/2026-06-01-preview';
    await page.evaluate(({ targetPath, folderPath }) => {
      const original = document.querySelector('#tree-other');
      const row = original.cloneNode(true);
      original.replaceWith(row);
      row.setAttribute('data-row-index', '30');
      row.addEventListener('click', () => {
        // Model TreeEx retaining the same connected element while assigning it
        // to a different virtual index immediately after the first gesture.
        row.id = 'recycled-folder-row';
        row.setAttribute('data-row-index', '31');
        row.setAttribute('aria-expanded', 'false');
        row.setAttribute('aria-label', folderPath);
        row.querySelector('.bolt-table-cell-content').textContent = '2026-06-01-preview';
      }, { once: true });
      window.__recycledFolderActivated = false;
      const redirectToFolder = () => {
        window.__recycledFolderActivated = true;
        sessionStorage.setItem('fixture-recycled-folder-activated', '1');
        history.pushState({}, '', location.pathname + '?_a=files&path=' + encodeURIComponent(folderPath));
      };
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') redirectToFolder();
      });
      row.addEventListener('dblclick', redirectToFolder);
      window.__recycledTargetPath = targetPath;
    }, { targetPath: fixtures.OTHER_PATH, folderPath: recycledFolder });

    await page.evaluate((path) => { void window.ADORC_probe.openFile(path); }, fixtures.OTHER_PATH);
    await expect.poll(() => new URL(page.url()).searchParams.get('path'), { timeout: 7000 })
      .toBe(fixtures.OTHER_PATH);
    expect(new URL(page.url()).searchParams.get('path')).not.toBe(recycledFolder);
    expect(await page.evaluate(() => sessionStorage.getItem('fixture-recycled-folder-activated'))).toBeNull();
    expect(server.pageLoads).toBe(2);
  });

  test('reinitializes a reused Preview container without stale buttons, badges, headings, or duplicate sidebars', async ({ page }) => {
    const { server } = await setupAdoExtensionPage(page);

    await page.evaluate((path) => window.__ADO_FIXTURE__.openPath(path), fixtures.OTHER_PATH);
    await waitForAdoReady(page, fixtures.OTHER_PATH, userThreadCount(server.threads));
    await expect(page.locator('.markdown-preview-container h1')).toContainText('Other Document');
    await expect(page.locator('.markdown-preview-container .adrc-comment-btn')).toHaveCount(4);
    await expect(page.locator('.adrc-thread-badge')).toHaveCount(1);
    expect((await page.evaluate(() => window.ADORC_probe.sidebar())).outlineCount).toBe(8);

    await page.evaluate((path) => window.__ADO_FIXTURE__.openPath(path), fixtures.DESIGN_PATH);
    await waitForAdoReady(page, fixtures.DESIGN_PATH, userThreadCount(server.threads));
    await expect(page.locator('.markdown-preview-container h1')).toContainText('Design Review');
    await expect(page.locator('.adrc-thread-badge')).toHaveCount(2);
    await expect(page.locator('.adrc-sidebar')).toHaveCount(1);
    await expect(page.locator('.adrc-sidebar-launcher')).toHaveCount(0);

    const outline = await page.evaluate(() => window.ADORC_probe.outline());
    expect(outline.cachedFilePath).toBe(fixtures.DESIGN_PATH);
    expect(outline.headings.map((heading) => heading.text)).toEqual([
      'Design Review', 'Architecture', 'Implementation', 'Ownership'
    ]);
    expect(outline.staleHeadingCount).toBe(0);
  });

  test('rejects a slow prior-file source response after a rapid route switch', async ({ page }) => {
    const { server, logs } = await setupAdoExtensionPage(page, {
      // PR-wide Changes eagerly caches inventory files. Exclude OTHER here so
      // opening it still exercises a genuinely slow line-map fetch.
      prChanges: fixtures.defaultChanges().filter((change) =>
        change.item.path !== fixtures.OTHER_PATH
      ),
    });
    server.sourceDelays[`${SOURCE_COMMIT}:${fixtures.OTHER_PATH}`] = 700;

    await page.evaluate((path) => window.__ADO_FIXTURE__.openPath(path), fixtures.OTHER_PATH);
    await expect.poll(() => server.requests.filter((request) => {
      if (request.method !== 'GET' || !request.pathname.endsWith('/items')) return false;
      const url = new URL(request.url);
      return url.searchParams.get('path') === fixtures.OTHER_PATH &&
        url.searchParams.get('versionDescriptor.version') === SOURCE_COMMIT;
    }).length).toBe(1);

    await page.evaluate((path) => window.__ADO_FIXTURE__.openPath(path), fixtures.DESIGN_PATH);
    await expect.poll(() => server.completedSources.some((entry) =>
      entry.path === fixtures.OTHER_PATH && entry.version === SOURCE_COMMIT
    )).toBe(true);
    await waitForAdoReady(page, fixtures.DESIGN_PATH, userThreadCount(server.threads));

    const state = await page.evaluate(() => ({
      sidebar: window.ADORC_probe.sidebar(),
      outline: window.ADORC_probe.outline(),
      title: document.querySelector('.markdown-preview-container h1')?.textContent,
      buttonCount: document.querySelectorAll('.markdown-preview-container .adrc-comment-btn').length,
    }));
    expect(state.sidebar.currentFile).toBe(fixtures.DESIGN_PATH);
    expect(state.outline.cachedFilePath).toBe(fixtures.DESIGN_PATH);
    expect(state.title).toContain('Design Review');
    expect(state.buttonCount).toBeGreaterThan(4);
    expect(logs.filter((line) => line.includes('Initialized:') && line.includes(fixtures.OTHER_PATH)))
      .toHaveLength(0);
  });
});
