/**
 * Shared test helpers for the Playwright e2e suite.
 *
 * Strategy: the extension's content script only initializes when
 * `window.location.pathname` matches `/<owner>/<repo>/pull/<num>/<files|changes>`.
 * `page.setContent()` doesn't change the URL, so we'd have to monkey-patch
 * `window.location` (fragile). Instead we use Playwright's `page.route()` to
 * intercept requests to a fake GitHub PR URL and return our static fixture
 * HTML — then `parsePRUrl()` matches and `init()` runs normally.
 *
 * Each test:
 *   1. Calls `setupFixture(page, fixtureName, { rawSource })` — registers
 *      route handlers for the fake GitHub PR URL (returns the fixture)
 *      and the blob URL (returns `rawSource` wrapped in the textarea shape
 *      `fetchRawSource()` expects).
 *   2. Calls `gotoPRPage(page)` — navigates to the fake URL.
 *   3. Calls `injectExtension(page)` — loads every `src/lib/*.js` + `content.js`
 *      in manifest order; the IIFE wrappers attach helpers to `window.GRDC`
 *      and `content.js` runs its `maybeInit()` immediately.
 *   4. Calls `waitForInit(page)` — waits for the `[GRDC] Initialized:` log line.
 *
 * We don't load the extension as a real Chrome extension here — that
 * would require persistent context + extension path setup which adds
 * meaningful complexity for no test-value gain. The init code path we
 * exercise is identical either way.
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const MANIFEST = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'manifest.json'), 'utf8')
);
const CONTENT_SCRIPTS = MANIFEST.content_scripts[0].js; // in manifest order

// A fake-but-syntactically-valid PR URL. The extension parses `owner`,
// `repo`, `pullNumber` from the pathname; the values themselves don't
// matter because all network access is stubbed.
const FAKE_PR_URL = 'https://github.com/test-owner/test-repo/pull/1/files';
const FAKE_HEAD_OID = 'a'.repeat(40);

/**
 * Register route handlers and serve the fixture HTML at the fake PR URL.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} fixtureName  Name under `tests/e2e/fixtures/` (no `.html`).
 * @param {object} [opts]
 * @param {Record<string, string>} [opts.rawSource]  Map of file path → raw
 *     markdown source. Each entry stubs the blob URL `fetchRawSource()`
 *     would request for that path.
 */
async function setupFixture(page, fixtureName, opts) {
  opts = opts || {};
  const fixtureFile = path.join(__dirname, 'fixtures', `${fixtureName}.html`);
  if (!fs.existsSync(fixtureFile)) {
    throw new Error(`Fixture not found: ${fixtureFile}`);
  }
  const fixtureHtml = fs.readFileSync(fixtureFile, 'utf8');
  const rawSourceMap = opts.rawSource || {};

  // Playwright route handlers run in REVERSE registration order (newest
  // wins). So we register the broad fallback FIRST and the specific
  // overrides AFTER, otherwise the fallback would 404 every request.

  // Fallback: any github.com URL we didn't stub returns 404 (fails the
  // test loud instead of timing out).
  await page.route('https://github.com/**', function (route) {
    return route.fulfill({
      status: 404,
      body: 'No stub for ' + route.request().url(),
    });
  });

  // Serve raw markdown sources at the blob URLs the extension fetches.
  const blobRouteGlob = 'https://github.com/test-owner/test-repo/blob/' + FAKE_HEAD_OID + '/**';
  await page.route(blobRouteGlob, function (route) {
    const url = route.request().url();
    const m = url.match(/\/blob\/[0-9a-f]{40}\/(.+?)(?:\?.*)?$/);
    const filePath = m ? decodeURIComponent(m[1]) : '';
    const raw = rawSourceMap[filePath];
    if (raw === undefined) {
      return route.fulfill({ status: 404, body: 'No stub for ' + filePath });
    }
    const escaped = raw
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const html =
      '<!doctype html><html><body><textarea id="read-only-cursor-text-area">' +
      escaped +
      '</textarea></body></html>';
    return route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: html,
    });
  });

  // Serve the fixture at the fake PR URL (registered LAST so it wins
  // over the fallback).
  await page.route(FAKE_PR_URL, function (route) {
    return route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: fixtureHtml,
    });
  });
}

/**
 * Navigate to the fake PR URL (which `setupFixture()` registered).
 */
async function gotoPRPage(page) {
  await page.goto(FAKE_PR_URL, { waitUntil: 'domcontentloaded' });
  // styles.css would normally be loaded by the extension via manifest;
  // in our test setup we inject it explicitly so CSS-driven layout
  // (button position, hover visibility) is measurable.
  await page.addStyleTag({ path: path.join(REPO_ROOT, 'styles.css') });
  // Move the sidebar off the fixture's content strip before init. Since
  // 1.7.0 the sidebar's default position is top-centre (top:16px,
  // left:50%, translateX(-50%)) which — on real github.com — sits above
  // a tall page header that pushes the diff content below it. Our
  // stripped fixtures have no such header, so the sidebar directly
  // overlaps `<h1>` / `<h2>` / `<li>` and intercepts pointer events for
  // `.hover()` tests. Pinning it to the top-right corner via
  // `grdc_sidebar_pos` before init makes `applySidebarPersistedPos()`
  // restore to that position instead of the top-centre default. Chosen
  // to sit within Playwright's default 1280×720 viewport so the sidebar
  // is still visible and interactive (needed by keyboard-shortcut tests
  // that toggle its state) but out of the way of typical fixture
  // content at x=0..~600.
  await page.evaluate(() => {
    localStorage.setItem('grdc_sidebar_pos', JSON.stringify({ left: 840, top: 8 }));
  });
}

/**
 * Inject the extension's content scripts into the current page in manifest
 * order. They install onto `window.GRDC` via the IIFE wrapper pattern;
 * `content.js` then runs its `maybeInit()` immediately.
 */
async function injectExtension(page) {
  for (const scriptPath of CONTENT_SCRIPTS) {
    await page.addScriptTag({ path: path.join(REPO_ROOT, scriptPath) });
  }
}

/**
 * Wait for the extension to finish its init pass on the current page.
 * Identified by the `[GRDC] Initialized: N commentable elements found`
 * console message that `content.js` always emits at end of init.
 */
async function waitForInit(page, opts) {
  opts = opts || {};
  const timeout = opts.timeout || 5000;
  await page.waitForEvent('console', {
    predicate: function (msg) { return /^\[GRDC\] Initialized:/.test(msg.text()); },
    timeout: timeout,
  });
}

/**
 * Full setup in one call. Most tests use this. Returns nothing — the
 * page is ready to query for `.grdc-comment-btn`, `.grdc-sidebar`, etc.
 */
async function setupExtensionPage(page, fixtureName, opts) {
  await setupFixture(page, fixtureName, opts);
  await gotoPRPage(page);
  await injectExtension(page);
  await waitForInit(page);
}

module.exports = {
  REPO_ROOT: REPO_ROOT,
  CONTENT_SCRIPTS: CONTENT_SCRIPTS,
  FAKE_PR_URL: FAKE_PR_URL,
  FAKE_HEAD_OID: FAKE_HEAD_OID,
  setupFixture: setupFixture,
  gotoPRPage: gotoPRPage,
  injectExtension: injectExtension,
  waitForInit: waitForInit,
  setupExtensionPage: setupExtensionPage,
};
