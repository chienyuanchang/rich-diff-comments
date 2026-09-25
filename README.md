# Markdown PR Comments for GitHub and Azure DevOps

Two separate Chrome/Edge extensions that let you leave **and view** inline pull-request review comments directly in rendered Markdown:

- **Markdown PR — Markdown PR Comments for GitHub** targets GitHub rich diff.
- **Markdown PR — Azure DevOps PR Comments** targets Azure DevOps Preview mode.

Install only the target you use; each package requests access solely to its own service.

## Problem

GitHub rich diff and Azure DevOps Preview render Markdown beautifully, but neither provides the complete block-level review workflow available in source diff. Reviewers otherwise switch views repeatedly to comment, find conversations, and scan what changed.

## What this does

### Common features

- Overlays a `+` button on every paragraph, heading, list item, table row, and code block in the rendered Markdown review surface.
- Click `+` → write a comment → posts as a real PR review comment on the correct source line.
- Renders existing review threads inline at the rendered block that corresponds to each commented line.
- **Reply** to threads, **resolve / unresolve** them, and **edit / delete** your own comments from the rendered view.
- **Mention teammates:** type `@` in a comment, reply, or edit to search host-supported people and preserve native notifications.
- **Commented table rows and fenced-code lines stay identifiable:** persistent markers show conversation counts and cycle through threads by mouse or keyboard.
- **Copy a direct link** to any visible review comment from its header.
- **Threads sidebar** docked to the right edge lists every review thread (author, snippet, file:line, and target-supported status tags) — click to jump, with prev/next chevrons and a comment counter.
- **Outline tab** in the sidebar shows the heading tree of every changed `.md` file with comment-count pills, per-section folding, and bulk `Fold H1 / H2 / H3` / `Expand all` controls.
- **Changes tab** in the sidebar lists every changed block (paragraph / list item / table row / code block / heading / blockquote) with a `+` / `−` / `±` kind glyph, file:line, and a snippet. The header also gets a `◀ N/M ▶` counter so you can step through changes without opening the tab. Best way to scan a Markdown PR for the first time without re-reading the unchanged prose.
- **Native file navigation stays synchronized:** clicking a file in either host's file tree updates the rendered review surface and the extension's Changes, Threads, and Outline context; extension navigation selects the corresponding native file.
- **Copy Markdown:** copy a rendered comment's original Markdown body for reuse in another discussion or document.
- **Keyboard shortcuts:** `j` / `k` next / previous thread, `h` / `l` first / last thread, `[` / `]` previous / next change, `{` / `}` (Shift+[, Shift+]) first / last change, `1` / `2` / `3` switch sidebar tab (Changes / Threads / Outline), `t` toggle the sidebar, `Shift+T` reset its position.
- No PAT required — each target uses the existing signed-in session for its service.

### GitHub-specific features

- **Start rendered review across the pull request:** render every changed Markdown file as rich diff in one sweep when GitHub's PR mode can retain them; optimized large PRs receive one-file-at-a-time guidance.
- **Rich-diff integration:** preserve GitHub's added/removed rendering, expose outdated-thread state and author-association badges, and keep heading anchor links working in rendered Markdown.

### Azure DevOps-specific features

- **Open Markdown Preview in one click:** select the current or first changed Markdown file and retain Preview mode while moving between files.
- **Preview change highlighting:** added sections are green, modified sections use a warm warning highlight, and new files receive a subtle marker.
- **PR-wide source analysis before Preview visits:** build Changes and Outline from pull-request source data before every Markdown file has been opened in Preview.

See the shared [feature parity roadmap](docs/FEATURES.md) for both targets and the small [GitHub](docs/github/FEATURES.md) / [Azure DevOps](docs/ado/FEATURES.md) platform notes for host-specific behavior.

## Install

### For end users

**Azure DevOps:**

- **Chrome / Brave / Vivaldi / Arc / any Chromium browser:** <https://chromewebstore.google.com/detail/markdown-pr-comments-for/habbfnkhgmnkhlbakjlnapadamjijbdh>
- **Microsoft Edge:** <https://microsoftedge.microsoft.com/addons/detail/ajgoipjphffaapagamibikngconoanac>

**GitHub:**

- **Chrome / Brave / Vivaldi / Arc / any Chromium browser:** <https://chromewebstore.google.com/detail/markdown-pr-comments-for/bdkcmcdfnhonfcpdgcmemkpcmnhnhemj> — short link: <https://aka.ms/md-pr>
- **Microsoft Edge:** <https://microsoftedge.microsoft.com/addons/detail/agomibenjlnikaldoddminkjbokfocgb>

No separate login, setup, or Personal Access Token is required. See [INSTALL.md](INSTALL.md) for both walkthroughs.

> 📌 **Just installed?** Hard-refresh (Ctrl+Shift+R / Cmd+Shift+R) any GitHub or Azure DevOps PR tab that was already open when you installed — see [INSTALL.md → Just installed?](INSTALL.md#just-installed).

### For local development

1. `git clone https://github.com/chienyuanchang/rich-diff-comments`
2. Open Chrome → `chrome://extensions/` (or Edge → `edge://extensions/`)
3. Enable **Developer mode**
4. Click **Load unpacked** and select one target folder:
  - **GitHub:** `extensions/github/`
  - **Azure DevOps:** `extensions/ado/`
5. Open a pull request's changed-files view. Select rich diff for a GitHub Markdown file, or use the Azure DevOps sidebar's **Open Markdown Preview** action.

After editing a target's content script, click the reload icon on the extension card and hard-refresh the PR (Ctrl+Shift+R). If you edit anything under `src/lib/`, run `.\scripts\dev-sync.ps1 -Target github` or `-Target ado` first, then reload that extension.

## Usage

1. Open a PR's changed-files view
2. Select **rich diff** for a GitHub Markdown file, or click **Open Markdown Preview** in the Azure DevOps sidebar
3. Hover a block → click the `+` button → type → **Comment**
4. Existing comments appear inline as a `💬 N comments` badge — click to expand

## Files

```
extensions/github/     Chrome / Edge load unpacked from here
  manifest.json           Extension manifest (Manifest V3)
  content.js              Main content script (DOM + fetch glue)
  styles.css              Comment button and box styles
  icons/                  Extension icons
  src/lib/                Mirrored from repo-root src/lib (git-ignored)
  PRIVACY.md              Mirrored from repo-root PRIVACY.md (git-ignored)
extensions/ado/        Separate Azure DevOps Chrome / Edge extension
  manifest.json           ADO-only hosts and package metadata
  content.js              ADO Preview, REST, comments, and navigation UI
  styles.css              Fluent light/dark/high-contrast interface
  icons/                  Reversed-color ADO icon set
  src/                    Mirrored shared helpers + ADO adapter (git-ignored)
  PRIVACY.md              Mirrored from PRIVACY_ADO.md (git-ignored)
src/lib/               Shared pure helpers — source of truth
  textMatch.js            block text → source-line matching
  responses.js            GitHub API response parsing, path validation, escapeHtml, formatTimeAgo
  tableRows.js            table row → source-line arithmetic
  markdownPreview.js      offline markdown → HTML for the Preview tab
  codeBlocks.js           fence detection + thread-head sorting
scripts/
  package.ps1             Build the publish zip (-Target github|ado)
  dev-sync.ps1            Mirror src/lib + PRIVACY.md into extensions/<target>/
tests/                 Node test runner specs (`npm test`)
test_md_files/         Synthetic Markdown fixture for manual rich-diff testing
docs/github/APPROACH.md   GitHub strategy and design choices
docs/FEATURES.md       Shared feature parity roadmap and target status
docs/github/FEATURES.md   GitHub-specific feature mechanics and constraints
docs/ado/FEATURES.md      ADO-specific feature mechanics and constraints
docs/github/DEV_NOTES.md  Implementation notes & GitHub internal data shapes
docs/ado/ADO_DEV_NOTES.md ADO REST, DOM, lifecycle, and debugging findings
docs/ado/ADO_ADAPTER_PLAN.md   Design and validation record for the Azure DevOps target
docs/PUBLISHING.md     Store submission and release workflow
```

## Tests

All suites are local — no live GitHub or Azure DevOps calls.

```bash
npm install         # one-time: fetches jsdom + @playwright/test (devDeps only)
npx playwright install chromium    # one-time: ~150 MB Chromium for e2e tests

npm test                  # 410 unit/static tests (Node:test + jsdom)
npm run test:e2e          # 21 GitHub Playwright fixtures
npm run test:e2e:ado      # 63 ADO Preview + mocked REST Playwright fixtures
npm run test:e2e:all      # both browser targets
npm run test:all          # Node tests plus both browser targets
```

**Unit tests** (`tests/*.test.js`) cover the pure helpers (line matching, response parsing, table arithmetic, code-block fence detection, anchor-key encoding) and DOM-coupled glue (per-file block→line mapping, `+`-button anchor selection, `styles.css` coverage).

**GitHub E2E tests** (`tests/e2e/*.spec.js`) drive the GitHub extension against captured rich-diff HTML fixtures. **ADO E2E tests** (`tests/e2e-ado/*.spec.js`) drive the separate ADO manifest against Preview-shaped fixtures and a stateful mocked ADO REST API. Both cover what jsdom cannot: real CSS layout, `:hover`, keyboard events, scrolling, and SPA timing.

The extension itself ships zero runtime npm dependencies — `jsdom` and `@playwright/test` are devDependencies only. The published zip contains no `node_modules`, no `package.json`, no test files.

GitHub network mutations remain covered by the [manual test checklist](docs/github/DEV_NOTES.md#manual-test-checklist). The ADO fixture suite covers create, reply, status, edit, and delete requests without contacting a live organization.

## Packaging a release

Build a publish-ready zip for the Chrome Web Store / Edge Add-ons:

```powershell
# From this folder
.\scripts\package.ps1
.\scripts\package.ps1 -Target ado
# → rdc-<version>.zip for GitHub; rdc-ado-<version>.zip for ADO
```

See [docs/PUBLISHING.md](docs/PUBLISHING.md) for the full publishing workflow (store submission, listing copy, permissions justification, versioning).

For a guided pre-submission audit + per-version release-doc generation, the [`rdc-publish-check`](.github/skills/rdc-publish-check/SKILL.md) skill automates the workflow.

## Limitations

- Mermaid diagrams and other non-text blocks can't be matched against source — comments near them may anchor to the previous matched block.
- Requires rendered Markdown to be active for the file (GitHub rich diff or Azure DevOps Preview).
- Service APIs may reject comments on source lines that are not reviewable in the current pull-request iteration.

## See also

- [docs/FEATURES.md](docs/FEATURES.md) — authoritative shared roadmap and GitHub/ADO parity status.
- [docs/github/FEATURES.md](docs/github/FEATURES.md) and [docs/ado/FEATURES.md](docs/ado/FEATURES.md) — host-specific mechanics, constraints, and intentional differences.
- [docs/github/APPROACH.md](docs/github/APPROACH.md) — GitHub strategy and design choices (start here if you're new).
- [docs/github/DEV_NOTES.md](docs/github/DEV_NOTES.md) — internal GitHub data shapes, gotchas, and debugging recipes.
- [docs/ado/ADO_DEV_NOTES.md](docs/ado/ADO_DEV_NOTES.md) — Azure DevOps REST, DOM, lifecycle, and debugging findings.

## Legal

These are independent, third-party browser extensions. They are not affiliated with, endorsed by, sponsored by, or otherwise connected to GitHub, Inc. or Microsoft Corporation. "GitHub" and "Azure DevOps" are used only to identify the services the extensions work with.

Released under the [MIT License](LICENSE).
