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
  // to `maxLen` characters. Defensive against null/undefined input.
  function buildSnippet(body, maxLen) {
    if (body == null) return '';
    const max = Number.isFinite(maxLen) && maxLen > 0 ? maxLen : 80;
    const flat = String(body).replace(/\s+/g, ' ').trim();
    return flat.length > max ? flat.slice(0, max) : flat;
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

  return {
    buildSnippet,
    clampDragPos,
    nextWrappingIndex,
  };
});
