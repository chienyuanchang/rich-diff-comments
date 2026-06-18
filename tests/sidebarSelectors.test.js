'use strict';

// Static-analysis tests for content.js that pin DOM-selector contracts
// the rest of the codebase relies on. These are pure lexical scans of
// the source — no jsdom, no actual extension load — chosen because the
// bugs they catch (silent selector regressions) are exactly the kind
// where a unit test pass is no comfort if nobody runs the extension on
// the right kind of page.
//
// Background — the regression this file pins:
//
//   `.grdc-sidebar-card` is the base CSS class for cards in BOTH the
//   Threads pane (`.grdc-sidebar-list > .grdc-sidebar-card`) and the
//   Changes pane (`.grdc-sidebar-changes-list > .grdc-sidebar-card
//   .grdc-sidebar-card-change`). The thread-navigation functions
//   (`updateSidebarCount`, `sidebarJump`, the `j`/`k` keyboard handler)
//   must scope their queries to the Threads list — otherwise the prev /
//   next buttons silently walk a mixed list and `cards[i].click()` lands
//   on a change card whose handler scrolls to a change instead of a
//   thread. The bug only manifests when the threads list is empty or
//   small (in normal cases the threads come first in DOM order and hide
//   the leak), which makes it easy to ship without noticing — and easy
//   to revert without noticing.
//
//   The 2026-06 fix: every `.grdc-sidebar-card` query in a thread-nav
//   codepath must be prefixed with `.grdc-sidebar-list ` (or the
//   equivalent Changes-pane scope when in a changes-nav codepath).
//
// The mirror image applies to the Changes pane: its queries must scope
// to `.grdc-sidebar-changes-list` so a future contributor doesn't write
// an unscoped query that walks threads instead of changes.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CONTENT_PATH = path.join(__dirname, '..', 'content.js');
const content = fs.readFileSync(CONTENT_PATH, 'utf8');

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

// Find every line index (0-based) whose content matches `regex`. Returns
// `[{lineNumber (1-based), text}]`.
function findLines(regex) {
  const out = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) out.push({ lineNumber: i + 1, text: lines[i] });
  }
  return out;
}

// Build a human-readable failure message listing every offending line.
function describe(offenders) {
  return offenders.map((o) => `  L${o.lineNumber}: ${o.text.trim()}`).join('\n');
}

// ───────────────────────────────────────────────────────────────────────────
// Selector-scoping rules
// ───────────────────────────────────────────────────────────────────────────

test('content.js: no unscoped `.grdc-sidebar-card` selectors', () => {
  // Match `.querySelector(...)` or `.querySelectorAll(...)` where the
  // selector string starts with `.grdc-sidebar-card` (with optional
  // class suffix) but is NOT preceded by an ancestor selector.
  //
  // Acceptable:
  //   '.grdc-sidebar-list .grdc-sidebar-card'             ← threads-scoped
  //   '.grdc-sidebar-changes-list .grdc-sidebar-card'     ← changes-scoped
  //   '.grdc-sidebar-changes-list .grdc-sidebar-card-change'
  //   '.grdc-sidebar-card-active' alone in toggle / class manipulation
  //   '.grdc-sidebar-card-resolved' alone (read on a known thread element)
  //
  // Rejected:
  //   '.grdc-sidebar-card'                                ← unscoped, the bug
  //   '.grdc-sidebar-card-change'                         ← also dangerous if used to count
  //
  // Strategy: scan every `querySelector` / `querySelectorAll` call whose
  // first argument starts with `.grdc-sidebar-card`. Allowlist the lines
  // that include a scoping ancestor (`.grdc-sidebar-list ` or
  // `.grdc-sidebar-changes-list ` before the card class).
  const callRe = /\.querySelector(?:All)?\(\s*['"`]([^'"`]*\.grdc-sidebar-card[^'"`]*)['"`]/g;

  const offenders = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    callRe.lastIndex = 0;
    while ((m = callRe.exec(line)) !== null) {
      const selector = m[1];
      // Skip selectors that are unrelated to the count problem — these
      // target specific state classes that only exist on already-narrowed
      // sets (e.g. checking whether a passed-in element is resolved).
      // Match any selector that LITERALLY starts with `.grdc-sidebar-card`
      // (no scoping ancestor) and uses `.grdc-sidebar-card` as the BASE
      // class. State classes like `.grdc-sidebar-card-resolved` used as
      // standalone selectors are rare and explicitly excluded.
      const isBareBaseCard = /^\.grdc-sidebar-card(\s|$|\.)/.test(selector) &&
                             !/^\.grdc-sidebar-card-(resolved|outdated|active|body|head|user|loc|tags|change-(added|removed|mixed))(\s|$|\.)/.test(selector);
      if (!isBareBaseCard) continue;

      offenders.push({ lineNumber: i + 1, text: line, selector });
    }
  }

  if (offenders.length > 0) {
    const message =
      `Found ${offenders.length} unscoped \`.grdc-sidebar-card\` selector(s) in content.js. ` +
      `This class is used in BOTH the Threads pane (\`.grdc-sidebar-list .grdc-sidebar-card\`) ` +
      `AND the Changes pane (\`.grdc-sidebar-changes-list .grdc-sidebar-card.grdc-sidebar-card-change\`). ` +
      `An unscoped query walks both lists and silently breaks navigation — see the bug note ` +
      `at the top of this test file.\n\n` +
      `Fix: prefix the selector with \`.grdc-sidebar-list \` (threads) or ` +
      `\`.grdc-sidebar-changes-list \` (changes) depending on which pane the caller belongs to.\n\n` +
      `Offending lines:\n${describe(offenders)}`;
    assert.fail(message);
  }
});

test('content.js: thread-nav functions query the threads list explicitly', () => {
  // Positive assertion — the three thread-nav codepaths (counter, mouse
  // jump, keyboard handler) MUST use the scoped selector. If any of them
  // is missing, the static check above passes (no bare selector to fail
  // on) but the function silently does nothing. This test fails loudly.
  //
  // We don't try to parse JS — we just count occurrences of the scoped
  // selector and assert it's at least 3 (one per call site as of 2026-06).
  // If a future refactor consolidates them into a helper, that's fine —
  // the test will fail and you can update the expected count, which forces
  // a re-read of this file and re-considers whether the contract still
  // holds.
  const scopedCount = (content.match(
    /\.querySelectorAll\(['"`]\.grdc-sidebar-list \.grdc-sidebar-card['"`]\)/g
  ) || []).length;

  assert.ok(
    scopedCount >= 3,
    `Expected at least 3 occurrences of \`.querySelectorAll('.grdc-sidebar-list .grdc-sidebar-card')\` ` +
    `(updateSidebarCount + sidebarJump + the j/k keyboard handler in content.js). ` +
    `Found ${scopedCount}. If you intentionally consolidated these into a helper, ` +
    `update this expected count and re-confirm every call site still scopes correctly.`
  );
});

test('content.js: changes-nav functions query the changes list explicitly', () => {
  // Mirror of the test above — same rule, opposite pane. Changes-nav
  // functions (`updateChangesCount`, `changesJump`, and the inner
  // `forEach` that paints `.grdc-sidebar-card-active`) must scope to
  // `.grdc-sidebar-changes-list` so they don't walk threads.
  const scopedCount = (content.match(
    /\.querySelectorAll\(['"`]\.grdc-sidebar-changes-list \.grdc-sidebar-card['"`]\)/g
  ) || []).length;

  assert.ok(
    scopedCount >= 2,
    `Expected at least 2 occurrences of \`.querySelectorAll('.grdc-sidebar-changes-list .grdc-sidebar-card')\` ` +
    `(updateChangesCount + changesJump scroll-into-view in content.js). ` +
    `Found ${scopedCount}. If you intentionally consolidated these into a helper, ` +
    `update this expected count and re-confirm every call site still scopes correctly.`
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Tab order contract — Changes / Threads / Outline (1.5.0+).
//
// The 1.5.0 reorder put Changes first because reviewers reach for "next
// change" before "next comment" when opening a PR. Three things need to
// stay in sync or the UX gets confusing:
//
//   1. The HTML render order of the .grdc-sidebar-tab buttons
//   2. The keyboard mapping (1=Changes, 2=Threads, 3=Outline)
//   3. The default fallback tab when no preference is saved
//
// These tests pin all three so a future refactor doesn't silently break
// one of them. They mirror the rationale of the selector-scoping tests
// above: the bug class is "easy to introduce, hard to notice".
// ───────────────────────────────────────────────────────────────────────────

test('content.js: sidebar tab buttons render in Changes / Threads / Outline order', () => {
  // Look for the three `<button class="grdc-sidebar-tab …" data-grdc-tab="…">`
  // declarations and verify the order is changes → threads → outline.
  // Match the data-grdc-tab attribute since the visible label could
  // theoretically be localised in the future without changing semantics.
  const re = /<button[^>]*class="grdc-sidebar-tab[^"]*"[^>]*data-grdc-tab="(changes|threads|outline)"/g;
  const order = [];
  let m;
  while ((m = re.exec(content)) !== null) order.push(m[1]);

  assert.deepEqual(
    order,
    ['changes', 'threads', 'outline'],
    `Expected sidebar tab buttons to render in Changes / Threads / Outline order ` +
    `(1.5.0 reorder for the reviewer-first flow). Found: [${order.join(', ')}].`
  );
});

test('content.js: 1/2/3 keyboard shortcuts map to Changes / Threads / Outline', () => {
  // Find the inline ternary in the document-level keydown handler that
  // maps e.key to a tab name. The exact form lives in content.js as:
  //   const target = e.key === '1' ? 'changes'
  //     : e.key === '2' ? 'threads'
  //     : 'outline';
  // Tolerate whitespace variation but pin the mapping.
  const mappingRe = /e\.key\s*===\s*['"]1['"]\s*\?\s*['"](\w+)['"]\s*:\s*e\.key\s*===\s*['"]2['"]\s*\?\s*['"](\w+)['"]\s*:\s*['"](\w+)['"]/;
  const m = content.match(mappingRe);
  assert.ok(
    m,
    `Could not find the 1/2/3 → tab mapping in content.js. ` +
    `Expected a ternary like \`e.key === '1' ? 'changes' : e.key === '2' ? 'threads' : 'outline'\`. ` +
    `If you refactored to a different shape, update this regex and confirm the mapping.`
  );
  assert.equal(m[1], 'changes', `Expected key '1' → 'changes' (1.5.0 reorder). Got '${m[1]}'.`);
  assert.equal(m[2], 'threads', `Expected key '2' → 'threads' (1.5.0 reorder). Got '${m[2]}'.`);
  assert.equal(m[3], 'outline', `Expected key '3' (fallthrough) → 'outline' (1.5.0 reorder). Got '${m[3]}'.`);
});

test('content.js: default sidebar tab is `changes` when no preference saved', () => {
  // The default-tab fallback lives where the localStorage read is done:
  //   const savedTab = localStorage.getItem(SIDEBAR_TAB_KEY) || 'changes';
  // We scan for that pattern. If it changes shape, the test fails loudly.
  const defaultRe = /localStorage\.getItem\(\s*SIDEBAR_TAB_KEY\s*\)\s*\|\|\s*['"](\w+)['"]/;
  const m = content.match(defaultRe);
  assert.ok(
    m,
    `Could not find the default-tab fallback in content.js. ` +
    `Expected \`localStorage.getItem(SIDEBAR_TAB_KEY) || '…'\`.`
  );
  assert.equal(
    m[1],
    'changes',
    `Expected default tab to be 'changes' (1.5.0 reorder \u2014 reviewers reach for change-nav first). ` +
    `Got '${m[1]}'. If you intentionally reverted the default, update this test and the matching ` +
    `entry in CHANGELOG.md so the change is recorded.`
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Sanity check on the test itself — if the file no longer exists or has
// shrunk dramatically, every other assertion would silently pass with
// zero offenders. Catch that obvious failure mode.
// ───────────────────────────────────────────────────────────────────────────

test('content.js: file is present and substantial', () => {
  // content.js is ~4000+ lines as of 2026-06. A wildly different size
  // suggests the test is reading the wrong file or the file got
  // corrupted; either way the regex scans above can't be trusted.
  const lines = content.split(/\r?\n/).length;
  assert.ok(
    lines > 1000,
    `content.js has only ${lines} lines — that's a fraction of its expected size. ` +
    `The static-analysis tests in this file scan the file by line; if the file is missing or ` +
    `truncated, every other test in this file becomes a no-op pass. Investigate before suppressing.`
  );
});
