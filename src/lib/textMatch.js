/**
 * Pure text-matching helpers: render-block text → source-line resolution.
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

  const INVISIBLE_RE = /[\u00ad\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\ufeff\ufff9-\ufffb]/g;

  function stripMarkdown(text) {
    return text
      .replace(/^#{1,6}\s+/gm, '')              // headings
      .replace(/\*\*([^*]+)\*\*/g, '$1')         // bold
      .replace(/\*([^*]+)\*/g, '$1')             // italic
      .replace(/__([^_]+)__/g, '$1')             // bold
      .replace(/_([^_]+)_/g, '$1')               // italic
      .replace(/~~([^~]+)~~/g, '$1')             // strikethrough
      .replace(/`([^`]+)`/g, '$1')               // inline code
      // Images BEFORE links — link regex would otherwise eat `[alt](url)` from
      // `![alt](url)` and leave an orphan `!`.
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')   // images
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')    // links
      .replace(/^\s*[-*+]\s+/gm, '')             // list markers
      .replace(/^\s*\d+\.\s+/gm, '')             // numbered list markers
      .replace(/^\s*>\s?/gm, '')                 // blockquotes
      .replace(/\|/g, ' ')                       // table pipes
      .replace(/^-{3,}/gm, '');                  // horizontal rules
  }

  function cleanRenderedText(text) {
    return text
      .replace(INVISIBLE_RE, '')
      .replace(/^\+/gm, '')                      // diff addition markers
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  // Diagram-only languages: rendered as SVG, source text is unreachable in DOM.
  // Blank these lines out so the forward-scan matcher doesn't latch onto them.
  const DIAGRAM_LANGS = new Set(['mermaid', 'plantuml', 'dot', 'graphviz']);

  // Find a leading YAML frontmatter block (`---\n...\n---\n` at the very top
  // of the file, possibly preceded by blank lines). Returns the inclusive
  // [start, end] line range (1-based) of the fence + body, **plus** the
  // 1-based source line numbers of every top-level YAML key inside it
  // (`keyLines`). Returns null if no frontmatter is present.
  //
  // GitHub's rich-diff renders the contents as a 2-column <table>, so we
  // have to mask these lines in the source index — otherwise long YAML
  // values (e.g. a `related:` array stringified into one cell) can
  // accidentally text-match body content later in the file (a Related
  // Features table, a Change Log row), pushing `lastOffset` far downstream
  // and breaking the line mapping for every block after frontmatter.
  //
  // `keyLines` is then used by `buildLineMap` in content.js to map each
  // top-level rendered <tr> in the frontmatter table back to its YAML key's
  // source line, so reviewers can post `+` comments on `area:`, `status:`,
  // `related:`, etc. — without giving up the body-line correctness.
  //
  // "Top-level key" = a line that starts at column 0 (no indentation) and
  // matches `<identifier>:` or `<identifier>: <value>`. Indented continuation
  // lines, array items (`- foo`), and YAML comments (`# ...`) are excluded.
  function findFrontmatterRange(lines) {
    let i = 0;
    while (i < lines.length && lines[i].trim() === '') i++;
    if (i >= lines.length || lines[i].trim() !== '---') return null;
    const start = i;
    const keyLines = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '---') {
        return { start: start + 1, end: j + 1, keyLines };
      }
      // Top-level YAML key: starts at column 0 (no indentation), begins with
      // an identifier char, contains `:`. Excludes indented continuations,
      // array items (`- ...`), and comment lines (`# ...`).
      if (/^[A-Za-z_][\w-]*\s*:/.test(lines[j])) {
        keyLines.push(j + 1);
      }
    }
    return null;
  }

  function buildSourceIndex(sourceLines) {
    const normalize = (s) =>
      s.replace(INVISIBLE_RE, '').replace(/\s+/g, ' ').trim().toLowerCase();

    const masked = sourceLines.slice();

    // Mask YAML frontmatter (the leading `---` ... `---` block). GitHub
    // renders this as a table in rich-diff; if we leave its text searchable
    // here, body rows can match into it and vice-versa, breaking the line
    // map for every block after frontmatter.
    const frontmatter = findFrontmatterRange(masked);
    if (frontmatter) {
      for (let i = frontmatter.start - 1; i <= frontmatter.end - 1; i++) {
        masked[i] = '';
      }
    }

    let inFence = false;
    let fenceLang = '';
    let fenceMarker = '';
    for (let i = 0; i < masked.length; i++) {
      const line = masked[i];
      const fenceOpen = line.match(/^(\s*)(```+|~~~+)\s*([\w-]*)/);
      if (!inFence && fenceOpen) {
        inFence = true;
        fenceMarker = fenceOpen[2];
        fenceLang = (fenceOpen[3] || '').toLowerCase();
        continue;
      }
      if (inFence) {
        const closeRe = new RegExp('^\\s*' + fenceMarker.replace(/`/g, '\\`') + '\\s*$');
        if (closeRe.test(line)) {
          inFence = false;
          fenceLang = '';
          continue;
        }
        if (DIAGRAM_LANGS.has(fenceLang)) {
          masked[i] = '';
        }
      }
    }

    const lineOffsets = [];
    let concat = '';
    for (let i = 0; i < masked.length; i++) {
      lineOffsets.push(concat.length);
      concat += normalize(stripMarkdown(masked[i])) + ' ';
    }
    return { concat, lineOffsets };
  }

  function findLineAtOffset(lineOffsets, pos) {
    for (let i = lineOffsets.length - 1; i >= 0; i--) {
      if (lineOffsets[i] <= pos) return i + 1;
    }
    return 1;
  }

  // Logger is injectable so tests can run silent.
  function findTextInSource(index, text, lastOffset, logger) {
    const fallbackLine = () => findLineAtOffset(index.lineOffsets, lastOffset);

    if (!text) return { line: fallbackLine(), offset: lastOffset };

    const needle = cleanRenderedText(text);
    if (!needle) return { line: fallbackLine(), offset: lastOffset };

    const lengths = [80, 50, 30, 20, 12];
    for (const len of lengths) {
      const chunk = needle.slice(0, len);
      if (chunk.length < 5) continue;

      let pos = index.concat.indexOf(chunk, lastOffset);
      if (pos !== -1) {
        return { line: findLineAtOffset(index.lineOffsets, pos), offset: pos };
      }
      pos = index.concat.indexOf(chunk);
      if (pos !== -1) {
        return { line: findLineAtOffset(index.lineOffsets, pos), offset: pos };
      }
    }

    if (logger && typeof logger === 'function') {
      logger('NO MATCH', { needleLen: needle.length, needle: needle.slice(0, 60), lastOffset });
    }
    return { line: fallbackLine(), offset: lastOffset };
  }

  return {
    stripMarkdown,
    cleanRenderedText,
    buildSourceIndex,
    findLineAtOffset,
    findTextInSource,
    findFrontmatterRange,
    DIAGRAM_LANGS,
  };
});
