'use strict';

const { test, expect } = require('@playwright/test');
const { setupAdoExtensionPage } = require('./_helpers');

async function computed(locator, property) {
  return locator.evaluate((element, name) => getComputedStyle(element)[name], property);
}

async function setAdoThemeTokens(page, tokens) {
  await page.evaluate((values) => {
    const root = document.documentElement;
    Object.entries(values).forEach(([name, value]) => root.style.setProperty(name, value));
  }, tokens);
}

const DARK_TOKENS = {
  '--background-color': 'rgb(30, 30, 30)',
  '--text-primary-color': 'rgb(245, 245, 245)',
  '--text-secondary-color': 'rgb(190, 190, 190)',
  '--border-subtle-color': 'rgb(90, 90, 90)',
  '--focus-border-color': 'rgb(120, 180, 255)',
  '--communication-background': 'rgb(70, 145, 230)',
  '--text-on-communication-background': 'rgb(255, 255, 255)',
  '--status-error-text': 'rgb(255, 155, 155)',
  '--status-error-background': 'rgb(80, 35, 35)',
  '--status-success-text': 'rgb(140, 210, 140)',
  '--status-warning-text': 'rgb(255, 190, 90)',
  '--status-warning-background': 'rgb(75, 60, 25)',
  '--status-info-foreground': 'rgb(195, 166, 255)',
  '--panel-shadow-color': 'rgba(0, 0, 0, 0.55)',
  '--panel-shadow-secondary-color': 'rgba(0, 0, 0, 0.3)',
  '--palette-neutral-2': '42, 42, 42',
  '--palette-primary-60': '70, 145, 230',
  '--palette-primary-darkened-6': '90, 160, 240',
  '--palette-black-alpha-4': 'rgba(255, 255, 255, 0.08)',
  '--palette-black-alpha-6': 'rgba(255, 255, 255, 0.10)',
};

const LIGHT_TOKENS = {
  '--background-color': 'rgb(255, 255, 255)',
  '--text-primary-color': 'rgb(32, 31, 30)',
  '--text-secondary-color': 'rgb(96, 94, 92)',
  '--border-subtle-color': 'rgb(209, 209, 209)',
  '--focus-border-color': 'rgb(0, 120, 212)',
  '--communication-background': 'rgb(0, 120, 212)',
  '--text-on-communication-background': 'rgb(255, 255, 255)',
  '--status-error-text': 'rgb(218, 10, 0)',
  '--status-error-background': 'rgb(253, 236, 234)',
  '--status-success-text': 'rgb(16, 124, 16)',
  '--status-warning-text': 'rgb(202, 80, 16)',
  '--status-warning-background': 'rgb(255, 244, 206)',
  '--status-info-foreground': 'rgb(0, 120, 212)',
  '--panel-shadow-color': 'rgba(0, 0, 0, 0.18)',
  '--panel-shadow-secondary-color': 'rgba(0, 0, 0, 0.08)',
  '--palette-neutral-2': '250, 249, 248',
  '--palette-primary-60': '0, 120, 212',
  '--palette-primary-darkened-6': '16, 110, 190',
  '--palette-black-alpha-4': 'rgba(0, 0, 0, 0.04)',
  '--palette-black-alpha-6': 'rgba(0, 0, 0, 0.06)',
};

test.describe('ADO theme integration', () => {
  test('uses dark browser fallbacks when host theme tokens are unavailable', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await setupAdoExtensionPage(page);

    const sidebar = page.locator('.adrc-sidebar');
    await expect(sidebar).toBeVisible();
    expect(await computed(sidebar, 'backgroundColor')).toBe('rgb(32, 31, 30)');
    expect(await computed(sidebar, 'color')).toBe('rgb(243, 242, 241)');
    expect(await computed(sidebar, 'borderColor')).toBe('rgb(96, 94, 92)');
    expect(await computed(page.locator('.adrc-sidebar-header'), 'backgroundColor')).toBe('rgb(43, 42, 41)');
    expect(await computed(page.locator('.adrc-thread-panel').first(), 'backgroundColor')).toBe('rgb(43, 42, 41)');
  });

  test('follows live ADO semantic-token changes without remounting or losing a draft', async ({ page }) => {
    await setupAdoExtensionPage(page);
    const sidebar = page.locator('.adrc-sidebar');
    const h1 = page.locator('.markdown-preview-container h1', { hasText: 'Design Review' });
    await h1.hover();
    await h1.locator('.adrc-comment-btn').dispatchEvent('click');
    const editor = page.locator('.adrc-compose-editor');
    const textarea = editor.locator('textarea');
    await textarea.fill('Draft survives an in-place ADO theme switch.');
    await page.evaluate(() => {
      window.__themeSidebar = document.querySelector('.adrc-sidebar');
      window.__themeButtonCount = document.querySelectorAll('.adrc-comment-btn').length;
    });

    await setAdoThemeTokens(page, DARK_TOKENS);
    await expect.poll(() => computed(sidebar, 'backgroundColor')).toBe('rgb(30, 30, 30)');
    expect(await computed(sidebar, 'color')).toBe('rgb(245, 245, 245)');
    expect(await computed(sidebar, 'borderColor')).toBe('rgb(90, 90, 90)');
    expect(await computed(page.locator('.adrc-sidebar-tab-active'), 'color')).toBe('rgb(70, 145, 230)');
    expect(await computed(editor, 'backgroundColor')).toBe('rgb(42, 42, 42)');
    await expect(textarea).toHaveValue('Draft survives an in-place ADO theme switch.');

    await setAdoThemeTokens(page, LIGHT_TOKENS);
    await expect.poll(() => computed(sidebar, 'backgroundColor')).toBe('rgb(255, 255, 255)');
    expect(await computed(sidebar, 'color')).toBe('rgb(32, 31, 30)');
    expect(await computed(editor, 'backgroundColor')).toBe('rgb(250, 249, 248)');
    await expect(textarea).toHaveValue('Draft survives an in-place ADO theme switch.');
    expect(await page.evaluate(() =>
      window.__themeSidebar === document.querySelector('.adrc-sidebar') &&
      window.__themeButtonCount === document.querySelectorAll('.adrc-comment-btn').length
    )).toBe(true);
  });

  test('uses system colors and visible focus in forced-colors mode', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark', forcedColors: 'active' });
    await setupAdoExtensionPage(page);

    expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);
    const sidebar = page.locator('.adrc-sidebar');
    const commentButton = page.locator('.adrc-comment-btn').first();
    const activeChange = page.locator('.adrc-sidebar-change-active');
    expect(await computed(sidebar, 'forcedColorAdjust')).toBe('none');
    expect(await computed(commentButton, 'forcedColorAdjust')).toBe('none');
    expect(await computed(activeChange, 'backgroundColor')).not.toBe('rgba(0, 0, 0, 0)');
    expect(await computed(activeChange, 'color')).not.toBe(await computed(activeChange, 'backgroundColor'));

    const tab = page.locator('.adrc-sidebar-tab-active');
    await tab.focus();
    expect(await computed(tab, 'outlineStyle')).toBe('solid');
    expect(parseFloat(await computed(tab, 'outlineWidth'))).toBeGreaterThanOrEqual(2);
  });
});
