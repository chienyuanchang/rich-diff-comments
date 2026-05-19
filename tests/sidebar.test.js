'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildSnippet, clampDragPos, nextWrappingIndex } = require('../src/lib/sidebar.js');

// ───────────────────────────────────────────────────────────────────────────
// buildSnippet
// ───────────────────────────────────────────────────────────────────────────

test('buildSnippet — collapses whitespace and trims', () => {
  assert.equal(buildSnippet('  hello   world\n\nfoo  '), 'hello world foo');
});

test('buildSnippet — truncates to maxLen', () => {
  assert.equal(buildSnippet('abcdefghij', 5), 'abcde');
});

test('buildSnippet — default maxLen is 80', () => {
  const long = 'x'.repeat(120);
  assert.equal(buildSnippet(long).length, 80);
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
  assert.equal(buildSnippet(long, 0).length, 80);
  assert.equal(buildSnippet(long, -1).length, 80);
  assert.equal(buildSnippet(long, NaN).length, 80);
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
