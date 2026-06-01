# Markdown PR Comments for GitHub

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
- **One-click "Render all Markdown files as rich-diff"** flips every `.md` file in the PR from source-diff to rich-diff in a single sweep, so comments on those files load automatically.
- **Keyboard shortcuts:** `j` / `k` next / previous thread, `h` / `l` first / last, `t` toggle the sidebar, `Shift+T` reset its position.
- No PAT required — uses your existing GitHub session cookies (works for public and private repos).

(For submitting a full review / approve / request changes, use GitHub's native **"Review changes"** button at the top of the Files-changed tab.)

See [docs/FEATURES.md](docs/FEATURES.md) for the full feature list and roadmap.

## Install

### For end users

> *Chrome Web Store and Edge Add-ons listings are pending review. Until they're live, use the developer-mode install below.*

<!-- Once the listings are approved, replace this block with:
- **Chrome / Brave / Vivaldi / Arc:** <https://chromewebstore.google.com/detail/rich-diff-comments-for-github/...>
- **Microsoft Edge:** <https://microsoftedge.microsoft.com/addons/detail/...>
-->

See [INSTALL.md](INSTALL.md) for the user-facing walkthrough.

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

Pure helpers (line matching, response parsing, table arithmetic, code-block fence detection, anchor-key encoding) have unit tests using Node's built-in test runner — no `npm install` required.

```bash
node --test tests/*.test.js
```

DOM glue and the network layer aren't unit-tested — they're covered by the [manual test checklist](docs/DEV_NOTES.md#manual-test-checklist).

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
