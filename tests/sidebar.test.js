'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSnippet,
  clampDragPos,
  nextWrappingIndex,
  clampSize,
  isMarkdownPath,
  formatLineRange,
  filterSidebarThreadItems,
  sortSidebarThreadItems,
  buildScopedCounterState,
} = require('../src/lib/sidebar.js');

// ───────────────────────────────────────────────────────────────────────────
// buildSnippet
// ───────────────────────────────────────────────────────────────────────────

test('buildSnippet — collapses whitespace and trims', () => {
  assert.equal(buildSnippet('  hello   world\n\nfoo  '), 'hello world foo');
});

test('buildSnippet — truncates to maxLen and appends ellipsis', () => {
  assert.equal(buildSnippet('abcdefghij', 5), 'abcde\u2026');
});

test('buildSnippet — does NOT append ellipsis when no truncation happened', () => {
  assert.equal(buildSnippet('short', 80), 'short');
});

test('buildSnippet — default maxLen is 80 (plus 1 char for ellipsis when truncated)', () => {
  const long = 'a'.repeat(200);
  // 80 chars + the trailing ellipsis character
  assert.equal(buildSnippet(long).length, 81);
  assert.ok(buildSnippet(long).endsWith('\u2026'));
});

test('buildSnippet — null / undefined return empty string', () => {
  assert.equal(buildSnippet(null), '');
  assert.equal(buildSnippet(undefined), '');
});

test('buildSnippet — non-string input is coerced', () => {
  assert.equal(buildSnippet(42), '42');
});

test('buildSnippet — invalid maxLen falls back to default', () => {
  const long = 'x'.repeat(120);
  assert.equal(buildSnippet(long, 0).length, 81);
  assert.equal(buildSnippet(long, -1).length, 81);
  assert.equal(buildSnippet(long, NaN).length, 81);
});

// ───────────────────────────────────────────────────────────────────────────
// clampDragPos
// ───────────────────────────────────────────────────────────────────────────

const VIEWPORT = { width: 1000, height: 800 };
const RECT = { left: 200, top: 100, width: 320 };

test('clampDragPos — happy path: returns rect.left + dx, rect.top + dy', () => {
  const r = clampDragPos(RECT, { dx: 50, dy: 30 }, VIEWPORT);
  assert.deepEqual(r, { left: 250, top: 130 });
});

test('clampDragPos — clamps to right edge minus margin', () => {
  // Try to drag to left=1500 → should clamp to viewport.width - margin = 920
  const r = clampDragPos(RECT, { dx: 1300, dy: 0 }, VIEWPORT, 80);
  assert.equal(r.left, 920);
});

test('clampDragPos — clamps to left edge: minLeft = margin - width', () => {
  // Width 320, margin 80 → minLeft = -240. Try to drag way left.
  const r = clampDragPos(RECT, { dx: -1000, dy: 0 }, VIEWPORT, 80);
  assert.equal(r.left, -240);
});

test('clampDragPos — clamps top to 0', () => {
  const r = clampDragPos(RECT, { dx: 0, dy: -500 }, VIEWPORT);
  assert.equal(r.top, 0);
});

test('clampDragPos — clamps bottom to viewport.height - 40', () => {
  const r = clampDragPos(RECT, { dx: 0, dy: 2000 }, VIEWPORT);
  assert.equal(r.top, 760); // 800 - 40
});

test('clampDragPos — defensive against missing input', () => {
  const r = clampDragPos(null, null, null, null);
  assert.equal(typeof r.left, 'number');
  assert.equal(typeof r.top, 'number');
});

test('clampDragPos — uses default margin of 80 when omitted', () => {
  const r = clampDragPos(RECT, { dx: 0, dy: 0 }, VIEWPORT);
  // No movement → returns starting position unchanged.
  assert.deepEqual(r, { left: 200, top: 100 });
});

// ───────────────────────────────────────────────────────────────────────────
// nextWrappingIndex
// ───────────────────────────────────────────────────────────────────────────

test('nextWrappingIndex — forward step', () => {
  assert.equal(nextWrappingIndex(0, 1, 5), 1);
  assert.equal(nextWrappingIndex(3, 1, 5), 4);
});

test('nextWrappingIndex — wraps forward past end', () => {
  assert.equal(nextWrappingIndex(4, 1, 5), 0);
});

test('nextWrappingIndex — backward step', () => {
  assert.equal(nextWrappingIndex(2, -1, 5), 1);
});

test('nextWrappingIndex — wraps backward past start', () => {
  assert.equal(nextWrappingIndex(0, -1, 5), 4);
});

test('nextWrappingIndex — delta larger than total reduces mod total', () => {
  assert.equal(nextWrappingIndex(0, 7, 5), 2);
  assert.equal(nextWrappingIndex(0, -7, 5), 3);
});

test('nextWrappingIndex — empty / invalid total returns 0', () => {
  assert.equal(nextWrappingIndex(3, 1, 0), 0);
  assert.equal(nextWrappingIndex(3, 1, -1), 0);
  assert.equal(nextWrappingIndex(3, 1, NaN), 0);
});

test('nextWrappingIndex — invalid curr / delta treated as 0', () => {
  assert.equal(nextWrappingIndex(NaN, NaN, 5), 0);
});

test('nextWrappingIndex — single-item list always returns 0', () => {
  assert.equal(nextWrappingIndex(0, 1, 1), 0);
  assert.equal(nextWrappingIndex(0, -1, 1), 0);
});


// ───────────────────────────────────────────────────────────────────────────
// clampSize — sanity floor for sidebar dimensions
// ───────────────────────────────────────────────────────────────────────────

test('clampSize — passes through values at or above the floor', () => {
  const r = clampSize(400, 600, 220, 120);
  assert.equal(r.width, 400);
  assert.equal(r.height, 600);
});

test('clampSize — value exactly at the floor is allowed', () => {
  const r = clampSize(220, 120, 220, 120);
  assert.equal(r.width, 220);
  assert.equal(r.height, 120);
});

// ──────────────────────────────────────────────────────────────────────
// isMarkdownPath — used by the "render all .md as rich-diff" sidebar action
// to decide which per-file toggles to click.
// ──────────────────────────────────────────────────────────────────────

test('isMarkdownPath — matches .md / .markdown (case-insensitive)', () => {
  assert.equal(isMarkdownPath('README.md'), true);
  assert.equal(isMarkdownPath('docs/notes.MD'), true);
  assert.equal(isMarkdownPath('Foo.markdown'), true);
  assert.equal(isMarkdownPath('Foo.MARKDOWN'), true);
  assert.equal(isMarkdownPath('a/b/c/x.md'), true);
});

test('isMarkdownPath — rejects non-Markdown extensions', () => {
  assert.equal(isMarkdownPath('script.py'), false);
  assert.equal(isMarkdownPath('readme.mdx'), false); // close but not .md
  assert.equal(isMarkdownPath('mdfile'), false);     // no extension
  assert.equal(isMarkdownPath('foo.md.bak'), false);
  assert.equal(isMarkdownPath('CHANGELOG'), false);
});

test('isMarkdownPath — tolerates missing / non-string input', () => {
  assert.equal(isMarkdownPath(null), false);
  assert.equal(isMarkdownPath(undefined), false);
  assert.equal(isMarkdownPath(''), false);
  assert.equal(isMarkdownPath(42), false);
  assert.equal(isMarkdownPath({}), false);
});

test('isMarkdownPath — strips ?query / #hash before matching', () => {
  assert.equal(isMarkdownPath('README.md?ts=1'), true);
  assert.equal(isMarkdownPath('README.md#section'), true);
  assert.equal(isMarkdownPath('script.py?foo=.md'), false);
});

test('clampSize — width below floor returns null for width, keeps height', () => {
  const r = clampSize(100, 600, 220, 120);
  assert.equal(r.width, null);
  assert.equal(r.height, 600);
});

test('clampSize — height below floor returns null for height, keeps width', () => {
  const r = clampSize(400, 50, 220, 120);
  assert.equal(r.width, 400);
  assert.equal(r.height, null);
});

test('clampSize — both below floor returns nulls for both', () => {
  const r = clampSize(50, 30, 220, 120);
  assert.equal(r.width, null);
  assert.equal(r.height, null);
});

test('clampSize — non-finite width returns null without affecting height', () => {
  assert.equal(clampSize(NaN, 600, 220, 120).width, null);
  assert.equal(clampSize(Infinity, 600, 220, 120).width, null);
  assert.equal(clampSize(undefined, 600, 220, 120).width, null);
  assert.equal(clampSize(null, 600, 220, 120).width, null);
});

test('clampSize — non-finite height returns null without affecting width', () => {
  assert.equal(clampSize(400, NaN, 220, 120).height, null);
  assert.equal(clampSize(400, Infinity, 220, 120).height, null);
  assert.equal(clampSize(400, undefined, 220, 120).height, null);
});

test('clampSize — non-finite minimums return null (defensive)', () => {
  const r = clampSize(400, 600, NaN, NaN);
  assert.equal(r.width, null);
  assert.equal(r.height, null);
});

// ──────────────────────────────────────────────────────────────────────
// Thread-card helpers — shared by platform sidebar renderers
// ──────────────────────────────────────────────────────────────────────

test('formatLineRange — formats single and multi-line anchors', () => {
  assert.equal(formatLineRange(12, 12), 'line 12');
  assert.equal(formatLineRange(12, 18), 'lines 12\u201318');
  assert.equal(formatLineRange(12, null), 'line 12');
});

test('formatLineRange — rejects invalid starts and earlier ends', () => {
  assert.equal(formatLineRange(null, 5), '');
  assert.equal(formatLineRange(0, 5), '');
  assert.equal(formatLineRange(8, 3), 'line 8');
});

test('filterSidebarThreadItems — unresolved filter is non-mutating', () => {
  const items = [{ id: 1, resolved: false }, { id: 2, resolved: true }, { id: 3 }];
  assert.deepEqual(filterSidebarThreadItems(items, true).map(x => x.id), [1, 3]);
  assert.deepEqual(filterSidebarThreadItems(items, false).map(x => x.id), [1, 2, 3]);
  assert.deepEqual(items.map(x => x.id), [1, 2, 3]);
});

test('filterSidebarThreadItems — defensive against non-arrays', () => {
  assert.deepEqual(filterSidebarThreadItems(null, true), []);
  assert.deepEqual(filterSidebarThreadItems({}, false), []);
});

test('sortSidebarThreadItems — current file first then path and line', () => {
  const items = [
    { id: 1, path: '/z.md', line: 4 },
    { id: 2, path: '/a.md', line: 20 },
    { id: 3, path: '/current.md', line: 30 },
    { id: 4, path: '/a.md', line: 5 },
    { id: 5, path: '/current.md', line: 2 },
  ];
  assert.deepEqual(
    sortSidebarThreadItems(items, '/current.md').map(x => x.id),
    [5, 3, 4, 2, 1]
  );
  assert.deepEqual(items.map(x => x.id), [1, 2, 3, 4, 5]);
});

test('sortSidebarThreadItems — explicit native file order stays stable without promoting current file', () => {
  const items = [
    { id: 1, path: '/z.md', line: 4 },
    { id: 2, path: '/a.md', line: 20 },
    { id: 3, path: '/m.md', line: 30 },
    { id: 4, path: '/a.md', line: 5 },
  ];
  assert.deepEqual(
    sortSidebarThreadItems(items, null, ['/m.md', '/z.md', '/a.md']).map(x => x.id),
    [3, 1, 4, 2]
  );
  assert.deepEqual(items.map(x => x.id), [1, 2, 3, 4]);
});

test('sortSidebarThreadItems — paths missing from explicit order sort after ranked paths', () => {
  const items = [
    { id: 1, path: '/unknown-b.md', line: 1 },
    { id: 2, path: '/known.md', line: 1 },
    { id: 3, path: '/unknown-a.md', line: 1 },
  ];
  assert.deepEqual(
    sortSidebarThreadItems(items, null, ['/known.md']).map(x => x.id),
    [2, 3, 1]
  );
});

test('sortSidebarThreadItems — creation time and stability break ties', () => {
  const items = [
    { id: 1, path: '/a.md', line: 5, createdAt: '2026-01-02T00:00:00Z' },
    { id: 2, path: '/a.md', line: 5, createdAt: '2026-01-01T00:00:00Z' },
    { id: 3, path: '/a.md', line: 5, createdAt: '2026-01-02T00:00:00Z' },
  ];
  assert.deepEqual(sortSidebarThreadItems(items).map(x => x.id), [2, 1, 3]);
});

test('sortSidebarThreadItems — defensive against malformed input', () => {
  assert.deepEqual(sortSidebarThreadItems(null, '/a.md'), []);
  const malformed = [{ id: 1 }, null, { id: 2, path: '/a.md', line: 1 }];
  assert.deepEqual(sortSidebarThreadItems(malformed, '/a.md').map(x => x && x.id), [2, 1, null]);
});

// ──────────────────────────────────────────────────────────────────────
// GitHub-parity scoped counters — shared by ADO Changes and Threads
// ──────────────────────────────────────────────────────────────────────

test('buildScopedCounterState — multi-file counter shows file progress and PR total', () => {
  const items = [
    { path: '/a.md' },
    { path: '/a.md' },
    { path: '/b.md' },
  ];
  assert.deepEqual(buildScopedCounterState(items, 1, '/a.md', 'threads'), {
    text: '2/2 (3)',
    title: '2 of 2 threads in this file · 3 threads in this pull request',
    position: 2,
    fileTotal: 2,
    total: 3,
    empty: false,
  });
});

test('buildScopedCounterState — file with no items shows dimmable zero state', () => {
  const state = buildScopedCounterState([{ path: '/a.md' }], 0, '/empty.md', 'changes');
  assert.equal(state.text, '0/0 (1)');
  assert.equal(state.empty, true);
  assert.equal(state.fileTotal, 0);
});

test('buildScopedCounterState — single-file list drops redundant PR total', () => {
  const state = buildScopedCounterState([
    { path: '/only.md' }, { path: '/only.md' }
  ], 0, '/only.md', 'threads');
  assert.equal(state.text, '1/2');
  assert.equal(state.empty, false);
});

test('buildScopedCounterState — selected item in another file reports zero current position', () => {
  const state = buildScopedCounterState([
    { path: '/a.md' }, { path: '/b.md' }, { path: '/b.md' }
  ], 0, '/b.md', 'changes');
  assert.equal(state.text, '0/2 (3)');
  assert.equal(state.position, 0);
});

test('buildScopedCounterState — unknown route and invalid input use defensive flat count', () => {
  assert.equal(buildScopedCounterState([{ path: '/a.md' }], 0, '', 'threads').text, '1/1');
  assert.equal(buildScopedCounterState(null, 99, null, 'changes').text, '0/0');
});


