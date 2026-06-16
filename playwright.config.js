// Playwright config for the Markdown PR Comments for GitHub extension.
//
// Why we have this: jsdom-based unit tests can't catch a whole class of bugs
// that only manifest in a real browser — CSS layout (does the + button
// actually sit inside its host's bounding box?), real :hover semantics
// (does hover reveal the +?), real keyboard event dispatch (does pressing
// 1/2/3 switch sidebar tabs?), real drag-and-drop, real MutationObserver
// timing. Playwright drives a real headless Chromium against captured
// rich-diff HTML fixtures — no live github.com required.
//
// Test suite layout:
//   tests/e2e/*.spec.js     ← Playwright tests (this file's testDir)
//   tests/e2e/fixtures/     ← static .html snapshots of rich-diff DOM
//   tests/e2e/_helpers.js   ← shared setup: serves fixtures, injects content.js
//   tests/*.test.js         ← fast Node:test suite (unchanged)
//
// Run with:
//   npm run test:e2e        ← these tests only
//   npm run test:all        ← npm test (fast) + npm run test:e2e (slow)
//
// CI is unchanged for now: preflight still runs `npm test` (the fast
// suite). Promote a subset to CI later if we hit a regression that only
// e2e tests catch.

const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  // Each spec file is independent and fast (~1s); serial run keeps logs
  // readable. Bump to parallel when total wall-clock matters.
  fullyParallel: false,
  workers: 1,
  // Fail fast in local dev so we see the first failure immediately.
  retries: 0,
  reporter: [['list']],
  use: {
    headless: true,
    // Always trace + screenshot on failure so post-mortem debugging
    // doesn't need a re-run.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
