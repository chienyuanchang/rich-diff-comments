# Markdown PR — Markdown PR Comments for GitHub

Chrome/Edge extension that lets you leave **and view** inline PR review comments directly from GitHub's **rendered markdown** (rich diff) view.

## Problem

GitHub's "Files changed" rich diff renders markdown beautifully but provides no way to click on a paragraph and leave a comment. Existing review threads are also hidden — you have to switch back to source-diff mode to see or post anything.

## What this does

- Overlays a `+` button on every paragraph, heading, list item, table row, and code block in rich diff.
- Click `+` → write a comment → posts as a real PR review comment on the correct source line.
- Renders existing review threads inline at the rendered block that corresponds to each commented line.
- **Reply** to threads, **resolve / unresolve** them, and see **resolved / outdated** state — all from the rendered view.
- **Threads sidebar** docked to the right edge lists every review thread (author, snippet, file:line, resolved / outdated tags) — click to jump, with prev/next chevrons and a comment counter.
- **Outline tab** in the sidebar shows the heading tree of every changed `.md` file with comment-count pills, per-section folding, and bulk `Fold H1 / H2 / H3` / `Expand all` controls.
- **Changes tab** in the sidebar lists every changed block (paragraph / list item / table row / code block / heading / blockquote) with a `+` / `−` / `±` kind glyph, file:line, and a snippet. The header also gets a `◀ N/M ▶` counter so you can step through changes without opening the tab. Best way to scan a Markdown PR for the first time without re-reading the unchanged prose.
- **One-click "Render all Markdown files as rich-diff"** flips every `.md` file in the PR from source-diff to rich-diff in a single sweep, so comments on those files load automatically.
- **Keyboard shortcuts:** `j` / `k` next / previous thread, `h` / `l` first / last thread, `[` / `]` previous / next change, `{` / `}` (Shift+[, Shift+]) first / last change, `1` / `2` / `3` switch sidebar tab (Changes / Threads / Outline), `t` toggle the sidebar, `Shift+T` reset its position.
- No PAT required — uses your existing GitHub session cookies (works for public and private repos).

(For submitting a full review / approve / request changes, use GitHub's native **"Review changes"** button at the top of the Files-changed tab.)

See [docs/FEATURES.md](docs/FEATURES.md) for the full feature list and roadmap.

## Install

### For end users

- **Chrome / Brave / Vivaldi / Arc / any Chromium browser:** <https://chromewebstore.google.com/detail/markdown-pr-comments-for/bdkcmcdfnhonfcpdgcmemkpcmnhnhemj> — short link: <https://aka.ms/md-pr>
- **Microsoft Edge:** <https://microsoftedge.microsoft.com/addons/detail/agomibenjlnikaldoddminkjbokfocgb>

No login, no setup, no Personal Access Token required. Works on public and private repos. See [INSTALL.md](INSTALL.md) for the user-facing walkthrough.

> 📌 **Just installed?** Hard-refresh (Ctrl+Shift+R / Cmd+Shift+R) any GitHub PR tab that was already open when you installed — see [INSTALL.md → Just installed?](INSTALL.md#just-installed).

### For local development

1. `git clone https://github.com/chienyuanchang/rich-diff-comments`
2. Open Chrome → `chrome://extensions/` (or Edge → `edge://extensions/`)
3. Enable **Developer mode**
4. Click **Load unpacked** and select the cloned folder
5. Open any GitHub PR → **Files changed** → toggle rich diff on a `.md` file

After editing `content.js`, click the reload icon on the extension card and hard-refresh the PR (Ctrl+Shift+R).

## Usage

1. Open a PR → **Files changed** tab
2. Toggle **rich diff** (document icon) on any markdown file
3. Hover a block → click the `+` button → type → **Comment**
4. Existing comments appear inline as a `💬 N comments` badge — click to expand

## Files

```
manifest.json        Extension manifest (Manifest V3)
src/lib/             Pure helpers shared between extension + tests
  textMatch.js         block text → source-line matching
  responses.js         GitHub API response parsing, path validation, escapeHtml, formatTimeAgo
  tableRows.js         table row → source-line arithmetic
  markdownPreview.js   offline markdown → HTML for the Preview tab
  codeBlocks.js        fence detection + thread-head sorting
content.js           Main content script (DOM + fetch glue)
styles.css           Comment button and box styles
icons/               Extension icons
tests/               Node test runner specs (`npm test`)
test_md_files/       Synthetic Markdown fixture for manual rich-diff testing
docs/APPROACH.md     Strategy and design choices (start here)
docs/DEV_NOTES.md    Implementation notes & GitHub internal data shapes
docs/PUBLISHING.md   Store submission and release workflow
```

## Tests

Two suites, both local — no live github.com calls.

```bash
npm install         # one-time: fetches jsdom + @playwright/test (devDeps only)
npx playwright install chromium    # one-time: ~150 MB Chromium for e2e tests

npm test            # 268 fast unit tests (Node:test + jsdom), ~2s
npm run test:e2e    # 20 Playwright e2e tests in headless Chromium, ~35s
npm run test:all    # both
```

**Unit tests** (`tests/*.test.js`) cover the pure helpers (line matching, response parsing, table arithmetic, code-block fence detection, anchor-key encoding) and DOM-coupled glue (per-file block→line mapping, `+`-button anchor selection, `styles.css` coverage).

**E2E tests** (`tests/e2e/*.spec.js`) drive the extension end-to-end against captured rich-diff HTML fixtures — covers what jsdom can't: real CSS layout (is the `+` actually visible?), real `:hover` semantics, real keydown events. Catches the class of bug that passes unit tests but fails in a browser.

The extension itself ships zero runtime npm dependencies — `jsdom` and `@playwright/test` are devDependencies only. The published zip contains no `node_modules`, no `package.json`, no test files.

The network layer (posting comments to GitHub) and drag-range tinting aren't unit-tested — they're covered by the [manual test checklist](docs/DEV_NOTES.md#manual-test-checklist).

## Packaging a release

Build a publish-ready zip for the Chrome Web Store / Edge Add-ons:

```powershell
# From this folder
.\scripts\package.ps1
# → rdc-<version>.zip   (version is read from manifest.json)
```

See [docs/PUBLISHING.md](docs/PUBLISHING.md) for the full publishing workflow (store submission, listing copy, permissions justification, versioning).

For a guided pre-submission audit + per-version release-doc generation, the [`rdc-publish-check`](.github/skills/rdc-publish-check/SKILL.md) skill automates the workflow.

## Limitations

- Mermaid diagrams and other non-text blocks can't be matched against source — comments near them may anchor to the previous matched block.
- Lines outside any diff hunk are rejected by GitHub with `Line could not be resolved`.
- Requires the rich-diff (prose-diff) view to be active for a file.

## See also

- [docs/FEATURES.md](docs/FEATURES.md) — full feature list, roadmap, gap analysis.
- [docs/APPROACH.md](docs/APPROACH.md) — strategy and design choices (start here if you're new).
- [docs/DEV_NOTES.md](docs/DEV_NOTES.md) — internal GitHub data shapes, gotchas, and debugging recipes.

## Legal

This is an independent, third-party browser extension. It is not affiliated with, endorsed by, sponsored by, or otherwise connected to GitHub, Inc. "GitHub" is a registered trademark of GitHub, Inc., and is used here only to identify the service this extension works with.

Released under the [MIT License](LICENSE).
