'use strict';

const { test, expect } = require('@playwright/test');
const { setupFixture, gotoPRPage, injectExtension, waitForInit } = require('./_helpers');

// A fake speechSynthesis: records what is spoken and "finishes" each utterance
// on demand, so the test controls the pace.
async function fakeSpeech(page, voices) {
  await page.addInitScript((voices) => {
    window.__spoken = [];
    let current = null;
    const synth = {
      speaking: false,
      pending: false,
      getVoices: () => voices,
      addEventListener() {},
      speak(u) { window.__spoken.push(u.text); current = u; this.speaking = true; },
      cancel() { const u = current; current = null; this.speaking = false; if (u && u.onerror) u.onerror({ error: 'canceled' }); },
    };
    window.__finishUtterance = () => { const u = current; current = null; synth.speaking = false; if (u && u.onend) u.onend({}); };
    window.__failUtterance = (error = 'synthesis-failed') => { const u = current; current = null; synth.speaking = false; if (u && u.onerror) u.onerror({ error }); };
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    window.SpeechSynthesisUtterance = function (text) { this.text = text; };
    window.__voicesUsed = [];
    const speak = synth.speak;
    synth.speak = function (u) { window.__voicesUsed.push(u.voice && u.voice.name); speak.call(this, u); };
  }, voices || [{ name: 'Local', lang: 'en-US', localService: true, default: true }]);
}

async function setup(page, voices, { enabled = true } = {}) {
  await fakeSpeech(page, voices);
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
  await page.evaluate((on) => {
    localStorage.setItem('grdc_sidebar_pos', JSON.stringify({ left: 720, top: 8 }));
    if (on) localStorage.setItem('grdc_listen_enabled', '1');
  }, enabled);
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

test('compact toolbar keeps counters and controls visible with Listening on and off', async ({ page }) => {
  await setup(page, undefined, { enabled: false });

  const expectToolbarFits = async () => {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const layout = await page.evaluate(() => {
      const header = document.querySelector('.grdc-sidebar-header');
      const leftIcon = header.querySelector('.grdc-sidebar-collapse svg').getBoundingClientRect();
      const rightIcon = header.querySelector('.grdc-sidebar-release-notes svg').getBoundingClientRect();
      const bounds = header.getBoundingClientRect();
      const controls = Array.from(header.children)
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width && rect.height)
        .map((rect) => ({ left: rect.left, right: rect.right }));
      const groups = Array.from(header.querySelectorAll('.grdc-sidebar-changes-nav, .grdc-sidebar-nav'))
        .map((group) => Array.from(group.children)
          .map((element) => element.getBoundingClientRect())
          .filter((rect) => rect.width && rect.height)
          .map((rect) => ({ left: rect.left, right: rect.right })));
      const counters = Array.from(header.querySelectorAll('.grdc-sidebar-changes-count, .grdc-sidebar-count'))
        .map((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          const text = range.getBoundingClientRect();
          const box = element.getBoundingClientRect();
          return { height: text.height, textLeft: text.left, textRight: text.right, left: box.left, right: box.right, width: box.width };
        });
      const largeButtons = Array.from(header.querySelectorAll(
        '.grdc-sidebar-render-md, .grdc-sidebar-diff-icon, .grdc-sidebar-prev-change, .grdc-sidebar-next-change, .grdc-sidebar-thread-icon, .grdc-sidebar-listen'
      )).map((button) => button.getBoundingClientRect())
        .filter((rect) => rect.width && rect.height)
        .map((rect) => ({ width: rect.width, height: rect.height }));
      return {
        left: leftIcon.left - bounds.left,
        right: bounds.right - rightIcon.right,
        headerLeft: bounds.left,
        headerRight: bounds.right,
        controls,
        groups,
        counters,
        largeButtons,
      };
    });
    expect(Math.abs(layout.left - layout.right)).toBeLessThanOrEqual(1);
    expect(layout.controls[0].left).toBeGreaterThanOrEqual(layout.headerLeft + 7);
    expect(layout.controls.at(-1).right).toBeLessThanOrEqual(layout.headerRight - 7);
    for (let i = 1; i < layout.controls.length; i++) {
      expect(layout.controls[i].left).toBeGreaterThanOrEqual(layout.controls[i - 1].right);
    }
    for (const group of layout.groups) {
      for (let i = 1; i < group.length; i++) {
        expect(group[i].left).toBeGreaterThanOrEqual(group[i - 1].right);
      }
    }
    for (const counter of layout.counters) {
      expect(counter.width).toBeGreaterThanOrEqual(56);
      expect(counter.height).toBeLessThanOrEqual(16);
      expect(counter.textLeft).toBeGreaterThanOrEqual(counter.left - 0.5);
      expect(counter.textRight).toBeLessThanOrEqual(counter.right + 0.5);
    }
    for (const button of layout.largeButtons) {
      expect(button.width).toBeGreaterThanOrEqual(30);
      expect(button.height).toBeGreaterThanOrEqual(30);
    }
  };

  await expectToolbarFits();
  const settingsGap = await page.evaluate(() => {
    const separator = Array.from(document.querySelectorAll('.grdc-sidebar-header > .grdc-sidebar-separator')).at(-1);
    return document.querySelector('.grdc-sidebar-header-filter').getBoundingClientRect().left -
      separator.getBoundingClientRect().right;
  });
  expect(settingsGap).toBeLessThanOrEqual(5);
  await page.evaluate(() => {
    for (const counter of document.querySelectorAll('.grdc-sidebar-changes-count, .grdc-sidebar-count')) {
      counter.innerHTML = '12/34 <span class="grdc-sidebar-count-total">(123)</span>';
    }
  });
  await expectToolbarFits();
  await page.getByRole('button', { name: /^View options/ }).click();
  await page.getByRole('checkbox', { name: 'Enable Listening', exact: true }).check();
  await page.keyboard.press('Escape');
  await expectToolbarFits();

  await page.locator('.grdc-sidebar-collapse').click();
  await expectToolbarFits();
  await page.getByRole('button', { name: /^View options/ }).click();
  await page.getByRole('checkbox', { name: 'Enable Listening', exact: true }).uncheck();
  await page.keyboard.press('Escape');
  await expectToolbarFits();
});

test('long counters keep the help button visible when a wide sidebar is collapsed', async ({ page }) => {
  await setup(page, undefined, { enabled: false });
  await page.locator('.grdc-sidebar').evaluate((sidebar) => {
    sidebar.style.left = '300px';
    sidebar.style.width = '800px';
    sidebar.style.boxSizing = 'border-box';
  });
  await page.evaluate(() => {
    for (const counter of document.querySelectorAll('.grdc-sidebar-changes-count, .grdc-sidebar-count')) {
      counter.innerHTML = '12/34 <span class="grdc-sidebar-count-total">(123)</span>';
    }
  });
  await expect.poll(() => page.locator('.grdc-sidebar-count').evaluate((counter) => counter.offsetWidth)).toBeGreaterThan(56);

  const rightSpace = () => page.evaluate(() => {
    const header = document.querySelector('.grdc-sidebar-header').getBoundingClientRect();
    const help = document.querySelector('.grdc-sidebar-release-notes').getBoundingClientRect();
    return header.right - help.right;
  });
  await page.locator('.grdc-sidebar-collapse').click();
  await expect.poll(rightSpace).toBeGreaterThanOrEqual(7);
  await page.locator('.grdc-sidebar-collapse').click();
  await page.keyboard.press('t');
  await expect.poll(rightSpace).toBeGreaterThanOrEqual(7);
  await page.keyboard.press('t');
  await page.getByRole('button', { name: /^View options/ }).click();
  await page.getByRole('checkbox', { name: 'Enable Listening', exact: true }).check();
  await page.keyboard.press('Escape');
  await page.locator('.grdc-sidebar-collapse').click();
  await expect.poll(rightSpace).toBeGreaterThanOrEqual(7);
  await page.evaluate(() => {
    for (const counter of document.querySelectorAll('.grdc-sidebar-changes-count, .grdc-sidebar-count')) {
      counter.textContent = '0/0';
    }
  });
  await expect.poll(() => page.locator('.grdc-sidebar').evaluate((sidebar) => parseFloat(sidebar.style.minWidth) || 496))
    .toBeLessThanOrEqual(498);
});

test('resizing height is saved without retaining automatic counter width', async ({ page }) => {
  await setup(page, undefined, { enabled: false });
  const sidebar = page.locator('.grdc-sidebar');
  await sidebar.evaluate((element) => {
    element.style.width = '462px';
    element.style.height = '240px';
  });
  const savedSize = () => page.evaluate(() => JSON.parse(localStorage.getItem('grdc_sidebar_size')));
  await expect.poll(async () => (await savedSize())?.height).toBe(await sidebar.evaluate((element) => element.offsetHeight));
  const originalWidth = (await savedSize()).width;
  await page.evaluate(() => {
    for (const counter of document.querySelectorAll('.grdc-sidebar-changes-count, .grdc-sidebar-count')) {
      counter.innerHTML = '12/34 <span class="grdc-sidebar-count-total">(123)</span>';
    }
  });
  await expect.poll(() => sidebar.evaluate((element) => parseFloat(element.style.minWidth))).toBeGreaterThan(462);
  const before = await sidebar.boundingBox();
  await page.mouse.move(before.x + before.width - 3, before.y + before.height - 3);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width - 3, before.y + before.height + 117, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => sidebar.evaluate((element) => element.offsetHeight)).toBe(before.height + 120);
  await expect.poll(async () => (await savedSize())?.height).toBe(await sidebar.evaluate((element) => element.offsetHeight));
  expect((await savedSize()).width).toBe(originalWidth);

  const savedHeight = (await savedSize()).height;
  await gotoPRPage(page);
  await injectExtension(page);
  await waitForInit(page);
  await expect(sidebar).toHaveCSS('height', `${savedHeight}px`);
});

test('a manual width reduction to the long-counter minimum is saved', async ({ page }) => {
  await setup(page, undefined, { enabled: false });
  const sidebar = page.locator('.grdc-sidebar');
  await sidebar.evaluate((element) => {
    element.style.left = '300px';
    element.style.width = '620px';
    element.style.height = '240px';
  });
  await page.evaluate(() => {
    for (const counter of document.querySelectorAll('.grdc-sidebar-changes-count, .grdc-sidebar-count')) {
      counter.innerHTML = '12/34 <span class="grdc-sidebar-count-total">(123)</span>';
    }
  });
  await expect.poll(() => sidebar.evaluate((element) => parseFloat(element.style.minWidth))).toBeGreaterThan(462);
  const savedWidth = () => page.evaluate(() => JSON.parse(localStorage.getItem('grdc_sidebar_size'))?.width);
  await expect.poll(savedWidth).toBe(await sidebar.evaluate((element) => element.offsetWidth));
  const before = await sidebar.boundingBox();
  await page.mouse.move(before.x + before.width - 3, before.y + before.height - 3);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width - 203, before.y + before.height - 3, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => sidebar.evaluate((element) => element.offsetWidth)).toBeLessThan(before.width - 100);
  await expect.poll(savedWidth).toBe(await sidebar.evaluate((element) => element.offsetWidth));
});

test('resetting the sidebar discards a saved width even when counts need extra space', async ({ page }) => {
  await setup(page, undefined, { enabled: false });
  const sidebar = page.locator('.grdc-sidebar');
  await sidebar.evaluate((element) => { element.style.width = '620px'; });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('grdc_sidebar_size'))?.width)).toBeGreaterThan(600);
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'T', shiftKey: true, bubbles: true }));
    for (const counter of document.querySelectorAll('.grdc-sidebar-changes-count, .grdc-sidebar-count')) {
      counter.innerHTML = '12/34 <span class="grdc-sidebar-count-total">(123)</span>';
    }
    document.querySelector('.grdc-listen-enabled').dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(() => sidebar.evaluate((element) => parseFloat(element.style.minWidth))).toBeGreaterThan(462);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('grdc_sidebar_size'))?.width)).toBeLessThan(500);
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

test('with only network voices, Listen is off so no PR text leaves the browser', async ({ page }) => {
  await setup(page, [{ name: 'Google US English', lang: 'en-US', localService: false, default: true }]);
  const play = page.locator('.grdc-sidebar-listen');
  await expect(play).toBeDisabled();
  await play.click({ force: true });
  await page.waitForTimeout(300);
  expect(await spoken(page)).toEqual([]);
  await page.locator('.grdc-sidebar-header-filter').click();
  await expect(page.locator('.grdc-listen-voice option')).toHaveText(['Default']);

  await page.getByRole('checkbox', { name: 'Allow online voices' }).check();
  await expect(play).toBeEnabled();
  await page.keyboard.press('Escape');
  await play.click();
  await expect.poll(() => page.evaluate(() => window.__voicesUsed.slice())).toEqual(['Google US English']);
});

test('Allow online voices is off by default, explains the privacy trade-off, and offers network voices once on', async ({ page }) => {
  await setup(page, [
    { name: 'Local', lang: 'en-US', localService: true, default: true },
    { name: 'Google UK English Male', lang: 'en-GB', localService: false, default: false },
  ]);
  const menu = page.getByRole('dialog', { name: 'View options', exact: true });
  const online = menu.getByRole('checkbox', { name: 'Allow online voices' });
  await page.getByRole('button', { name: /^View options/ }).click();
  await expect(online).not.toBeChecked();
  await expect(menu.locator('.grdc-listen-online-note')).toContainText('PR text being read may be sent to its provider');
  await expect(online).toHaveAccessibleDescription(/PR text being read may be sent to its provider/);
  await expect(menu.locator('.grdc-listen-voice option')).toHaveText(['Default', 'Local (en-US)']);

  await online.check();
  expect(await page.evaluate(() => localStorage.getItem('grdc_listen_online_voices'))).toBe('1');
  await expect(menu.locator('.grdc-listen-voice option')).toHaveText(['Default', 'Local (en-US)', 'Google UK English Male (en-GB) — online']);
  await menu.locator('.grdc-listen-voice').selectOption('Google UK English Male');
  await page.keyboard.press('Escape');
  await page.locator('.grdc-sidebar-listen').click();
  await expect.poll(() => page.evaluate(() => window.__voicesUsed.slice())).toEqual(['Google UK English Male']);

  // Turning it off stops the online voice and falls back to on-device voices.
  await page.getByRole('button', { name: /^View options/ }).click();
  await online.uncheck();
  await expect(page.locator('.grdc-sidebar-listen')).toHaveAttribute('aria-pressed', 'false');
  await expect(menu.locator('.grdc-listen-voice option')).toHaveText(['Default', 'Local (en-US)']);
  await page.keyboard.press('Escape');
  await page.locator('.grdc-sidebar-listen').click();
  await expect.poll(() => page.evaluate(() => window.__voicesUsed.at(-1))).toBe('Local');
});

test('Listening preferences sync across open PR tabs and disabling online voices stops playback', async ({ page }) => {
  const voices = [
    { name: 'Local', lang: 'en-US', localService: true, default: true },
    { name: 'Google UK English Male', lang: 'en-GB', localService: false, default: false },
  ];
  await setup(page, voices);
  const other = await page.context().newPage();
  await setup(other, voices);

  const openOptions = async (target) => target.getByRole('button', { name: /^View options/ }).click();
  const online = (target) => target.locator('.grdc-listen-online');
  const enabled = (target) => target.locator('.grdc-listen-enabled');

  await openOptions(page);
  await online(page).check();
  await expect(online(other)).toBeChecked();
  await expect(other.locator('.grdc-listen-voice option')).toHaveText([
    'Default',
    'Local (en-US)',
    'Google UK English Male (en-GB) — online',
  ]);
  await page.locator('.grdc-listen-voice').selectOption('Google UK English Male');
  await page.locator('.grdc-listen-rate').selectOption('1.5');
  await expect(other.locator('.grdc-listen-voice')).toHaveValue('Google UK English Male');
  await expect(other.locator('.grdc-listen-rate')).toHaveValue('1.5');
  await page.keyboard.press('Escape');

  await page.locator('.grdc-sidebar-listen').click();
  await expect.poll(() => page.evaluate(() => window.__voicesUsed.at(-1))).toBe('Google UK English Male');
  await openOptions(other);
  await online(other).uncheck();
  await expect(page.locator('.grdc-sidebar-listen')).toHaveAttribute('aria-pressed', 'false');
  await expect(online(page)).not.toBeChecked();
  await expect(page.locator('.grdc-listen-voice option')).toHaveText(['Default', 'Local (en-US)']);

  await page.locator('.grdc-sidebar-listen').click();
  await expect.poll(() => page.evaluate(() => window.__voicesUsed.at(-1))).toBe('Local');
  await enabled(other).uncheck();
  await expect(page.locator('.grdc-sidebar-listen')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.speechSynthesis.speaking)).toBe(false);
  await openOptions(page);
  await enabled(page).check();
  await expect(enabled(other)).toBeChecked();
  await expect(other.locator('.grdc-sidebar-listen')).toBeVisible();
});

test('a speech error stops reading instead of silently skipping the sentence', async ({ page }) => {
  await setup(page);
  const play = page.locator('.grdc-sidebar-listen');
  const alert = page.locator('.grdc-listen-status');
  await play.click();
  await expect.poll(() => spoken(page)).toEqual(['Kept new words ending.']);
  await page.evaluate(() => window.__failUtterance());
  await expect(play).toHaveAttribute('aria-pressed', 'false');
  await expect(play).toHaveAttribute('title', /Listening stopped/);
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('Listening stopped');
  await page.waitForTimeout(600);
  expect(await spoken(page)).toEqual(['Kept new words ending.']);

  await play.click();
  await expect(alert).toBeHidden();
  await page.evaluate(() => window.__failUtterance('interrupted'));
  await expect(play).toHaveAttribute('aria-pressed', 'false');
  await expect(alert).toContainText('interrupted');
});

test('← right after a change finishes replays its last sentence', async ({ page }) => {
  await setup(page);
  await page.locator('.grdc-sidebar-listen').click();
  await expect.poll(() => spoken(page)).toEqual(['Kept new words ending.']);
  await finish(page);
  await expect.poll(() => spoken(page).then((s) => s.length)).toBe(2);
  await finish(page); // last sentence done; the next change starts after a short pause
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => spoken(page).then((s) => s.at(-1))).toBe('Removed: old words.');
  await expect(page.locator('#mixed')).toHaveClass(/grdc-listen-active/);
});

test('scrolling the page while listening stops the reading from pulling it back', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.style.height = '4000px';
    document.body.append(spacer);
    window.scrollTo(0, 0);
  });
  await page.locator('.grdc-sidebar-listen').click();
  await expect.poll(() => spoken(page)).toEqual(['Kept new words ending.']);
  await page.waitForTimeout(400);

  await page.mouse.move(100, 400);
  await page.mouse.wheel(0, 3000);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1500);
  const browsing = await page.evaluate(() => window.scrollY);

  await finish(page);
  await finish(page); // moves on to the next change by itself
  await expect(page.locator('#old-block')).toHaveClass(/grdc-listen-active/);
  await page.waitForTimeout(800);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - browsing)).toBeLessThan(5);

  // Clicking the currently active change resumes following, too.
  await page.locator('.grdc-sidebar-changes-list .grdc-sidebar-card').nth(1).click();
  await expect(page.locator('#old-block')).toHaveClass(/grdc-listen-active/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(browsing - 500);
});

test('sentence navigation brings the current change back after manual scrolling', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.style.height = '4000px';
    document.body.append(spacer);
  });
  await page.locator('.grdc-sidebar-listen').click();
  await expect.poll(() => spoken(page)).toEqual(['Kept new words ending.']);
  await page.waitForTimeout(400);
  await page.mouse.move(100, 400);
  await page.mouse.wheel(0, 3000);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1500);
  const browsing = await page.evaluate(() => window.scrollY);

  await page.keyboard.press('ArrowRight');
  await expect.poll(() => spoken(page).then((s) => s.at(-1))).toBe('Removed: old words.');
  await expect(page.locator('#mixed')).toHaveClass(/grdc-listen-active/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(browsing - 500);
});

test('Listening is off by default; Enable Listening shows the play button, speed and voice', async ({ page }) => {
  await setup(page, undefined, { enabled: false });
  const play = page.locator('.grdc-sidebar-listen');
  const menu = page.getByRole('dialog', { name: 'View options', exact: true });
  const enable = menu.getByRole('checkbox', { name: 'Enable Listening' });
  const restore = menu.getByRole('button', { name: 'Restore defaults' });
  await expect(play).toBeHidden();
  await expect(page.locator('.grdc-sidebar')).toHaveCSS('min-width', '462px');

  await page.getByRole('button', { name: /^View options/ }).click();
  await expect(menu.getByRole('group', { name: 'Listening' })).toBeVisible();
  await expect(enable).not.toBeChecked();
  await expect(menu.locator('.grdc-listen-rate')).toBeHidden();
  await expect(menu.locator('.grdc-listen-voice')).toBeHidden();
  await expect(restore).toBeDisabled();

  await enable.check();
  await expect(menu.locator('.grdc-listen-rate')).toBeVisible();
  await expect(menu.locator('.grdc-listen-voice')).toBeVisible();
  await expect(restore).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('grdc_listen_enabled'))).toBe('1');
  await page.keyboard.press('Escape');
  await expect(play).toBeVisible();
  await expect(page.locator('.grdc-sidebar')).toHaveCSS('min-width', '496px');

  // Turning it off stops speech in progress; Restore defaults turns it off too.
  await play.click();
  expect((await spoken(page)).length).toBe(1);
  await page.getByRole('button', { name: /^View options/ }).click();
  await enable.uncheck();
  await expect(play).toBeHidden();
  expect(await page.evaluate(() => window.speechSynthesis.speaking)).toBe(false);
  await enable.check();
  await menu.getByRole('checkbox', { name: 'Allow online voices' }).check();
  await restore.click();
  await expect(enable).not.toBeChecked();
  await expect(menu.locator('.grdc-listen-online')).not.toBeChecked();
  await expect(menu.locator('.grdc-listen-rate')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('grdc_listen_enabled'))).toBe('0');
  expect(await page.evaluate(() => localStorage.getItem('grdc_listen_online_voices'))).toBe('0');
});
