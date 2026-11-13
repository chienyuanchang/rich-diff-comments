'use strict';

const { test, expect } = require('@playwright/test');
const { setupFixture, gotoPRPage, injectExtension, waitForInit } = require('./_helpers');

// A fake speechSynthesis: records what is spoken and "finishes" each utterance
// on demand, so the test controls the pace.
async function fakeSpeech(page) {
  await page.addInitScript(() => {
    window.__spoken = [];
    let current = null;
    const synth = {
      speaking: false,
      pending: false,
      getVoices: () => [],
      addEventListener() {},
      speak(u) { window.__spoken.push(u.text); current = u; this.speaking = true; },
      cancel() { const u = current; current = null; this.speaking = false; if (u && u.onerror) u.onerror({ error: 'canceled' }); },
    };
    window.__finishUtterance = () => { const u = current; current = null; synth.speaking = false; if (u && u.onend) u.onend({}); };
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    window.SpeechSynthesisUtterance = function (text) { this.text = text; };
  });
}

async function setup(page) {
  await fakeSpeech(page);
  await setupFixture(page, 'removed-content', {
    rawSource: { 'docs/visibility.md': '# Visibility example\n\nKept new words ending.\n', 'docs/deleted.md': '' },
    routeData: {
      headOid: 'a'.repeat(40),
      comparison: { headOid: 'a'.repeat(40), baseOid: 'b'.repeat(40) },
      diffSummaries: [
        { path: 'docs/visibility.md', pathDigest: 'visibility', changeType: 'MODIFIED', markersMap: {} },
        { path: 'docs/deleted.md', pathDigest: 'deleted', changeType: 'REMOVED', markersMap: {} },
      ],
      markers: { threads: {} },
    },
  });
  await gotoPRPage(page);
  await page.evaluate(() => localStorage.setItem('grdc_sidebar_pos', JSON.stringify({ left: 720, top: 8 })));
  await injectExtension(page);
  await waitForInit(page);
  await expect(page.locator('.grdc-sidebar-changes-count')).not.toHaveText('0/0');
}

const spoken = (page) => page.evaluate(() => window.__spoken.slice());
const finish = (page) => page.evaluate(() => window.__finishUtterance());

test('Play reads each change aloud and moves on; ‹ › jump while listening; Play again stops', async ({ page }) => {
  await setup(page);
  const play = page.locator('.grdc-sidebar-listen');
  await expect(play).toBeVisible();
  await expect(play).toHaveAttribute('aria-pressed', 'false');

  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => spoken(page)).toEqual(['Kept new words ending.']);
  await expect(page.locator('#mixed')).toHaveClass(/grdc-listen-active/);
  await expect(page.locator('.grdc-sidebar-changes-count')).toContainText('1/');

  // Show removed content is on by default, so the deleted words follow.
  await finish(page);
  await expect.poll(() => spoken(page)).toEqual(['Kept new words ending.', 'Removed: old words.']);

  // After the last sentence it moves to the next change by itself.
  await finish(page);
  await expect.poll(() => (spoken(page)).then((s) => s[2])).toBe('Removed block starting with Deleted paragraph.');
  await expect(page.locator('#old-block')).toHaveClass(/grdc-listen-active/);
  await expect(page.locator('#mixed')).not.toHaveClass(/grdc-listen-active/);

  // › skips to the following change and reads it.
  await page.locator('.grdc-sidebar-next-change').click();
  await expect.poll(() => (spoken(page)).then((s) => s.length)).toBe(4);
  await expect(page.locator('.grdc-sidebar-changes-count')).toContainText('3/');

  // Play again stops: nothing more is spoken and the highlight goes away.
  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.grdc-listen-active')).toHaveCount(0);
  const before = (await spoken(page)).length;
  await finish(page);
  await page.waitForTimeout(600);
  expect((await spoken(page)).length).toBe(before);
});

test('← / → step by sentence while listening, and the spoken sentence is highlighted', async ({ page }) => {
  await setup(page);
  const highlighted = () => page.evaluate(() => {
    const h = CSS.highlights.get('grdc-listen-sentence');
    return h ? [...h][0].toString() : null;
  });
  await page.locator('.grdc-sidebar-listen').click();
  await expect.poll(() => spoken(page)).toEqual(['Kept new words ending.']);
  await expect.poll(highlighted).toMatch(/^Kept .*new words ending\.$/);

  await page.keyboard.press('ArrowRight'); // second sentence of the same change
  await expect.poll(() => spoken(page).then((s) => s.at(-1))).toBe('Removed: old words.');
  await expect.poll(highlighted).toBe(null); // not on screen as visible text
  await page.keyboard.press('ArrowRight'); // into the next change
  await expect.poll(() => spoken(page).then((s) => s.at(-1))).toBe('Removed block starting with Deleted paragraph.');
  await expect(page.locator('#old-block')).toHaveClass(/grdc-listen-active/);
  await page.keyboard.press('ArrowLeft'); // back to the previous change's last sentence
  await expect.poll(() => spoken(page).then((s) => s.at(-1))).toBe('Removed: old words.');
  await expect(page.locator('#mixed')).toHaveClass(/grdc-listen-active/);

  // Not listening: arrows are left to the page.
  await page.locator('.grdc-sidebar-listen').click();
  const before = (await spoken(page)).length;
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  expect((await spoken(page)).length).toBe(before);
  expect(await highlighted()).toBe(null);
});

test('navigating to a change lands it below sticky headers taller than 120px', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const bar = document.createElement('div');
    bar.style.cssText = 'position:sticky;top:0;height:110px;background:#eee;z-index:5';
    document.body.prepend(bar);
    const fileHeader = document.createElement('div');
    fileHeader.style.cssText = 'position:sticky;top:110px;height:60px;background:#ddd;z-index:5';
    const diff = document.getElementById('diff-visibility');
    diff.prepend(fileHeader);
    const spacer = document.createElement('div');
    spacer.style.height = '3000px';
    document.body.append(spacer);
    window.scrollTo(0, 0);
  });
  for (let i = 0; i < 3; i++) await page.locator('.grdc-sidebar-next-change').click();
  await page.waitForTimeout(800);
  const active = await page.evaluate(() => {
    const blocks = document.querySelector('.grdc-sidebar')._grdcChangeBlocks;
    const idx = Number(document.querySelector('.grdc-sidebar-changes-count').textContent.split('/')[0]) - 1;
    return blocks[idx].getBoundingClientRect().top;
  });
  expect(active).toBeGreaterThanOrEqual(170);
});

test('with Show removed content off, edits are read without the deleted words', async ({ page }) => {
  await setup(page);
  await page.locator('.grdc-sidebar-header-filter').click();
  await page.locator('.grdc-show-removed').uncheck();
  await page.keyboard.press('Escape');
  await page.locator('.grdc-sidebar-listen').click();
  await expect.poll(() => spoken(page)).toEqual(['Kept new words ending.']);
  await finish(page);
  await expect.poll(() => (spoken(page)).then((s) => s[1])).not.toBe('Removed: old words.');
});
