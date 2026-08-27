/**
 * Pure helpers for the threads-sidebar feature.
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

  // Build a single-line snippet from a (possibly multi-line) comment body
  // for display in a sidebar card. Collapses whitespace, trims, truncates
  // to `maxLen` characters. Appends an ellipsis when truncation actually
  // dropped content (so the user knows there's more). Defensive against
  // null/undefined input.
  function buildSnippet(body, maxLen) {
    if (body == null) return '';
    const max = Number.isFinite(maxLen) && maxLen > 0 ? maxLen : 80;
    const flat = String(body).replace(/\s+/g, ' ').trim();
    return flat.length > max ? flat.slice(0, max).trimEnd() + '\u2026' : flat;
  }

  // Clamp a candidate sidebar position so at least `margin` pixels stay
  // visible inside the viewport. `rect` is the sidebar's bounding rect at
  // drag start; `mouseDelta` is `{dx, dy}` movement since start; `viewport`
  // is `{width, height}`. Returns `{left, top}` clamped to the visible area.
  //
  // The clamp envelope is asymmetric on x to allow the sidebar to slide
  // mostly off-screen left (so a narrow viewport can still see the right
  // edge with its resize handle), but anchored to keep at least `margin`px
  // of the LEFT edge inside the viewport's right side.
  function clampDragPos(rect, mouseDelta, viewport, margin) {
    const m = Number.isFinite(margin) && margin > 0 ? margin : 80;
    const dx = mouseDelta?.dx || 0;
    const dy = mouseDelta?.dy || 0;
    let left = (rect?.left || 0) + dx;
    let top = (rect?.top || 0) + dy;
    const width = rect?.width || 0;
    const minLeft = m - width;
    const maxLeft = (viewport?.width || 0) - m;
    const minTop = 0;
    const maxTop = (viewport?.height || 0) - 40;
    if (left < minLeft) left = minLeft;
    if (left > maxLeft) left = maxLeft;
    if (top < minTop) top = minTop;
    if (top > maxTop) top = maxTop;
    return { left, top };
  }

  // Modulo arithmetic for the prev/next thread cycle in the sidebar. Wraps
  // around at both ends. Returns 0 for an empty list. Negative deltas walk
  // backward; positive deltas walk forward; deltas larger than `total` are
  // reduced modulo `total`.
  function nextWrappingIndex(curr, delta, total) {
    if (!Number.isFinite(total) || total <= 0) return 0;
    const c = Number.isFinite(curr) ? curr : 0;
    const d = Number.isFinite(delta) ? delta : 0;
    return ((c + d) % total + total) % total;
  }

  // Sanity-floor a sidebar size against minimums. Returns `null` for any
  // dimension that is non-finite or falls below its floor — the caller
  // skips persisting / applying that dimension so a once-tiny stored size
  // can't permanently shrink the sidebar across reloads. Used on both
  // read (load from localStorage) and write (ResizeObserver callback).
  function clampSize(width, height, minWidth, minHeight) {
    const okW = Number.isFinite(width) && Number.isFinite(minWidth) && width >= minWidth;
    const okH = Number.isFinite(height) && Number.isFinite(minHeight) && height >= minHeight;
    return {
      width: okW ? width : null,
      height: okH ? height : null,
    };
  }

  // True for paths whose extension marks them as Markdown. Used by the
  // "render all .md as rich-diff" sidebar action to filter the per-file
  // toggles it should click. Accepts `.md` / `.markdown` (case-insensitive)
  // and tolerates missing / non-string input (returns false). Strips any
  // query / hash suffix the caller might pass in by mistake.
  function isMarkdownPath(p) {
    if (typeof p !== 'string' || p.length === 0) return false;
    const cleaned = p.split(/[?#]/)[0];
    return /\.(md|markdown)$/i.test(cleaned);
  }

  // Format a 1-based source-line anchor for compact sidebar display.
  // Single-line: "line 12". Multi-line: "lines 12–18". Invalid starts
  // return an empty string; invalid/earlier ends fall back to single-line.
  function formatLineRange(startLine, endLine) {
    if (!Number.isFinite(startLine) || startLine <= 0) return '';
    if (Number.isFinite(endLine) && endLine > startLine) {
      return `lines ${startLine}\u2013${endLine}`;
    }
    return `line ${startLine}`;
  }

  // Apply the sidebar's unresolved-only filter without mutating the input.
  // Items use a normalized boolean `resolved` property so this helper is
  // platform-neutral (GitHub/ADO adapters choose how statuses map to it).
  function filterSidebarThreadItems(items, unresolvedOnly) {
    if (!Array.isArray(items)) return [];
    if (!unresolvedOnly) return items.slice();
    return items.filter((item) => item && item.resolved !== true);
  }

  // Stable product ordering for PR-wide thread cards. An optional orderedPaths
  // array lets a platform follow its native file navigator rather than API
  // response order. Existing callers retain the original behavior:
  //   1. current file first (when currentPath is supplied),
  //   2. explicit file order, or paths alphabetically when none is supplied,
  //   3. line ascending,
  //   4. creation time ascending,
  //   5. original order as the stable final tiebreaker.
  // Returns a NEW array and tolerates partial / malformed items.
  function sortSidebarThreadItems(items, currentPath, orderedPaths) {
    if (!Array.isArray(items)) return [];
    const pathRanks = new Map();
    (Array.isArray(orderedPaths) ? orderedPaths : []).forEach((path, index) => {
      if (typeof path === 'string' && !pathRanks.has(path)) pathRanks.set(path, index);
    });
    return items
      .map((item, index) => ({ item, index }))
      .sort((a, b) => {
        const ap = typeof a.item?.path === 'string' ? a.item.path : '';
        const bp = typeof b.item?.path === 'string' ? b.item.path : '';
        const ac = !!currentPath && ap === currentPath;
        const bc = !!currentPath && bp === currentPath;
        if (ac !== bc) return ac ? -1 : 1;
        const ar = pathRanks.has(ap) ? pathRanks.get(ap) : Number.MAX_SAFE_INTEGER;
        const br = pathRanks.has(bp) ? pathRanks.get(bp) : Number.MAX_SAFE_INTEGER;
        const pathOrder = ar !== br ? ar - br : ap.localeCompare(bp);
        if (pathOrder !== 0) return pathOrder;
        const al = Number.isFinite(a.item?.line) ? a.item.line : Number.MAX_SAFE_INTEGER;
        const bl = Number.isFinite(b.item?.line) ? b.item.line : Number.MAX_SAFE_INTEGER;
        if (al !== bl) return al - bl;
        const at = new Date(a.item?.createdAt || 0).getTime();
        const bt = new Date(b.item?.createdAt || 0).getTime();
        if (at !== bt) return at - bt;
        return a.index - b.index;
      })
      .map((entry) => entry.item);
  }

  return {
    buildSnippet,
    clampDragPos,
    nextWrappingIndex,
    clampSize,
    isMarkdownPath,
    formatLineRange,
    filterSidebarThreadItems,
    sortSidebarThreadItems,
  };
});
