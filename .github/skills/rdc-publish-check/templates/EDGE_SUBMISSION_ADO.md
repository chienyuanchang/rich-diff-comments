# Microsoft Edge Add-ons submission — Azure DevOps v1.4.0

> Canonical living submission document for the separate Azure DevOps extension.
> Paste each fenced section into Microsoft Partner Center.
> Dashboard: <https://partner.microsoft.com/dashboard/microsoftedge>

## Submission notes

Version 1.4.0 adds actions to copy a direct link or the original Markdown from any rendered comment. It remains separate from the GitHub extension, requests no new permissions or hosts, and has no backend, analytics, telemetry, advertising, or remote code.

## Package

- **Zip:** `rdc-ado-1.4.0.zip`
- **Manifest version:** `1.4.0`
- **Release folder:** `releases/ado/1.4.0/`

## Store listing

### Title

```
Markdown PR — Azure DevOps PR Comments
```

### Short description

```
Comment on rendered Markdown in Azure DevOps PRs with inline threads, Changes, Outline, and keyboard navigation.
```

### Description

```
🆕 What's new — v1.4.0 (2026-09-23)

• Copy a direct link to any rendered comment and receive clear clipboard feedback.
• Copy the original Markdown from any rendered comment for reuse without generated attribution or links.

v1.3.0 (2026-09-21)

• See persistent markers on table rows and fenced-code lines that already have review conversations; activate a marker to open or cycle through its threads.
• Empty threads disappear after their final visible comment is deleted instead of remaining as “0 comments” entries.
• Added and modified sections keep the correct Preview highlight across every paragraph, heading, and list item, while adjacent unchanged content remains clear.

v1.2.0 (2026-09-17)

• See added and modified sections highlighted directly in Markdown Preview, with a subtle marker for completely new files.
• Mention teammates from comments, replies, and edits with multi-word search; conversations and the Threads sidebar keep names readable.

📌 Just installed? Hard-refresh (Ctrl+Shift+R / Cmd+Shift+R) any Azure DevOps pull request tab that was already open when you clicked Get. New tabs work automatically.

—

Azure DevOps Preview makes Markdown design documents, plans, READMEs, and ADRs easy to read—but reviewing them still means switching back to source diff to find the right line and conversation. This extension turns Preview into a complete rendered-document review surface.

What it does:

• Start from any pull request Files page: the sidebar appears immediately and can open an available changed Markdown file in Preview for you.
• Hover a paragraph, heading, list item, table row, or code block and click the blue “+” to create a real Azure DevOps pull request comment on the matching source line.
• Drag between rendered blocks to comment on a multi-line range. Inside fenced code, move the “+” to target an individual source line.
• See existing review conversations beside the rendered section they belong to. Expand a thread to reply, resolve or reopen it, and edit or delete your own comments.
• Copy a direct link to any visible comment or copy its original Markdown for reuse elsewhere.
• Persistent markers identify table rows and fenced-code lines with existing conversations. A count appears when several threads share a row or line, and activating the marker cycles through them.
• Write in Markdown with formatting controls, Write/Preview tabs, automatic textarea growth, and Cmd/Ctrl+Enter submission.
• Type @ in a comment, reply, or edit to search for teammates and insert a native Azure DevOps mention. Mentioned names remain readable in inline conversations and the Threads sidebar.
• Changes tab: scan changed Markdown sections across every file in the pull request. New, deleted, and renamed files receive clear summaries; click a card or use keyboard shortcuts to navigate while remaining in Preview.
• Added and modified sections are highlighted directly in Preview, while completely new files receive a subtle NEW FILE marker.
• Threads tab: see all review threads in stable Azure DevOps file-tree order, filter to unresolved conversations, and jump directly to a thread in another file.
• Outline tab: browse headings from every changed Markdown file, see section thread counts, jump across files, fold individual sections, or bulk-fold H1/H2/H3 sections.
• Header icons jump to the first change or thread in the current file. Counters such as “2/4 (11)” show current-file progress and the pull-request total.
• Keyboard workflow: 1/2/3 switch tabs; b opens Outline; t toggles the sidebar; Shift+T resets it; j/k/h/l navigate threads; [ ] { } navigate changes.
• The interface follows Azure DevOps light, dark, and Windows high-contrast themes without closing drafts or resetting navigation.

No Personal Access Token or separate setup is required. Requests use the Azure DevOps session already open in your browser and go only to the current dev.azure.com or legacy visualstudio.com organization. No third-party servers, telemetry, analytics, ads, or remote code.

Also use GitHub? Our companion extension offers similar Markdown pull request review capabilities in GitHub's rich-diff view: https://microsoftedge.microsoft.com/addons/detail/agomibenjlnikaldoddminkjbokfocgb

Open source: https://github.com/chienyuanchang/rich-diff-comments

—

This is an independent, third-party browser extension. It is not affiliated with, endorsed by, sponsored by, or otherwise connected to Microsoft Corporation. “Azure DevOps” is used only to identify the service this extension works with.
```

### Category

Productivity / Developer Tools

### Language

English (United States)

### Search terms

```
azure devops review
markdown pull request
rendered markdown comments
design doc review
inline review comments
code review
pull request navigation
```

Word budget: 3 + 3 + 3 + 3 + 3 + 2 + 3 = **20 / 21**. Every term is at most 30 characters.

## Privacy & permissions

### Single purpose description

```
Add inline review comments and document navigation to rendered Markdown in Azure DevOps pull request Preview mode, so reviewers can comment, manage threads, scan changes, and navigate headings without switching back to source diff.
```

### Permission justification

This extension declares **no** entries in `permissions`. There are no Edge extension API permissions to justify.

### Host permission justification (under 1,000 characters)

```
“https://dev.azure.com/*” covers current Azure DevOps organization URLs and “https://*.visualstudio.com/*” covers legacy Azure DevOps URLs. Access is required to read rendered Markdown Preview content, inject the review interface, and make same-origin requests using the browser-managed Azure DevOps session. Those requests fetch pull request metadata, Markdown source, changed files, review threads and identity data, and create/reply/edit/delete comments or change thread status only when the user requests it. No other host is accessed. No data is sent to third parties, and there is no analytics or telemetry.
```

### Privacy policy URL

```
https://github.com/chienyuanchang/rich-diff-comments/blob/main/PRIVACY_ADO.md
```

### Website / Homepage URL

```
https://github.com/chienyuanchang/rich-diff-comments
```

### Support URL

```
https://github.com/chienyuanchang/rich-diff-comments/issues
```

### Data usage

Select only:

- ☑ **Authentication information** — relies on the browser-managed Azure DevOps session; never reads or stores passwords, raw session cookies, PATs, or OAuth tokens.
- ☑ **Website content** — processes rendered Markdown, Markdown source, pull request metadata, changed-file information, review threads, and comments solely for the rendered review interface.
- ☑ **Personally identifiable information** — when the user invokes `@mention` autocomplete, the extension processes Azure DevOps identity search results such as display names and sign-in addresses solely to show matching teammates and submit the selected native mention.

Leave all other categories unchecked. Confirm that data is not sold, is not used outside the extension's purpose, and is not used for credit or lending decisions.

### Remote code

**Answer:** No.

All JavaScript is bundled in the package. There is no `eval`, dynamically downloaded executable code, remotely hosted script, WebAssembly download, or external runtime dependency. Azure DevOps responses are processed only as data.

## Notes for certification (under 2,000 characters)

```
This extension activates only on Azure DevOps pull request URLs under dev.azure.com or legacy *.visualstudio.com origins. It enhances Preview mode for changed Markdown files.

TEST PAGE
https://dev.azure.com/chienyuanchang/test-ado-md-comments/_git/test-ado-md-comments/pullrequest/1?_a=files

HOW TO TEST
1. Sign in to Azure DevOps and open the test pull request (or any accessible PR that changes a .md file).
2. Select Files while no Markdown Preview is open. The sidebar should appear immediately; choose Open Markdown Preview and confirm that it opens an available changed Markdown file in Preview.
3. Hover a paragraph or heading. A blue “+” appears. Clicking it opens the Markdown comment editor. Posting requires normal comment permission; read-only navigation works without write permission.
4. In the editor, type `@` followed by at least two characters (spaces are supported). Select a person and confirm the posted conversation shows the readable name.
5. Existing conversations appear beside rendered content. Use Copy link on any visible comment and confirm the destination reaches that comment; use Copy Markdown and confirm the original Markdown reaches the clipboard. Table rows and fenced-code lines with conversations show persistent markers; activate a marker to open its thread. The sidebar contains Changes, Threads, and Outline tabs.
6. Cards and headings navigate between Markdown files while retaining Preview. Use 1/2/3 to switch tabs, j/k for threads, [ and ] for changes, and t to collapse/expand the sidebar.
7. Change the Azure DevOps light/dark theme; the interface updates without remounting or losing a draft.

AUTHENTICATION
No credentials are bundled or requested. Same-origin requests use the reviewer's existing browser-managed Azure DevOps session.

DEPENDENCIES
None. No backend, analytics, telemetry, remote code, or third-party service.

Privacy policy:
https://github.com/chienyuanchang/rich-diff-comments/blob/main/PRIVACY_ADO.md
```

## Availability

- **Initial visibility:** Hidden / link-only
- **Markets:** All

## What's new in this version

### v1.4.0 — 2026-09-23

#### Added

- Copy a direct link from any rendered comment and receive clear feedback when it reaches the clipboard.
- Copy the original Markdown body from any rendered comment for reuse without generated attribution or links.

### v1.3.0 — 2026-09-21

#### Added

- Persistent markers identify table rows with review conversations; shared rows show a count and cycle through their threads by mouse or keyboard.
- Persistent markers identify affected lines in fenced code blocks, including counts and cycling when conversations share a line.

#### Fixed

- Threads disappear after their final visible comment is deleted instead of remaining in Preview, sidebar totals, or keyboard navigation as **0 comments** entries.
- Added and modified sections keep the correct Preview highlight across every paragraph, heading, and list item, while adjacent unchanged content remains clear.

### v1.2.0 — 2026-09-17

#### Added

- Added and modified sections are highlighted directly in Markdown Preview, while completely new files receive a subtle **NEW FILE** marker.
- Type `@` in comments, replies, or edits to find and mention teammates; posted conversations and the Threads sidebar show readable names.
- Loading progress remains clear in both collapsed and expanded sidebar states.

#### Changed

- The extension is now named **Markdown PR — Azure DevOps PR Comments**, making Azure DevOps easier to identify in browser and store displays.

#### Fixed

- Comments on list items stay attached to the selected bullet, with the comment button centered on its first rendered line.
- Cross-file Outline navigation keeps the selected section centered with nearby headings visible.
