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

  function buildSourceIndex(sourceLines) {
    const normalize = (s) =>
      s.replace(INVISIBLE_RE, '').replace(/\s+/g, ' ').trim().toLowerCase();

    const masked = sourceLines.slice();
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
    DIAGRAM_LANGS,
  };
});
