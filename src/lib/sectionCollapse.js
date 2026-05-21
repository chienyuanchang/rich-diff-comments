/**
 * Pure helpers for the heading-section collapse feature.
 *
 * `collectSiblingsToHide` and `collectSectionRoots` walk the rendered
 * markdown DOM around a heading element to determine which following
 * elements belong to that heading's section. The walkers handle the two
 * shapes GitHub's prose-diff produces:
 *
 *   • Flat: the heading and its body elements share a parent. The walker
 *     follows direct `nextElementSibling` chain until it hits another
 *     heading at level <= ours.
 *
 *   • Hunk-wrapped: GitHub wraps later hunks (containing the next
 *     same-level heading) inside a sibling container. We peek into each
 *     sibling's subtree for a descendant boundary heading and stop there
 *     so we don't pull content from the next section into the fold.
 *
 *     Additionally, if no direct siblings carry content (the case when
 *     our own injected thread badge is the only direct sibling), we walk
 *     the parent's next-sibling chain across hunk boundaries until we
 *     hit a boundary heading or leave the rich-diff container.
 *
 * Both walkers are DOM-aware but extension-agnostic: they accept a
 * pluggable `isInjected` predicate so the production code can pass its
 * own injected-node detector while tests can pass `() => false`. They
 * also accept a `richDiffSelector` so tests can use any container shape.
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
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function headingLevel(el) {
    if (!el || !el.tagName) return null;
    const m = String(el.tagName).match(/^H([1-6])$/i);
    return m ? parseInt(m[1], 10) : null;
  }

  // Look for a descendant heading inside `el`'s subtree at the given
  // shallowest level (or shallower). Used to detect hunk-wrapped boundary
  // headings that the direct-sibling walker would otherwise miss.
  function findBoundaryDescendant(el, ourLevel) {
    if (!el || typeof el.querySelector !== 'function') return null;
    const desc = el.querySelector('h1, h2, h3, h4, h5, h6');
    if (!desc) return null;
    const dLevel = headingLevel(desc);
    if (dLevel == null) return null;
    return dLevel <= ourLevel ? desc : null;
  }

  // Find the closest rich-diff container ancestor. Accepts either a
  // selector string or a predicate; defaults to GitHub's two known
  // container classes.
  function findRichDiffContainer(heading, richDiffMatcher) {
    if (!heading) return null;
    if (typeof richDiffMatcher === 'function') {
      let cur = heading.parentElement;
      while (cur) {
        if (richDiffMatcher(cur)) return cur;
        cur = cur.parentElement;
      }
      return null;
    }
    const selector = typeof richDiffMatcher === 'string' && richDiffMatcher
      ? richDiffMatcher
      : '.prose-diff, .markdown-body';
    if (typeof heading.closest === 'function') return heading.closest(selector);
    return null;
  }

  // Return every following-sibling element under `heading`'s direct parent
  // up to (but not including) the next heading at level <= heading's level,
  // skipping anything the caller marks as injected (badges, comment boxes).
  //
  // If no non-injected siblings are found at the direct-sibling level,
  // walk up through `parent.nextElementSibling` chains across hunk
  // boundaries until either a boundary heading or the rich-diff container
  // is reached.
  //
  // Options:
  //   isInjected(el)        → true if `el` is our own UI and should be skipped
  //   richDiffSelector      → CSS selector for the bounding container
  //                            (default: '.prose-diff, .markdown-body')
  function collectSiblingsToHide(heading, options) {
    const level = headingLevel(heading);
    if (!level) return [];
    const opts = options || {};
    const isInjected = typeof opts.isInjected === 'function' ? opts.isInjected : () => false;
    const out = [];

    // Strategy 1: direct siblings under same parent.
    let cur = heading.nextElementSibling;
    while (cur) {
      const curLevel = headingLevel(cur);
      if (curLevel != null && curLevel <= level) break;
      if (findBoundaryDescendant(cur, level)) break;
      if (!isInjected(cur)) out.push(cur);
      cur = cur.nextElementSibling;
    }

    // Strategy 2: if we collected nothing (rare in normal markdown — happens
    // in GitHub's hunk-wrapped prose-diff and also when our own thread
    // badge is the only direct sibling), walk the parent's next-sibling
    // chain too. Stop at a boundary heading or when we leave the rich-diff
    // container.
    if (out.length === 0) {
      const richDiff = findRichDiffContainer(heading, opts.richDiffSelector);
      let parent = heading.parentElement;
      while (parent && parent !== richDiff) {
        let walker = parent.nextElementSibling;
        while (walker) {
          const ownLevel = headingLevel(walker);
          if (ownLevel != null && ownLevel <= level) return out;
          if (findBoundaryDescendant(walker, level)) return out;
          if (!isInjected(walker)) out.push(walker);
          walker = walker.nextElementSibling;
        }
        parent = parent.parentElement;
      }
    }

    return out;
  }

  // Like `collectSiblingsToHide`, but INCLUDES injected nodes in the result
  // (callers use this to find thread bodies and comment boxes inside the
  // section so they can be folded / restored).
  function collectSectionRoots(heading, options) {
    const level = headingLevel(heading);
    if (!level) return [];
    const opts = options || {};
    const isInjected = typeof opts.isInjected === 'function' ? opts.isInjected : () => false;
    const out = [];

    // Strategy 1: direct siblings.
    let cur = heading.nextElementSibling;
    while (cur) {
      const curLevel = headingLevel(cur);
      if (curLevel != null && curLevel <= level) break;
      if (findBoundaryDescendant(cur, level)) break;
      out.push(cur);
      cur = cur.nextElementSibling;
    }

    // Strategy 2: cross-parent walk if Strategy 1 found nothing
    // non-injected. We test "has content" with `isInjected` so a section
    // whose only direct sibling is our own thread badge still escalates
    // to the parent walk.
    const hasContent = out.some((el) => !isInjected(el));
    if (!hasContent) {
      const richDiff = findRichDiffContainer(heading, opts.richDiffSelector);
      let parent = heading.parentElement;
      while (parent && parent !== richDiff) {
        let walker = parent.nextElementSibling;
        let stopped = false;
        while (walker) {
          const ownLevel = headingLevel(walker);
          if (ownLevel != null && ownLevel <= level) { stopped = true; break; }
          if (findBoundaryDescendant(walker, level)) { stopped = true; break; }
          out.push(walker);
          walker = walker.nextElementSibling;
        }
        if (stopped) break;
        parent = parent.parentElement;
      }
    }

    return out;
  }

  return {
    headingLevel,
    collectSiblingsToHide,
    collectSectionRoots,
  };
}));
