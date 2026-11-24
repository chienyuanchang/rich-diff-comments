/**
 * Per-file block→line mapping for GitHub rich-diff.
 *
 * Given a rich-diff `<div>` (one file's rendered Markdown), the raw source
 * lines for that file, and the file path, return a Map<Element, {path, line}>
 * with one entry per commentable block (paragraphs, headings, list items,
 * table rows, code blocks).
 *
 * Pure, DOM-walking, no fetches and no module globals — so it's testable
 * with jsdom (or any DOM-shaped fixture) without spinning up a browser.
 *
 * The caller (content.js) orchestrates the per-file containers, the
 * `fetchRawSource()` network calls, and merges the per-file Maps into the
 * page-wide `fileLineMap`. See `docs/github/APPROACH.md` for the matching strategy
 * and `docs/github/DEV_NOTES.md` for the GitHub DOM quirks this function handles.
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

  // ── DOM-shape helpers (used by the matching loop) ─────────────────────

  // Mermaid/PlantUML/DOT/Graphviz blocks render as `<svg>` with no useful
  // prose; their textual code form (if still in the DOM) breaks the
  // forward-scan matcher. We blank out their source lines in
  // `buildSourceIndex` AND skip the blocks themselves here so neither side
  // can latch onto the diagram text.
  function isDiagramBlock(el) {
    if (!el) return false;
    if (el.tagName === 'PRE') {
      const code = el.querySelector('code');
      const cls = (code && code.className ? code.className : '') + ' ' + (el.className || '');
      if (/language-mermaid|language-plantuml|language-dot|language-graphviz/i.test(cls)) return true;
      // Rendered diagram: <pre> contains <svg> with no useful prose
      if (el.querySelector('svg') && !(el.textContent || '').trim()) return true;
    }
    if (el.closest && el.closest('[class*="mermaid" i], .highlight-source-mermaid, pre code.language-mermaid')) return true;
    return false;
  }

  // Detect blocks that sit wholly inside a `<del>` ancestor — GitHub's
  // prose-diff wraps deleted prose blocks the same way it wraps inserted
  // ones in `<ins>`. Such blocks don't exist in the post-change source, so
  // our forward-scan matcher always fails on them and they fall through to
  // the `lastLine + 1` nudge. Worse, the nudge advances `lastLine` once per
  // deleted block, so every subsequent block ends up anchored that many
  // lines too early — cumulative downstream drift on any diff with
  // deletions. We skip these blocks entirely so no `+` is rendered and no
  // source line is consumed. Commenting on deleted lines (which would
  // require posting with `side: "LEFT"` against the BASE file's line
  // number) is a separate feature tracked in FEATURES.md.
  //
  // GitHub's prose-diff also uses a `class="removed"` marker on the block
  // ITSELF (e.g. `<li class="removed">...</li>`) for whole-block deletions,
  // without a `<del>` wrapper. We check both: the semantic `<del>` ancestor
  // AND any `.removed` ancestor (including the block itself).
  function isInDeletedBlock(el) {
    if (!el) return false;
    if (el.tagName === 'DEL' || el.tagName === 'S') return true;
    if (el.classList && el.classList.contains('removed')) return true;
    return !!(el.closest && el.closest('del, s, .removed'));
  }

  // Per-element text estimator — used as a fallback line bump when we have
  // no source to text-match against (no `sourceIndex`). Counts newlines in
  // the element's textContent, minimum 1.
  function estimateLines(element) {
    const text = (element && element.textContent) || '';
    const newlines = (text.match(/\n/g) || []).length;
    return Math.max(1, newlines + 1);
  }

  // A rendered list item can have the same visible text as a heading. If an
  // earlier host-rendered block failed to advance the generic forward matcher,
  // an unconstrained search can therefore resolve the <li> to the heading (or
  // repeatedly nudge it from the previous block). Restrict list-item hits to
  // source lines that actually begin with a Markdown list marker.
  function findListItemInSource(index, sourceLines, text, lastOffset, cleanRenderedText) {
    const fallback = { line: 1, offset: lastOffset, matched: false };
    if (!index || !Array.isArray(index.lineOffsets) || !Array.isArray(sourceLines) ||
        typeof cleanRenderedText !== 'function') return fallback;

    const needle = cleanRenderedText(text || '');
    if (!needle) return fallback;

    const markerRe = /^\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;
    const lengths = Array.from(new Set([80, 50, 30, 20, 12, needle.length]))
      .map((length) => Math.min(length, needle.length))
      .filter((length) => length > 0)
      .sort((a, b) => b - a);

    for (const length of lengths) {
      const chunk = needle.slice(0, length);
      let pos = index.concat.indexOf(chunk, Math.max(0, lastOffset + 1));
      while (pos !== -1) {
        let lineIndex = index.lineOffsets.length - 1;
        while (lineIndex > 0 && index.lineOffsets[lineIndex] > pos) lineIndex--;
        if (markerRe.test(sourceLines[lineIndex] || '')) {
          return { line: lineIndex + 1, offset: pos, matched: true };
        }
        pos = index.concat.indexOf(chunk, pos + 1);
      }
    }

    return fallback;
  }

  // ── The matching loop ─────────────────────────────────────────────────

  /**
   * Build a per-file Map<Element, {path, line}> mapping each commentable
   * block in `richDiff` to its source line.
   *
   * @param {Element} richDiff  Rendered markdown body element.
   * @param {string[] | null} sourceLines  Raw markdown source split on '\n', or
   *     null if we couldn't fetch it (matcher falls back to a per-block size
   *     estimator).
   * @param {string} path  File path (relative to repo root). Stored on each
   *     entry's value so the caller knows which file a block belongs to
   *     after Maps are merged.
   * @param {object} [deps]  Injected pure helpers (so tests don't have to
   *     load the full extension surface). Required keys:
   *       - buildSourceIndex(lines) → { concat, lineOffsets }
   *       - findTextInSource(index, text, lastOffset) → { line, offset }
  *       - cleanRenderedText(text) → normalized string
   *       - computeTableRowLine(headerLine, rowIndex, hri) → number
   *       - findFrontmatterRange(lines) → { start, end, keyLines } | null
   * @param {(...args) => void} [log]  Optional logger (defaults to no-op for
   *     tests; production passes `console.log.bind(console)`).
   * @returns {Map<Element, {path:string, line:number}>}
   */
  function mapBlocksToSourceLines(richDiff, sourceLines, path, deps, log) {
    if (!richDiff) return new Map();
    const map = new Map();
    const noop = function () {};
    const _log = typeof log === 'function' ? log : noop;
    const {
      buildSourceIndex,
      findTextInSource,
      cleanRenderedText,
      computeTableRowLine,
      findFrontmatterRange,
    } = deps || {};

    const sourceIndex = sourceLines && buildSourceIndex ? buildSourceIndex(sourceLines) : null;
    const maxLine = sourceLines ? sourceLines.length : Number.MAX_SAFE_INTEGER;

    // Detect the rendered YAML frontmatter table (if any). See docs/github/APPROACH.md
    // → Edge cases that bit us → YAML frontmatter for the full diagnosis.
    const frontmatter = sourceLines && findFrontmatterRange
      ? findFrontmatterRange(sourceLines)
      : null;
    // Never the old copy of an edited frontmatter that is still in <del>.
    const frontmatterTable = frontmatter
      ? Array.from(richDiff.querySelectorAll('table')).find((table) => !isInDeletedBlock(table)) || null
      : null;
    const frontmatterRowToLine = new Map();
    if (frontmatterTable && frontmatter && frontmatter.keyLines.length > 0) {
      const bodyRows = frontmatterTable.querySelectorAll(':scope > tbody > tr');
      const allRows = frontmatterTable.querySelectorAll(':scope > thead > tr, :scope > tbody > tr');
      if (bodyRows.length === frontmatter.keyLines.length) {
        bodyRows.forEach((tr, idx) => {
          frontmatterRowToLine.set(tr, frontmatter.keyLines[idx]);
        });
        _log(`[GRDC] Frontmatter ${path}: 2-col layout, ${bodyRows.length} rows mapped to YAML key lines`);
      } else if (allRows.length >= 1) {
        allRows.forEach((tr) => {
          frontmatterRowToLine.set(tr, frontmatter.keyLines[0]);
        });
        _log(`[GRDC] Frontmatter ${path}: ${allRows.length} rendered rows vs ${frontmatter.keyLines.length} YAML keys — pinning all rows to line ${frontmatter.keyLines[0]} (first key)`);
      } else {
        _log(`[GRDC] Frontmatter ${path}: detected a leading --- block but no rendered <tr> rows in the first <table>; no + buttons added in frontmatter range`);
      }
    }

    const blocks = richDiff.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, tr, pre');

    let fallbackLine = 1;
    // `lastOffset` starts at -1 (not 0) so that the very first block's
    // match — which legitimately lands at offset 0 when the file starts
    // with the matched text (e.g. an H1 with no preceding frontmatter or
    // blank lines) — passes the `result.offset > lastOffset` "did we move
    // forward?" check. With `lastOffset = 0`, an H1 at source line 1 would
    // be anchored at line 2 because `0 > 0` is false → nudge to lastLine+1.
    let lastOffset = -1;
    let lastLine = 1;
    let matchCount = 0;
    const tableHeaderLine = new Map();

    function blockTextWithoutInjectedUi(block) {
      const clone = block.cloneNode(true);
      clone.querySelectorAll(
        '.grdc-comment-box, .grdc-thread, .grdc-sidebar, .grdc-comment-edit, .grdc-reply-box, ' +
        '.grdc-table-thread-marker, .grdc-code-line-thread-marker, ' +
        '.adrc-editor, .adrc-thread-badge, .adrc-thread-panel, .adrc-sidebar, ' +
        '.adrc-comment-btn, .adrc-collapse-toggle'
      ).forEach((element) => element.remove());
      if (clone.tagName === 'LI') {
        const nested = clone.querySelector('ul, ol');
        if (nested) nested.remove();
      }
      if (clone.tagName === 'TR') {
        // An edited cell holds `<del>old</del><ins>new</ins>`; only the new text is in the source.
        clone.querySelectorAll('del').forEach((element) => element.remove());
        const cells = clone.querySelectorAll('td, th');
        if (cells.length) return Array.from(cells).map((cell) => cell.textContent).join(' ');
      }
      return clone.textContent;
    }

    blocks.forEach((block) => {
      if (isDiagramBlock(block)) return;
      if (isInDeletedBlock(block)) return;
      if (block.classList.contains('grdc-thread-row')) return;
      // Frontmatter handling: top-level YAML rows get mapped to their
      // source line. Nested rows / inner blocks are skipped (and crucially
      // do NOT advance `lastOffset`) so their text can't poison the body
      // matcher.
      if (frontmatterTable && frontmatterTable.contains(block)) {
        if (frontmatterRowToLine.has(block)) {
          map.set(block, { path, line: frontmatterRowToLine.get(block) });
        }
        return;
      }
      // Skip <p> inside <li> — parent <li> already gets a button.
      if (block.tagName === 'P' && block.closest('li')) return;

      const rawText = blockTextWithoutInjectedUi(block);

      let line;
      // Special handling for table rows: only text-match the header row,
      // then compute subsequent rows arithmetically (account for the
      // |---| divider that exists in source but not in DOM).
      if (block.tagName === 'TR' && sourceIndex) {
        const table = block.closest('table');
        // Removed rows and our thread rows are not in the source.
        const allRows = table ? Array.from(table.querySelectorAll('tr:not(.removed):not(.grdc-thread-row)')) : [block];
        const rowIndex = allRows.indexOf(block);

        if (rowIndex === 0 || !tableHeaderLine.has(table)) {
          const result = findTextInSource(sourceIndex, rawText, lastOffset);
          if (result.offset > lastOffset) {
            line = result.line;
            lastOffset = result.offset;
            lastLine = line;
            matchCount++;
            if (table) tableHeaderLine.set(table, { headerLine: line, rowIndex });
          } else {
            lastLine = Math.min(lastLine + 1, maxLine);
            line = lastLine;
          }
        } else {
          const cached = tableHeaderLine.get(table);
          line = Math.min(computeTableRowLine(cached.headerLine, rowIndex, cached.rowIndex), maxLine);
          lastLine = line;
        }
        map.set(block, { path, line });
        return;
      }

      if (sourceIndex) {
        const listResult = block.tagName === 'LI'
          ? findListItemInSource(sourceIndex, sourceLines, rawText, lastOffset, cleanRenderedText)
          : null;
        // Never feed an unmatched <li> back into the generic prose matcher:
        // the same text can legitimately belong to a heading. An unmatched
        // constrained result instead follows the normal one-line fallback.
        const result = listResult || findTextInSource(sourceIndex, rawText, lastOffset);
        if (result.offset > lastOffset) {
          line = result.line;
          lastOffset = result.offset;
          lastLine = line;
          matchCount++;
        } else {
          // No match: advance one line past the previous block so consecutive
          // unmatched rows don't all collapse to the same line. Cap at the
          // source file's actual line count so we never produce impossible
          // line numbers (which would 422 with "Line could not be resolved").
          lastLine = Math.min(lastLine + 1, maxLine);
          line = lastLine;
        }
      } else {
        line = fallbackLine;
        fallbackLine += estimateLines(block);
      }

      map.set(block, { path, line });
    });

    _log(`[GRDC] Mapped ${map.size} elements for ${path} (source-matched: ${!!sourceLines}, text-hits: ${matchCount})`);
    return map;
  }

  // For elements that aren't valid parents/siblings for our injected nodes
  // (notably <tr>), return a sensible anchor for the `+` button host.
  // Buttons go INSIDE the first <td> OR <th> of a <tr> — both are valid
  // descendants. YAML frontmatter rows put keys in `<th>` cells (the first
  // cell of the row), so we accept whichever comes first.
  function buttonAnchor(element) {
    if (!element) return element;
    if (element.tagName === 'TR') {
      return element.querySelector('td, th') || element;
    }
    return element;
  }

  return {
    isDiagramBlock,
    isInDeletedBlock,
    estimateLines,
    findListItemInSource,
    mapBlocksToSourceLines,
    buttonAnchor,
  };
});
