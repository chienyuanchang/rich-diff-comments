'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildOutlineTree,
  attributeThreadsToHeadings,
  collapseHeadingsAtLevel,
} = require('../src/lib/outline.js');

// ───────────────────────────────────────────────────────────────────────────
// buildOutlineTree
// ───────────────────────────────────────────────────────────────────────────

test('buildOutlineTree — simple H1 → H2 → H3 nest', () => {
  const tree = buildOutlineTree([
    { id: 'a', level: 1, text: 'A', line: 1 },
    { id: 'b', level: 2, text: 'B', line: 5 },
    { id: 'c', level: 3, text: 'C', line: 8 },
  ]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].id, 'a');
  assert.equal(tree[0].children.length, 1);
  assert.equal(tree[0].children[0].id, 'b');
  assert.equal(tree[0].children[0].children[0].id, 'c');
});

test('buildOutlineTree — siblings at same level', () => {
  const tree = buildOutlineTree([
    { id: 'a', level: 1 },
    { id: 'b', level: 2 },
    { id: 'c', level: 2 },
    { id: 'd', level: 2 },
  ]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].children.length, 3);
  assert.deepEqual(tree[0].children.map(c => c.id), ['b', 'c', 'd']);
});

test('buildOutlineTree — level jump (H1 → H3) still nests under H1', () => {
  const tree = buildOutlineTree([
    { id: 'a', level: 1 },
    { id: 'b', level: 3 },
  ]);
  assert.equal(tree[0].children.length, 1);
  assert.equal(tree[0].children[0].id, 'b');
});

test('buildOutlineTree — H2 pops back out of H3 ancestor', () => {
  const tree = buildOutlineTree([
    { id: 'a', level: 1 },
    { id: 'b', level: 2 },
    { id: 'c', level: 3 },
    { id: 'd', level: 2 },
  ]);
  // d is sibling of b under a (NOT a child of c)
  assert.equal(tree[0].children.length, 2);
  assert.deepEqual(tree[0].children.map(c => c.id), ['b', 'd']);
});

test('buildOutlineTree — multiple top-level H1s', () => {
  const tree = buildOutlineTree([
    { id: 'a', level: 1 },
    { id: 'b', level: 1 },
  ]);
  assert.equal(tree.length, 2);
});

test('buildOutlineTree — preserves arbitrary extra fields', () => {
  const tree = buildOutlineTree([
    { id: 'a', level: 1, text: 'Foo', line: 7, file: 'README.md' },
  ]);
  assert.equal(tree[0].text, 'Foo');
  assert.equal(tree[0].line, 7);
  assert.equal(tree[0].file, 'README.md');
});

test('buildOutlineTree — empty / null / non-array input', () => {
  assert.deepEqual(buildOutlineTree(null), []);
  assert.deepEqual(buildOutlineTree(undefined), []);
  assert.deepEqual(buildOutlineTree([]), []);
  assert.deepEqual(buildOutlineTree('not an array'), []);
});

test('buildOutlineTree — skips entries without a valid level', () => {
  const tree = buildOutlineTree([
    { id: 'a', level: 1 },
    { id: 'b' /* no level */ },
    { id: 'c', level: 2 },
  ]);
  assert.equal(tree[0].children.length, 1);
  assert.equal(tree[0].children[0].id, 'c');
});

// ───────────────────────────────────────────────────────────────────────────
// attributeThreadsToHeadings
// ───────────────────────────────────────────────────────────────────────────

test('attributeThreadsToHeadings — basic ownership', () => {
  const headings = [
    { id: 'a', level: 1, line: 1 },
    { id: 'b', level: 2, line: 10 },
    { id: 'c', level: 2, line: 20 },
  ];
  const threads = [
    { line: 5 },   // → a (1..9)
    { line: 12 },  // → b (10..19)
    { line: 25 },  // → c (20..)
  ];
  const counts = attributeThreadsToHeadings(headings, threads);
  assert.equal(counts.get(headings[0]), 1);
  assert.equal(counts.get(headings[1]), 1);
  assert.equal(counts.get(headings[2]), 1);
});

test('attributeThreadsToHeadings — multiple threads under one heading', () => {
  const headings = [{ id: 'a', level: 1, line: 1 }, { id: 'b', level: 1, line: 50 }];
  const counts = attributeThreadsToHeadings(headings, [
    { line: 5 }, { line: 10 }, { line: 49 },
  ]);
  assert.equal(counts.get(headings[0]), 3);
  assert.equal(counts.get(headings[1]), 0);
});

test('attributeThreadsToHeadings — thread before first heading is dropped', () => {
  const headings = [{ id: 'a', level: 1, line: 10 }];
  const counts = attributeThreadsToHeadings(headings, [{ line: 3 }]);
  assert.equal(counts.get(headings[0]), 0);
});

test('attributeThreadsToHeadings — deepest matching heading wins (nested)', () => {
  const headings = [
    { id: 'a', level: 1, line: 1 },
    { id: 'b', level: 2, line: 10 },
    { id: 'c', level: 3, line: 15 },
  ];
  // line 17 is inside c (which is inside b which is inside a) — attributed to c.
  const counts = attributeThreadsToHeadings(headings, [{ line: 17 }]);
  assert.equal(counts.get(headings[0]), 0);
  assert.equal(counts.get(headings[1]), 0);
  assert.equal(counts.get(headings[2]), 1);
});

test('attributeThreadsToHeadings — file scoping isolates cross-file threads', () => {
  const headings = [
    { id: 'a', level: 1, line: 1, file: 'A.md' },
    { id: 'b', level: 1, line: 1, file: 'B.md' },
  ];
  const counts = attributeThreadsToHeadings(headings, [
    { line: 5, path: 'A.md' },
    { line: 5, path: 'B.md' },
  ]);
  assert.equal(counts.get(headings[0]), 1);
  assert.equal(counts.get(headings[1]), 1);
});

test('attributeThreadsToHeadings — empty inputs', () => {
  assert.equal(attributeThreadsToHeadings([], []).size, 0);
  const counts = attributeThreadsToHeadings([{ id: 'a', level: 1, line: 1 }], []);
  assert.equal(counts.get({ id: 'a', level: 1, line: 1 }), undefined); // ref-keyed
});

test('attributeThreadsToHeadings — defensive against invalid input', () => {
  assert.equal(attributeThreadsToHeadings(null, null).size, 0);
});

// ───────────────────────────────────────────────────────────────────────────
// collapseHeadingsAtLevel
// ───────────────────────────────────────────────────────────────────────────

test('collapseHeadingsAtLevel — fold H2 only (H1 and H3 untouched)', () => {
  const headings = [
    { id: 'a', level: 1 },
    { id: 'b', level: 2 },
    { id: 'c', level: 3 },
    { id: 'd', level: 2 },
  ];
  const ids = collapseHeadingsAtLevel(headings, 2);
  assert.deepEqual([...ids].sort(), ['b', 'd']);
});

test('collapseHeadingsAtLevel — fold H3 only', () => {
  const headings = [
    { id: 'a', level: 1 },
    { id: 'b', level: 2 },
    { id: 'c', level: 3 },
    { id: 'd', level: 4 },
  ];
  const ids = collapseHeadingsAtLevel(headings, 3);
  assert.deepEqual([...ids], ['c']);
});

test('collapseHeadingsAtLevel — no headings at requested level returns empty set', () => {
  const headings = [{ id: 'a', level: 1 }, { id: 'b', level: 3 }];
  assert.equal(collapseHeadingsAtLevel(headings, 2).size, 0);
});

test('collapseHeadingsAtLevel — Infinity returns empty set (caller handles expand-all separately)', () => {
  const headings = [{ id: 'a', level: 1 }, { id: 'b', level: 2 }];
  assert.equal(collapseHeadingsAtLevel(headings, Infinity).size, 0);
});

test('collapseHeadingsAtLevel — invalid input returns empty set', () => {
  assert.equal(collapseHeadingsAtLevel(null, 2).size, 0);
  assert.equal(collapseHeadingsAtLevel('nope', 2).size, 0);
});

test('collapseHeadingsAtLevel — non-finite level returns empty set ("no-op")', () => {
  const headings = [{ id: 'a', level: 1 }, { id: 'b', level: 2 }];
  assert.equal(collapseHeadingsAtLevel(headings, NaN).size, 0);
});
