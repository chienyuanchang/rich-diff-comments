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

  return { computeTableRowLine };
});
