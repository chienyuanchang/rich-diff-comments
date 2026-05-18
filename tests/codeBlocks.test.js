'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { findFenceRangeAroundLine, sortThreadHeads } = require('../src/lib/codeBlocks.js');

// ───────────────────────────────────────────────────────────────────────────
// findFenceRangeAroundLine
// ───────────────────────────────────────────────────────────────────────────

function lines(...arr) { return arr.join('\n'); }

test('findFenceRangeAroundLine — single fence, target inside content', () => {
  // line 1: prose
  // line 2: ```yaml
  // line 3: foo: 1
  // line 4: bar: 2
  // line 5: ```
  const src = lines('prose', '```yaml', 'foo: 1', 'bar: 2', '```');
  assert.deepEqual(findFenceRangeAroundLine(src, 3), { start: 3, end: 4 });
  assert.deepEqual(findFenceRangeAroundLine(src, 4), { start: 3, end: 4 });
});

test('findFenceRangeAroundLine — target IS the opening fence', () => {
  const src = lines('prose', '```yaml', 'foo: 1', 'bar: 2', '```');
  // openLine=2; strict containment includes openLine so still returns range.
  assert.deepEqual(findFenceRangeAroundLine(src, 2), { start: 3, end: 4 });
});

test('findFenceRangeAroundLine — target IS the closing fence', () => {
  const src = lines('prose', '```yaml', 'foo: 1', 'bar: 2', '```');
  assert.deepEqual(findFenceRangeAroundLine(src, 5), { start: 3, end: 4 });
});

test('findFenceRangeAroundLine — target just before open (slack)', () => {
  // matcher anchored the <pre> one line before the fence; ±5 slack covers it.
  const src = lines('prose', '```yaml', 'foo: 1', 'bar: 2', '```');
  assert.deepEqual(findFenceRangeAroundLine(src, 1), { start: 3, end: 4 });
});

test('findFenceRangeAroundLine — target way outside any fence returns null', () => {
  const src = lines('p1', 'p2', '```', 'code', '```', 'p3', 'p4', 'p5', 'p6', 'p7');
  // target line 10 is 5+ lines past the close (line 5). slack default ±5
  // means line 10 is exactly at the boundary; line 11+ is null.
  assert.equal(findFenceRangeAroundLine(src, 11), null);
});

test('findFenceRangeAroundLine — tilde fences work too', () => {
  const src = lines('prose', '~~~js', 'x = 1;', '~~~');
  assert.deepEqual(findFenceRangeAroundLine(src, 3), { start: 3, end: 3 });
});

test('findFenceRangeAroundLine — multiple fences, picks the containing one', () => {
  const src = lines(
    'p1',          // 1
    '```',         // 2
    'block1',      // 3
    '```',         // 4
    'p2',          // 5
    '```js',       // 6
    'block2 a',    // 7
    'block2 b',    // 8
    '```'          // 9
  );
  assert.deepEqual(findFenceRangeAroundLine(src, 3), { start: 3, end: 3 });
  assert.deepEqual(findFenceRangeAroundLine(src, 7), { start: 7, end: 8 });
  assert.deepEqual(findFenceRangeAroundLine(src, 8), { start: 7, end: 8 });
});

test('findFenceRangeAroundLine — between two fences picks the nearest within slack', () => {
  const src = lines(
    '```',          // 1
    'a',            // 2
    '```',          // 3
    'p4',           // 4
    'p5',           // 5
    'p6',           // 6
    '```',          // 7
    'b',            // 8
    '```'           // 9
  );
  // line 4 is 1 from close=3, 3 from open=7 → first fence (closer).
  assert.deepEqual(findFenceRangeAroundLine(src, 4), { start: 2, end: 2 });
  // line 6 is 3 from close=3, 1 from open=7 → second fence.
  assert.deepEqual(findFenceRangeAroundLine(src, 6), { start: 8, end: 8 });
});

test('findFenceRangeAroundLine — empty / missing input', () => {
  assert.equal(findFenceRangeAroundLine('', 1), null);
  assert.equal(findFenceRangeAroundLine(null, 1), null);
  assert.equal(findFenceRangeAroundLine('no fences here', 1), null);
});

test('findFenceRangeAroundLine — custom slack', () => {
  const src = lines('p1', 'p2', '```', 'code', '```');
  // target=8 with default slack=5 → no match (open=3, close=5, dist=3 — wait, that's <=5).
  // Use slack=1 to actually fail.
  assert.deepEqual(findFenceRangeAroundLine(src, 8, 1), null);
  assert.deepEqual(findFenceRangeAroundLine(src, 4, 1), { start: 4, end: 4 });
});

// ───────────────────────────────────────────────────────────────────────────
// sortThreadHeads
// ───────────────────────────────────────────────────────────────────────────

test('sortThreadHeads — primary line asc', () => {
  const heads = [
    { line: 20, createdAt: '2026-05-13T10:00:00Z' },
    { line: 5,  createdAt: '2026-05-13T12:00:00Z' },
    { line: 10, createdAt: '2026-05-13T11:00:00Z' },
  ];
  const sorted = sortThreadHeads(heads);
  assert.deepEqual(sorted.map(h => h.line), [5, 10, 20]);
});

test('sortThreadHeads — secondary createdAt asc when lines are equal', () => {
  const heads = [
    { line: 10, createdAt: '2026-05-13T12:00:00Z', label: 'C' },
    { line: 10, createdAt: '2026-05-13T10:00:00Z', label: 'A' },
    { line: 10, createdAt: '2026-05-13T11:00:00Z', label: 'B' },
  ];
  const sorted = sortThreadHeads(heads);
  assert.deepEqual(sorted.map(h => h.label), ['A', 'B', 'C']);
});

test('sortThreadHeads — uses startLine when present, falls back to line', () => {
  const heads = [
    { line: 20, startLine: 5, createdAt: '' }, // anchor = 5
    { line: 10, createdAt: '' },                // anchor = 10
    { line: 30, startLine: 15, createdAt: '' }, // anchor = 15
  ];
  const sorted = sortThreadHeads(heads);
  assert.deepEqual(sorted.map(h => h.line), [20, 10, 30]);
});

test('sortThreadHeads — does not mutate input', () => {
  const heads = [
    { line: 20, createdAt: '' },
    { line: 5,  createdAt: '' },
  ];
  const copy = heads.slice();
  sortThreadHeads(heads);
  assert.deepEqual(heads, copy);
});

test('sortThreadHeads — empty / non-array input', () => {
  assert.deepEqual(sortThreadHeads([]), []);
  assert.deepEqual(sortThreadHeads(null), []);
  assert.deepEqual(sortThreadHeads(undefined), []);
});

test('sortThreadHeads — missing createdAt treated as epoch 0', () => {
  const heads = [
    { line: 5, createdAt: '2026-05-13T10:00:00Z', label: 'has-date' },
    { line: 5, label: 'no-date' },
  ];
  const sorted = sortThreadHeads(heads);
  // no-date sorts first (epoch 0 < 2026).
  assert.deepEqual(sorted.map(h => h.label), ['no-date', 'has-date']);
});
