'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  headingLevel,
  collectSiblingsToHide,
  collectSectionRoots,
} = require('../src/lib/sectionCollapse.js');

// ───────────────────────────────────────────────────────────────────────────
// Tiny fake-DOM builder
//
// Each node has: tagName, classList.contains(), parentElement,
// nextElementSibling, querySelector(selector), closest(selector). Selectors
// here only need to support comma-separated tag lists ("h1, h2, ...") and
// class lists (".prose-diff, .markdown-body"); the walkers don't use
// anything fancier.
// ───────────────────────────────────────────────────────────────────────────

function makeNode(tag, classes) {
  const node = {
    tagName: tag.toUpperCase(),
    children: [],
    parentElement: null,
    nextElementSibling: null,
    previousElementSibling: null,
    _classes: new Set(classes || []),
    classList: {
      contains(name) { return node._classes.has(name); },
    },
    querySelector(selector) {
      const sel = String(selector).split(',').map((s) => s.trim());
      const tagWanted = sel
        .filter((s) => !s.startsWith('.'))
        .map((s) => s.toUpperCase());
      const classWanted = sel
        .filter((s) => s.startsWith('.'))
        .map((s) => s.slice(1));
      function visit(n) {
        for (const c of n.children) {
          if (tagWanted.includes(c.tagName)) return c;
          if (classWanted.some((cls) => c._classes.has(cls))) return c;
          const found = visit(c);
          if (found) return found;
        }
        return null;
      }
      return visit(node);
    },
    closest(selector) {
      const classWanted = String(selector)
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.startsWith('.'))
        .map((s) => s.slice(1));
      let cur = node;
      while (cur) {
        if (classWanted.some((cls) => cur._classes.has(cls))) return cur;
        cur = cur.parentElement;
      }
      return null;
    },
  };
  return node;
}

// Append `child` as the next child of `parent`, wiring parent + sibling links.
function appendChild(parent, child) {
  if (parent.children.length > 0) {
    const last = parent.children[parent.children.length - 1];
    last.nextElementSibling = child;
    child.previousElementSibling = last;
  }
  child.parentElement = parent;
  parent.children.push(child);
  return child;
}

// Helper: build a container with a sequence of child nodes.
function makeContainer(classes, ...children) {
  const c = makeNode('div', classes);
  children.forEach((ch) => appendChild(c, ch));
  return c;
}

// ───────────────────────────────────────────────────────────────────────────
// headingLevel
// ───────────────────────────────────────────────────────────────────────────

test('headingLevel — returns 1..6 for H1..H6', () => {
  for (let i = 1; i <= 6; i++) {
    assert.equal(headingLevel(makeNode(`h${i}`)), i);
  }
});

test('headingLevel — returns null for non-heading elements', () => {
  assert.equal(headingLevel(makeNode('p')), null);
  assert.equal(headingLevel(makeNode('div')), null);
});

test('headingLevel — null / no tagName returns null', () => {
  assert.equal(headingLevel(null), null);
  assert.equal(headingLevel({}), null);
});

// ───────────────────────────────────────────────────────────────────────────
// collectSiblingsToHide — flat (Strategy 1) cases
// ───────────────────────────────────────────────────────────────────────────

test('collectSiblingsToHide — flat: collects siblings until next H2', () => {
  const h2 = makeNode('h2');
  const p1 = makeNode('p');
  const p2 = makeNode('p');
  const h2next = makeNode('h2');
  const p3 = makeNode('p');
  makeContainer(['prose-diff'], h2, p1, p2, h2next, p3);

  const result = collectSiblingsToHide(h2);
  assert.deepEqual(result, [p1, p2]);
});

test('collectSiblingsToHide — flat: H3 boundary does not stop H2 fold', () => {
  const h2 = makeNode('h2');
  const p1 = makeNode('p');
  const h3 = makeNode('h3');
  const p2 = makeNode('p');
  const h2next = makeNode('h2');
  makeContainer(['prose-diff'], h2, p1, h3, p2, h2next);

  const result = collectSiblingsToHide(h2);
  assert.deepEqual(result, [p1, h3, p2]);
});

test('collectSiblingsToHide — flat: H2 boundary DOES stop H3 fold (shallower)', () => {
  const h3 = makeNode('h3');
  const p1 = makeNode('p');
  const h2 = makeNode('h2');
  const p2 = makeNode('p');
  makeContainer(['prose-diff'], h3, p1, h2, p2);

  const result = collectSiblingsToHide(h3);
  assert.deepEqual(result, [p1]);
});

test('collectSiblingsToHide — flat: skips injected siblings', () => {
  const h2 = makeNode('h2');
  const injectedBadge = makeNode('div', ['grdc-existing-thread']);
  const p1 = makeNode('p');
  const h2next = makeNode('h2');
  makeContainer(['prose-diff'], h2, injectedBadge, p1, h2next);

  const isInjected = (el) => el && el.classList && el.classList.contains('grdc-existing-thread');
  const result = collectSiblingsToHide(h2, { isInjected });
  assert.deepEqual(result, [p1]);
});

test('collectSiblingsToHide — returns [] for non-heading input', () => {
  const p = makeNode('p');
  assert.deepEqual(collectSiblingsToHide(p), []);
});

// ───────────────────────────────────────────────────────────────────────────
// collectSiblingsToHide — hunk-wrapped (descendant-heading boundary)
//
// Regression test for the 1.0.1 bug: GitHub's prose-diff sometimes wraps
// a later hunk containing the *next* same-level heading inside a sibling
// container. Without the descendant-heading peek, the walker would pull
// content from the next section into the current fold (Phase 3 collapse
// was over-hiding Phase 4).
// ───────────────────────────────────────────────────────────────────────────

test('collectSiblingsToHide — hunk-wrapped: stops at sibling whose subtree holds next H2', () => {
  const h2 = makeNode('h2');     // "## Implementation Phases"
  const p1 = makeNode('p');      // intro
  const phase3body = makeNode('p');
  const phase4hunk = makeContainer([], makeNode('h2'));  // wraps next H2
  const tail = makeNode('p');    // would be inside phase4hunk; sits after
  makeContainer(['prose-diff'], h2, p1, phase3body, phase4hunk, tail);

  const result = collectSiblingsToHide(h2);
  // The hunk container has a descendant H2 at our level → stop BEFORE it.
  assert.deepEqual(result, [p1, phase3body]);
});

test('collectSiblingsToHide — hunk-wrapped: H3 descendant inside sibling does NOT stop H2 fold', () => {
  const h2 = makeNode('h2');
  const p1 = makeNode('p');
  const hunk = makeContainer([], makeNode('h3'), makeNode('p'));  // descendant H3
  const h2next = makeNode('h2');
  makeContainer(['prose-diff'], h2, p1, hunk, h2next);

  const result = collectSiblingsToHide(h2);
  // H3 is deeper than our H2 → not a boundary; include the hunk.
  assert.deepEqual(result, [p1, hunk]);
});

// ───────────────────────────────────────────────────────────────────────────
// collectSiblingsToHide — Strategy 2 (cross-parent walk)
// ───────────────────────────────────────────────────────────────────────────

test('collectSiblingsToHide — Strategy 2: walks up when no non-injected direct sibling', () => {
  // heading's direct parent contains only the heading + an injected badge;
  // real content lives in the parent's NEXT sibling under the rich-diff root.
  const h2 = makeNode('h2');
  const injectedBadge = makeNode('div', ['grdc-existing-thread']);
  const hunk1 = makeContainer([], h2, injectedBadge);
  const realContent = makeNode('p');
  const hunk2 = makeContainer([], realContent);
  const h2next = makeNode('h2');
  makeContainer(['prose-diff'], hunk1, hunk2, h2next);

  const isInjected = (el) => el && el.classList && el.classList.contains('grdc-existing-thread');
  const result = collectSiblingsToHide(h2, { isInjected });
  // Strategy 1 collected zero non-injected → Strategy 2 walks up and finds hunk2.
  assert.deepEqual(result, [hunk2]);
});

test('collectSiblingsToHide — Strategy 2: stops at boundary heading reached via cross-parent walk', () => {
  const h2 = makeNode('h2');
  const hunk1 = makeContainer([], h2);  // h2 alone, no content
  const hunk2 = makeContainer([], makeNode('h2'));  // next H2 wrapped
  makeContainer(['prose-diff'], hunk1, hunk2);

  const result = collectSiblingsToHide(h2);
  // hunk2 contains a boundary descendant → Strategy 2 returns immediately.
  assert.deepEqual(result, []);
});

// ───────────────────────────────────────────────────────────────────────────
// collectSectionRoots — same walker but INCLUDES injected nodes
// ───────────────────────────────────────────────────────────────────────────

test('collectSectionRoots — INCLUDES injected nodes', () => {
  const h2 = makeNode('h2');
  const p1 = makeNode('p');
  const injectedBadge = makeNode('div', ['grdc-existing-thread']);
  const p2 = makeNode('p');
  const h2next = makeNode('h2');
  makeContainer(['prose-diff'], h2, p1, injectedBadge, p2, h2next);

  const isInjected = (el) => el && el.classList && el.classList.contains('grdc-existing-thread');
  const result = collectSectionRoots(h2, { isInjected });
  assert.deepEqual(result, [p1, injectedBadge, p2]);
});

test('collectSectionRoots — same hunk-wrapped boundary detection as siblingsToHide', () => {
  const h2 = makeNode('h2');
  const p1 = makeNode('p');
  const hunkWithNextH2 = makeContainer([], makeNode('h2'));
  makeContainer(['prose-diff'], h2, p1, hunkWithNextH2);

  const result = collectSectionRoots(h2);
  assert.deepEqual(result, [p1]);
});

test('collectSectionRoots — returns [] for non-heading input', () => {
  const p = makeNode('p');
  assert.deepEqual(collectSectionRoots(p), []);
});
