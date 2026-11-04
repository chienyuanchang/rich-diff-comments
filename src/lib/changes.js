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
    '.grdc-comment-box, .grdc-thread, .grdc-sidebar, .grdc-comment-edit, .grdc-reply-box, ' +
    '.adrc-editor, .adrc-thread-badge, .adrc-thread-panel, .adrc-sidebar, ' +
    '.adrc-comment-btn, .adrc-collapse-toggle';

  const REMOVAL_SELECTOR = 'del, .removed';
  const REVIEW_UI_SELECTOR = INJECTED_UI_SELECTOR +
    ', .grdc-existing-thread, .grdc-comment-btn, .grdc-collapse-toggle, ' +
    '.grdc-table-thread-marker, .grdc-code-line-thread-marker';

  function findRemovedContent(rootEl) {
    if (!rootEl || typeof rootEl.querySelectorAll !== 'function') return [];
    const markers = Array.from(rootEl.querySelectorAll(REMOVAL_SELECTOR))
      .filter((element) => !element.closest(REVIEW_UI_SELECTOR));
    const removed = new Set(markers);

    function hasRetainedContent(node) {
      if (node.nodeType === 3) return !!node.textContent.trim();
      if (node.nodeType !== 1 || node.matches(REMOVAL_SELECTOR + ', ' + REVIEW_UI_SELECTOR)) return false;
      if (node.matches('ins, .added, img, svg, video, audio, canvas, iframe, hr, input, math')) return true;
      return Array.from(node.childNodes).some(hasRetainedContent);
    }

    // Hide emptied reading units as well as their deletion markers, but keep
    // table cells in place so retained columns cannot shift sideways.
    for (const block of rootEl.querySelectorAll(READING_BLOCK_SELECTOR + ', ul, ol, thead, tbody')) {
      if (block.closest(REVIEW_UI_SELECTOR) || !block.querySelector(REMOVAL_SELECTOR)) continue;
      if (!hasRetainedContent(block)) removed.add(block);
    }
    return Array.from(removed);
  }

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

  // Normalize source into logical lines. Ignore the conventional final
  // newline so "text" and "text\n" don't create a phantom Changes card;
  // preserve any additional trailing blank lines as real content.
  function splitSourceLines(source) {
    if (source == null || source === '') return [];
    const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    return lines;
  }

  // Myers shortest-edit-script over arrays of lines. Produces a stream of
  // `{type: 'equal'|'insert'|'delete', text}` operations. Memory grows with
  // edit distance rather than N*M. For a wholesale rewrite beyond the safety
  // limit, degrade to one replace-all hunk instead of retaining a huge trace.
  function diffLineOperations(baseLines, headLines, maxEditDistance) {
    const a = Array.isArray(baseLines) ? baseLines : [];
    const b = Array.isArray(headLines) ? headLines : [];
    if (a.length === 0) return b.map((text) => ({ type: 'insert', text }));
    if (b.length === 0) return a.map((text) => ({ type: 'delete', text }));

    const max = a.length + b.length;
    const limit = Number.isFinite(maxEditDistance) && maxEditDistance > 0
      ? Math.min(max, maxEditDistance)
      : Math.min(max, 2000);
    let v = new Map([[1, 0]]);
    const trace = [];

    for (let d = 0; d <= limit; d++) {
      const next = new Map();
      for (let k = -d; k <= d; k += 2) {
        const fromDelete = v.has(k - 1) ? v.get(k - 1) : -Infinity;
        const fromInsert = v.has(k + 1) ? v.get(k + 1) : -Infinity;
        let x;
        if (k === -d || (k !== d && fromDelete < fromInsert)) {
          x = Number.isFinite(fromInsert) ? fromInsert : 0;
        } else {
          x = (Number.isFinite(fromDelete) ? fromDelete : 0) + 1;
        }
        let y = x - k;
        while (x < a.length && y < b.length && a[x] === b[y]) {
          x++;
          y++;
        }
        next.set(k, x);
        if (x >= a.length && y >= b.length) {
          trace.push(next);
          return backtrackLineOperations(trace, a, b);
        }
      }
      trace.push(next);
      v = next;
    }

    // Safety fallback for an extremely large rewrite: still accurate at the
    // hunk level (everything changed), just not a minimal edit script.
    return [
      ...a.map((text) => ({ type: 'delete', text })),
      ...b.map((text) => ({ type: 'insert', text })),
    ];
  }

  function backtrackLineOperations(trace, baseLines, headLines) {
    let x = baseLines.length;
    let y = headLines.length;
    const reversed = [];

    for (let d = trace.length - 1; d > 0; d--) {
      const previous = trace[d - 1];
      const k = x - y;
      const left = previous.has(k - 1) ? previous.get(k - 1) : -Infinity;
      const down = previous.has(k + 1) ? previous.get(k + 1) : -Infinity;
      const previousK = k === -d || (k !== d && left < down) ? k + 1 : k - 1;
      const previousX = previous.has(previousK) ? previous.get(previousK) : 0;
      const previousY = previousX - previousK;

      while (x > previousX && y > previousY) {
        reversed.push({ type: 'equal', text: baseLines[x - 1] });
        x--;
        y--;
      }
      if (x === previousX) {
        reversed.push({ type: 'insert', text: headLines[y - 1] });
        y--;
      } else {
        reversed.push({ type: 'delete', text: baseLines[x - 1] });
        x--;
      }
    }

    while (x > 0 && y > 0) {
      reversed.push({ type: 'equal', text: baseLines[x - 1] });
      x--;
      y--;
    }
    while (x > 0) reversed.push({ type: 'delete', text: baseLines[--x] });
    while (y > 0) reversed.push({ type: 'insert', text: headLines[--y] });
    return reversed.reverse();
  }

  // Compare full base/head sources and return consecutive non-equal operations
  // as 1-based hunks. An empty side is represented by end=start-1. `kind` is
  // added / removed / mixed (replacement). Line arrays are retained for card
  // snippets, especially deletion-only hunks absent from rendered head DOM.
  function diffLineHunks(baseSource, headSource, options) {
    const baseLines = splitSourceLines(baseSource);
    const headLines = splitSourceLines(headSource);
    // Markdown trailing spaces are often introduced or removed by editors and
    // are not visible in Preview. Treat them as equal for hunk boundaries so
    // an unchanged heading/TODO line with a trailing-space-only edit cannot
    // absorb a following pure-added section and turn its highlight modified.
    // Leading whitespace remains significant for Markdown structure.
    const comparableBaseLines = baseLines.map((line) => line.replace(/[ \t]+$/g, ''));
    const comparableHeadLines = headLines.map((line) => line.replace(/[ \t]+$/g, ''));
    const operations = diffLineOperations(
      comparableBaseLines,
      comparableHeadLines,
      options && options.maxEditDistance
    );
    const hunks = [];
    let baseLine = 1;
    let headLine = 1;
    let current = null;

    function flush() {
      if (!current) return;
      current.baseEnd = current.baseStart + current.baseLines.length - 1;
      current.headEnd = current.headStart + current.headLines.length - 1;
      current.kind = current.baseLines.length > 0 && current.headLines.length > 0
        ? 'mixed'
        : current.headLines.length > 0 ? 'added' : 'removed';
      hunks.push(current);
      current = null;
    }

    operations.forEach((operation) => {
      if (operation.type === 'equal') {
        flush();
        baseLine++;
        headLine++;
        return;
      }
      if (!current) {
        current = { baseStart: baseLine, headStart: headLine, baseLines: [], headLines: [] };
      }
      if (operation.type === 'delete') {
        current.baseLines.push(operation.text);
        baseLine++;
      } else if (operation.type === 'insert') {
        current.headLines.push(operation.text);
        headLine++;
      }
    });
    flush();

    // Myers can split one visual replacement when a blank separator is equal
    // on both sides. For example, replacing a paragraph plus its list may be
    // emitted as one mixed hunk followed by an added list. Join only those
    // mixed/add-or-remove continuations across blank-only context so Preview
    // presents the whole replacement as modified, without combining two
    // independent paragraph edits.
    const merged = [];
    hunks.forEach((hunk) => {
      const previous = merged[merged.length - 1];
      if (previous) {
        const baseGap = hunk.baseStart - previous.baseEnd - 1;
        const headGap = hunk.headStart - previous.headEnd - 1;
        const pairKinds = new Set([previous.kind, hunk.kind]);
        const isReplacementContinuation =
          (pairKinds.has('mixed') && (pairKinds.has('added') || pairKinds.has('removed'))) ||
          (pairKinds.has('added') && pairKinds.has('removed'));
        const blankOnlyGap = baseGap > 0 && baseGap === headGap &&
          baseLines.slice(previous.baseEnd, hunk.baseStart - 1).every((line) => !String(line).trim()) &&
          headLines.slice(previous.headEnd, hunk.headStart - 1).every((line) => !String(line).trim());
        if (isReplacementContinuation && blankOnlyGap) {
          const baseContext = baseLines.slice(previous.baseEnd, hunk.baseStart - 1);
          const headContext = headLines.slice(previous.headEnd, hunk.headStart - 1);
          previous.baseLines.push(...baseContext, ...hunk.baseLines);
          previous.headLines.push(...headContext, ...hunk.headLines);
          previous.baseEnd = hunk.baseEnd;
          previous.headEnd = hunk.headEnd;
          previous.kind = previous.baseLines.length && previous.headLines.length ? 'mixed'
            : previous.headLines.length ? 'added' : 'removed';
          return;
        }
      }
      merged.push(hunk);
    });
    return merged;
  }

  function mergeChangeKind(a, b) {
    if (!a) return b;
    if (!b || a === b) return a;
    return 'mixed';
  }

  /**
   * Map source diff hunks onto rendered reading blocks.
   *
   * `mappedBlocks`: [{ block, line, endLine? }] — one entry per rendered
   * block. Missing endLine is inferred as the line before the next block (or
   * headLineCount at EOF), allowing a changed interior line in a multi-line
   * paragraph to land on that paragraph. Explicit code-block ranges win.
   *
   * Deletion-only hunks have no head lines; they anchor at the next rendered
   * context line, or the prior block at EOF. Returns one merged stop per block
   * in source order without mutating inputs.
   */
  function mapDiffHunksToBlocks(hunks, mappedBlocks, headLineCount) {
    if (!Array.isArray(hunks) || !Array.isArray(mappedBlocks)) return [];
    const maxHead = Number.isFinite(headLineCount) && headLineCount > 0 ? headLineCount : 1;
    const entries = mappedBlocks
      .map((entry, index) => ({
        block: entry && entry.block,
        line: entry && entry.line,
        explicitEnd: entry && entry.endLine,
        index,
      }))
      .filter((entry) => entry.block && Number.isFinite(entry.line) && entry.line > 0)
      .sort((a, b) => a.line - b.line || a.index - b.index);
    if (entries.length === 0) return [];

    entries.forEach((entry, index) => {
      let nextLine = null;
      for (let i = index + 1; i < entries.length; i++) {
        if (entries[i].line > entry.line) {
          nextLine = entries[i].line;
          break;
        }
      }
      entry.endLine = Number.isFinite(entry.explicitEnd) && entry.explicitEnd >= entry.line
        ? entry.explicitEnd
        : Math.max(entry.line, nextLine == null ? maxHead : nextLine - 1);
      // ATX headings occupy one source line. Never let an unmatched rendered
      // block beneath a heading make that unchanged heading inherit the
      // following paragraph's inferred source range.
      if (/^H[1-6]$/.test(String(entry.block.tagName || ''))) {
        entry.endLine = entry.line;
      }
    });

    const byBlock = new Map();
    hunks.forEach((hunk) => {
      if (!hunk || !hunk.kind) return;
      const hasHead = Array.isArray(hunk.headLines) && hunk.headLines.length > 0;
      const start = hasHead
        ? hunk.headStart
        : Math.max(1, Math.min(maxHead, Number(hunk.headStart) || 1));
      const end = hasHead ? hunk.headEnd : start;
      let matching = entries.filter((entry) => entry.line <= end && entry.endLine >= start);
      if (matching.length === 0 && !hasHead) {
        const after = entries.find((entry) => entry.line >= start);
        matching = [after || entries[entries.length - 1]].filter(Boolean);
      }

      matching.forEach((entry) => {
        const stopLine = hasHead ? Math.max(start, entry.line) : start;
        const stopEnd = hasHead ? Math.min(end, entry.endLine) : stopLine;
        const existing = byBlock.get(entry.block);
        if (existing) {
          existing.line = Math.min(existing.line, stopLine);
          existing.endLine = Math.max(existing.endLine, stopEnd);
          existing.kind = mergeChangeKind(existing.kind, hunk.kind);
          existing.baseLines.push(...(hunk.baseLines || []));
          existing.headLines.push(...(hunk.headLines || []));
          existing.hunks.push(hunk);
        } else {
          byBlock.set(entry.block, {
            block: entry.block,
            line: stopLine,
            endLine: stopEnd,
            kind: hunk.kind,
            baseLines: (hunk.baseLines || []).slice(),
            headLines: (hunk.headLines || []).slice(),
            hunks: [hunk],
            _order: entry.index,
          });
        }
      });
    });

    return Array.from(byBlock.values())
      .sort((a, b) => a.line - b.line || a._order - b._order)
      .map((stop) => {
        delete stop._order;
        return stop;
      });
  }

  /**
   * Expand DOM-free source-hunk stops into the rendered blocks that should
   * receive persistent Preview highlighting. Sidebar navigation deliberately
   * keeps one card per source hunk, but one hunk can cover several rendered
   * blocks (for example a newly added heading, paragraphs, and list items).
   * Mixed replacement context wins if overlapping hunks reach the same block.
   */
  function mapChangeStopsToHighlightBlocks(stops, mappedBlocks, headLineCount) {
    if (!Array.isArray(stops) || !Array.isArray(mappedBlocks)) return [];
    const byBlock = new Map();
    stops.forEach((stop) => {
      if (!stop || stop.stopType !== 'hunk' ||
          (stop.kind !== 'added' && stop.kind !== 'mixed') || !stop.hunk) return;
      const headLines = Array.isArray(stop.hunk.headLines) ? stop.hunk.headLines : [];
      const expectedHeadLineCount = Math.max(0, stop.hunk.headEnd - stop.hunk.headStart + 1);
      // Legacy restored snapshots compressed all head lines to one sentinel,
      // losing blank-boundary information. Do not risk tinting neighboring
      // unchanged blocks; a fresh catalog will replace this transient state.
      if (headLines.length !== expectedHeadLineCount) {
        return;
      }
      let firstContent = 0;
      let lastContent = headLines.length - 1;
      while (firstContent < headLines.length && !String(headLines[firstContent]).trim()) firstContent++;
      while (lastContent >= firstContent && !String(headLines[lastContent]).trim()) lastContent--;
      // Blank lines belong to Markdown structure rather than a visible block.
      // Trim them before overlap mapping so an insertion beginning between two
      // blocks does not tint the preceding unchanged block whose inferred range
      // includes that blank separator.
      if (firstContent >= headLines.length) return;
      const highlightHunk = {
        ...stop.hunk,
        headStart: stop.hunk.headStart + firstContent,
        headEnd: stop.hunk.headStart + lastContent,
        headLines: headLines.slice(firstContent, lastContent + 1),
      };
      const mapped = mapDiffHunksToBlocks([highlightHunk], mappedBlocks, headLineCount);
      mapped.forEach((entry) => {
        if (!entry || !entry.block) return;
        const kind = entry.kind === 'mixed' ? 'mixed' : stop.kind;
        const prior = byBlock.get(entry.block);
        if (kind === 'mixed' || !prior) byBlock.set(entry.block, kind);
      });
    });
    return Array.from(byBlock, ([block, kind]) => ({ block, kind }));
  }

  // Build a compact source snippet for a DOM-free PR-wide card. Prefer the
  // changed head text (what the reviewer sees), falling back to removed base
  // text. This deliberately keeps Markdown punctuation: it often carries
  // useful context (`##`, `- [ ]`, fenced language) and mirrors source view.
  function buildSourceChangeSnippet(lines, maxLen) {
    const max = Number.isFinite(maxLen) && maxLen > 0 ? maxLen : 90;
    const flat = (Array.isArray(lines) ? lines : [])
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    return flat.length > max ? flat.slice(0, max).trimEnd() + '\u2026' : flat;
  }

  /**
   * Convert one normalized PR file change plus optional source contents into
   * stable, DOM-free sidebar stops.
   *
   * `change`: `{type, path, oldPath, changeId, changeTrackingId}` where type
   * is add/edit/delete/rename. The ADO adapter owns that normalization.
   * `options.error` represents a source-fetch failure; lifecycle summaries
   * remain useful without source, while an edit becomes one UNAVAILABLE card.
   *
   * Added/deleted files intentionally emit one summary rather than one stop
   * per source line. A rename always emits its summary and adds hunk stops only
   * when content also changed. Modified files emit one card per source hunk.
   */
  function buildPrChangeStops(change, baseSource, headSource, options) {
    if (!change || typeof change.path !== 'string' || !change.path) return [];
    const type = change.type === 'add' || change.type === 'delete' || change.type === 'rename'
      ? change.type
      : 'edit';
    const path = change.path;
    const oldPath = change.oldPath || path;
    const identity = change.changeTrackingId != null
      ? String(change.changeTrackingId)
      : change.changeId != null ? String(change.changeId) : `${oldPath}->${path}`;
    const error = options && options.error
      ? String(options.error.message || options.error).slice(0, 200)
      : '';

    function summary(kind, lifecycle, label, source, detail) {
      const sourceLines = splitSourceLines(source);
      return {
        key: `${identity}:summary:${lifecycle}`,
        stopType: 'summary',
        lifecycle,
        kind,
        label,
        path,
        oldPath,
        line: lifecycle === 'delete' ? null : 1,
        endLine: lifecycle === 'delete' ? null : 1,
        snippet: buildSourceChangeSnippet(sourceLines, 90) || detail || '(empty file)',
        error: error || null,
      };
    }

    if (type === 'add') {
      return [summary('added', 'add', 'NEW FILE', headSource, error ? 'Source preview unavailable' : '')];
    }
    if (type === 'delete') {
      return [summary('removed', 'delete', 'DELETED', baseSource, error ? 'Source preview unavailable' : '')];
    }

    const stops = [];
    if (type === 'rename') {
      stops.push(summary(
        'renamed',
        'rename',
        'RENAMED',
        '',
        `${oldPath} \u2192 ${path}`
      ));
    }

    if (error) {
      stops.push({
        key: `${identity}:unavailable`,
        stopType: 'unavailable',
        lifecycle: type,
        kind: 'unavailable',
        label: 'UNAVAILABLE',
        path,
        oldPath,
        line: 1,
        endLine: 1,
        snippet: error,
        error,
      });
      return stops;
    }

    const hunks = diffLineHunks(baseSource || '', headSource || '');
    const headLineCount = splitSourceLines(headSource).length;
    hunks.forEach((hunk, index) => {
      const hasHead = Array.isArray(hunk.headLines) && hunk.headLines.length > 0;
      const line = hasHead
        ? Math.max(1, Number(hunk.headStart) || 1)
        : Math.max(1, Math.min(headLineCount || 1, Number(hunk.headStart) || 1));
      const endLine = hasHead
        ? Math.max(line, Number(hunk.headEnd) || line)
        : line;
      const snippetLines = hunk.kind === 'removed' ? hunk.baseLines : hunk.headLines;
      stops.push({
        key: `${identity}:hunk:${index}:${hunk.baseStart}:${hunk.headStart}`,
        stopType: 'hunk',
        lifecycle: type,
        kind: hunk.kind,
        label: null,
        path,
        oldPath,
        line,
        endLine,
        snippet: buildSourceChangeSnippet(snippetLines, 90) || '(No visible text)',
        baseLines: (hunk.baseLines || []).slice(),
        headLines: (hunk.headLines || []).slice(),
        hunk,
        error: null,
      });
    });
    return stops;
  }

  return {
    findChangeBlocks,
    findRemovedContent,
    classifyChangeKind,
    buildChangeSnippet,
    nextChangeIndex,
    splitSourceLines,
    diffLineHunks,
    mapDiffHunksToBlocks,
    mapChangeStopsToHighlightBlocks,
    buildSourceChangeSnippet,
    buildPrChangeStops,
  };
});
