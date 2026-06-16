# Changelog

All notable changes to Markdown PR Comments for GitHub (formerly *Rich Diff Comments for GitHub*). Follows [Keep a Changelog](https://keepachangelog.com/) loosely; versions follow [SemVer](https://semver.org/).

## [Unreleased]

## [1.5.1] — 2026-06-16

### Fixed

- **Comments on Markdown files that start with YAML frontmatter (the `---` ... `---` block at the top of design docs and dev plans) no longer land at the bottom of the file.** Headings, paragraphs, list items, and tables now anchor to their real source lines whether or not the file has frontmatter.

### Added

- **You can now leave inline `+` comments on YAML frontmatter rows.** Hover any row in the metadata block at the top of a file — `area:`, `status:`, `related:`, etc. — and click the `+` to comment on the metadata without flipping to source-diff.

## [1.5.0] — 2026-06-12

### Added

- **Changes navigation — jump between added / removed / modified blocks without reading the kept prose around them.** A new **Changes** tab in the sidebar lists every changed paragraph, list item, table row, code block, heading, and blockquote in document order, with a kind glyph (`+` added / `−` removed / `±` mixed), a coloured left rail, a file:line label, and a snippet of the changed text. Click a card to jump; the target block briefly pulses so you see where you landed. The sidebar header also gets a `◀ N/M ▶` counter next to the existing thread `↑ ↓` (separated by a subtle divider so the two are clearly different concerns), and the same prev/next is bound to `[` and `]` (vim's `[c` / `]c` convention). The Changes tab and the header counter auto-hide when there's nothing to navigate (e.g. before any file is opened in rich-diff). This is the first thing reviewers reach for when opening a Markdown PR for the first time — scan the edits without re-reading the unchanged prose.
- **First / last change shortcuts: `Shift+[` (`{`) jumps to the first change, `Shift+]` (`}`) to the last.** Mirrors `h` / `l` for threads. Useful for jumping back to the top of a long PR after scrolling deep, or skipping straight to the final hunk to check the end-state.
- **Tab-switch shortcuts: press `1`, `2`, or `3`** to switch the sidebar to Threads, Outline, or Changes respectively. Auto-expands the sidebar if it was collapsed so you don't end up swapping a tab hidden behind the slim bar. Tab labels now carry tooltips (`Threads (1)`, `Outline (2)`, `Changes (3)`) so the shortcut is discoverable on hover.
- **"Render all Markdown files as rich-diff" CTA now also appears in the empty Changes pane** — previously the Changes tab was hidden whenever no file was rendered, so users on a fresh `/changes` page never saw it; now the tab stays visible with the same primary action button that the empty Threads pane has, so the next step is obvious from any tab.

### Changed

- **Renamed to "Markdown PR — Markdown PR Comments for GitHub"** (was *Markdown PR Comments for GitHub*). Same extension, same install — the new "Short — Long" pattern means narrow contexts like the browser toolbar tooltip and store carousel cards show a short `Markdown PR` prefix that fits, while wider contexts (toolbar hover, store detail page, screen readers) still show the full descriptive name. Auto-updates to the new display name with no action needed from you.

### Fixed

- **Thread navigation (`↑` / `↓` and the `N/M` counter) no longer accidentally walks the new Changes cards.** The thread-nav code was using an unscoped CSS selector (`.grdc-sidebar-card`) that matched both lists; on pages with few unresolved comments and several changes, pressing `↓` on the Threads tab would scroll to a *change* in the document instead of the next thread, and the counter showed inflated counts (e.g. `1/5` with only 1 thread visible). Pinned by a new regression test that scans `content.js` for any unscoped variant of the selector.

## [1.4.0] — 2026-06-05

### Changed

- **Editing your own comment is now one click.** A direct `Edit` link sits in the comment header next to `GitHub ↗`, so you no longer have to open the `⋯` menu first. `Delete` still lives in `⋯` (one extra click + a confirm prompt) because it's destructive.

## [1.3.0] — 2026-06-02

### Changed

- **The Outline tab now shows a folder hint next to each file label** so multiple files with the same name (e.g. several `README.md` or `SKILL.md`) are easy to tell apart at a glance. Deeply-nested files show their depth with one `../` per ancestor folder — e.g. `../../foo/README.md` for `features/sdk/foo/README.md`. Hover the label to see the full path.

### Fixed

- **Outline toolbar's `Fold H1` / `Fold H2` / `Fold H3` / `Expand all` (and the per-row outline chevrons) no longer silently do nothing until you refresh the page.** After GitHub re-rendered a file's rich-diff DOM in place (e.g. flipping between source and rendered, or React replacing nodes), the chevron buttons attached to each heading became stale, so clicking the Outline toolbar quietly no-op'd. Outline-pane clicks now lazily re-attach the in-heading chevron if it's missing, so the buttons stay self-healing without a page refresh.

## [1.2.0] — 2026-06-01

### Changed

- **Renamed to "Markdown PR Comments for GitHub"** (was *Rich Diff Comments for GitHub*). Same extension, same install — the new name makes it obvious at a glance what the extension is for. The display name updates in your browser's extensions list and toolbar tooltip after the auto-update lands; no action needed from you.
- **New icon to match the new name** — a bold "M↓" mark inside a speech bubble, in GitHub blue. Replaces the previous design so the toolbar icon, extensions list, and store listing all read as one consistent product.

## [1.1.0] — 2026-05-29

### Added

- **The threads sidebar is now always available on PR rich-diff pages.** It used to disappear whenever no file was opened in rich-diff (so landing on a fresh "Files changed" view in source-diff mode showed nothing), and on small READMEs with very little structure. The sidebar now shows on every PR Files-changed page so it's always findable — even before you open the first file as rich-diff.
- **"Render all Markdown files as rich-diff" in one click.** A new book icon in the sidebar header (and a big blue button in the empty Threads pane) opens every `.md` file in the PR as rich-diff at once. A brief "Loading Markdown files…" splash appears while it works; your scroll position is restored when it's done. Comments on the newly-opened files load automatically. Files that are already in rich-diff are left alone.
- **Keyboard shortcuts to show, hide, and reset the sidebar.** Press `t` anywhere on a Files-changed page to toggle the sidebar between collapsed and expanded — handy when you've collapsed it once and can't find the slim bar. Press `Shift+T` to reset the sidebar to its default right-edge spot at full size — recovers from cases where you dragged it on a wider window and reopened the page on a smaller one.
- **"Fold H1" button in the Outline toolbar.** Joins the existing `Fold H2` / `Fold H3` / `Expand all`. Collapses every top-level heading at once so each document shrinks to just its title — gives you a one-screen overview of which files changed on a multi-file PR.
- **Helpful empty state in the Threads pane.** When no comments are loaded yet (common when you've just opened the PR and haven't switched any files to rich-diff), the pane now shows a clear "Render all Markdown files as rich-diff" button instead of an empty list, so the next step is obvious.

### Changed

- **Sidebar header now matches GitHub's link blue** so it reads as part of GitHub's own UI rather than a custom accent. The collapsed bar is much easier to spot against any page background in both light and dark mode.
- **The "Unresolved only" funnel button is much easier to read on the new header** — pressed and unpressed states use a clear color inversion (white-on-blue when off, blue-on-white when on) so you can tell at a glance whether the filter is active.

### Fixed

- **The sidebar can no longer get stranded offscreen after a window resize.** If you dragged the sidebar on a larger window and then reopened the PR on a smaller one (or changed browser zoom), the sidebar sometimes ended up entirely outside the visible area — invisible. It now always stays at least partly in view, and your original drop position is remembered, so growing the window again slides it back to where you put it.

## [1.0.2] — 2026-05-28

### Fixed

- **Inline comments on top-level list items now appear right under the item you commented on.** Before, leaving a comment on a top-level bullet in an added or deleted list could push the comment thread down below the entire list — so the comment looked like it belonged to the last item instead of the one you clicked. Comments now stay anchored to the correct bullet in every case.

## [1.0.1] — 2026-05-20

### Added

- **Threads sidebar.** A draggable, resizable panel docked to the right edge of the page that lists every review thread — with author, snippet, file:line, and resolved / outdated tags. Click a card to jump to the thread (the badge briefly flashes so you can see where you landed). The header has prev / next chevrons and a comment counter. Press `j` / `k` for next / previous thread, `h` / `l` for the first / last. A funnel icon toggles "Unresolved only" — visible while the sidebar is collapsed too, so you can filter without expanding. Collapse the sidebar to a slim bar; your collapsed state, filter, position, and size are remembered. Hidden automatically when the page has no threads, and also when you toggle to source-diff view (and back when you toggle to rich-diff).
- **Outline tab in the sidebar.** A second tab that shows the heading tree of every modified `.md` file in the PR, with a comment-count pill next to each section. Click a heading to jump to it; the current section is highlighted as you scroll. Per-row chevrons fold or expand individual sections. Toolbar buttons handle bulk folding: `Fold H2` / `Fold H3` (which flip to `Unfold` once everything's folded) and `Expand all`. Folding from the outline, the toolbar, or a heading's own chevron in the document all stay in sync.
- **Heading anchor links work in rich-diff.** Clicking a link like `[Change Log](#change-log)` from a Table of Contents now scrolls to the heading on rich-diff pages, just like it does on the rendered blob view.
- **Avatars and role badges in threads.** Every comment shows the author's avatar and matches GitHub's native source-diff badges: `Author` (the PR opener), plus `Owner` / `Member` / `Collaborator` / `Contributor` / `First-time contributor` / `First-timer` based on the commenter's relationship to the repo. Both can appear together (e.g. `Owner` `Author` when the repo owner opens their own PR).

### Changed

- **Comment badges are easier to spot.** The inline "💬 N comments" pill is larger, has a stronger blue accent stripe on the left, and a subtle shadow so it stands out from surrounding markdown while you're scrolling.
- **Comment badges show a disclosure chevron.** Each badge now starts with a chevron that points down when the thread is open and right when it's collapsed, so the open / closed state is visible at a glance. Clicking the badge still toggles the thread (no behavior change, just clearer affordance).
- **Cleaner thread look.** Threads use a pale-blue card on a white background to clearly mark the review surface, and replies inside a thread are tinted slightly deeper so you can see the nesting at a glance.
- **Better section-collapse affordance.** The fold chevron next to each heading now sits in a small left-side area instead of in front of the heading text, so headings no longer shift when the chevron appears.

### Fixed

- **Scroll position is preserved across re-renders.** After you reply, edit, delete, or resolve a comment, the page no longer jumps to the top — you stay anchored on the thread you were reading.
- **Deleted blocks no longer shift line numbers.** Comments on lines after a deleted block were sometimes off by one (per deleted block) because the deleted prose still appears in rich-diff. They're now correctly skipped, so line numbers stay accurate. Comments attached next to deleted blocks also no longer pick up strikethrough styling from the surrounding text.
- **Comment badges respect dark mode.** On pages where GitHub didn't fully define its theme tokens, the badge could appear with a bright light-mode background even when the rest of the page was dark. The badge now uses dark-mode-appropriate colors in that situation.
- **Section collapse stops at the right place.** Clicking the fold chevron next to a heading could collapse content past the next same-level heading when GitHub's rich-diff grouped hunks into sibling containers. The fold now correctly stops at the next heading at the same or shallower level.

## [1.0.0] — 2026-05-18

Initial release as an independent third-party extension.

### Features

- **Inline `+` button** on every commentable block in GitHub PR rich-diff view — paragraphs, headings (H1–H6), list items (including nested), table rows, and code blocks.
- **Click `+` → write a comment → post** as a real PR review comment on the correct source line. Works on public and private repos.
- **Drag `+` between blocks** to leave a multi-line range comment. The selected range tints yellow while dragging and stays highlighted for existing range threads.
- **Existing review threads render inline** as `💬 N comments` badges, anchored to the rendered block they belong to. Expand a thread to read replies, **reply**, **resolve / unresolve**, **edit your own comments**, or **delete your own comments** — all without leaving rich-diff.
- **Resolved / outdated thread state** is shown on the badge and dims the thread; resolving a thread auto-collapses its body, unresolving auto-expands.
- **GitHub-style comment box** with a Markdown toolbar, Write / Preview tabs (using GitHub's own renderer for full GFM), `@mention` autocomplete with full user list, and Cmd/Ctrl+Enter to submit.
- **Code-block features**: hover anywhere inside a `<pre>` and the `+` slides vertically to follow the cursor's line. The comment-box header shows the actual fence range (e.g. *"code block, lines 195–240"*).
- **Section collapse** by heading level — click the `▾` chevron next to any heading to fold that whole section. Useful for long design docs.
- **Source-diff sync** — after posting / replying / resolving / editing / deleting from rich-diff, toggling back to GitHub's source-diff view triggers a silent reload so source-diff comes back in sync.
- **No Personal Access Token required** — uses your existing GitHub session cookies. Works seamlessly on public and private repos.

### Privacy & security

- Single permission: `host_permissions: https://github.com/*`.
- All requests go to `github.com` only. No third-party servers, no telemetry, no analytics.
- See [PRIVACY.md](PRIVACY.md) for the full policy.

### Compatibility

- Manifest V3.
- Tested on Chrome, Edge, Brave, Vivaldi, Arc, and other Chromium-based browsers.
- Activates on `https://github.com/*/pull/*` pages.
- **Light and dark theme support** — uses GitHub's own Primer design tokens so the comment UI matches whichever theme the user has selected (per-account theme on github.com, not OS theme).
