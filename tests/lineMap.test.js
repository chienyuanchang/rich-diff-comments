/**
 * Tests for the per-file block→line mapping (src/lib/lineMap.js).
 *
 * Uses jsdom to build synthetic rich-diff HTML fixtures, then asserts that
 * `mapBlocksToSourceLines()` returns the correct source-line for each
 * commentable block. These tests are the regression net for every bug
 * we've ever shipped in this code path:
 *
 *   • YAML frontmatter poisons body line numbers (fixed in 1.5.1)
 *   • Mermaid diagrams shift downstream blocks   (fixed in 1.0.1)
 *   • Deleted blocks drift downstream lines       (fixed in 1.0.1)
 *   • Table rows collapse to the same line        (fixed in 1.0.0)
 *
 * Each fixture below is small enough that a maintainer can read it and see
 * the failure mode without spinning up a browser.
 *
 * Run with:  npm test    (Node's built-in test runner; jsdom is a devDep)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const textMatch = require('../src/lib/textMatch.js');
const tableRows = require('../src/lib/tableRows.js');
const { mapBlocksToSourceLines, isDiagramBlock, isInDeletedBlock } = require('../src/lib/lineMap.js');

const deps = {
  buildSourceIndex: textMatch.buildSourceIndex,
  findTextInSource: textMatch.findTextInSource,
  computeTableRowLine: tableRows.computeTableRowLine,
  findFrontmatterRange: textMatch.findFrontmatterRange,
};

// Build a jsdom-rendered `<div class="markdown-body">` from a body-HTML
// string. Helper avoids repeating boilerplate in every test.
function richDiff(html) {
  const dom = new JSDOM(`<!doctype html><html><body><div class="markdown-body">${html}</div></body></html>`);
  return dom.window.document.querySelector('.markdown-body');
}

// Convenience: get the source line for the Nth element matching `selector`.
function lineOf(map, root, selector, index) {
  const els = root.querySelectorAll(selector);
  const el = els[index || 0];
  if (!el) throw new Error(`No element matched '${selector}'[${index || 0}]`);
  const entry = map.get(el);
  if (!entry) throw new Error(`Element '${selector}'[${index || 0}] is not in the line map`);
  return entry.line;
}

// ── Baseline: a plain Markdown body, no frontmatter / diagrams / deletions ──

test('plain markdown body: each block anchors to its real source line', () => {
  const source = [
    '# Title',           // 1
    '',                  // 2
    'First paragraph.',  // 3
    '',                  // 4
    '## Section A',      // 5
    '',                  // 6
    'Body of section A.',// 7
  ];
  const rd = richDiff(`
    <h1>Title</h1>
    <p>First paragraph.</p>
    <h2>Section A</h2>
    <p>Body of section A.</p>
  `);
  const map = mapBlocksToSourceLines(rd, source, 'doc.md', deps);
  assert.equal(lineOf(map, rd, 'h1'), 1);
  assert.equal(lineOf(map, rd, 'p', 0), 3);
  assert.equal(lineOf(map, rd, 'h2'), 5);
  assert.equal(lineOf(map, rd, 'p', 1), 7);
});

// ── Regression: YAML frontmatter (the 1.5.1 bug) ────────────────────────

test('frontmatter regression: H1 below `---` block anchors to its real line, not the bottom of the file', () => {
  // Mirrors local-only/138_line_issue.md in miniature. Without the
  // frontmatter fix, the long `related:` value substring-matched body text
  // downstream and pushed the H1 from line 6 to the file's last line.
  const source = [
    '---',                                                              // 1
    'feature: cu-cli',                                                  // 2
    'related: markitdown-integration similar-to MarkItDown CLI option', // 3
    '---',                                                              // 4
    '',                                                                 // 5
    '# Title',                                                          // 6
    '',                                                                 // 7
    '| Feature | Note |',                                               // 8
    '|---------|------|',                                               // 9
    '| markitdown-integration | similar-to MarkItDown CLI option |',    // 10
  ];
  // GitHub renders frontmatter as a 2-col <table> at the top of the rich-diff.
  // The first <table> is always the frontmatter table when frontmatter is present.
  const rd = richDiff(`
    <table>
      <tbody>
        <tr><th>feature</th><td>cu-cli</td></tr>
        <tr><th>related</th><td>markitdown-integration similar-to MarkItDown CLI option</td></tr>
      </tbody>
    </table>
    <h1>Title</h1>
    <table>
      <thead><tr><th>Feature</th><th>Note</th></tr></thead>
      <tbody><tr><td>markitdown-integration</td><td>similar-to MarkItDown CLI option</td></tr></tbody>
    </table>
  `);
  const map = mapBlocksToSourceLines(rd, source, 'doc.md', deps);
  assert.equal(lineOf(map, rd, 'h1'), 6, 'H1 must anchor to source line 6, not be dragged to file end');
});

test('frontmatter top-level keys (`<th>` cells) get + buttons on their key source lines', () => {
  const source = [
    '---',                // 1
    'feature: cu-cli',    // 2 ← key
    'status: proposal',   // 3 ← key
    'area: integration',  // 4 ← key
    '---',                // 5
    '',
    '# Title',
  ];
  const rd = richDiff(`
    <table>
      <tbody>
        <tr><th>feature</th><td>cu-cli</td></tr>
        <tr><th>status</th><td>proposal</td></tr>
        <tr><th>area</th><td>integration</td></tr>
      </tbody>
    </table>
    <h1>Title</h1>
  `);
  const map = mapBlocksToSourceLines(rd, source, 'doc.md', deps);
  assert.equal(lineOf(map, rd, 'tr', 0), 2);
  assert.equal(lineOf(map, rd, 'tr', 1), 3);
  assert.equal(lineOf(map, rd, 'tr', 2), 4);
});

test('frontmatter nested rows (e.g. inside a `related:` array cell) do NOT poison body line numbers', () => {
  // The pathological case: frontmatter renders as a 2-col table whose
  // `related:` cell contains an *inner* <table> with rows whose text
  // overlaps body content. Inner rows must be skipped silently — neither
  // assigned a line nor allowed to advance `lastOffset`.
  const source = [
    '---',                                          // 1
    'feature: cu-cli',                              // 2
    'related:',                                     // 3
    '  - feature: markitdown-integration',          // 4
    '    note: MarkItDown CLI option',              // 5
    '---',                                          // 6
    '',                                             // 7
    '# Title',                                      // 8
    '',                                             // 9
    'Body paragraph mentioning markitdown-integration MarkItDown CLI option.', // 10
  ];
  const rd = richDiff(`
    <table>
      <tbody>
        <tr><th>feature</th><td>cu-cli</td></tr>
        <tr>
          <th>related</th>
          <td>
            <table>
              <thead><tr><th>feature</th><th>note</th></tr></thead>
              <tbody>
                <tr><td>markitdown-integration</td><td>MarkItDown CLI option</td></tr>
              </tbody>
            </table>
          </td>
        </tr>
      </tbody>
    </table>
    <h1>Title</h1>
    <p>Body paragraph mentioning markitdown-integration MarkItDown CLI option.</p>
  `);
  const map = mapBlocksToSourceLines(rd, source, 'doc.md', deps);
  assert.equal(lineOf(map, rd, 'h1'), 8, 'H1 anchors to its real line, not dragged downstream by nested cell text');
  assert.equal(lineOf(map, rd, 'p'), 10, 'body paragraph anchors to its real line, not collapsed onto a frontmatter row');
  // Nested rows inside the frontmatter table must NOT be in the map
  // (silent skip — no `+` button, no line consumed).
  const outerRows = rd.querySelectorAll('table:first-of-type > tbody > tr');
  assert.equal(map.has(outerRows[0]), true, 'top-level frontmatter rows ARE in the map');
  const innerRows = rd.querySelectorAll('table table tr');
  for (const tr of innerRows) {
    assert.equal(map.has(tr), false, 'nested frontmatter rows are NOT in the map');
  }
});

test('frontmatter wide layout (single <thead> row of keys + single <tbody> row of values) falls back to pinning all rows to first key line', () => {
  const source = [
    '---',                                  // 1
    'feature: cu-cli',                      // 2 ← first key
    'status: proposal',                     // 3
    '---',                                  // 4
    '',
    '# Title',
  ];
  // "Wide" layout: one header row with all keys, one body row with all values.
  // Body-row count (1) != YAML key count (2), so the matcher pins both
  // rendered rows to line 2 (the first key).
  const rd = richDiff(`
    <table>
      <thead><tr><th>feature</th><th>status</th></tr></thead>
      <tbody><tr><td>cu-cli</td><td>proposal</td></tr></tbody>
    </table>
    <h1>Title</h1>
  `);
  const map = mapBlocksToSourceLines(rd, source, 'doc.md', deps);
  // Both <tr>s pinned to line 2 — at least one + somewhere in the frontmatter range.
  assert.equal(lineOf(map, rd, 'thead tr'), 2);
  assert.equal(lineOf(map, rd, 'tbody tr'), 2);
  // Body still anchors correctly.
  assert.equal(lineOf(map, rd, 'h1'), 6);
});

// ── Regression: mermaid (the 1.0.1 bug) ──────────────────────────────────

test('mermaid block: the rendered <svg> does NOT shift downstream block line numbers', () => {
  const source = [
    '# Title',                                                          // 1
    '',                                                                 // 2
    'Intro paragraph.',                                                 // 3
    '',                                                                 // 4
    '```mermaid',                                                       // 5
    'graph TD',                                                         // 6
    '    A --> B',                                                      // 7
    '```',                                                              // 8
    '',                                                                 // 9
    'After diagram paragraph that contains the word graph for distraction.', // 10
  ];
  // Rendered: the mermaid fence becomes an <svg> with no useful prose.
  const rd = richDiff(`
    <h1>Title</h1>
    <p>Intro paragraph.</p>
    <pre><svg><g></g></svg></pre>
    <p>After diagram paragraph that contains the word graph for distraction.</p>
  `);
  const map = mapBlocksToSourceLines(rd, source, 'doc.md', deps);
  assert.equal(lineOf(map, rd, 'h1'), 1);
  assert.equal(lineOf(map, rd, 'p', 0), 3);
  // The <pre><svg></pre> is recognized as a diagram block and silently skipped.
  assert.equal(map.has(rd.querySelector('pre')), false, 'diagram <pre> is not in the map');
  assert.equal(lineOf(map, rd, 'p', 1), 10, 'after-diagram paragraph anchors to its real line');
});

// ── Regression: deleted blocks (the 1.0.1 bug) ──────────────────────────

test('blocks inside <del> are skipped: downstream line numbers are NOT shifted by the deletion count', () => {
  const source = [
    '# Title',     // 1
    '',            // 2
    'Kept para.',  // 3
    '',            // 4
    'After para.', // 5
  ];
  // GitHub's prose-diff wraps deleted content in <del>. Those blocks
  // don't exist in the post-change source — including them would advance
  // `lastLine` once per deleted block and drift everything downstream.
  const rd = richDiff(`
    <h1>Title</h1>
    <p>Kept para.</p>
    <del><p>Deleted para 1.</p></del>
    <del><p>Deleted para 2.</p></del>
    <p>After para.</p>
  `);
  const map = mapBlocksToSourceLines(rd, source, 'doc.md', deps);
  assert.equal(lineOf(map, rd, 'p', 0), 3);
  // Deleted paragraphs are NOT in the map.
  const deletedPs = rd.querySelectorAll('del p');
  for (const p of deletedPs) {
    assert.equal(map.has(p), false, 'paragraphs inside <del> are not in the map');
  }
  assert.equal(lineOf(map, rd, 'p:not(del p)', 1), 5, 'after-paragraph anchors to its real line, not shifted by deletion count');
});

test('blocks with class="removed" are skipped the same way as <del>', () => {
  const source = [
    '# Title',     // 1
    '',            // 2
    'Kept para.',  // 3
    '',            // 4
    'After para.', // 5
  ];
  const rd = richDiff(`
    <h1>Title</h1>
    <p>Kept para.</p>
    <p class="removed">Deleted via class marker.</p>
    <p>After para.</p>
  `);
  const map = mapBlocksToSourceLines(rd, source, 'doc.md', deps);
  assert.equal(lineOf(map, rd, 'p', 0), 3);
  assert.equal(map.has(rd.querySelector('p.removed')), false);
  assert.equal(lineOf(map, rd, 'p:not(.removed)', 1), 5);
});

// ── Regression: table rows (the 1.0.0 design) ────────────────────────────

test('regular markdown table: header text-matched, subsequent rows computed arithmetically (header + rowIndex + 1)', () => {
  const source = [
    '# Title',                  // 1
    '',                         // 2
    '| Date | Note |',          // 3 ← header
    '|------|------|',          // 4 (the divider, exists in source NOT in DOM)
    '| 2026 | a    |',          // 5 ← row 0
    '| 2027 | b    |',          // 6 ← row 1
  ];
  const rd = richDiff(`
    <h1>Title</h1>
    <table>
      <thead><tr><th>Date</th><th>Note</th></tr></thead>
      <tbody>
        <tr><td>2026</td><td>a</td></tr>
        <tr><td>2027</td><td>b</td></tr>
      </tbody>
    </table>
  `);
  const map = mapBlocksToSourceLines(rd, source, 'doc.md', deps);
  // Header row text-matched at source line 3.
  assert.equal(lineOf(map, rd, 'thead tr'), 3);
  // Body rows: header (3) + rowIndex (1, 2) + 1-for-divider = 5, 6.
  assert.equal(lineOf(map, rd, 'tbody tr', 0), 5);
  assert.equal(lineOf(map, rd, 'tbody tr', 1), 6);
});

// ── Helper unit tests ────────────────────────────────────────────────────

test('isDiagramBlock detects mermaid <pre> by class and by rendered <svg> content', () => {
  const { window: w } = new JSDOM('<div></div>');
  const d = w.document;
  const byClass = d.createElement('pre');
  const code = d.createElement('code');
  code.className = 'language-mermaid';
  byClass.appendChild(code);
  assert.equal(isDiagramBlock(byClass), true);

  const bySvg = d.createElement('pre');
  bySvg.innerHTML = '<svg></svg>';
  assert.equal(isDiagramBlock(bySvg), true);

  const normalPre = d.createElement('pre');
  normalPre.textContent = 'just some code';
  assert.equal(isDiagramBlock(normalPre), false);
});

test('isInDeletedBlock catches <del>, <s>, and class="removed" hosts and ancestors', () => {
  const { window: w } = new JSDOM(`
    <del><p id="in-del">x</p></del>
    <s><p id="in-s">x</p></s>
    <ul><li id="self-removed" class="removed">x</li></ul>
    <ul><li><span id="in-removed-ancestor"></span></li></ul>
    <p id="plain">x</p>
  `);
  const d = w.document;
  assert.equal(isInDeletedBlock(d.getElementById('in-del')), true);
  assert.equal(isInDeletedBlock(d.getElementById('in-s')), true);
  assert.equal(isInDeletedBlock(d.getElementById('self-removed')), true);
  assert.equal(isInDeletedBlock(d.getElementById('plain')), false);
});

test('mapBlocksToSourceLines on null richDiff returns an empty map', () => {
  const map = mapBlocksToSourceLines(null, [], 'doc.md', deps);
  assert.equal(map.size, 0);
});

test('mapBlocksToSourceLines with no sourceLines falls back to the estimateLines counter', () => {
  // No source → no source-match attempted, line numbers are estimator-driven.
  // Useful so files we couldn't fetch the source for don't crash.
  const rd = richDiff('<p>A</p><p>B</p><p>C</p>');
  const map = mapBlocksToSourceLines(rd, null, 'doc.md', deps);
  assert.equal(map.size, 3);
  // Each paragraph is 1 line in the estimator, so they walk 1, 2, 3.
  assert.equal(lineOf(map, rd, 'p', 0), 1);
  assert.equal(lineOf(map, rd, 'p', 1), 2);
  assert.equal(lineOf(map, rd, 'p', 2), 3);
});
