'use strict';

// Static-analysis tests for the sidebar's collapsed-state CSS contracts.
//
// Background — the design decisions this file pins:
//
//   When the user clicks the `≡` toggle to collapse the sidebar, CSS
//   sets `width: auto !important` so the sidebar shrinks to fit the
//   header strip. The header stays one row with: collapse button +
//   Changes nav cluster (`[↑ ± N/M ↓]`) + Threads nav cluster
//   (`[↑ 💬 N/M ↓]`) + filter funnel + render-md book icon.
//
//   2026-06 design iterations:
//
//     v1 (just after 1.5.0 shipped): both nav clusters visible in
//       collapsed mode. Width was uncapped — strip could shrink so
//       narrow that icons clipped out of `overflow: hidden`. The
//       "sidebar disappeared on collapse" report.
//
//     v2 (interim fix): hid both nav clusters in collapsed mode and
//       forced flex-wrap: nowrap. Strip stayed minimal but lost the
//       at-a-glance counter — defeated the point of the slim strip.
//
//     v3 (current): nav clusters visible AGAIN, but with `min-width:
//       300px` floor on .grdc-sidebar-collapsed and `overflow: visible`
//       so the icons always paint. Best of both: the counters are
//       readable when collapsed AND the layout stays stable.
//
//   The tests below pin v3:
//     • Nav clusters MUST NOT be hidden in collapsed mode.
//     • Header MUST NOT force nowrap (let it wrap if user shrinks further).
//     • Collapsed strip MUST inherit the parent .grdc-sidebar width (>= 400px floor).
//     • The collapse toggle MUST stay reachable.
//
//   If you intentionally revert any of these, update the test message
//   AND CHANGELOG.md so the design change is recorded.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CSS_PATH = path.join(__dirname, '..', 'styles.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');

// ───────────────────────────────────────────────────────────────────────────
// Helper — does `css` contain a rule selector matching `selectorRegex`
// whose body includes `display: none` (modulo whitespace)?
//
// The selector regex is matched against each rule's selector list. We
// don't try to parse the full CSS grammar — just split on `{` to get
// per-rule selectors and check each block's body for the property.
// ───────────────────────────────────────────────────────────────────────────
function ruleHidesElement(cssText, selectorRegex) {
  // Strip CSS comments so they don't confuse the parse.
  const stripped = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  // Split on rule boundaries. Each "block" is `selector { decls }`.
  // We pair `{` with the matching `}`. Naive but sufficient for our
  // stylesheet (no nested at-rules with rules inside, except the
  // @container/@media wrappers which we'll handle by recursing).
  let i = 0;
  while (i < stripped.length) {
    const openBrace = stripped.indexOf('{', i);
    if (openBrace === -1) break;
    const selectorPart = stripped.slice(i, openBrace).trim();
    // Find matching closing brace, accounting for nested braces (e.g.
    // @container queries containing inner rules).
    let depth = 1;
    let j = openBrace + 1;
    while (j < stripped.length && depth > 0) {
      if (stripped[j] === '{') depth++;
      else if (stripped[j] === '}') depth--;
      j++;
    }
    const body = stripped.slice(openBrace + 1, j - 1);
    // If selector matches our target AND body declares display:none, win.
    if (selectorRegex.test(selectorPart) && /display\s*:\s*none/.test(body)) {
      return true;
    }
    // If this was an at-rule with nested rules, recurse into the body
    // to catch rules wrapped in @container / @media.
    if (selectorPart.startsWith('@') && ruleHidesElement(body, selectorRegex)) {
      return true;
    }
    i = j;
  }
  return false;
}

// ───────────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────────

test('styles.css: collapsed state does NOT hide the Changes nav cluster', () => {
  // 2026-06 design decision: collapsed mode keeps both nav clusters
  // visible because the at-a-glance `[↑ ± N/M ↓]` / `[↑ 💬 N/M ↓]` counters
  // are the whole point of the slim strip. An earlier iteration hid
  // them on collapse — don't bring that back without revisiting the
  // design (see the conversation history around the 1.5.0 ship).
  //
  // The strip width is sized by `min-width` on .grdc-sidebar-collapsed
  // (see test below) to fit both clusters + filter + book on one row.
  const found = ruleHidesElement(
    css,
    /\.grdc-sidebar-collapsed\s+\.grdc-sidebar-changes-nav/
  );
  assert.ok(
    !found,
    `Found a CSS rule that hides .grdc-sidebar-changes-nav in collapsed mode. ` +
    `The 2026-06 design keeps the cluster visible in the collapsed strip for the ` +
    `at-a-glance counter. If you intentionally re-introduced the hide rule, update ` +
    `this test and document the design change in CHANGELOG.md.`
  );
});

test('styles.css: collapsed state does NOT hide the Threads nav cluster', () => {
  // Mirror of the Changes test — same rule, opposite cluster.
  const found = ruleHidesElement(
    css,
    /\.grdc-sidebar-collapsed\s+\.grdc-sidebar-nav([^a-z-]|$)/
  );
  assert.ok(
    !found,
    `Found a CSS rule that hides .grdc-sidebar-nav in collapsed mode. ` +
    `The 2026-06 design keeps the Threads cluster visible for the at-a-glance counter. ` +
    `If you intentionally re-introduced the hide rule, update this test and document ` +
    `the design change in CHANGELOG.md.`
  );
});

test('styles.css: collapsed state forces flex-wrap to nowrap on the header', () => {
  // 2026-06-17 design decision (revised): the collapsed strip MUST stay
  // on one row. Wrapping to a second row visually defeats the "thin
  // collapsed strip" purpose — at that point the user might as well
  // expand the sidebar. With `min-width: 360px` on .grdc-sidebar-collapsed,
  // the content always fits; `flex-wrap: nowrap` is a safety net for
  // transient measurement hiccups during a re-render.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const hasNowrap = /\.grdc-sidebar-collapsed\s+\.grdc-sidebar-header\s*\{[^}]*flex-wrap\s*:\s*nowrap/.test(stripped);
  assert.ok(
    hasNowrap,
    `Expected a CSS rule like \`.grdc-sidebar-collapsed .grdc-sidebar-header { flex-wrap: nowrap; }\`. ` +
    `Without this, the collapsed strip can wrap to a second row when the persisted width is small ` +
    `or during transient measurements — defeating the "thin strip" purpose of collapsing.`
  );
});

test('styles.css: collapsed state still keeps the collapse toggle reachable', () => {
  // Guard against the over-aggressive opposite of the regression — we
  // must NOT accidentally hide `.grdc-sidebar-collapse` (the `≡` button)
  // in collapsed mode. If we did, the user would have no way to reopen
  // the sidebar without `t` (or the `Shift+T` reset).
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const accidentallyHidden = /\.grdc-sidebar-collapsed[^{]*\.grdc-sidebar-collapse\s*\{[^}]*display\s*:\s*none/.test(stripped);
  assert.ok(
    !accidentallyHidden,
    `Found a rule that hides .grdc-sidebar-collapse in collapsed mode. This would trap users ` +
    `in collapsed mode with no visible toggle to reopen the sidebar. The collapse button must ` +
    `stay visible in BOTH states.`
  );
});

test('styles.css: collapsed sidebar inherits the parent width (no auto-shrink)', () => {
  // 2026-06-17 design (revised): the collapsed strip used to set
  // `width: auto !important` and a separate `min-width` floor. That
  // pulled the funnel inward when collapsed, which looked visually
  // disconnected from the expanded layout (and on narrow viewports made
  // the funnel disappear entirely). The new rule: collapsed mode does
  // NOT override width — it inherits the 400px floor from .grdc-sidebar
  // so the funnel stays in the same screen position whether expanded or
  // collapsed.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blockMatch = stripped.match(/\.grdc-sidebar-collapsed\s*\{([^}]*)\}/);
  assert.ok(blockMatch, `Could not find the .grdc-sidebar-collapsed rule in styles.css.`);
  const body = blockMatch[1];

  // The collapsed rule must NOT set `width: auto` — that would shrink
  // the strip to its content width and pull the funnel inward.
  assert.doesNotMatch(
    body,
    /width\s*:\s*auto/,
    `Found \`width: auto\` on .grdc-sidebar-collapsed. The 2026-06-17 design inherits the ` +
    `parent's 400px width instead, so the collapsed strip stays the same width as the expanded ` +
    `sidebar and the funnel doesn't get pulled inward / clipped.`
  );

  // Parent .grdc-sidebar must have min-width: 400px (or higher) — that's
  // the floor the collapsed strip inherits.
  const parentMatch = stripped.match(/\.grdc-sidebar\s*\{([^}]*)\}/);
  assert.ok(parentMatch, `Could not find the parent .grdc-sidebar rule.`);
  const parentBody = parentMatch[1];
  const minWidthMatch = parentBody.match(/min-width\s*:\s*(\d+)px/);
  assert.ok(
    minWidthMatch,
    `Expected \`min-width: <N>px\` on the parent .grdc-sidebar so the collapsed strip ` +
    `inherits a sensible floor. Without it, the strip can shrink past the v2 header content ` +
    `and clip the funnel.`
  );
  const minWidthPx = parseInt(minWidthMatch[1], 10);
  assert.ok(
    minWidthPx >= 400,
    `.grdc-sidebar min-width is ${minWidthPx}px — too narrow to fit the v2 header (collapse + ` +
    `book + diff cluster + thread cluster + funnel ≈ 380px). Bump to >= 400px.`
  );
});
