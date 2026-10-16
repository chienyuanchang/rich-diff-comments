---
name: rdc-feature-dev
description: Iterative feature-development loop for the GitHub and Azure DevOps Markdown PR Comments browser extensions. Use when starting a new feature or bug fix — defines one shared outcome and both target statuses in FEATURES.md, records only necessary target differences, then builds, tests, and updates docs.
---

# Feature development loop

This skill captures how a feature or bug fix moves from "noticed it" to "shipped and documented" across the GitHub and Azure DevOps targets. The loop is shaped by browser-extension DOM dependencies: pure behavior is shared and unit-tested, while each host surface also needs fixture and manual validation.

## When to use

- The user says "let's work on X", "fix this", "add this feature", "implement Y" referring to anything in [docs/FEATURES.md](../../../docs/FEATURES.md).
- The user reports a bug during manual testing of the extension.
- The user asks "what should we do next?" while planning.
- A new idea comes up during a chat that should be captured before being built.

## When NOT to use

- Pure documentation edits with no code change (use direct file edits).
- Publishing / release work — use [rdc-publish-check](../rdc-publish-check/SKILL.md) instead.
- One-off questions about a host's internals — answer directly and add a target developer note only if the finding will be useful again.

## Documentation model

Keep roadmap status, target constraints, durable decisions, and captured implementation evidence in their designated sources.

| File | Purpose | What goes here |
|---|---|---|
| [docs/FEATURES.md](../../../docs/FEATURES.md) | **The authoritative parity roadmap.** | Define the shared user outcome once, assign P0–P3 priority, and record GitHub and ADO status independently. |
| [docs/github/FEATURES.md](../../../docs/github/FEATURES.md) / [docs/ado/FEATURES.md](../../../docs/ado/FEATURES.md) | **Target notes, not additional roadmaps.** | Record only host-specific mechanics, constraints, acceptance differences, and intentional delegation. Never duplicate priority or status. |
| [docs/github/APPROACH.md](../../../docs/github/APPROACH.md) | **The GitHub knowledge base.** Stable architectural decisions and matching strategies. | Why we use forward-scan matching, how the source-to-rendered mapping works, the LEFT vs RIGHT side model — durable concepts that outlive any single feature. |
| [docs/github/DEV_NOTES.md](../../../docs/github/DEV_NOTES.md) / [docs/ado/ADO_DEV_NOTES.md](../../../docs/ado/ADO_DEV_NOTES.md) | **Target implementation diaries.** | Reverse-engineered payloads, DOM quirks, captured network calls, debugging recipes, and evidence future work will need. |

> **Rule of thumb:** if it's a *what* (shared outcome, priority, status) → main FEATURES. If it's a host-specific product constraint → target FEATURES. If it's a *why* that should outlive a feature → APPROACH. If it's observed *how* (endpoint, DOM, payload, probe) → the target DEV_NOTES.

## The eight-step loop

### Step 1 — Identify the next feature or bug

Sources, in rough order of frequency:

1. **Manual testing of the extension** — find something annoying or broken.
2. **Feedback from others** — paste of a screenshot, a complaint about UX, a comment that the docs are confusing.
3. **The shared FEATURES.md backlog** — items already triaged with visible target gaps.

The skill agent should identify the affected target or shared helper and check the main roadmap to avoid duplicating an outcome.

### Step 2 — Write the solution into FEATURES.md, then discuss

Before any code:

1. Add or update one shared-outcome entry in the main [docs/FEATURES.md](../../../docs/FEATURES.md), which is the only feature status source.
2. Record GitHub and ADO status separately, including `N/A`, native-equivalent, or blocked when exact parity is impossible.
3. Include shared acceptance criteria, deferred follow-ups, and risk acceptances. If the outcome is host-specific, keep it in the main roadmap and mark the other target native-equivalent or not applicable rather than creating a second status entry.
4. Put host-specific mechanics in the matching target FEATURES page only when they materially differ; do not repeat priority, status, or version there.
5. Cross-reference the target DEV_NOTES / APPROACH when relevant background already exists.
6. Stop and discuss with the user. Confirm scope and call out unknowns explicitly. **If a reverse-engineered payload is needed, block on capturing it before writing code** — see the target DEV_NOTES for examples.

This step is gated. Do not skip ahead to coding without confirmation.

### Step 3 — Build

Implement against the agreed plan. Conventions:

- **DOM-bound code** lives in the affected target's `content.js`.
- **Pure helpers** (no DOM, no fetch) go in `src/lib/<area>.js` so they're testable in Node — see existing `textMatch.js`, `codeBlocks.js`, `sidebar.js`, `anchors.js`.
- **Defensive against null / unexpected input** for any helper that might receive user content or host data.
- **Comment generously** on non-obvious decisions, especially anything that interacts with undocumented host behavior.
- **Diagnostic logs** use `[GRDC]` for GitHub and `[ADRC]` for ADO.

### Step 4 — Manual test (human-only)

The user runs the affected target in a real PR. The skill agent's role here is to be ready for the next round — don't move on until the user reports back.

### Step 5 — Triage surprises

When the manual test surfaces a bug, the user investigates console logs, network traffic, DOM state, and the host's native review behavior. They share findings, often as a screenshot, DOM snippet, or payload.

**Ask for the actual DOM / payload, not a description.** A captured `<li class="removed grdc-hoverable">…</li>` snippet immediately reveals that GitHub uses a class, not a `<del>` wrapper. A described "the deleted lines look weird" leaves us guessing.

### Step 6 — Fix, iterate

The agent fixes based on the captured evidence. Usually takes 1–3 rounds — each round is steps 3→5 in miniature. Keep changes minimal per round so each fix is independently verifiable.

### Step 7 — Refactor, test, clean up

When the feature is working, before declaring done:

1. **Identify pure logic** that was inlined in `content.js`. If it has clear inputs/outputs and no DOM/fetch, lift it to `src/lib/<area>.js`.
2. **Add unit tests** in `tests/<area>.test.js` using Node's built-in `node:test`. Cover happy paths, boundaries, defensive null/invalid input. Aim for 5–15 tests per helper.
3. **Register new lib files** in every target manifest that consumes them. Run `.\scripts\dev-sync.ps1 -Target github` and/or `-Target ado` so the browser dev-load folders receive the shared source. (`package.ps1` and `preflight.ps1` synchronize automatically.)
4. **Re-run all tests:** `node --test (Get-ChildItem tests/*.test.js)` should be 100% green.
5. **Re-run manual tests** against the affected target's developer notes and release checklist.

### Capturing long Playwright results on Windows

VS Code terminal execution can return partial Playwright output when its idle detector fires before the child process exits. Never infer success or failure from a truncated test list, and do not start a duplicate suite just because streamed output stopped.

For a long GitHub E2E run, remove stale artifacts, redirect the full output, and write the real exit code to a separate sentinel after Node exits:

```powershell
C:\Windows\System32\cmd.exe /v:on /d /c "del /q %TEMP%\grdc-github-e2e-result.txt %TEMP%\grdc-github-e2e-exit.txt 2>nul & cd /d C:\Local\local_repos\rich-diff-comments & %LOCALAPPDATA%\nodejs-portable\node-v24.18.0-win-x64\node.exe .\node_modules\@playwright\test\cli.js test --config=playwright.config.js > %TEMP%\grdc-github-e2e-result.txt 2>&1 & echo !ERRORLEVEL! > %TEMP%\grdc-github-e2e-exit.txt"
```

If the terminal tool returns early, continue other work instead of polling or rerunning. Later, read both files directly. The run is successful only when the exit sentinel contains `0` and the result file ends with the complete Playwright summary (for example, `39 passed`). Use target-specific filenames and `playwright.ado.config.js` for ADO.

The goal isn't 100% coverage — it's "every algorithm a future change might break has a regression test."

### Step 8 — Update the documentation sources

After the feature ships:

- [docs/FEATURES.md](../../../docs/FEATURES.md):
  - Update only the shipped target's status and target-qualified version.
  - Condense the shared entry to the final user outcome; leave the other target visibly planned, partial, blocked, native-equivalent, or not applicable.
  - Update a target FEATURES page only if its mechanics, constraints, or intentional differences changed.
- [docs/github/APPROACH.md](../../../docs/github/APPROACH.md):
  - Only if a *durable* architectural concept changed. New feature additions rarely belong here.
- [docs/github/DEV_NOTES.md](../../../docs/github/DEV_NOTES.md) or [docs/ado/ADO_DEV_NOTES.md](../../../docs/ado/ADO_DEV_NOTES.md):
  - Add newly captured payloads, DOM discoveries, or "I thought X but actually Y" entries to the affected target only.
- [CHANGELOG.md](../../../CHANGELOG.md) or [CHANGELOG_ADO.md](../../../CHANGELOG_ADO.md):
  - Append to `[Unreleased]` under `### Added` / `### Fixed`.
  - **User-facing language only.** Write each bullet like a feature announcement to someone who has never opened the source. No file/function/class names, no CSS selectors, no DOM-shape detail, no specific line numbers from a bug repro file. Stick to *what the user sees, when they'd notice it, why it's better.* See the CHANGELOG / release-notes writing rules in [rdc-publish-check](../rdc-publish-check/SKILL.md) for full rules and examples.

Then commit, push, and the user moves to the next iteration.

## Anti-patterns to avoid

- **Writing code before FEATURES.md defines the shared outcome and target status.** Even a quick fix benefits from a one-line item: it forces explicit scope and makes parity drift visible.
- **Guessing at host endpoint payloads.** A `200 OK` doesn't prove the stored semantics are correct—capture the real native request and validate the resulting thread.
- **Skipping the refactor step.** Inline ad-hoc functions in `content.js` accumulate fast and become untestable. Move pure logic out *the same session* it's written.
- **Marking one target "shipped" by rewriting the feature as target-specific.** Update that target's status cell and leave the other target's gap explicit.
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
