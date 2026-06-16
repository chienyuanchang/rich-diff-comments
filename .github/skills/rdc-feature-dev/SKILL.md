---
description: Iterative feature-development loop for the Markdown PR Comments for GitHub browser extension. Use when starting a new feature or bug fix — walks through identifying the work, designing in FEATURES.md, building, manual testing, refactoring with unit tests, and updating docs.
---

# Feature development loop

This skill captures how a feature or bug fix moves from "noticed it" to "shipped and documented" in the **Markdown PR Comments for GitHub** repo. The loop is shaped by the fact that this is a browser extension with heavy DOM dependencies — most behavior can't be unit-tested in Node, so manual testing in a real PR carries the load.

## When to use

- The user says "let's work on X", "fix this", "add this feature", "implement Y" referring to anything in [docs/FEATURES.md](../../../docs/FEATURES.md).
- The user reports a bug during manual testing of the extension.
- The user asks "what should we do next?" while planning.
- A new idea comes up during a chat that should be captured before being built.

## When NOT to use

- Pure documentation edits with no code change (use direct file edits).
- Publishing / release work — use [rdc-publish-check](../rdc-publish-check/SKILL.md) instead.
- One-off questions about how GitHub's internals work — answer directly and consider adding a note to [docs/DEV_NOTES.md](../../../docs/DEV_NOTES.md) only if it'll be useful again.

## The three documents

Knowledge in this repo lives in three places. Keep them aligned at every stage.

| File | Purpose | What goes here |
|---|---|---|
| [docs/FEATURES.md](../../../docs/FEATURES.md) | **The roadmap.** What's shipped, what's planned, what we deliberately won't do. | Feature items grouped by priority (P0–P3). Each item carries its own acceptance criteria, possible solutions, and status. Shipped items use `[x]` with the version they shipped in. |
| [docs/APPROACH.md](../../../docs/APPROACH.md) | **The knowledge base.** Stable architectural decisions and matching strategies. | Why we use forward-scan matching, how the source-to-rendered mapping works, the LEFT vs RIGHT side model — durable concepts that outlive any single feature. |
| [docs/DEV_NOTES.md](../../../docs/DEV_NOTES.md) | **The implementation diary.** Reverse-engineered endpoint payloads, DOM quirks, captured network calls. | "GitHub uses `class=\"removed\"` on deleted blocks", captured `create_review_comment` payloads (RIGHT and LEFT side), the `subjectType: \"multiline\"` lowercase gotcha. Anything future-you will need to look up. |

> **Rule of thumb:** if it's a *what* (feature plan, status) → FEATURES. If it's a *why* (architectural reason that won't change) → APPROACH. If it's a *how* (specific endpoint shape, DOM class, captured payload) → DEV_NOTES.

## The eight-step loop

### Step 1 — Identify the next feature or bug

Sources, in rough order of frequency:

1. **Manual testing of the extension** — find something annoying or broken.
2. **Feedback from others** — paste of a screenshot, a complaint about UX, a comment that the docs are confusing.
3. **The FEATURES.md backlog** — items already triaged and waiting.

The skill agent should ask which source if unclear, and check FEATURES.md to avoid duplicating an entry.

### Step 2 — Write the solution into FEATURES.md, then discuss

Before any code:

1. Add (or update) an entry under the right priority block in FEATURES.md.
2. Include: acceptance criteria, one or more proposed solutions, deferred follow-ups, and risk acceptances if any.
3. Cross-reference DEV_NOTES.md / APPROACH.md if relevant background already exists.
4. Stop and discuss with the user. Confirm scope and call out unknowns explicitly. **If a reverse-engineered payload is needed (e.g. for a new GitHub endpoint), block on capturing it before writing code** — see DEV_NOTES.md for examples.

This step is gated. Do not skip ahead to coding without confirmation.

### Step 3 — Build

Implement against the agreed plan. Conventions:

- **DOM-bound code** lives in `content.js`.
- **Pure helpers** (no DOM, no fetch) go in `src/lib/<area>.js` so they're testable in Node — see existing `textMatch.js`, `codeBlocks.js`, `sidebar.js`, `anchors.js`.
- **Defensive against null / unexpected input** for any helper that might receive user content or GitHub data.
- **Comment generously** on non-obvious decisions, especially anything that interacts with GitHub's undocumented internals.
- **Diagnostic logs** use the `[GRDC]` prefix.

### Step 4 — Manual test (human-only)

The user runs the extension in a real PR. The skill agent's role here is to be ready for the next round — don't move on until the user reports back.

### Step 5 — Triage surprises

When the manual test surfaces a bug, the user investigates: console logs, network tab, inspect element, comparing to GitHub's own source-diff behavior. They share findings (often as a screenshot or DOM snippet).

**Ask for the actual DOM / payload, not a description.** A captured `<li class="removed grdc-hoverable">…</li>` snippet immediately reveals that GitHub uses a class, not a `<del>` wrapper. A described "the deleted lines look weird" leaves us guessing.

### Step 6 — Fix, iterate

The agent fixes based on the captured evidence. Usually takes 1–3 rounds — each round is steps 3→5 in miniature. Keep changes minimal per round so each fix is independently verifiable.

### Step 7 — Refactor, test, clean up

When the feature is working, before declaring done:

1. **Identify pure logic** that was inlined in `content.js`. If it has clear inputs/outputs and no DOM/fetch, lift it to `src/lib/<area>.js`.
2. **Add unit tests** in `tests/<area>.test.js` using Node's built-in `node:test`. Cover happy paths, boundaries, defensive null/invalid input. Aim for 5–15 tests per helper.
3. **Register new lib files** in `manifest.json` `content_scripts.js` array so the browser loads them.
4. **Re-run all tests:** `node --test (Get-ChildItem tests/*.test.js)` should be 100% green.
5. **Re-run manual tests** against the manual checklist in DEV_NOTES.md.

The goal isn't 100% coverage — it's "every algorithm a future change might break has a regression test."

### Step 8 — Update the three documents

After the feature ships:

- [docs/FEATURES.md](../../../docs/FEATURES.md):
  - Flip the item to `[x]` with `(shipped in 1.0.X)` and ~~strikethrough~~ the priority tag.
  - Append a short summary of *what was actually done* (the as-built can drift from the original plan — record the final shape).
  - Bump the test count if new tests were added.
- [docs/APPROACH.md](../../../docs/APPROACH.md):
  - Only if a *durable* architectural concept changed. New feature additions rarely belong here.
- [docs/DEV_NOTES.md](../../../docs/DEV_NOTES.md):
  - Add any newly captured payloads, DOM-class discoveries, or "I thought X but actually Y" entries under the relevant section.
- [CHANGELOG.md](../../../CHANGELOG.md):
  - Append to `[Unreleased]` under `### Added` / `### Fixed`.
  - **User-facing language only.** Write each bullet like a feature announcement to someone who has never opened the source. No file/function/class names, no CSS selectors, no DOM-shape detail, no specific line numbers from a bug repro file. Stick to *what the user sees, when they'd notice it, why it's better.* Full rules and examples in [rdc-publish-check → CHANGELOG / release-notes writing rules](../rdc-publish-check/SKILL.md#changelog--release-notes-writing-rules).

Then commit, push, and the user moves to the next iteration.

## Anti-patterns to avoid

- **Writing code before FEATURES.md has the design.** Even a quick fix benefits from a one-line item: it forces explicit scope and prevents drift.
- **Guessing at GitHub's endpoint payloads.** A `200 OK` doesn't mean correct — `subjectType: "multiLine"` returns 200 but stores as single-line. Always capture from the real native UI first.
- **Skipping the refactor step.** Inline ad-hoc functions in `content.js` accumulate fast and become untestable. Move pure logic out *the same session* it's written.
- **Marking items "shipped" without updating the docs.** If FEATURES is wrong, the next agent (or future-you) reads stale state and rebuilds something that already exists.
- **Touching the `content-understanding/tools/github-rich-diff-comments/` mirror.** That's a snapshot in another repo, not the source of truth. All work goes in `c:\Local\local_repos\rich-diff-comments\`.

## Reference: pure-helper library structure

When extracting logic, follow the existing pattern (see [src/lib/sidebar.js](../../../src/lib/sidebar.js)):

```js
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

  function helper(x) { /* ... */ }

  return { helper };
});
```

This dual-context export lets the same file work in:

- The browser content script (registered in `manifest.json`, attaches to `window.GRDC`).
- Node tests (`require('../src/lib/...')`).

Tests follow [tests/sidebar.test.js](../../../tests/sidebar.test.js) — Node's `node:test` + `node:assert/strict`, no external deps.
