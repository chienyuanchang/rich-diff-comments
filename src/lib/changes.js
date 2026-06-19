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
  // at which a user wants to land when pressing "next change". Lists are
  // NOT here because the user wants to land on the specific changed
  // `<li>`, not on the wrapper `<ul>` / `<ol>`. Tables ARE here so the
  // narrow ancestor-walker rule below can detect GitHub's `<ins><table>…
  // </table></ins>` whole-replaced-table pattern.
  const READING_BLOCK_SELECTOR = 'p, li, tr, pre, h1, h2, h3, h4, h5, h6, blockquote, table';

  // Selector for the markers GitHub's prose-diff renderer leaves on changed
  // content. Both the semantic tags AND the class markers are checked
  // because GitHub uses both depending on the change type (semantic
  // `<ins>` / `<del>` for inline edits, `class="added"` / `class="removed"`
  // for whole-block deletions like a removed `<li>` that needs to keep its
  // tag for layout reasons).
  const CHANGE_MARKER_SELECTOR = 'ins, del, .added, .removed';

  // File-scope boundary for the table ancestor walker — stops at the
  // file's `.markdown-body` / `.prose-diff` container so it can't climb
  // into a wholesale file-level wrapper.
  const FILE_BOUNDARY_SELECTOR = '.markdown-body, .prose-diff';

  // Containers we inject ourselves — must be excluded so reading a comment
  // body doesn't register as a "change in the document".
  const INJECTED_UI_SELECTOR =
    '.grdc-comment-box, .grdc-thread, .grdc-sidebar, .grdc-comment-edit, .grdc-reply-box';

  // Ancestor-marker walker. Returns true if a parent up the tree
  // (bounded by FILE_BOUNDARY_SELECTOR) matches `selector` (defaults
  // to CHANGE_MARKER_SELECTOR).
  //
  // Used to catch GitHub's per-block-wrap pattern, where each newly
  // added reading unit is rendered as `<ins><h2>…</h2></ins>`,
  // `<ins><p>…</p></ins>`, `<ins><table>…</table></ins>`, etc.
  // The reading block itself has no marker class — the marker is the
  // immediate parent (or near-ancestor).
  //
  // SAFETY: applied uniformly to all reading-unit types. This could
  // misfire on whole-new-file rich-diffs (where one big `<ins>` wraps
  // the entire body, so every block inside has a marker ancestor),
  // BUT content.js's `buildChangesPane` filters ADDED / REMOVED files
  // BEFORE calling `findChangeBlocks` — those files never reach this
  // code. Inside a MODIFIED file, an `<ins>` wrapping many blocks is
  // far less common; the bounded walk + file-level filter together
  // are the safety net.
  function hasAncestorMarker(el, selector) {
    if (!el || typeof el.matches !== 'function') return false;
    const sel = selector || CHANGE_MARKER_SELECTOR;
    let cur = el.parentElement;
    while (cur) {
      if (cur.matches && cur.matches(FILE_BOUNDARY_SELECTOR)) return false;
      if (cur.matches && cur.matches(sel)) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  // Find every reading-unit block inside `rootEl` that either IS a change
  // marker or CONTAINS / is WRAPPED BY one. Returns elements in DOM order,
  // deduped so a changed parent block subsumes its changed descendant
  // blocks (e.g. a changed `<li>` is one stop even if it wraps a changed
  // `<p>`).
  //
  // Three detection paths:
  //   (a) Self marker        — `<li class="added">`, `<tr class="added">`
  //   (b) Descendant marker  — `<p>before <ins>edit</ins> after</p>`
  //   (c) Ancestor marker    — `<ins><h2>…</h2></ins>`, `<ins><p>…</p></ins>`
  //
  // `<table>` is special-cased to skip (b) (descendant) so a table with
  // one changed `<td>` lands as a per-`<tr>` stop, not as a whole-table
  // aggregate. See the in-line comment in `findChangeBlocks` for why.
  //
  // Defensive against null / non-element input — returns `[]`.
  function findChangeBlocks(rootEl) {
    if (!rootEl || typeof rootEl.querySelectorAll !== 'function') return [];

    const blocks = rootEl.querySelectorAll(READING_BLOCK_SELECTOR);
    const result = [];

    for (const block of blocks) {
      // Skip blocks inside our own injected UI.
      if (block.closest && block.closest(INJECTED_UI_SELECTOR)) continue;

      const selfIsMarker = block.matches && block.matches(CHANGE_MARKER_SELECTOR);
      const isTable = block.tagName === 'TABLE';
      // Tables: skip the descendant check so per-`<tr>` stops win for
      // partial-table edits (only one cell changed).
      const hasDescendantMarker = !isTable
        && block.querySelector
        && block.querySelector(CHANGE_MARKER_SELECTOR) !== null;
      // All block types: check ancestor markers (covers GitHub's per-
      // block wrap pattern). Whole-new-file flood is prevented at the
      // content.js level by skipping ADDED / REMOVED files via
      // `pathChangeTypeMap` BEFORE this function is called.
      const ancestorIsMarker = hasAncestorMarker(block);
      const hasMarker = selfIsMarker || hasDescendantMarker || ancestorIsMarker;
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

    // Also walk ancestors so a block inside `<ins>` / `<del>` gets the
    // right `+` / `−` glyph instead of falling through to the default.
    // Same scope as `findChangeBlocks` — see `hasAncestorMarker` for why
    // this is safe (file-level filter in content.js prevents the
    // whole-new-file flood).
    const ancestorAdded = hasAncestorMarker(blockEl, 'ins, .added');
    const ancestorRemoved = hasAncestorMarker(blockEl, 'del, s, .removed');

    const hasAdd = selfAdded || innerAdded || ancestorAdded;
    const hasDel = selfRemoved || innerRemoved || ancestorRemoved;

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
