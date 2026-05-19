# Changelog

All notable changes to Rich Diff Comments for GitHub. Follows [Keep a Changelog](https://keepachangelog.com/) loosely; versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Added

- **Threads sidebar (v1).** Right-docked collapsible panel listing every thread on the current page — author, snippet, file:line, resolved/outdated tags. Click a card to smooth-scroll to the thread (with a brief flash). Header `↑` `n / total` `↓` prev/next buttons; same nav via the `g j` / `g k` keyboard chord. "Unresolved only" toggle. Drag the header to move; drag the bottom-right corner to resize. Collapsed state, filter state, position, and size all persist in `localStorage`. Auto-hides when the page has no threads. Foundation for the planned Outline tab and quick-reply card UI — see [FEATURES.md → Threads sidebar](docs/FEATURES.md).
- **Pure sidebar helpers** extracted to `src/lib/sidebar.js`: `buildSnippet`, `clampDragPos`, `nextWrappingIndex`. Covered by 21 new unit tests in `tests/sidebar.test.js`.

### Fixed

- **Scroll position is preserved across re-inits.** After posting a reply / edit / delete / resolve, GitHub's React optimistic update tripped our `MutationObserver` and triggered a full re-init, which briefly removed every injected block and reset the page to `scrollY = 0`. `scheduleReinit()` now snapshots `window.scrollY` before the debounce and restores it after `init()` finishes (`requestAnimationFrame` + microtask fallback). URL-navigation re-inits still land at top as before.
- **Deleted blocks no longer drift downstream line numbers.** On diffs with deletions, rich-diff still renders the deleted prose (wrapped in `<del>` / `.removed`). The DOM walker used to treat those blocks like any other, fail the text match against the post-change source, and consume a `lastLine + 1` nudge — so every subsequent block was anchored that many lines too early. The walker now detects `<del>` / `<s>` / `.removed` ancestors and skips those blocks entirely (no `+` attached, no line consumed). The same selectors are now also escaped in `topUnderlinedAncestor` so the comment box / threads don't inherit `<del>`'s strikethrough painting. Commenting directly on deleted lines (which would require posting with `side: "left"` against the base file) is tracked separately in [FEATURES.md](docs/FEATURES.md).

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
