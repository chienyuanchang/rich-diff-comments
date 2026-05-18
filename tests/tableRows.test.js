const test = require('node:test');
const assert = require('node:assert/strict');

const { computeTableRowLine } = require('../src/lib/tableRows.js');

test('computeTableRowLine — canonical example from APPROACH.md', () => {
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
