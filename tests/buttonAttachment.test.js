/**
 * Integration tests for `buttonAnchor()` (src/lib/lineMap.js).
 *
 * `buttonAnchor(el)` decides WHERE the `+` button gets injected for a given
 * mapped block. The full `attachCommentButtons()` in content.js lives in
 * the DOM and depends on heavy globals, but the anchor-picking part is
 * pure: given an element, return where the button should land.
 *
 * These tests cover:
 *   • For `<tr>`, the button lands inside the first `<td>` OR `<th>`,
 *     not as a sibling of `<tr>` (the HTML parser hoists block content
 *     out of `<tr>` and the button disappears).
 *   • For everything else, the button lands on the element itself.
 *   • Specifically: YAML frontmatter rows put keys in `<th>` cells, so
 *     `buttonAnchor` must accept `<th>` as a valid first-cell host
 *     (regression for the v1.5.1 "no + on frontmatter rows" bug).
 *
 * For a full end-to-end "+ visible on hover" test we'd need a real
 * browser (Playwright) because CSS `:hover` and computed bounding boxes
 * aren't supported by jsdom. The CSS-coverage tests
 * (`tests/cssCoverage.test.js`) cover the static rule presence; this
 * file covers the DOM-attachment side.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const { buttonAnchor } = require('../src/lib/lineMap.js');

function makeRow(html) {
  const dom = new JSDOM(`<!doctype html><html><body><table><tbody>${html}</tbody></table></body></html>`);
  return dom.window.document.querySelector('tr');
}

test('buttonAnchor(<tr>) returns the first <td> when the row starts with a <td>', () => {
  const tr = makeRow('<tr><td>a</td><td>b</td></tr>');
  const anchor = buttonAnchor(tr);
  assert.equal(anchor.tagName, 'TD');
  assert.equal(anchor.textContent, 'a');
});

test('buttonAnchor(<tr>) returns the first <th> when the row starts with a <th> (YAML frontmatter case)', () => {
  // Regression for v1.5.1: GitHub renders YAML frontmatter as a 2-column
  // table where the KEYS column is `<th>` cells (`<tr><th>feature</th><td>cu-cli</td></tr>`).
  // Before the fix, `buttonAnchor` only looked for `<td>`, so it returned
  // the `<tr>` itself; the button got injected as a sibling of `<tr>` and
  // was silently hoisted out by the HTML parser — no visible `+`.
  const tr = makeRow('<tr><th>feature</th><td>cu-cli</td></tr>');
  const anchor = buttonAnchor(tr);
  assert.equal(anchor.tagName, 'TH', 'must find <th> as a valid host, not skip past it');
  assert.equal(anchor.textContent, 'feature');
});

test('buttonAnchor(<tr>) returns whichever cell comes first (mixed <th>/<td>)', () => {
  // If a future weird table puts a <td> before a <th>, take the <td>.
  // (Querying `td, th` in document order, jsdom + browsers honor that.)
  const tr = makeRow('<tr><td>first</td><th>second</th></tr>');
  const anchor = buttonAnchor(tr);
  assert.equal(anchor.tagName, 'TD');
  assert.equal(anchor.textContent, 'first');
});

test('buttonAnchor(<tr>) returns the <tr> itself when it has no cells (degenerate)', () => {
  // Should never happen in real GitHub rich-diff, but the function must
  // not crash on a malformed row.
  const tr = makeRow('<tr></tr>');
  const anchor = buttonAnchor(tr);
  assert.equal(anchor.tagName, 'TR');
});

test('buttonAnchor() returns the element itself for non-<tr> hosts', () => {
  const dom = new JSDOM('<p>hello</p><h2>section</h2><li>item</li><pre>code</pre>');
  const d = dom.window.document;
  for (const tag of ['p', 'h2', 'li', 'pre']) {
    const el = d.querySelector(tag);
    assert.equal(buttonAnchor(el), el, `<${tag}> hosts the button directly`);
  }
});

test('buttonAnchor() handles null/undefined gracefully (no crash)', () => {
  // Defensive: callers should never pass null, but if they do, returning
  // the falsy value is fine (attachCommentButtons treats it as a no-op).
  assert.equal(buttonAnchor(null), null);
  assert.equal(buttonAnchor(undefined), undefined);
});

// ── End-to-end DOM attachment (mini-simulation of attachCommentButtons) ──
//
// Reproduce the actual injection pattern used in content.js:
//   const host = buttonAnchor(element);
//   host.classList.add('grdc-hoverable');
//   const btn = document.createElement('button');
//   btn.className = 'grdc-comment-btn';
//   host.appendChild(btn);
// and assert the button ends up in the right place AND survives the
// browser-side HTML parser repair that strips invalid `<tr>` children.

function attachButton(document, host) {
  host.classList.add('grdc-hoverable');
  const btn = document.createElement('button');
  btn.className = 'grdc-comment-btn';
  btn.textContent = '+';
  host.appendChild(btn);
  return btn;
}

test('attachment: + button on a frontmatter <tr> ends up INSIDE the first <th>, not stripped by the HTML parser', () => {
  const dom = new JSDOM('<!doctype html><html><body><table><tbody><tr><th>feature</th><td>cu-cli</td></tr></tbody></table></body></html>');
  const d = dom.window.document;
  const tr = d.querySelector('tr');
  const host = buttonAnchor(tr);

  attachButton(d, host);

  // Button must be a child of the <th>, not a sibling of <tr> (which the
  // HTML parser would have silently hoisted out or discarded).
  const btn = d.querySelector('.grdc-comment-btn');
  assert.ok(btn, 'button was created');
  assert.equal(btn.parentElement.tagName, 'TH', 'button is inside the <th>, not <tr> or beyond');
  assert.equal(btn.parentElement.classList.contains('grdc-hoverable'), true, 'host gets the hover class');

  // The button must still be reachable from the <tr> (so existing hover
  // CSS that walks down from `.grdc-hoverable` works).
  assert.ok(tr.contains(btn), 'button is reachable from the <tr> ancestor');
});

test('attachment: + button on a regular <td> ends up INSIDE the <td>', () => {
  const dom = new JSDOM('<!doctype html><html><body><table><tbody><tr><td>cell text</td></tr></tbody></table></body></html>');
  const d = dom.window.document;
  const tr = d.querySelector('tr');
  const host = buttonAnchor(tr);

  attachButton(d, host);

  const btn = d.querySelector('.grdc-comment-btn');
  assert.equal(btn.parentElement.tagName, 'TD');
});

test('attachment: + button on a paragraph host is a direct child of the <p>', () => {
  const dom = new JSDOM('<!doctype html><html><body><p>body paragraph</p></body></html>');
  const d = dom.window.document;
  const p = d.querySelector('p');
  const host = buttonAnchor(p);
  assert.equal(host, p, 'paragraph is its own anchor');
  attachButton(d, host);
  const btn = d.querySelector('.grdc-comment-btn');
  assert.equal(btn.parentElement.tagName, 'P');
});

test('attachment: + button on a <pre> code block lands inside the <pre>', () => {
  const dom = new JSDOM('<!doctype html><html><body><pre><code>x = 1</code></pre></body></html>');
  const d = dom.window.document;
  const pre = d.querySelector('pre');
  const host = buttonAnchor(pre);
  assert.equal(host, pre);
  attachButton(d, host);
  const btn = d.querySelector('.grdc-comment-btn');
  assert.equal(btn.parentElement.tagName, 'PRE');
});
