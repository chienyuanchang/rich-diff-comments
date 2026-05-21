'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildSnippet, clampDragPos, nextWrappingIndex, clampSize } = require('../src/lib/sidebar.js');

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
