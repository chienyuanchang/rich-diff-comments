# Azure DevOps feature notes

This document records Azure DevOps-specific behavior and constraints for the shared product roadmap in [Features & parity roadmap](../FEATURES.md). It is **not a second roadmap**: priorities and GitHub/ADO status are updated only in the shared document.

For the original port sequence and detailed acceptance records, see the [ADO adapter design and validation record](./ADO_ADAPTER_PLAN.md). For REST payloads, DOM findings, lifecycle behavior, debugging commands, and manual evidence, see [ADO developer notes](./ADO_DEV_NOTES.md).

## Surface mapping

| Shared capability | Azure DevOps implementation |
|---|---|
| Rendered review surface | Azure DevOps Markdown Preview on a pull request's Files page. Preview displays the final rendered document rather than a rendered diff. |
| Activate rendered review | Preview is a sticky PR-wide mode. The sidebar's Open Markdown Preview action selects the current or first changed Markdown file and opens Preview. |
| Create and manage threads | Documented Azure DevOps REST endpoints use the existing signed-in browser session and need no PAT. |
| Comment preview | The bundled local Markdown renderer powers Write/Preview tabs because ADO has no equivalent server-preview endpoint used by this extension. |
| Changes | The extension compares target and source Markdown, calculates line hunks, and maps them to rendered blocks because ADO Preview has no native change markers. |
| Cross-file navigation | Exact native TreeEx selection, collapsed-ancestor expansion, virtual-row materialization, and Preview restoration precede a same-PR route fallback. |
| Lifecycle | Same-PR file switches retain warm PR-wide catalogs. A direct PR-to-PR SPA transition performs one document reload so stale asynchronous state cannot cross PR identities. |
| Theme | Azure DevOps semantic theme properties and defensive fallbacks support light, dark, and forced-colors modes. |

## Current platform advantages

- Preview is sticky across the pull request, so ADO needs one Open Markdown Preview action instead of GitHub's render-all sweep.
- The REST API provides stable documented thread, reply, status, edit, and delete endpoints.
- PR-wide Changes and Outline can be assembled from source and iteration data before every file has been opened in Preview.
- Azure DevOps' native file tree already identifies the selected file; the extension does not add a second active-row treatment.

## Current platform constraints

- Preview omits deleted content and does not visually distinguish changed blocks. Changes navigation is calculated by the extension, but persistent rendered-diff highlighting remains an ADO-specific opportunity.
- List-item mapping now accepts only Markdown list-marker lines, preventing matching bullet text from being assigned to a section heading. Automated coverage verifies the third bullet's posted ADO line; the original live PR still needs manual confirmation before release.
- List-item `+` buttons use the first rendered line's height, keeping single-line and nested-list controls centered on the bullet text. Automated geometry coverage also protects ordinary single-line paragraphs; live confirmation remains pending.
- Table threads remain below the complete table to preserve valid markup, while a persistent marker in the affected row's first cell identifies the exact source row. The marker shows a count for multiple threads and cycles through their badges by mouse or keyboard without collapsing an already open conversation.
- Cross-file Outline clicks restore and center the selected destination after every PR-wide row rebuild, keeping nearby headings visible while Preview opens the destination. Ordinary Preview scroll-follow still uses minimal nearest-edge movement.
- Outline bulk controls apply Fold H1/H2/H3 and Expand all only to the current file. This matches ADO's one-file-at-a-time Preview surface but differs from GitHub's all-rendered-files scope.
- Shared frontmatter masking is loaded by the ADO target, but ADO-specific frontmatter rendering and line mapping do not yet have dedicated fixture coverage; the shared roadmap therefore records partial confidence rather than full parity.
- ADO has no direct equivalent of GitHub's author-association roles. Identity GUIDs can establish comment ownership but not Owner, Member, or Contributor badges.
- ADO thread tracking differs from GitHub's outdated-thread model; status should be presented using ADO semantics rather than forced into GitHub labels.
- Mention autocomplete queries active IdentityPicker users and inserts ADO's native identity token in new comments, replies, and edits. Multi-word search, keyboard/mouse selection, readable inline rendering, Threads snippets, edits, and cross-file navigation are live validated. Notification delivery from the mentioned account remains an acceptance check.
- The sidebar intentionally lists Markdown-file threads only. Threads on other file types have no rendered Preview destination in this extension.
- The sidebar header's × fully hides the panel. A small launcher restores its saved position and size and opens the Threads tab.
- When the sidebar starts collapsed, its header shows **Loading…** until the initial Changes and Threads catalogs finish. Expanded panes report their own progress: **Finding changed Markdown files…**, **Loading review threads…**, or **Loading pull request outline…** instead of showing a premature empty state.

## Open ADO design notes

### Persistent change highlighting

ADO Preview renders only the final document. The extension already compares target and source text for the Changes pane, so a future ADO-only enhancement can add persistent added/modified rails or tints to mapped rendered blocks. Removed content cannot be displayed without introducing a separate rendered representation.

The MVP uses green for additions and the existing warning/brown treatment for modified blocks. A newly added file receives a subtle file-level green marker instead of an all-green document; edited files highlight only added and mixed hunks. Highlights follow progressive Changes analysis and Preview remounts without adding another source fetch.

### Deleted-line comments

Unlike GitHub rich diff, ADO Preview provides no DOM for removed prose. Parity therefore depends on first designing a safe representation for removed blocks; REST payload support alone is insufficient.

### Mentions and collaboration polish

Identity search uses `POST /_apis/IdentityPicker/Identities`; native comments store a selected person as `@<identity-guid>`. Search results provide the local identity GUID and display metadata. The extension resolves those tokens before rendering inline conversations or Threads snippets, including after a cross-file document fallback. Confirm notification delivery from the mentioned account. Role badges should remain not applicable unless ADO exposes a stable relationship model. Reactions and live updates remain shared roadmap items but require ADO-specific endpoint investigation.

### Navigation safety

Native selection is authoritative; URL movement alone is not proof that ADO selected the requested file. Preview options must be discovered only inside the visible mode popup because file-tree rows use the same generic list primitives. Full PR identity—origin, organization, project, repository, and PR ID—is the runtime boundary.

## ADO-specific delegation

The extension continues to delegate these capabilities to Azure DevOps:

- Complete-review voting and pull-request completion.
- Native source-diff review for non-Markdown files.
- Repository-wide file browsing outside the changed-file inventory.
- Organization identity and permission management.
