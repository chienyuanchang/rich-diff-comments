/**
 * Pure helpers for the sidebar Outline tab (v1.1).
 *
 * No DOM, no fetch — safe to unit-test in Node.
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

  // Given a flat list of heading descriptors (in DOM/source order) shaped like
  // `{ id, level, text, line, file }`, return a nested tree where each node
  // is `{ ...heading, children: [] }`. Levels jump arbitrarily — H1 can be
  // followed directly by H3; we still nest H3 under the most recent H1
  // because that matches how readers conceive the document outline (and how
  // GitHub's own TOCs render). The `file` field, if present, is used by the
  // sidebar to label cross-file groups; this builder doesn't interpret it.
  //
  // Defensive against null / non-array input — returns `[]`.
  function buildOutlineTree(headings) {
    if (!Array.isArray(headings) || headings.length === 0) return [];
    const root = [];
    // Stack of currently-open ancestors; each entry holds {level, node}.
    const stack = [];
    for (const raw of headings) {
      if (!raw || !Number.isFinite(raw.level)) continue;
      const node = { ...raw, children: [] };
      // Pop ancestors with level >= this node's level (siblings or shallower).
      while (stack.length && stack[stack.length - 1].level >= node.level) {
        stack.pop();
      }
      if (stack.length === 0) {
        root.push(node);
      } else {
        stack[stack.length - 1].node.children.push(node);
      }
      stack.push({ level: node.level, node });
    }
    return root;
  }

  // Attribute every thread to the heading whose source-line range contains
  // the thread's anchor line. A section's range is from the heading's line
  // to (but not including) the next heading at the same level or shallower
  // — i.e. the section ends where a sibling or ancestor begins. Threads
  // anchored above the first heading are dropped.
  //
  // `headings` is a flat list `[{line, ...}, ...]` (need not be sorted —
  // we sort defensively).
  // `threads` is a flat list `[{line, ...}, ...]`.
  // Returns `Map<heading, count>` keyed by reference, so the caller can
  // look up counts during render without mutating the tree.
  //
  // Within-file scoping: if both `heading.file` and `thread.path` are
  // present, only threads whose `path === heading.file` count toward that
  // heading. Otherwise file is ignored (single-file mode).
  function attributeThreadsToHeadings(headings, threads) {
    const counts = new Map();
    if (!Array.isArray(headings) || headings.length === 0) return counts;
    if (!Array.isArray(threads) || threads.length === 0) {
      headings.forEach(h => counts.set(h, 0));
      return counts;
    }
    headings.forEach(h => counts.set(h, 0));
    for (const t of threads) {
      if (!t || !Number.isFinite(t.line)) continue;
      // Find the deepest heading whose `line <= t.line` (and matching file
      // if both sides specify one). The outline is read top-to-bottom; the
      // last such heading we encounter is the one that owns this thread.
      let owner = null;
      for (const h of headings) {
        if (!h || !Number.isFinite(h.line)) continue;
        if (h.line > t.line) continue;
        if (h.file && t.path && h.file !== t.path) continue;
        owner = h;
      }
      if (owner) counts.set(owner, (counts.get(owner) || 0) + 1);
    }
    return counts;
  }

  // Return the set of heading ids that should be folded when the user
  // chooses "Fold H<N>". Semantics: fold every heading whose level is
  // **exactly** N — leave headings above and below untouched. Pairs with an
  // additive caller (one that only collapses headings in this set and
  // doesn't expand anything else). Pass `Infinity` to get an empty set
  // (caller treats that as "expand all" via a separate path).
  //
  // Each input heading should have an `id` (any unique identifier from the
  // caller's perspective). Defensive against null / invalid input.
  function collapseHeadingsAtLevel(headings, level) {
    if (!Array.isArray(headings)) return new Set();
    if (!Number.isFinite(level)) return new Set();
    const ids = new Set();
    for (const h of headings) {
      if (!h || !Number.isFinite(h.level)) continue;
      if (h.level === level) ids.add(h.id);
    }
    return ids;
  }

  // Stable identity shared by source snapshots and the active file's live DOM
  // headings. A line can contain at most one heading, but level is retained as
  // a defensive disambiguator if a renderer maps an unusual construct there.
  function outlineHeadingKey(file, line, level) {
    const path = typeof file === 'string' ? file : '';
    const sourceLine = Number.isFinite(line) ? line : 0;
    const headingLevel = Number.isFinite(level) ? level : 0;
    return `${path}::${sourceLine}::${headingLevel}`;
  }

  function cleanMarkdownHeadingText(value) {
    return String(value || '')
      .replace(/\s+#+\s*$/, '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/[`*_~]/g, '')
      .replace(/\\([#`*_{}\[\]()<>+\-.!])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim() || '(untitled)';
  }

  /**
   * Extract ATX (`## Title`) and Setext (`Title` + `---`) headings directly
   * from Markdown source. Fenced code is skipped so examples cannot pollute the
   * Outline. Returns DOM-free descriptors in source order.
   */
  function extractMarkdownHeadings(source, file) {
    if (typeof source !== 'string' || source.length === 0) return [];
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    const headings = [];
    let fenceChar = '';
    let fenceLength = 0;

    for (let index = 0; index < lines.length; index++) {
      const raw = lines[index];
      const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(raw);
      if (fence) {
        const marker = fence[1];
        if (!fenceChar) {
          fenceChar = marker[0];
          fenceLength = marker.length;
        } else if (marker[0] === fenceChar && marker.length >= fenceLength) {
          fenceChar = '';
          fenceLength = 0;
        }
        continue;
      }
      if (fenceChar) continue;

      const atx = /^\s{0,3}(#{1,6})(?:\s+|$)(.*)$/.exec(raw);
      if (atx) {
        const level = atx[1].length;
        const line = index + 1;
        headings.push({
          id: outlineHeadingKey(file, line, level),
          key: outlineHeadingKey(file, line, level),
          level,
          text: cleanMarkdownHeadingText(atx[2]),
          line,
          file,
        });
        continue;
      }

      // Setext underline belongs to the preceding non-empty plain-text line.
      const setext = /^\s{0,3}(=+|-+)\s*$/.exec(raw);
      if (!setext || index === 0) continue;
      const title = lines[index - 1];
      if (!title.trim() || /^\s{0,3}(?:[#>]|[-+*]\s|\d+[.)]\s)/.test(title)) continue;
      const level = setext[1][0] === '=' ? 1 : 2;
      const line = index; // preceding title line, 1-based
      headings.push({
        id: outlineHeadingKey(file, line, level),
        key: outlineHeadingKey(file, line, level),
        level,
        text: cleanMarkdownHeadingText(title),
        line,
        file,
      });
    }
    return headings;
  }

  return {
    buildOutlineTree,
    attributeThreadsToHeadings,
    collapseHeadingsAtLevel,
    outlineHeadingKey,
    extractMarkdownHeadings,
  };
});
