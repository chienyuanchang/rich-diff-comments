/**
 * Pure code-block / thread-sort helpers.
 *
 * No DOM, no fetch — safe to unit-test in Node.
 *
 * Loaded in two contexts:
 *   • Extension content script  → exports attached to `window.GRDC.*`
 *   • Node test runner          → exports via `module.exports`
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

  // Given the raw markdown source and a target line (1-indexed), find the
  // ``` fenced code-block whose open or close is closest to that line and
  // return its source-line range *inclusive of content only* (so the first
  // line of code, not the opening fence; last line of code, not the closing
  // fence). Returns null if no fence is within a small slack window of the
  // target.
  //
  // Fence detection: a line whose first non-whitespace chars are 3+ backticks
  // or 3+ tildes opens a fence; the matching closing fence is the next line
  // with the same marker char and >= same length. An info string on the
  // opening fence (e.g. ` ```yaml `) is allowed and ignored.
  //
  // Why "closest" not "contains": the text-matcher often anchors a `<pre>`
  // one line before its opening fence (matched against the prior paragraph)
  // or to the fence line itself rather than the first content line. So
  // `targetLine` can be a few lines off in either direction. We accept any
  // fence whose open or close is within ±slack lines of the target.
  function findFenceRangeAroundLine(source, targetLine, slack) {
    if (!source || !targetLine) return null;
    const window = typeof slack === 'number' ? slack : 5;
    const lines = source.split('\n');
    const fenceRe = /^\s*(`{3,}|~{3,})/;
    const fences = []; // [{ openLine, closeLine }] all 1-indexed
    let openIdx = -1;
    let openMarker = '';
    for (let i = 0; i < lines.length; i++) {
      const m = fenceRe.exec(lines[i]);
      if (!m) continue;
      const marker = m[1];
      if (openIdx < 0) {
        openIdx = i;
        openMarker = marker;
      } else if (marker[0] === openMarker[0] && marker.length >= openMarker.length) {
        fences.push({ openLine: openIdx + 1, closeLine: i + 1 });
        openIdx = -1;
        openMarker = '';
      }
    }
    if (!fences.length) return null;
    // 1) Prefer a fence that strictly contains the target.
    for (const f of fences) {
      if (targetLine >= f.openLine && targetLine <= f.closeLine) {
        return { start: f.openLine + 1, end: f.closeLine - 1 };
      }
    }
    // 2) Otherwise pick the fence whose open or close is nearest, within slack.
    let best = null;
    let bestDist = Infinity;
    for (const f of fences) {
      const d = Math.min(Math.abs(f.openLine - targetLine), Math.abs(f.closeLine - targetLine));
      if (d < bestDist) {
        best = f;
        bestDist = d;
      }
    }
    if (best && bestDist <= window) {
      return { start: best.openLine + 1, end: best.closeLine - 1 };
    }
    return null;
  }

  // Sort an array of comment-thread heads (i.e. each item is the FIRST comment
  // in its thread) primary by `startLine ?? line` ascending, secondary by
  // `createdAt` ascending. Stable on equal keys. Returns a NEW array.
  //
  // Used by `renderExistingComments` to render threads under tables / code
  // blocks (where every thread inside the container ends up stacked after
  // the closing tag) in spatial line order, with same-line threads in
  // chronological order.
  function sortThreadHeads(heads) {
    if (!Array.isArray(heads)) return [];
    return heads.slice().sort((a, b) => {
      const aLine = (a && (a.startLine != null ? a.startLine : a.line)) || 0;
      const bLine = (b && (b.startLine != null ? b.startLine : b.line)) || 0;
      if (aLine !== bLine) return aLine - bLine;
      const ta = new Date((a && a.createdAt) || 0).getTime();
      const tb = new Date((b && b.createdAt) || 0).getTime();
      return ta - tb;
    });
  }

  return {
    findFenceRangeAroundLine,
    sortThreadHeads,
  };
});
