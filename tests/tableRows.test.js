const test = require('node:test');
const assert = require('node:assert/strict');

const { computeTableRowLine } = require('../src/lib/tableRows.js');

test('computeTableRowLine — canonical example from docs/github/APPROACH.md', () => {
  // Source:
  //   line 40 : | header | header |
  //   line 41 : |--------|--------|
  //   line 42 : | row 0  | ...    |
  //   line 43 : | row 1  | ...    |
  //   line 44 : | row 2  | ...    |
  //   line 45 : | row 3  | ...    |
  const headerLine = 40;
  assert.equal(computeTableRowLine(headerLine, 0), 41); // header itself + 0 + 1 (only meaningful for k>=1)
  assert.equal(computeTableRowLine(headerLine, 1), 42);
  assert.equal(computeTableRowLine(headerLine, 2), 43);
  assert.equal(computeTableRowLine(headerLine, 3), 44);
  assert.equal(computeTableRowLine(headerLine, 4), 45);
});

test('computeTableRowLine — respects non-zero headerRowIndex (header re-discovered later)', () => {
  // If we first match row 2 (rowIndex=2, headerLine cached as the line we matched),
  // later rows shift relative to that index.
  // Caller cached: headerLine=44 at rowIndex=2 → row 3 should land on 45.
  assert.equal(computeTableRowLine(44, 3, 2), 44 + (3 - 2) + 1);
  assert.equal(computeTableRowLine(44, 3, 2), 46);
});

test('computeTableRowLine — default headerRowIndex is 0', () => {
  assert.equal(computeTableRowLine(10, 1), computeTableRowLine(10, 1, 0));
});

test('computeTableRowLine — produces strictly distinct lines across a 4-row table (bug fix)', () => {
  // Bug history: every data row used to collapse to the same line because each
  // row was independently text-matched and would fall back to the header line.
  const headerLine = 100;
  const lines = [1, 2, 3, 4].map((k) => computeTableRowLine(headerLine, k));
  const unique = new Set(lines);
  assert.equal(unique.size, 4, 'each row gets a distinct line number');
  assert.deepEqual(lines, [102, 103, 104, 105]);
});

test('computeTableRowLine — header row itself (rowIndex 0) bumps by 1 — caller must only invoke for k>=1', () => {
  // Document the formula's behavior at the boundary. Callers in buildLineMap
  // skip this call for the header row (they text-match it instead), so the
  // bumped value never reaches fileLineMap. If a future caller forgets, this
  // test catches the off-by-one.
  assert.equal(computeTableRowLine(40, 0), 41,
    'rowIndex 0 returns headerLine + 1 — buildLineMap must NOT call this for header rows');
});

// ── mergeReplacedTables: GitHub's <del>old table</del><ins>new table</ins> ──

const { JSDOM } = require('jsdom');
const { mergeReplacedTables } = require('../src/lib/tableRows.js');
const { findChangeBlocks } = require('../src/lib/changes.js');
const { mapBlocksToSourceLines } = require('../src/lib/lineMap.js');
const textMatch = require('../src/lib/textMatch.js');

function table(rows) {
  const [head, ...body] = rows;
  const tr = (cells, tag) => `<tr>${cells.map((c) => `<${tag}>${c}</${tag}>`).join('')}</tr>`;
  return `<markdown-accessiblity-table><table><thead>${tr(head, 'th')}</thead>` +
    `<tbody>${body.map((r) => tr(r, 'td')).join('')}</tbody></table></markdown-accessiblity-table>`;
}

function replacedTable(oldRows, newRows) {
  const doc = new JSDOM(`<div class="markdown-body"><p>Intro text.</p>` +
    `<del>${table(oldRows)}</del><ins>${table(newRows)}</ins><p>After the table.</p></div>`).window.document;
  return doc.querySelector('.markdown-body');
}

const rowTexts = (root) => Array.from(root.querySelectorAll('tr'), (tr) =>
  (tr.className ? `${tr.className}: ` : '') + Array.from(tr.cells, (c) => c.innerHTML).join(' | '));

test('mergeReplacedTables: one edited cell becomes one changed row, not two whole tables', () => {
  const root = replacedTable(
    [['Item', 'Owner'], ['Alpha', 'Ann'], ['Beta', 'Bill'], ['Gamma', 'Gil']],
    [['Item', 'Owner'], ['Alpha', 'Ann'], ['Beta', 'Bob'], ['Gamma', 'Gil']]);
  assert.equal(mergeReplacedTables(root), 1);
  assert.equal(root.querySelectorAll('table').length, 1);
  assert.equal(root.querySelector('del > *, ins > *'), null, 'no wrapper around a whole table is left');
  assert.deepEqual(rowTexts(root), ['Item | Owner', 'Alpha | Ann', 'Beta | <del>Bill</del><ins>Bob</ins>', 'Gamma | Gil']);
  assert.deepEqual(findChangeBlocks(root).map((b) => b.cells[0].textContent), ['Beta']);
  assert.equal(mergeReplacedTables(root), 0, 'running again changes nothing');
});

test('mergeReplacedTables: added and dropped rows are marked in place', () => {
  const root = replacedTable(
    [['Item', 'Owner'], ['Alpha', 'Ann'], ['Beta', 'Bob'], ['Gamma', 'Gil'], ['Delta', 'Dan']],
    [['Item', 'Owner'], ['Alpha', 'Ann'], ['New', 'Nia'], ['Gamma', 'Gil']]);
  mergeReplacedTables(root);
  // A row whose first cell changed reads as dropped + added, not as an edit.
  assert.deepEqual(rowTexts(root), ['Item | Owner', 'Alpha | Ann',
    'removed: Beta | Bob', 'added: New | Nia', 'Gamma | Gil', 'removed: Delta | Dan']);

  const appended = replacedTable([['A', 'B'], ['1', '2']], [['A', 'B'], ['1', '2'], ['3', '4'], ['5', '6']]);
  mergeReplacedTables(appended);
  assert.deepEqual(rowTexts(appended), ['A | B', '1 | 2', 'added: 3 | 4', 'added: 5 | 6']);

  const dropped = replacedTable([['A', 'B'], ['1', '2'], ['3', '4'], ['5', '6']], [['A', 'B'], ['1', '2']]);
  mergeReplacedTables(dropped);
  assert.deepEqual(rowTexts(dropped), ['A | B', '1 | 2', 'removed: 3 | 4', 'removed: 5 | 6']);
});

test('mergeReplacedTables: leaves a lone <del>/<ins> and non-table pairs alone', () => {
  const doc = new JSDOM('<div class="markdown-body"><del><p>old</p></del><ins><p>new</p></ins>' +
    `<del>${table([['A'], ['1']])}<p>extra</p></del><ins>${table([['A'], ['2']])}</ins></div>`).window.document;
  const root = doc.querySelector('.markdown-body');
  const before = root.innerHTML;
  assert.equal(mergeReplacedTables(root), 0);
  assert.equal(root.innerHTML, before);
});

test('mergeReplacedTables: merged rows still map to their source lines', () => {
  const source = ['Intro text.', '', '| Item | Owner |', '|---|---|', '| Alpha | Ann |',
    '| Beta | Bob |', '| Gamma | Gil |', '', 'After the table.'];
  const root = replacedTable(
    [['Item', 'Owner'], ['Alpha', 'Ann'], ['Gone', 'Gus'], ['Beta', 'Bill'], ['Gamma', 'Gil']],
    [['Item', 'Owner'], ['Alpha', 'Ann'], ['Beta', 'Bob'], ['Gamma', 'Gil']]);
  mergeReplacedTables(root);
  const deps = {
    buildSourceIndex: textMatch.buildSourceIndex,
    findTextInSource: textMatch.findTextInSource,
    cleanRenderedText: textMatch.cleanRenderedText,
    computeTableRowLine,
    findFrontmatterRange: textMatch.findFrontmatterRange,
  };
  const map = mapBlocksToSourceLines(root, source, 'doc.md', deps);
  const lines = Array.from(root.querySelectorAll('tr'), (tr) => map.get(tr) && map.get(tr).line);
  assert.deepEqual(lines, [3, 5, undefined, 6, 7], 'the removed row has no line and does not shift later rows');
  assert.equal(map.get(root.querySelectorAll('p')[1]).line, 9);
});
