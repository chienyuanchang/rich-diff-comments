/**
 * Tests for `styles.css` coverage — would have caught the 1.5.1 bug where
 * `+` buttons were attached to YAML frontmatter `<th>` cells but invisible
 * because no `th.grdc-hoverable .grdc-comment-btn` rule pulled the button
 * inward (the default `left: -30px` put it off-screen).
 *
 * Whenever we add a new "host tag" that `buttonAnchor()` returns, this
 * test makes sure `styles.css` has a matching positioning override so the
 * `+` is actually visible on hover.
 *
 * Pure file-parse — no jsdom, no extension load.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

/**
 * The tags that `buttonAnchor()` (src/lib/lineMap.js) can return as the
 * host element for the inline `+`. For each, `styles.css` must have a
 * rule of the form:
 *
 *   <tag>.grdc-hoverable .grdc-comment-btn { left: <N>px; ... }
 *
 * pulling the button inward from the default `.grdc-comment-btn { left: -30px }`
 * so it's actually visible inside narrow hosts (table cells, code blocks).
 *
 * `p`, `h1`–`h6`, `li`, `tr` don't need an override — `tr` is normalized
 * to the first `td`/`th` by `buttonAnchor()`, paragraphs/headings/list-items
 * have enough room to host the default left-of-content `+` placement.
 *
 * `td`, `th`, `pre` DO need overrides because their visible bounding box
 * is too narrow to host the default `left: -30px` (the button would land
 * outside the cell / code block).
 */
const HOSTS_REQUIRING_INWARD_PLACEMENT = ['td', 'th', 'pre'];

for (const tag of HOSTS_REQUIRING_INWARD_PLACEMENT) {
  test(`${tag}.grdc-hoverable .grdc-comment-btn has a positive 'left' rule so the + is on-screen`, () => {
    // Match either a single-selector rule (`td.grdc-hoverable .grdc-comment-btn { ... }`)
    // or a multi-selector rule that includes this tag
    // (`td.grdc-hoverable, th.grdc-hoverable .grdc-comment-btn { ... }` — though CSS
    // requires repeating `.grdc-comment-btn` per selector, so the realistic shape is
    // `td.grdc-hoverable .grdc-comment-btn, th.grdc-hoverable .grdc-comment-btn { left: ...; }`).
    //
    // We're conservative: require the literal `<tag>.grdc-hoverable .grdc-comment-btn`
    // somewhere in the file with a positive `left` declaration in the next rule
    // block.
    const selectorRegex = new RegExp(
      `${tag}\\.grdc-hoverable\\s+\\.grdc-comment-btn`,
      'i'
    );
    assert.match(
      css,
      selectorRegex,
      `Missing CSS selector "${tag}.grdc-hoverable .grdc-comment-btn" in styles.css. ` +
        `Without this, the + button on hover over a <${tag}> host inherits the ` +
        `default "left: -30px" and falls off-screen — exactly the YAML-frontmatter ` +
        `<th> bug from v1.5.1. Add a rule of the form:\n\n` +
        `  ${tag}.grdc-hoverable .grdc-comment-btn {\n` +
        `    left: 2px; top: 4px; transform: none;\n` +
        `  }\n`
    );

    // Now check that the *enclosing rule block* sets a positive `left:`
    // value. Find the selector then look for `left:` followed by a positive
    // px value before the next `}`.
    const ruleMatch = css.match(
      new RegExp(
        // Match selectors (possibly comma-separated) ending in our tag's anchor selector,
        // then the rule body up to and including `left: <positive>px`.
        `(?:[^}]+,\\s*)?${tag}\\.grdc-hoverable\\s+\\.grdc-comment-btn\\s*(?:,[^{]+)?\\{[^}]*left:\\s*(\\d+)px`,
        'i'
      )
    );
    assert.ok(
      ruleMatch,
      `Found selector "${tag}.grdc-hoverable .grdc-comment-btn" but no positive ` +
        `'left: <N>px' in the same rule block. The default is '-30px' which is off-screen.`
    );
    const leftPx = parseInt(ruleMatch[1], 10);
    assert.ok(
      leftPx >= 0,
      `'left: ${leftPx}px' must be >= 0 so the + sits inside the host's bounding box.`
    );
  });
}

test('the default `.grdc-comment-btn` rule keeps `left: -30px` (the wide-host placement) — overrides must opt in per host tag', () => {
  // Regression: ensures the inward overrides above remain *additional* on
  // top of the default wide-host placement, not a replacement. If someone
  // ever changes the default to `left: 2px` "to be safe", it'd visually
  // shift the + onto the text of paragraphs / headings / list items.
  const defaultRule = css.match(/\.grdc-comment-btn\s*\{[^}]*left:\s*(-?\d+)px/);
  assert.ok(defaultRule, 'styles.css must define a default `.grdc-comment-btn { left: ... }`');
  const leftPx = parseInt(defaultRule[1], 10);
  assert.ok(
    leftPx < 0,
    `Default '.grdc-comment-btn { left: ${leftPx}px }' should be negative so the + ` +
      `sits in the left gutter of wide hosts (paragraphs, headings). Per-host overrides ` +
      `for narrow hosts (td/th/pre) are what move it inward.`
  );
});

test('opacity transition: default `.grdc-comment-btn` is hidden, `.grdc-hoverable:hover > .grdc-comment-btn` reveals it', () => {
  // Pre-existing behavior: belt-and-suspenders test in case someone
  // refactors the hover model and accidentally leaves the + always visible
  // (would interfere with reading) or always hidden (would block all
  // commenting).
  assert.match(
    css,
    /\.grdc-comment-btn\s*\{[^}]*opacity:\s*0/,
    'Default `.grdc-comment-btn` must have `opacity: 0` so the + is hidden until hover.'
  );
  assert.match(
    css,
    /\.grdc-hoverable:hover\s*>\s*\.grdc-comment-btn\s*\{[^}]*opacity:\s*1/,
    'Hover must reveal the + via `.grdc-hoverable:hover > .grdc-comment-btn { opacity: 1 }`.'
  );
});
