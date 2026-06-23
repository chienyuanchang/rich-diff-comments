'use strict';

// Static-analysis tests for styles.css to keep dark-mode support intact.
//
// Background: GitHub's PR pages use Primer design tokens for theming.
// Anywhere we paint a color (background, color, border-color, box-shadow,
// etc.) we must use a three-level fallback chain:
//
//   var(--<new-primer-name>, var(--<legacy-primer-name>, #<light-hex>))
//
// New Primer (2024+) is what GitHub.com actually defines on PR pages today.
// Legacy Primer is still defined on older Enterprise Server installs. The
// literal hex is the last-resort fallback if neither variable is defined.
//
// See `docs/DEV_NOTES.md → CSS theming` for the full mapping table.
//
// These tests are pure lexical analysis of the CSS file — they don't run
// the extension or load a browser. The cost of a missed regression here is
// a broken comment box in GitHub dark mode that no unit-test in the JS
// suite would catch.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CSS_PATH = path.join(__dirname, '..', 'styles.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');
const lines = css.split(/\r?\n/);

// Map line-number → trimmed line, for nicer error messages.
function describeLine(lineNumber) {
  return `L${lineNumber}: ${(lines[lineNumber - 1] || '').trim()}`;
}

// ───────────────────────────────────────────────────────────────────────────
// Test 1 — no standalone hex colors outside var() fallbacks
// ───────────────────────────────────────────────────────────────────────────
//
// A "standalone" hex is a `#hex` value that appears as the right-hand side
// of a CSS declaration WITHOUT being wrapped in `var(..., #hex)`. Standalone
// hex values don't switch with the user's GitHub theme — they'd give a
// hardcoded light (or dark) color regardless.
//
// We tolerate hex inside rgba()/comments/box-shadow color stops, etc., by
// only flagging lines where the hex is the value being assigned at the top
// level (i.e. follows `:` and isn't preceded by `var(--…, `).

test('styles.css: every standalone hex color sits inside a var() fallback', () => {
  const offenders = [];

  lines.forEach((line, idx) => {
    const lineNumber = idx + 1;
    // Skip comment-only lines
    if (/^\s*(\/\*|\*|\/\/)/.test(line)) return;

    // Match `: #hex` (the start of a value), avoiding hex inside rgba() etc.
    // Pattern: `:`, optional whitespace, then `#hex` (3, 4, 6, or 8 chars).
    const hexMatch = /:\s*(#[0-9a-fA-F]{3,8})\b/.exec(line);
    if (!hexMatch) return;

    // Allowed: the hex sits inside a var(...) fallback elsewhere on the line.
    // `var(--name, #hex)` — the hex is the second argument to var().
    if (/var\([^)]+,\s*#[0-9a-fA-F]{3,8}/.test(line)) return;

    offenders.push(describeLine(lineNumber));
  });

  if (offenders.length > 0) {
    const message =
      `Found ${offenders.length} standalone hex color(s) in styles.css. ` +
      `Every color must be wrapped in a var() fallback so it adapts to GitHub's theme. ` +
      `See docs/DEV_NOTES.md → "CSS theming". Offending lines:\n` +
      offenders.map((s) => `  ${s}`).join('\n');
    assert.fail(message);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Test 2 — every legacy --color-* variable is wrapped in a new-Primer-name var()
// ───────────────────────────────────────────────────────────────────────────
//
// GitHub renamed Primer variables in late 2024: `--color-canvas-default`
// became `--bgColor-default`, `--color-fg-default` became `--fgColor-default`,
// `--color-btn-primary-bg` became `--button-primary-bgColor-rest`, etc. The
// legacy names are no longer defined on github.com, so any rule that uses
// ONLY the legacy name will fall through to its literal hex on every page
// load — breaking dark mode.
//
// The mapping below is the canonical translation table. Any legacy-Primer
// variable used in styles.css must appear as the *inner* var() inside a
// new-Primer-name wrapper:
//
//   color: var(--fgColor-default, var(--color-fg-default, #24292f));
//
// To add a new color category: drop it into LEGACY_TO_NEW below.

// Legacy → new mapping. Each legacy variable can map to **one or more**
// new-Primer names — legacy CSS had no per-state variants (rest only), but
// new Primer splits state into `-rest` / `-hover` / `-disabled` / `-active`.
// So `--color-btn-border` legitimately wraps with `--button-default-borderColor-rest`
// in a normal rule AND with `--button-default-borderColor-hover` inside a
// `:hover` selector. Both are correct.
const LEGACY_TO_NEW = {
  '--color-canvas-default':     ['--bgColor-default'],
  '--color-canvas-subtle':      ['--bgColor-muted'],
  '--color-canvas-overlay':     ['--overlay-bgColor'],
  '--color-fg-default':         ['--fgColor-default'],
  '--color-fg-muted':           ['--fgColor-muted'],
  '--color-fg-on-emphasis':     ['--fgColor-onEmphasis'],
  '--color-border-default':     ['--borderColor-default'],
  '--color-border-muted':       ['--borderColor-muted'],
  '--color-accent-fg':          ['--fgColor-accent'],
  '--color-accent-emphasis':    ['--bgColor-accent-emphasis'],
  '--color-accent-subtle':      ['--bgColor-accent-muted'],
  '--color-accent-muted':       ['--borderColor-accent-muted'],
  '--color-success-fg':         ['--fgColor-success'],
  '--color-success-emphasis':   ['--bgColor-success-emphasis'],
  '--color-success-subtle':     ['--bgColor-success-muted'],
  '--color-success-muted':      ['--borderColor-success-muted'],
  '--color-danger-fg':          ['--fgColor-danger'],
  '--color-danger-emphasis':    ['--bgColor-danger-emphasis'],
  '--color-danger-subtle':      ['--bgColor-danger-muted'],
  '--color-danger-muted':       ['--borderColor-danger-muted'],
  '--color-attention-subtle':   ['--bgColor-attention-muted'],
  '--color-attention-emphasis': ['--bgColor-attention-emphasis'],
  '--color-attention-muted':    ['--borderColor-attention-muted'],
  '--color-attention-fg':       ['--fgColor-attention'],
  '--color-neutral-muted':      ['--bgColor-neutral-muted'],
  '--color-btn-bg':             ['--button-default-bgColor-rest'],
  '--color-btn-text':           ['--button-default-fgColor-rest'],
  '--color-btn-border':         ['--button-default-borderColor-rest', '--button-default-borderColor-hover', '--button-default-borderColor-active'],
  '--color-btn-hover-bg':       ['--button-default-bgColor-hover'],
  '--color-btn-primary-bg':     ['--button-primary-bgColor-rest', '--button-primary-bgColor-disabled'],
  '--color-btn-primary-text':   ['--button-primary-fgColor-rest', '--button-primary-fgColor-disabled'],
  '--color-btn-primary-border': ['--button-primary-borderColor-rest', '--button-primary-borderColor-hover', '--button-primary-borderColor-active', '--button-primary-borderColor-disabled'],
  '--color-btn-primary-hover-bg': ['--button-primary-bgColor-hover'],
  '--color-action-list-item-default-hover-bg': ['--control-bgColor-hover'],
};

// Legacy variables that don't have a clean new-Primer equivalent. Tests 2
// and 3 skip these — they're allowed to appear as `var(--legacy, literal)`
// without a new-name wrapper. Keep this list short and justified; everything
// else should go through LEGACY_TO_NEW.
//
// `--color-shadow-large`: GitHub's new Primer doesn't expose a public CSS
//   variable for popover shadows on PR pages. The literal fallback
//   `0 8px 24px rgba(140, 149, 159, 0.2)` looks acceptable in both themes
//   (the rgba alpha keeps it subtle against dark backgrounds too).
const LEGACY_NO_NEW_EQUIVALENT = new Set([
  '--color-shadow-large',
]);

test('styles.css: every legacy --color-* variable is wrapped in a new Primer name', () => {
  const offenders = [];

  for (const [legacy, newNames] of Object.entries(LEGACY_TO_NEW)) {
    // Find every occurrence of `var(<legacy>, …)` in the file
    const re = new RegExp(`var\\(${legacy.replace(/[-]/g, '\\-')},`, 'g');
    let m;
    while ((m = re.exec(css)) !== null) {
      // Find the line this match is on
      const idx = m.index;
      const lineNumber = css.slice(0, idx).split('\n').length;
      const lineText = lines[lineNumber - 1] || '';

      // Check whether the immediately preceding context wraps us in any of
      // the accepted new names. The pattern: `var(<newName>, var(<legacy>, …))`.
      // Look at the ~80 chars before the match for `var(<newName>, `.
      const ctxStart = Math.max(0, idx - 80);
      const before = css.slice(ctxStart, idx);
      const wrapped = newNames.some((newName) => {
        const wrapperPattern = new RegExp(`var\\(${newName.replace(/[-]/g, '\\-')},\\s*$`);
        return wrapperPattern.test(before);
      });
      if (wrapped) continue;

      const expectedList = newNames.join(' OR ');
      offenders.push(
        `L${lineNumber}: ${lineText.trim()}\n      ` +
        `(expected ${expectedList} wrapping ${legacy})`
      );
    }
  }

  if (offenders.length > 0) {
    const message =
      `Found ${offenders.length} legacy Primer variable(s) used without a new-name wrapper. ` +
      `GitHub.com no longer defines the legacy --color-* variables; without the new ` +
      `--bgColor-* / --fgColor-* wrapper, these rules fall through to the literal hex ` +
      `and break dark mode. See docs/DEV_NOTES.md → "CSS theming" for the mapping table.\n` +
      offenders.map((s) => `  ${s}`).join('\n');
    assert.fail(message);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Test 3 — the mapping table itself is exhaustive
// ───────────────────────────────────────────────────────────────────────────
//
// If someone introduces a brand-new legacy --color-* variable without
// updating LEGACY_TO_NEW above, test 2 above can't enforce the wrapper. Catch
// it here: scan the CSS for any `--color-*` token and ensure it's in our
// mapping table.

test('styles.css: every --color-* variable used has a known new-name mapping', () => {
  const used = new Set();
  const re = /var\((--color-[\w-]+),/g;
  let m;
  while ((m = re.exec(css)) !== null) used.add(m[1]);

  const missing = [...used]
    .filter((v) => !(v in LEGACY_TO_NEW) && !LEGACY_NO_NEW_EQUIVALENT.has(v))
    .sort();

  if (missing.length > 0) {
    const message =
      `Found ${missing.length} legacy --color-* variable(s) without a known new-name mapping. ` +
      `Add each to the LEGACY_TO_NEW table at the top of this test, then re-run. ` +
      `Run the variable-discovery snippet in docs/DEV_NOTES.md → "CSS theming" on a ` +
      `live GitHub PR page to find the new Primer name.\n  ` +
      missing.join('\n  ');
    assert.fail(message);
  }
});
