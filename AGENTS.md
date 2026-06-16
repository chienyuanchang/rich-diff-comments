# Agent context: Markdown PR Comments for GitHub

A Chromium browser extension that adds inline review-comment UI to GitHub PR rich-diff (rendered markdown) pages. **Source of truth is here** (`c:\Local\local_repos\rich-diff-comments\`). A snapshot mirror lives at `content-understanding/tools/github-rich-diff-comments/` — **don't edit that copy**.

## Instructions

### CHANGELOG is user-facing — not engineering notes

Every entry in `CHANGELOG.md` (and the equivalent blocks in the store submission templates) must read like a feature announcement to someone who has never opened the source code.

- **Forbidden:** internal class / file / function names, CSS selectors, DOM-shape detail (`<th>` vs `<td>` cells), specific line numbers from a bug repro file, "we did X via Y" implementation talk, **dev infrastructure changes** (test suites, refactors, library extractions, build-system tweaks, devDependency bumps).
- **Required:** describe what the user sees, when they'd notice it, and why it's better. Use product names ("the threads sidebar", "the Outline tab"), not selectors.
- **When in doubt:** *"Would a non-developer Chrome extension user understand what changed for them?"* If no, it doesn't go in CHANGELOG.

**Full rules + examples:** [.github/skills/rdc-publish-check/SKILL.md → CHANGELOG / release-notes writing rules](.github/skills/rdc-publish-check/SKILL.md#changelog--release-notes-writing-rules).

### Where each kind of change belongs

| What | Where |
|---|---|
| User-visible feature or bug fix | `CHANGELOG.md` + the `Description` and `What's new` sections of `CHROME_SUBMISSION.md` / `EDGE_SUBMISSION.md` |
| Dev infrastructure (tests, refactors, lib extractions, devDeps) | Git commit message only — **NOT** CHANGELOG |
| Captured GitHub endpoint payloads, DOM quirks, "I thought X but actually Y" | [docs/DEV_NOTES.md](docs/DEV_NOTES.md) |
| Stable architecture decisions (why we forward-scan match, LEFT vs RIGHT side, edge-case strategy) | [docs/APPROACH.md](docs/APPROACH.md) |
| Feature roadmap, status, priority (P0–P3) | [docs/FEATURES.md](docs/FEATURES.md) |

### Tests

- `npm test` — 268 Node:test unit tests (~2s, no browser). Run before every commit touching JS.
- `npm run test:e2e` — 20 Playwright tests in headless Chromium (~35s). Run when touching DOM-coupled code (`content.js`, `src/lib/lineMap.js`, `styles.css`).
- `npm run test:all` — both suites.
- Preflight (`.github/skills/rdc-publish-check/scripts/preflight.ps1`) runs `npm test` only — add `test:e2e` to your manual flow when DOM behavior changed.

### What ships vs. what stays local

The published zip is built by [scripts/package.ps1](scripts/package.ps1) via an **allowlist**: `manifest.json`, `content.js`, `styles.css`, `src/`, `icons/`, `PRIVACY.md`. Everything else (`node_modules/`, `package.json`, `tests/`, `docs/`, `playwright.config.js`, `.github/`, `local-only/`) is naturally excluded; preflight's `-VerifyZip` mode also has a forbidden-paths denylist as a safety net. The extension ships **zero runtime npm dependencies** — `jsdom` and `@playwright/test` are dev-only.

### Skills

Under `.github/skills/`:
- **`rdc-feature-dev`** — the build-a-feature loop: identify → design in FEATURES.md → build → test → docs. Use when starting any new feature or bug fix.
- **`rdc-publish-check`** — release prep: bump version, update CHANGELOG, run preflight, build zip, publish to stores. Use for every release.

Each skill's `SKILL.md` has the detailed workflow. Consult them before improvising.

## Common mistakes to avoid

- **Putting dev-infra changes in CHANGELOG.** Test suites, refactors, performance work, devDep bumps don't belong there — they're invisible to users. They belong in commit messages.
- **Editing the mirror.** `content-understanding/tools/github-rich-diff-comments/` is a snapshot. All work goes here.
- **Hand-editing the published zip.** The zip is rebuilt from source by `release-prep.ps1` every release. Edits to the zip itself would be lost.
- **Adding to `[Unreleased]` without checking the user-facing rule.** If the change has no user impact, leave `[Unreleased]` empty — that's fine. An empty `[Unreleased]` between releases is healthier than one polluted with internals.
