# Changelog

All notable changes to Rich Diff Comments for GitHub. Follows [Keep a Changelog](https://keepachangelog.com/) loosely; versions follow [SemVer](https://semver.org/).

## [Unreleased]

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
