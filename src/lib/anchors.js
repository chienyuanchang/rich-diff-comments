/**
 * Pure helpers for TOC / heading-anchor jumps in rich-diff.
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

  // Slugify a heading's text the way GitHub's blob-view auto-anchor generator
  // does: lowercase, collapse internal whitespace, replace whitespace with
  // hyphens, drop anything that isn't `[a-z0-9-_]`. Result matches the slug
  // used in URL fragments like `#change-log` for a heading "Change Log".
  //
  // Verified against real headings on github.com blob pages:
  //   "Change Log"             → "change-log"
  //   "Phase 1: Foundation"    → "phase-1-foundation"
  //   "Architecture Diagram"   → "architecture-diagram"
  //   "Won't do (trade-offs)"  → "wont-do-trade-offs"
  //   "🚧 Planned"             → "-planned"   (emoji dropped, leading space → -)
  //
  // Defensive against null / non-string input — returns empty string.
  function slugifyHeading(text) {
    if (text == null) return '';
    return String(text)
      .toLowerCase()
      // Replace any whitespace run with a single hyphen.
      .replace(/\s+/g, '-')
      // Drop any character that isn't an ASCII letter, digit, hyphen, or
      // underscore. This matches GitHub's renderer behavior — accented
      // characters, emoji, punctuation are all stripped.
      .replace(/[^a-z0-9\-_]/g, '');
  }

  return { slugifyHeading };
});
