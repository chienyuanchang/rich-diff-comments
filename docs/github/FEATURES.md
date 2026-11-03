# GitHub feature notes

This document records GitHub-specific behavior and constraints for the shared product roadmap in [Features & parity roadmap](../FEATURES.md). It is **not a second roadmap**: priorities and GitHub/ADO status are updated only in the shared document.

For durable GitHub architecture decisions, see [Approach](./APPROACH.md). For endpoint payloads, DOM findings, debugging recipes, and manual checks, see [GitHub developer notes](./DEV_NOTES.md). The implemented sidebar-header design is preserved in the [GitHub sidebar header v2 record](./SIDEBAR_HEADER_V2.md).

## Surface mapping

| Shared capability | GitHub implementation |
|---|---|
| Rendered review surface | GitHub's per-file rich-diff view on a pull request's Files changed page. |
| Activate rendered review | Each Markdown file has its own source/rendered toggle. The extension's render-all action opens every changed Markdown file in one pass. |
| Create and manage threads | Same-origin GitHub page-data endpoints use the existing signed-in session. |
| Comment preview | GitHub's server renderer provides full GitHub Flavored Markdown; the bundled renderer is a fallback. |
| Changes | Native rich-diff added/removed markers identify changed rendered blocks. New and deleted files receive summary cards. |
| Cross-file navigation | File-tree anchors, rendered file containers, and scroll position keep Changes, Threads, and Outline synchronized. |
| Lifecycle | Mutation and route observation rebuild the review surface as GitHub replaces rich-diff DOM or moves between pull requests. |
| Theme | Primer variables and defensive light/dark fallbacks match the active GitHub theme. |

## Current platform advantages

- `@mention` autocomplete uses GitHub collaborator suggestions and is pre-warmed during initialization.
- Comment bodies and previews can use GitHub's own renderer.
- GitHub exposes author-association and outdated-thread information, so the extension can show role badges and outdated state.
- Rich diff already marks additions and removals, so the extension does not need to calculate the document diff itself.

## Current platform constraints

- Comment actions differ in scope. Edit and Delete apply only to the reviewer's own comments, while Copy link and Copy Markdown work for every visible comment. Copy Markdown uses the stored raw body without generated attribution or links. GitHub's native menu also offers Quote reply, Reference in a new issue, and permission-gated Hide. Keep issue creation exploratory until there is evidence of demand, and keep Hide delegated to GitHub rather than reproducing moderation permissions and reason selection.
- Rich diff is enabled separately for each Markdown file, which is why GitHub needs the render-all action. Azure DevOps Preview is PR-wide and sticky instead.
- Render-all must move through intermediate viewports because GitHub mounts some file controls lazily; jumping directly to the end can skip files. The sweep should wait adaptively for newly exposed controls, retain a bounded fallback timeout, and use route data as the expected-file count when available. After activating the toggles, it must wait boundedly for each visible rich-diff root to enter layout, explicitly rerun review initialization so suppressed sweep-time mutations cannot omit Threads, then restore position. Keep the loading surface modal so pointer actions and extension navigation shortcuts cannot compete with temporary sweep scrolling; completion or cancellation restores the same file-relative reading position because enabling rich diff can change the height of every preceding file.
- The book action renders Markdown and selects Outline without expanding a collapsed sidebar. Collapse/expand remains owned by its dedicated control and `t`; when the reviewer expands later, the prepared Outline is already active.
- Long Threads, Changes, Outline, and TOC jumps must track the semantic target rather than trust one initial page coordinate. GitHub can revise lazy file heights while navigation is in progress, so distant jumps should avoid traversing every intermediate viewport and all jumps need bounded post-layout correction. Sidebar-card visibility updates must adjust only the sidebar's own scroll container.
- GitHub's virtualized large-PR mode unloads offscreen files, so it must never run the PR-wide sweep. Keep bulk controls hidden, but offer a sequential **Switch next Markdown file to rich diff** action that uses the ordered route inventory and GitHub's native file destination to mount and activate one file at a time. The action must not wrap at the end or assume offscreen rich-diff state is retained; live validation must confirm navigation to an initially unmounted file before release.
- Outline bulk controls currently apply Fold H1/H2/H3 and Expand all across every rendered Markdown file in the pull request. This is useful for PR-wide triage but broader than ADO's current-file behavior; labels do not yet make that scope explicit.
- A future Threads-toolbar **Collapse all conversations** / **Expand all conversations** action should affect conversation bodies across every currently rendered Markdown file. Badges and table/code markers remain visible so comments stay discoverable.
- The sidebar can collapse to its header and can be toggled with the keyboard, but unlike ADO it has no × control that fully hides it and no compact launcher for restoring it.
- Deleted prose appears in rich diff, but posting on it requires LEFT-side source mapping and payloads. That remains tracked in the shared roadmap.
- **View options** opens from the header's funnel icon in either expanded or collapsed mode. The tooltip and dropdown title both read View options. Two independent checkboxes use checked = visible: **Show removed content** and **Show resolved comments**. A filled blue funnel on white indicates that either option is unchecked, even when the dropdown is closed. The dropdown supports keyboard focus, Escape, and outside-click dismissal and appears above the sidebar when needed to fit the viewport.
- **Show removed content** is checked by default. Unchecking hides deletions across rendered Markdown files, including files rendered later, without removing host content or changing comment anchors. Addition highlights remain; deletion-only Changes stops are omitted, while conversations remain accessible subject to the independent resolved-comments option. Selecting a thread reveals hidden context around its mapped anchor until the next thread selection, option change, or review-data rebuild. This does not add LEFT-side mapping or recover conversations the existing renderer cannot anchor. The mode is not saved across page reloads or different pull requests.
- **Show resolved comments** inversely exposes the existing saved Unresolved only preference, preserving its default and stored value. Unchecking hides resolved conversation bodies and badges in both the document and Threads; table/code markers count and cycle only unresolved conversations, and range highlights and Outline counts follow the same filter. Resolving a conversation updates these surfaces immediately. Checking again restores conversations without resetting their expansion state or drafts. This does not change stored resolution state. The old Threads checkbox and separate eye button are replaced by View options.
- Valid HTML and syntax-highlighting constraints keep table-row and code-line thread bodies below the containing table or code block. Persistent keyboard-accessible markers now provide the in-place signal, show conversation counts, and cycle through threads without altering table or highlighted-code markup.
- Changes navigation currently covers rendered Markdown only. Extending it to source-diff hunks for other file types remains shared roadmap work.

## Open GitHub design notes

### Current-file focus

A 2026-07 attempt rebuilt filtered Changes and Threads panes whenever the viewport crossed a file boundary. It was reverted because transient blank file detection, click-navigation pinning, and rebuilt flat indexes could leave the pane empty or one file behind.

A retry should keep navigation state independent from presentation. Prefer collapsible file groups or CSS-only visibility over rebuilding lists during scroll, retain the last known valid file, and restore selection by stable card key rather than array index.

### Native comment form cloning

The extension deliberately builds its own editor. GitHub's native form is mounted by Primer React; cloning its DOM produces buttons and tabs without their React state, event handlers, upload context, or current hidden inputs. Reusing GitHub's rendering and suggestion endpoints is stable enough; coupling to private React fibers is not.

### Activation after installation

Chromium does not inject a newly installed content script into an already-open pull-request tab. Documentation currently tells users to refresh. A toolbar-badge prototype was rejected because new extension icons are usually hidden behind the extensions menu. An in-page prompt would require broader permissions and should be reconsidered only if user feedback shows the documentation is insufficient.

## GitHub-specific delegation

The extension continues to delegate these capabilities to GitHub's native Files changed interface:

- Submit, approve, or request changes for a complete review.
- Mark a file as viewed.
- Navigate the pull request's complete file tree.
- Work in source diff, where GitHub already supplies line-comment controls.
- Upload images through GitHub's native editor.
