/**
 * Pure arithmetic for mapping rendered table rows to source lines.
 *
 * Markdown source for a table:
 *   line N    : | header | header |
 *   line N+1  : |--------|--------|     ← divider, NOT a <tr> in rendered DOM
 *   line N+2  : | row 0  | row 0  |
 *   line N+3  : | row 1  | row 1  |
 *
 * So DOM <tr> at index k (counting from header at headerRowIndex=0)
 * maps to source line:  headerLine + (k - headerRowIndex) + 1
 *
 * The `+1` accounts for the `|---|` divider line which is in source but not DOM.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  } else {
    root.GRDC = root.GRDC || {};
    Object.assign(root.GRDC, api);
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  function computeTableRowLine(headerLine, rowIndex, headerRowIndex) {
    const hri = headerRowIndex == null ? 0 : headerRowIndex;
    return headerLine + (rowIndex - hri) + 1;
  }

  // The table a `<del>` / `<ins>` wraps, when it wraps nothing else
  // (GitHub puts it inside a `<markdown-accessiblity-table>` element). It may
  // hold nested tables, e.g. a YAML frontmatter value that is a list.
  function soleTable(wrapper) {
    const table = wrapper.querySelector('table');
    return table && wrapper.textContent.trim() === table.textContent.trim() ? table : null;
  }

  const rowText = (tr) => Array.from(tr.cells, (cell) => cell.textContent.trim()).join('\u0001');
  const firstCell = (tr) => (tr.cells[0] ? tr.cells[0].textContent.trim() : '');

  // Longest common subsequence of keys → [oldIndex, newIndex] pairs.
  function matchingRows(oldKeys, newKeys) {
    const n = oldKeys.length;
    const m = newKeys.length;
    const len = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        len[i][j] = oldKeys[i] === newKeys[j] ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1]);
      }
    }
    const pairs = [];
    for (let i = 0, j = 0; i < n && j < m;) {
      if (oldKeys[i] === newKeys[j]) pairs.push([i++, j++]);
      else if (len[i + 1][j] >= len[i][j + 1]) i++;
      else j++;
    }
    return pairs;
  }

  // Align old and new rows in order: identical rows first, then rows that keep
  // their first cell (usually the row's name) between them. Returns
  // [{ old, new }] where either side may be missing (dropped / added row).
  function alignRows(oldRows, newRows, keys) {
    if (!keys.length) {
      return oldRows.map((row) => ({ old: row })).concat(newRows.map((row) => ({ new: row })));
    }
    const [key, ...rest] = keys;
    const pairs = matchingRows(oldRows.map(key), newRows.map(key));
    pairs.push([oldRows.length, newRows.length]);
    const steps = [];
    let i = 0;
    let j = 0;
    pairs.forEach(([oi, nj]) => {
      steps.push(...alignRows(oldRows.slice(i, oi), newRows.slice(j, nj), rest));
      if (oi < oldRows.length) steps.push({ old: oldRows[oi], new: newRows[nj] });
      i = oi + 1;
      j = nj + 1;
    });
    return steps;
  }

  function wrapChildren(doc, tag, cell) {
    const wrapper = doc.createElement(tag);
    wrapper.append(...cell.childNodes);
    return wrapper;
  }

  function markEditedCells(oldRow, newRow) {
    const doc = newRow.ownerDocument;
    Array.from(newRow.cells).forEach((cell, index) => {
      const old = oldRow.cells[index];
      if (old.textContent.trim() === cell.textContent.trim()) return;
      const added = cell.textContent.trim() ? wrapChildren(doc, 'ins', cell) : null;
      if (old.textContent.trim()) cell.append(wrapChildren(doc, 'del', old));
      if (added) cell.append(added);
    });
  }

  /**
   * GitHub's rich diff shows an edited table as the whole old table inside
   * `<del>` followed by the whole new table inside `<ins>`, so one changed
   * cell marks every row as changed. Fold each such pair into the new table:
   * unchanged rows stay plain, edited cells read `<del>old</del><ins>new</ins>`,
   * new rows get `.added`, and dropped rows return in place as `.removed`.
   * Returns how many tables were merged.
   */
  function mergeReplacedTables(root) {
    let merged = 0;
    Array.from(root.querySelectorAll('del')).forEach((del) => {
      const ins = del.nextElementSibling;
      if (!ins || ins.tagName !== 'INS') return;
      const oldTable = soleTable(del);
      const newTable = soleTable(ins);
      if (!oldTable || !newTable) return;

      const newRows = Array.from(newTable.rows);
      let pending = []; // dropped rows waiting for the next kept row
      alignRows(Array.from(oldTable.rows), newRows, [rowText, firstCell]).forEach((step) => {
        if (!step.new) {
          step.old.classList.add('removed');
          pending.push(step.old);
          return;
        }
        if (step.old && step.old.cells.length === step.new.cells.length) {
          markEditedCells(step.old, step.new);
        } else if (step.old) {
          step.old.classList.add('removed');
          pending.push(step.old);
          step.new.classList.add('added');
        } else {
          step.new.classList.add('added');
        }
        step.new.before(...pending);
        pending = [];
      });
      newRows[newRows.length - 1].after(...pending);

      del.remove();
      ins.replaceWith(...ins.childNodes);
      merged++;
    });
    return merged;
  }

  return { computeTableRowLine, mergeReplacedTables };
});
