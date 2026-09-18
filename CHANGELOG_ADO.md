# Changelog — Markdown PR — Azure DevOps PR Comments

All notable user-visible changes to the Azure DevOps browser extension are recorded here. Versions follow SemVer.

## [Unreleased]

### Added

- **Table comments now identify their exact row.** A persistent marker appears on each table row with review threads; when several conversations share a row, the marker shows their count and cycles through them by mouse or keyboard.

## [1.2.0] — 2026-09-17

### Added

- **Changed content is now visible directly in Markdown Preview.** Added sections use a green highlight, modified sections use a warm warning highlight, and completely new files receive a subtle **NEW FILE** marker without tinting the entire document.
- **Mention teammates while reviewing rendered Markdown.** Type `@` in a new comment, reply, or edit to search for people—including multi-word names—and select them with the keyboard or mouse. Posted conversations and the Threads sidebar show readable names instead of identity codes.
- **Loading progress remains clear when the sidebar is collapsed or still gathering review data.** The compact header shows **Loading…**, while expanded Changes, Threads, and Outline panes describe what they are loading instead of briefly showing an empty state.

### Changed

- **The extension is now named “Markdown PR — Azure DevOps PR Comments.”** The shorter name identifies Azure DevOps sooner in browser and store displays; existing installations update automatically with no action required.

### Fixed

- **Comments on list items now stay attached to the selected bullet.** The comment button is also centered on the bullet's first rendered line, including list items with nested content.
- **Cross-file Outline navigation now keeps the selected section centered in the sidebar.** After opening a heading in another Markdown file, the Outline stays with that destination and shows nearby sections for context instead of returning to the top.

## [1.1.0] — 2026-09-15

### Added

- **Start rendered Markdown review from any pull request Files page.** Choose **Open Markdown Preview**, and the extension opens the selected Markdown file—or an available changed Markdown file when necessary—in Preview automatically. Changes, Threads, and Outline remain ready as you move between files.

### Fixed

- **Switching directly between pull requests now shows the new pull request's review data.** The extension refreshes the page once so Changes, Threads, and Outline are rebuilt for the newly opened pull request instead of retaining previous items.

## [1.0.0] — 2026-08-28

### Added

- **Review rendered Markdown directly in Azure DevOps pull requests.** Hover paragraphs, headings, list items, table rows, and code blocks in Preview mode to add real Azure DevOps review comments without switching back to source diff.
- **Create precise single-line and multi-line comments.** Drag between rendered blocks to select a range, or target an individual line inside a fenced code block; the selected range stays visibly marked beside its thread.
- **Read and manage review threads inline.** Existing conversations appear next to the rendered section they belong to, with reply, resolve, reopen, edit, and delete actions available in place.
- **Write comments with Markdown tools and Preview.** The editor includes formatting controls, Write/Preview tabs, automatic textarea growth, keyboard submission, and safe cancel behavior.
- **Navigate the full pull request from one sidebar.** Changes, Threads, and Outline tabs provide file-grouped cards, current-item highlighting, unresolved filtering, previous/next controls, and keyboard shortcuts.
- **Scan every Markdown change across the pull request.** Changed sections are grouped in Azure DevOps file-tree order, with current-file progress and pull-request totals. New, deleted, and renamed Markdown files receive clear summary cards.
- **Browse headings from every changed Markdown file.** The Outline shows the pull-request-wide document structure, section thread counts, cross-file navigation, per-heading folding, and Fold H1/H2/H3/Expand all controls.
- **Collapse long rendered sections.** Heading chevrons hide content until the next heading at the same or higher level, helping reviewers focus on unfinished sections.
- **Use a complete keyboard workflow.** Switch tabs with `1`/`2`/`3`, open Outline with `b`, toggle/reset the sidebar with `t`/`Shift+T`, walk threads with `j`/`k`/`h`/`l`, and walk changes with `[`/`]`/`{`/`}`.
- **Changes, Threads, and Outline stay in Azure DevOps file-tree order.** Opening another file highlights its group without moving it, so long review lists remain stable.
- **The sidebar header uses distinct document-change and discussion icons.** Each icon jumps to the first matching item in the current file, while scoped counters such as `2/4 (11)` show file progress and the pull-request total. Files with no threads show a dimmed `0/0 (11)` instead of a misleading flat count.
- **The complete interface follows Azure DevOps light, dark, and Windows high-contrast themes.** Theme changes update in place without closing drafts or resetting sidebar state.
