'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  findChangeBlocks,
  classifyChangeKind,
  buildChangeSnippet,
  nextChangeIndex,
} = require('../src/lib/changes.js');

// ───────────────────────────────────────────────────────────────────────────
// Tiny fake-DOM builder
//
// Just enough to drive the changes.js helpers: tagName, classList, parent,
// children, matches(selector), querySelector(selector), querySelectorAll,
// contains(node), closest(selector), cloneNode(deep), textContent. Selector
// support is intentionally minimal — tag names, class selectors, and
// comma-separated lists of either (`ins, del, .added, .removed`).
// ───────────────────────────────────────────────────────────────────────────

function makeNode(tag, opts) {
  opts = opts || {};
  const node = {
    tagName: tag.toUpperCase(),
    children: [],
    parentElement: null,
    _classes: new Set(opts.classes || []),
    _text: opts.text || '',
    classList: {
      contains(name) { return node._classes.has(name); },
    },
    matches(selector) {
      return selectorMatches(node, selector);
    },
    querySelector(selector) {
      const all = collectAll(node);
      for (const n of all) {
        if (n === node) continue;
        if (selectorMatches(n, selector)) return n;
      }
      return null;
    },
    querySelectorAll(selector) {
      const all = collectAll(node);
      return all.filter((n) => n !== node && selectorMatches(n, selector));
    },
    contains(other) {
      if (!other) return false;
      if (other === node) return true;
      let cur = other.parentElement;
      while (cur) {
        if (cur === node) return true;
        cur = cur.parentElement;
      }
      return false;
    },
    closest(selector) {
      let cur = node;
      while (cur) {
        if (selectorMatches(cur, selector)) return cur;
        cur = cur.parentElement;
      }
      return null;
    },
    cloneNode(deep) {
      const clone = makeNode(tag, { classes: Array.from(node._classes), text: node._text });
      if (deep) {
        for (const c of node.children) {
          appendChild(clone, c.cloneNode(true));
        }
      }
      return clone;
    },
    remove() {
      const parent = node.parentElement;
      if (!parent) return;
      const idx = parent.children.indexOf(node);
      if (idx !== -1) parent.children.splice(idx, 1);
      node.parentElement = null;
    },
    get textContent() {
      if (node.children.length === 0) return node._text;
      return node.children.map((c) => c.textContent).join('');
    },
  };
  return node;
}

function selectorMatches(node, selector) {
  if (!node || !node.tagName) return false;
  const parts = String(selector).split(',').map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    if (part.startsWith('.')) {
      const cls = part.slice(1);
      if (node._classes && node._classes.has(cls)) return true;
    } else {
      if (node.tagName === part.toUpperCase()) return true;
    }
  }
  return false;
}

function collectAll(root) {
  // DOM-order traversal (root first, then descendants depth-first left-to-right).
  const out = [root];
  for (const c of root.children) {
    out.push(...collectAll(c));
  }
  return out;
}

function appendChild(parent, child) {
  child.parentElement = parent;
  parent.children.push(child);
  return child;
}

// Sugar: build a node and attach children in one call.
function el(tag, opts, ...children) {
  const node = makeNode(tag, opts);
  for (const c of children) {
    appendChild(node, typeof c === 'string' ? makeNode('text', { text: c }) : c);
  }
  // For the "text" pseudo-tag, its textContent is _text.
  return node;
}

// Build a typical rich-diff container shape: `.prose-diff > .markdown-body > children`.
function container(...children) {
  return el('div', { classes: ['prose-diff'] },
    el('div', { classes: ['markdown-body'] }, ...children));
}

// ───────────────────────────────────────────────────────────────────────────
// findChangeBlocks
// ───────────────────────────────────────────────────────────────────────────

test('findChangeBlocks — empty / non-element / no children → []', () => {
  assert.deepEqual(findChangeBlocks(null), []);
  assert.deepEqual(findChangeBlocks(undefined), []);
  assert.deepEqual(findChangeBlocks({}), []);
  assert.deepEqual(findChangeBlocks(container()), []);
});

test('findChangeBlocks — no markers → []', () => {
  const root = container(
    el('p', {}, 'unchanged paragraph'),
    el('p', {}, 'another unchanged paragraph'),
  );
  assert.deepEqual(findChangeBlocks(root), []);
});

test('findChangeBlocks — single <p> containing <ins> → 1 block', () => {
  const ins = el('ins', {}, 'new text');
  const p = el('p', {}, 'before ', ins, ' after');
  const root = container(p);
  const blocks = findChangeBlocks(root);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0], p);
});

test('findChangeBlocks — single <p> containing <del> → 1 block', () => {
  const del = el('del', {}, 'removed text');
  const p = el('p', {}, 'before ', del, ' after');
  const root = container(p);
  const blocks = findChangeBlocks(root);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0], p);
});

test('findChangeBlocks — <li class="added"> → 1 block (self-marker)', () => {
  const li = el('li', { classes: ['added'] }, 'whole new bullet');
  const root = container(el('ul', {}, li));
  const blocks = findChangeBlocks(root);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0], li);
});

test('findChangeBlocks — multiple <ins> inside same <p> → 1 stop (per-block dedupe)', () => {
  const p = el('p', {},
    'before ', el('ins', {}, 'one'),
    ' middle ', el('ins', {}, 'two'),
    ' end');
  const root = container(p);
  const blocks = findChangeBlocks(root);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0], p);
});

test('findChangeBlocks — <p> with mixed <ins> + <del> → 1 stop', () => {
  const p = el('p', {},
    el('del', {}, 'old '),
    el('ins', {}, 'new'),
    ' rest');
  const root = container(p);
  const blocks = findChangeBlocks(root);
  assert.equal(blocks.length, 1);
});

test('findChangeBlocks — sibling paragraphs each with change → 2 stops in DOM order', () => {
  const p1 = el('p', {}, el('ins', {}, 'first change'));
  const p2 = el('p', {}, 'unchanged');
  const p3 = el('p', {}, el('del', {}, 'second change'));
  const root = container(p1, p2, p3);
  const blocks = findChangeBlocks(root);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0], p1);
  assert.equal(blocks[1], p3);
});

test('findChangeBlocks — nested LI with inner change → outer LI is the stop', () => {
  const innerLi = el('li', {}, el('ins', {}, 'new nested item'));
  const innerUl = el('ul', {}, innerLi);
  const outerLi = el('li', {}, 'parent text ', innerUl);
  const root = container(el('ul', {}, outerLi));
  const blocks = findChangeBlocks(root);
  // Per-block dedupe — outer LI subsumes inner LI.
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0], outerLi);
});

test('findChangeBlocks — <tr class="added"> inside <table> → 1 stop on the tr', () => {
  const tr = el('tr', { classes: ['added'] }, el('td', {}, 'cell'));
  const table = el('table', {}, tr);
  const root = container(table);
  const blocks = findChangeBlocks(root);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0], tr);
});

// Regression: a partially-changed list (one new item among unchanged
// ones) must land on the specific changed `<li>`, not the whole list.
test('findChangeBlocks — <ul> with one <li class="added"> among unchanged → 1 stop on the changed li', () => {
  const li1 = el('li', {}, 'unchanged');
  const li2 = el('li', { classes: ['added'] }, 'new item');
  const li3 = el('li', {}, 'unchanged too');
  const ul = el('ul', {}, li1, li2, li3);
  const root = container(ul);
  const blocks = findChangeBlocks(root);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0], li2);
});

// `<ins><table>…</table></ins>` (whole replaced table) IS detected via
// the narrow table-only ancestor walker. Walking ancestors for other
// block types caused whole-new-file rich-diff to flood the Changes
// pane in earlier attempts; limiting it to `<table>` plus skipping
// ADDED / REMOVED files at the content.js level keeps the surface area
// safe. Tables are special because they're one semantic block but
// contain many rows — wrapping in `<ins>` is almost always an
// intentional "this table was replaced" pattern.
test('findChangeBlocks — <ins><table>…</table></ins> (whole replaced table) → 1 stop on the table', () => {
  const tr1 = el('tr', {}, el('td', {}, 'header'));
  const tr2 = el('tr', {}, el('td', {}, 'row 1'));
  const table = el('table', {}, tr1, tr2);
  const ins = el('ins', {}, table);
  const root = container(ins);
  const blocks = findChangeBlocks(root);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0], table);
});

test('findChangeBlocks — <del><table>…</table></del> (whole removed table) → 1 stop on the table', () => {
  const tr = el('tr', {}, el('td', {}, 'old cell'));
  const table = el('table', {}, tr);
  const del = el('del', {}, table);
  const root = container(del);
  const blocks = findChangeBlocks(root);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0], table);
});

// Regression: a table with one changed CELL (descendant marker on a
// `<td>`'s `<ins>`) must still land on the specific changed `<tr>`,
// not aggregate to the whole table. Tables intentionally don't
// qualify via descendant markers — only self / ancestor.
test('findChangeBlocks — <table> with one changed cell → per-row stop, NOT whole table', () => {
  const trUnchanged = el('tr', {}, el('td', {}, 'unchanged'));
  const trChanged = el('tr', {}, el('td', {}, el('ins', {}, 'edited cell')));
  const table = el('table', {}, trUnchanged, trChanged);
  const root = container(table);
  const blocks = findChangeBlocks(root);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0], trChanged);
});

test('classifyChangeKind — <ins><table>…</table></ins> → "added"', () => {
  const tr = el('tr', {}, el('td', {}, 'cell'));
  const table = el('table', {}, tr);
  el('ins', {}, table); // wrap so table.parentElement is the ins
  assert.equal(classifyChangeKind(table), 'added');
});

test('classifyChangeKind — <del><table>…</table></del> → "removed"', () => {
  const tr = el('tr', {}, el('td', {}, 'cell'));
  const table = el('table', {}, tr);
  el('del', {}, table);
  assert.equal(classifyChangeKind(table), 'removed');
});

// The lib's ancestor walker DOES detect per-block-wrap patterns:
//   <ins><h1>…</h1></ins>
//   <ins><p>…</p></ins>
//   <ins><li>…</li></ins>
// GitHub uses this pattern in MODIFIED files for per-block insertions
// (e.g. a new heading + paragraph appended to CHANGELOG.md). The
// whole-new-file flood that earlier blocked this is prevented in
// content.js (`buildChangesPane` filters ADDED / REMOVED files via
// `pathChangeTypeMap` BEFORE calling `findChangeBlocks`), so the lib
// can be permissive.
test('findChangeBlocks — <ins> wrapping h1+p+p+ul (per-block-wrap pattern) → detects each block', () => {
  const h1 = el('h1', {}, 'New File Title');
  const p1 = el('p', {}, 'first paragraph');
  const p2 = el('p', {}, 'second paragraph');
  const li1 = el('li', {}, 'item 1');
  const li2 = el('li', {}, 'item 2');
  const ul = el('ul', {}, li1, li2);
  const ins = el('ins', {}, h1, p1, p2, ul);
  const root = container(ins);
  const blocks = findChangeBlocks(root);
  // Each reading-unit child gets one stop via ancestor-marker detection.
  // Ordering follows DOM order; the `<ul>` wrapper isn't a reading unit
  // so it contributes its two `<li>` children directly.
  assert.equal(blocks.length, 5);
  assert.equal(blocks[0], h1);
  assert.equal(blocks[1], p1);
  assert.equal(blocks[2], p2);
  assert.equal(blocks[3], li1);
  assert.equal(blocks[4], li2);
});

// The CHANGELOG.md case the user reported: per-block `<ins>` wraps in
// a MODIFIED file. Each new entry is a separate `<ins>` immediately
// wrapping a single reading unit (h2, h3, etc.).
test('findChangeBlocks — multiple sibling <ins><h2></ins> + <ins><h3></ins> wraps → each detected', () => {
  const h2 = el('h2', {}, '1.2.0b3 (Unreleased)');
  const h3 = el('h3', {}, 'Other Changes');
  const root = container(
    el('ins', {}, h2),
    el('ins', {}, h3),
  );
  const blocks = findChangeBlocks(root);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0], h2);
  assert.equal(blocks[1], h3);
});

test('findChangeBlocks — heading change registers (h1..h6)', () => {
  const h1 = el('h1', {}, el('ins', {}, 'New section title'));
  const h3 = el('h3', { classes: ['added'] }, 'Another new heading');
  const root = container(h1, h3);
  const blocks = findChangeBlocks(root);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0], h1);
  assert.equal(blocks[1], h3);
});

test('findChangeBlocks — code block (<pre>) change registers', () => {
  const pre = el('pre', {}, el('ins', {}, 'console.log("added line")'));
  const root = container(pre);
  const blocks = findChangeBlocks(root);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0], pre);
});

test('findChangeBlocks — blockquote change registers', () => {
  const bq = el('blockquote', {}, el('p', {}, el('ins', {}, 'added quote')));
  const root = container(bq);
  const blocks = findChangeBlocks(root);
  // blockquote AND p inside it both match — per-block dedupe picks the outer.
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0], bq);
});

test('findChangeBlocks — injected UI (.grdc-comment-box) excluded', () => {
  const fakeComment = el('div', { classes: ['grdc-comment-box'] },
    el('p', {}, el('ins', {}, 'a previous reviewer wrote this in their comment')));
  const realChange = el('p', {}, el('ins', {}, 'actual doc change'));
  const root = container(fakeComment, realChange);
  const blocks = findChangeBlocks(root);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0], realChange);
});

// ───────────────────────────────────────────────────────────────────────────
// classifyChangeKind
// ───────────────────────────────────────────────────────────────────────────

test('classifyChangeKind — <p> containing only <ins> → added', () => {
  const p = el('p', {}, el('ins', {}, 'new'));
  assert.equal(classifyChangeKind(p), 'added');
});

test('classifyChangeKind — <p> containing only <del> → removed', () => {
  const p = el('p', {}, el('del', {}, 'old'));
  assert.equal(classifyChangeKind(p), 'removed');
});

test('classifyChangeKind — <p> with both <ins> and <del> → mixed', () => {
  const p = el('p', {}, el('del', {}, 'old'), el('ins', {}, 'new'));
  assert.equal(classifyChangeKind(p), 'mixed');
});

test('classifyChangeKind — <li class="added"> self-marker → added', () => {
  const li = el('li', { classes: ['added'] }, 'whole new bullet');
  assert.equal(classifyChangeKind(li), 'added');
});

test('classifyChangeKind — <li class="removed"> self-marker → removed', () => {
  const li = el('li', { classes: ['removed'] }, 'old bullet');
  assert.equal(classifyChangeKind(li), 'removed');
});

test('classifyChangeKind — plain <p> with no markers → null', () => {
  const p = el('p', {}, 'unchanged');
  assert.equal(classifyChangeKind(p), null);
});

test('classifyChangeKind — null / invalid input → null', () => {
  assert.equal(classifyChangeKind(null), null);
  assert.equal(classifyChangeKind({}), null);
});

// ───────────────────────────────────────────────────────────────────────────
// buildChangeSnippet
// ───────────────────────────────────────────────────────────────────────────

test('buildChangeSnippet — short text returned verbatim', () => {
  const p = el('p', {}, 'short paragraph');
  assert.equal(buildChangeSnippet(p), 'short paragraph');
});

test('buildChangeSnippet — long text truncated with ellipsis', () => {
  const p = el('p', {}, 'a'.repeat(200));
  const out = buildChangeSnippet(p, 50);
  assert.equal(out.length, 51); // 50 chars + 1 ellipsis
  assert.ok(out.endsWith('\u2026'));
});

test('buildChangeSnippet — collapses whitespace runs into single space', () => {
  const p = el('p', {}, 'word1   \n   word2     word3');
  assert.equal(buildChangeSnippet(p), 'word1 word2 word3');
});

test('buildChangeSnippet — uses default maxLen 80 when arg omitted', () => {
  const p = el('p', {}, 'x'.repeat(100));
  const out = buildChangeSnippet(p);
  assert.equal(out.length, 81);
  assert.ok(out.endsWith('\u2026'));
});

test('buildChangeSnippet — null input returns empty string', () => {
  assert.equal(buildChangeSnippet(null), '');
  assert.equal(buildChangeSnippet(undefined), '');
});

test('buildChangeSnippet — strips injected UI text (.grdc-thread) from snippet', () => {
  const threadBadge = el('div', { classes: ['grdc-thread'] }, 'this is comment text from a reviewer');
  const p = el('p', {}, 'actual change text ', threadBadge);
  // Snippet should be just the actual change text, not the comment.
  assert.equal(buildChangeSnippet(p), 'actual change text');
});

// ───────────────────────────────────────────────────────────────────────────
// nextChangeIndex
// ───────────────────────────────────────────────────────────────────────────

test('nextChangeIndex — forward wrap from last to first', () => {
  assert.equal(nextChangeIndex(2, +1, 3), 0);
});

test('nextChangeIndex — backward wrap from first to last', () => {
  assert.equal(nextChangeIndex(0, -1, 3), 2);
});

test('nextChangeIndex — delta larger than total reduces modulo', () => {
  assert.equal(nextChangeIndex(0, 7, 3), 1);
  assert.equal(nextChangeIndex(0, -7, 3), 2);
});

test('nextChangeIndex — empty list returns 0', () => {
  assert.equal(nextChangeIndex(5, +1, 0), 0);
  assert.equal(nextChangeIndex(5, +1, null), 0);
});

test('nextChangeIndex — non-finite curr defaults to 0', () => {
  assert.equal(nextChangeIndex(NaN, +1, 5), 1);
  assert.equal(nextChangeIndex(undefined, +2, 5), 2);
});
