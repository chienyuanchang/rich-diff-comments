// Playwright configuration for the Azure DevOps extension target.
//
// This suite is intentionally separate from the GitHub fixture suite. It
// drives the ADO manifest/scripts against a captured ADO Preview-shaped page
// and a stateful in-process REST mock, so it needs no live organization,
// cookies, PAT, or network access.

const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e-ado',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results/ado',
  use: {
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
