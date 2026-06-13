/**
 * Pure helpers for the Changes-nav feature.
 *
 * Walks rich-diff DOM to find blocks that contain `<ins>` / `<del>` /
 * `.added` / `.removed` markers and exposes them as one stop per reading
 * unit (paragraph, list item, table row, code block, heading, blockquote).
 *
 * Loaded in two contexts:
 *   • Extension content script  → exports attached to `window.GRDC.*`
 *   • Node test runner          → exports via `module.exports`
 *
 * DOM-aware but no fetch, no event bindings — safe to unit-test under
 * jsdom-free Node by passing in a parsed Document (which is what
 * tests/changes.test.js does).
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

  // Block-level tags that we treat as "reading units" — the granularity
  // at which a user wants to land when pressing "next change". Lists and
  // tables themselves are NOT here because the user wants to land on the
  // specific changed `<li>` / `<tr>`, not on the wrapper.
  const READING_BLOCK_SELECTOR = 'p, li, tr, pre, h1, h2, h3, h4, h5, h6, blockquote';

  // Selector for the markers GitHub's prose-diff renderer leaves on changed
  // content. Both the semantic tags AND the class markers are checked
  // because GitHub uses both depending on the change type (semantic
  // `<ins>` / `<del>` for inline edits, `class="added"` / `class="removed"`
  // for whole-block deletions like a removed `<li>` that needs to keep its
  // tag for layout reasons).
  const CHANGE_MARKER_SELECTOR = 'ins, del, .added, .removed';

  // Containers we inject ourselves — must be excluded so reading a comment
  // body doesn't register as a "change in the document".
  const INJECTED_UI_SELECTOR =
    '.grdc-comment-box, .grdc-thread, .grdc-sidebar, .grdc-comment-edit, .grdc-reply-box';

  // Find every reading-unit block inside `rootEl` that either IS a change
  // marker or CONTAINS one. Returns elements in DOM order, deduped so a
  // changed parent block subsumes its changed descendant blocks (e.g. a
  // changed `<li>` is one stop even if it wraps a changed `<p>`).
  //
  // Defensive against null / non-element input — returns `[]`.
  function findChangeBlocks(rootEl) {
    if (!rootEl || typeof rootEl.querySelectorAll !== 'function') return [];

    const blocks = rootEl.querySelectorAll(READING_BLOCK_SELECTOR);
    const result = [];

    for (const block of blocks) {
      // Skip blocks inside our own injected UI.
      if (block.closest && block.closest(INJECTED_UI_SELECTOR)) continue;

      // Is the block itself or any descendant a change marker?
      const selfIsMarker = block.matches && block.matches(CHANGE_MARKER_SELECTOR);
      const hasMarker = selfIsMarker || (block.querySelector && block.querySelector(CHANGE_MARKER_SELECTOR) !== null);
      if (!hasMarker) continue;

      // Per-block dedupe: if an earlier (outer) result already contains
      // this block, skip — we want the outermost reading unit, not the
      // inner one. Walking `blocks` in DOM order means ancestors come
      // first, so a simple "result contains this" check is enough.
      let containedInResult = false;
      for (let i = 0; i < result.length; i++) {
        if (result[i] !== block && result[i].contains && result[i].contains(block)) {
          containedInResult = true;
          break;
        }
      }
      if (containedInResult) continue;

      result.push(block);
    }

    return result;
  }

  // Classify a change block's kind by inspecting which markers it carries.
  // Returns 'added' / 'removed' / 'mixed' / null. A block that is both an
  // `<ins>` and contains a `<del>` (or vice versa) is 'mixed' — common
  // for paragraphs that were edited rather than wholly added or removed.
  function classifyChangeKind(blockEl) {
    if (!blockEl || typeof blockEl.matches !== 'function') return null;

    const selfAdded = blockEl.matches('ins, .added');
    const selfRemoved = blockEl.matches('del, s, .removed');

    const innerAdded = blockEl.querySelector && blockEl.querySelector('ins, .added') !== null;
    const innerRemoved = blockEl.querySelector && blockEl.querySelector('del, s, .removed') !== null;

    const hasAdd = selfAdded || innerAdded;
    const hasDel = selfRemoved || innerRemoved;

    if (hasAdd && hasDel) return 'mixed';
    if (hasAdd) return 'added';
    if (hasDel) return 'removed';
    return null;
  }

  // Build a single-line snippet of a change block's visible text, using
  // the same collapse / truncate semantics as `buildSnippet` in sidebar.js.
  // Strips our own injected UI text so a thread badge sitting next to a
  // changed paragraph doesn't pollute the preview. Defaults to maxLen=80.
  function buildChangeSnippet(blockEl, maxLen) {
    if (!blockEl) return '';
    const max = Number.isFinite(maxLen) && maxLen > 0 ? maxLen : 80;

    // Clone so removing injected UI doesn't mutate the live DOM. Using
    // textContent on the clone gives us the visible text without HTML.
    let text;
    if (typeof blockEl.cloneNode === 'function') {
      const clone = blockEl.cloneNode(true);
      if (typeof clone.querySelectorAll === 'function') {
        clone.querySelectorAll(INJECTED_UI_SELECTOR).forEach(n => n.remove());
      }
      text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
    } else {
      text = String(blockEl.textContent || '').replace(/\s+/g, ' ').trim();
    }

    return text.length > max ? text.slice(0, max).trimEnd() + '\u2026' : text;
  }

  // Wrapping index arithmetic for prev/next change cycle in the sidebar.
  // Same shape as nextWrappingIndex in sidebar.js — kept separate so a
  // change to one navigation feel doesn't accidentally affect the other.
  function nextChangeIndex(curr, delta, total) {
    if (!Number.isFinite(total) || total <= 0) return 0;
    const c = Number.isFinite(curr) ? curr : 0;
    const d = Number.isFinite(delta) ? delta : 0;
    return ((c + d) % total + total) % total;
  }

  return {
    findChangeBlocks,
    classifyChangeKind,
    buildChangeSnippet,
    nextChangeIndex,
  };
});
