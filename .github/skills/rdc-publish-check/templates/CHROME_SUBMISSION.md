# Chrome Web Store submission — v1.16.0

> Maintained for the GitHub extension release.
> Paste each section into the Chrome Web Store Developer Console.
> Dashboard: <https://chrome.google.com/webstore/devconsole>

## Submission notes (edit before submitting)

v1.16.0 adds optional Listening, opt-in online voices, and a sidebar changelog. When an online voice is used, the browser may send the PR text being read to its provider. No new permissions or host permissions were added. Review the store's data-use categories and certifications before submission.

<!--
Use this space for submission-specific context the reviewer should know
but that isn't true of every version. Examples:

- Resubmitting after rejection of v1.0.2 (violation ref: Purple Potassium).
  The unused `activeTab` permission has been removed; the extension now
  declares only `host_permissions: https://github.com/*`, which is
  actively used by every fetch() call in content.js.

- New host permission added in this version — see Host permission
  justification below for what changed and why.

- This version expands market scope / changes visibility from Unlisted
  to Public.

Delete this entire block if there's nothing submission-specific to say.
The block is HTML-commented so it won't render even if you forget.
-->

## Package

- **Expected zip:** `releases/1.16.0/rdc-1.16.0.zip` (relative to the repository root)
- **Manifest version:** `1.16.0`

## Product details

### Title (from package)

```
Markdown PR — Markdown PR Comments for GitHub
```

### Summary (from package, 132-char limit)

```
Comment, reply, resolve, and collapse sections directly in GitHub PR rich-diff (rendered markdown) view.
```

### Description

> *Focus on explaining what the item does and why users should install it.*
> *Lead with a short "What's new in recent releases" block grouping the **latest 3 versions** (newest first) under per-version `vX.Y.Z (YYYY-MM-DD)` sub-headers so existing users (who see this listing after auto-update) immediately notice recent changes — the dates match the `## [X.Y.Z] — YYYY-MM-DD` headings in `CHANGELOG.md`. Keep it to 1–2 bullets per version, 4–6 total — the full list still lives in the "What's new in this version" section below and in `CHANGELOG.md`.*

```
🆕 What's new in recent releases

v1.16.0 (2026-11-26)
• Listen to changes with highlighted sentences and optional online voices; Listening settings stay in sync across open PR tabs.
• Discover updates in the sidebar and revisit the complete notes for the latest five releases.

v1.15.0 (2026-11-24)
• Opt in to opening selected Markdown files in rich diff automatically, including on the first selection.
• Find visibility and behavior settings together under the gear, with an indicator for hidden content and Restore defaults.

v1.14.0 (2026-11-03)
• View options lets you show or hide removed content and resolved comments independently.
• Comments stay on the correct lines on newer GitHub file pages, and deleting a comment no longer returns you to a previously visited section.

📌 Just installed? Hard-refresh (Ctrl+Shift+R / Cmd+Shift+R) any GitHub PR tab that was already open when you clicked Add to Chrome — the extension only activates on tabs loaded AFTER install. New tabs work automatically.

—

GitHub's "Files changed" rich-diff renders Markdown beautifully — design docs, dev plans, READMEs — but provides no way to click on a paragraph and leave a review comment (using Azure DevOps? Try our companion extension: https://chromewebstore.google.com/detail/markdown-pr-comments-for/habbfnkhgmnkhlbakjlnapadamjijbdh). You have to flip back to source-diff mode to comment, then back again to see how it renders. This extension closes that gap.

What it does:

• Hover any paragraph, heading, list item, table row, or code block in rich-diff and a blue "+" appears. Click it, type a comment, click Comment. The comment posts as a real PR review comment on the correct source line.
• Drag the "+" from one block to another to leave a multi-line range comment.
• Existing review threads render inline as "N comments" badges, anchored to the rendered block they belong to. Expand a thread to read, reply, resolve, or unresolve — all without leaving rich-diff.
• Commented table rows and fenced-code lines keep persistent markers beside the affected content. Shared rows or lines show a count and cycle through their conversations by mouse or keyboard.
• Copy a direct link or the original Markdown body from any visible review comment's header.
• Comment box matches GitHub's UI: Markdown toolbar, Write / Preview tabs, @mention autocomplete, Cmd/Ctrl+Enter to submit.
• Threads sidebar — a draggable, resizable panel lists review threads on the page, with prev / next navigation and j / k / h / l keyboard shortcuts. Press `t` to toggle the sidebar, `Shift+T` to reset its position.
• View options — open the sidebar's gear to control removed content and resolved comments independently, or opt in to automatically rendering selected Markdown files while respecting your choice to switch a file to source. An indicator shows when content is hidden, and Restore defaults resets the options.
• Changes tab — a list of every changed block in document order with an added / removed / mixed glyph and a snippet, so you can scan the edits without reading the kept prose. Step through with `[` / `]`, click the page icon in the header to jump to the next change in one tap, or press `1` / `2` / `3` to switch sidebar tabs (Changes / Threads / Outline) from the keyboard.
• Listening — off by default; optionally read changes aloud with highlighted sentences and adjustable voice and speed. On-device voices are preferred. If you allow online voices, playback may use one and your browser may send the PR text being read to its provider. Listening settings sync across open GitHub tabs.
• What's new — discover feature updates in the sidebar and revisit the complete notes for the latest five releases.
• Outline button in the sidebar header — click the book icon (or press `b`) to switch to the Outline tab. If any Markdown files in a standard PR aren't rendered yet, they're rendered first so the outline has headings to show. On GitHub's optimized large-PR view, the sidebar instead explains that Markdown files must be reviewed and switched to rich diff one at a time because offscreen files are unloaded.
• Outline tab — a heading tree of every modified Markdown file with a comment-count pill per section; click to jump, fold individual sections or bulk-fold by level (Fold H1 / H2 / H3 / Expand all).
• Heading anchor links (Table of Contents) work in rich-diff — clicking `[Section](#section)` scrolls to the heading.
• Avatars and GitHub-native role badges (Author, Owner, Member, Contributor, First-time contributor, …) on every comment.
• Collapse sections by heading to focus on what's left to review.

No Personal Access Token required — uses your existing GitHub session cookies. Works on public and private repos. The extension has no backend, telemetry, or analytics. Optional online voices may send spoken PR text to their provider.

Best for PRs that include Markdown content — design docs, dev plans, READMEs, and ADRs. The extension activates wherever GitHub's rich-diff view is available; on source-only files (.js, .py, etc.) GitHub's normal source-diff continues to work as it always has.

Open source on GitHub: https://github.com/chienyuanchang/rich-diff-comments — source, issue tracker, and roadmap.

—

This is an independent, third-party browser extension. It is not affiliated with, endorsed by, sponsored by, or otherwise connected to GitHub, Inc. "GitHub" is a registered trademark of GitHub, Inc., and is used here only to identify the service this extension works with.
```

### Category

Developer Tools

### Language

English

## Privacy

### Single purpose

> *An extension must have a single purpose that is narrow and easy-to-understand.*

```
Add inline review-comment affordances to GitHub Pull Request rich-diff (rendered markdown) views — letting users comment, reply, resolve threads, and collapse sections directly in the rendered view that GitHub itself does not natively support comments on.
```

### Permission justification

> *Remove any permission that is not needed to fulfill the single purpose of your extension. Requesting an unnecessary permission will result in this version being rejected.*

This extension declares **no** entries in `permissions` — only `host_permissions`. There is nothing to justify in the `permissions` field.

### Host permission justification

> *A host permission is any match pattern specified in the "permissions" and "content_scripts" fields of the extension manifest.*

```
The extension's entire functionality is to add inline review comments to github.com Pull Request pages. The host permission "https://github.com/*" is required so the content script can:

1. Read the rendered diff DOM on github.com pull request pages and inject the inline comment / thread UI.
2. Make same-origin requests back to github.com — using the user's existing session cookies — to fetch the raw markdown source of files in the PR, fetch existing review threads, post new review comments, reply to threads, and resolve / unresolve threads. These are the same internal endpoints used by GitHub's own web UI.
3. Fetch markdown previews (github.com/preview) and @mention suggestions (github.com/suggestions/...).

The extension's own requests go to github.com, and it has no analytics or telemetry. Listening uses browser speech synthesis; if the user allows online voices and playback uses one, the browser may send the PR text being read to that voice's provider.
```

### Remote code use

**Answer:** *No, I am not using Remote code.*

All JavaScript is bundled in the package (`content.js` + `src/lib/*.js`). No `eval`, no `new Function(string)`, no remotely-hosted scripts. Responses fetched from github.com are parsed as data only — never executed.

### Data usage

**What user data do you plan to collect from users now or in the future?** — review the store's current categories against the privacy policy and actual use:

- **Authentication information** — the extension relies on the browser-managed `github.com` session so it can make same-origin requests to GitHub's PR endpoints on the user's behalf. It does not read or store passwords, raw session cookies, Personal Access Tokens, or OAuth tokens.
- **Website content** — the extension reads rendered GitHub PR pages and raw Markdown. If the user allows online voices and playback uses one, the browser may send the PR text being read to its provider.

Review all categories and certifications against the current store requirements, including the optional transfer to an online voice provider, before making any certification.

### Privacy policy URL

```
https://github.com/chienyuanchang/rich-diff-comments/blob/main/PRIVACY.md
```

### Website / Homepage URL

```
https://github.com/chienyuanchang/rich-diff-comments
```

### Support URL

```
https://github.com/chienyuanchang/rich-diff-comments/issues
```

## Notes for reviewer (testing instructions, under 2,000 chars)

```
This extension activates only on GitHub Pull Request pages (https://github.com/*/pull/*). It adds inline review-comment buttons to the "rich diff" (rendered markdown) view, which GitHub itself does not support comments on.

== How to test ==

1. Install the extension. No login or test account needed — the reviewer's own GitHub session is sufficient.
2. Open any public PR that modifies a Markdown (.md) file, e.g. any closed PR from:
   https://github.com/microsoft/vscode/pulls?q=is:pr+is:closed+.md
3. Click "Files changed".
4. On a modified .md file, click the document/page icon in the file header to toggle the rich-diff (rendered) view.
5. Hover over any paragraph, heading, list item, or table row — a blue "+" appears at the left. Click it, type a comment, click "Comment". Verify it appears in GitHub's own "Conversation" tab too.
6. Existing review threads appear inline as "N comments" badges. Click to expand, then Reply or Resolve.
7. Optional: drag "+" from one block to another for a multi-line range comment. Click the chevron next to a heading to collapse a section.
8. Open View options from the sidebar's gear. Uncheck Show removed content or Show resolved comments; verify the document and Threads update. Try Restore defaults, then enable automatic rendering and select another Markdown file.
9. Enable Listening in View options and play a change. Online voices are separately opt-in; when used, the browser may send spoken PR text to the voice provider.

== Authentication ==

No separate credentials are required. The extension's GitHub requests use the reviewer's existing session cookies. Optional online voices may send spoken PR text to their provider. No telemetry or analytics.

== Dependencies ==

No extension backend. Online speech providers are optional.

Privacy policy:
https://github.com/chienyuanchang/rich-diff-comments/blob/main/PRIVACY.md
```

## Distribution

- **Visibility:** Unlisted (install via link only — doesn't appear in store search)
- **Region:** All regions

## What's new in this version

### v1.16.0 — 2026-11-26

#### Added

- **Listen to the changes (optional).** Read changes aloud with highlighted sentences and navigate without being pulled back while browsing.
- **Choose online voices (optional).** Online voices may send the PR text being read to their provider.
- **See what's new.** Discover feature updates and browse the complete notes for the latest five releases from the sidebar.

#### Changed

- **Listening settings stay in sync across open pull request tabs.** Turning off Listening or online voices also stops playback in the other tabs.
- **The sidebar makes room for Listening and help controls.**

#### Fixed

- **Navigation keeps targets visible below GitHub's sticky headers.**
- **The sidebar keeps its controls visible and remembers its height.**

### v1.15.0 — 2026-11-24

#### Added

- **Open selected Markdown files in rich diff automatically.** Turn on Render Markdown when selected in View options to open a file from the file tree or Jump to file in rich diff, including on the first selection. If you manually switch a file to source diff, later selections keep it in source while you stay on the same pull request's Files changed page. Your source choice resets when you leave Files changed, reload, or switch pull requests.

#### Changed

- **Find review settings together.** View options now groups visibility and behavior settings under a gear, shows when content is hidden, and lets you restore the default settings.

### v1.14.0 — 2026-11-03

#### Added

- **Read rich diff with less clutter.** Uncheck Show removed content in View options to hide deletions while retaining added and unchanged content and access to conversations.

#### Changed

- **Choose which conversations you see.** Uncheck Show resolved comments to hide resolved conversations throughout the document and Threads; counts and markers follow your choice.
- **Display settings are together in View options.** Independent checkboxes control removed content and resolved comments, with an indicator when either is hidden.

#### Fixed

- **Comments stay anchored to the correct lines on GitHub's newer file pages**, avoiding shifted comment locations and rejected submissions.
- **Deleting a comment keeps you near the discussion**, rather than returning to a previously visited section.

<!-- End of submission copy. -->
