# Changelog

All notable changes to Rich Diff Comments for GitHub. Follows [Keep a Changelog](https://keepachangelog.com/) loosely; versions follow [SemVer](https://semver.org/).

## [Unreleased]

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
