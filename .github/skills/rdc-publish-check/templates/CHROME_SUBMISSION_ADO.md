# Chrome Web Store submission — Azure DevOps v1.4.0

> Canonical living submission document for the separate Azure DevOps extension.
> Paste each fenced section into the Chrome Web Store Developer Console.
> Dashboard: <https://chrome.google.com/webstore/devconsole>

## Submission notes

Version 1.4.0 adds actions to copy a direct link or the original Markdown from any rendered comment. It remains packaged separately from the GitHub extension, requests no new permissions or hosts, loads no remote code, has no backend, and contains no analytics or telemetry.

## Package

- **Zip:** `rdc-ado-1.4.0.zip`
- **Manifest version:** `1.4.0`
- **Release folder:** `releases/ado/1.4.0/`

## Product details

### Title

```
Markdown PR — Azure DevOps PR Comments
```

### Summary (132-character limit)

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

📌 Just installed? Hard-refresh (Ctrl+Shift+R / Cmd+Shift+R) any Azure DevOps pull request tab that was already open when you clicked Add to Chrome. New tabs work automatically.

—

Azure DevOps Preview makes Markdown design documents, plans, READMEs, and ADRs easy to read—but reviewing them still means switching back to source diff to find the right line and conversation (using GitHub? Try our companion extension: https://chromewebstore.google.com/detail/markdown-pr-comments-for/bdkcmcdfnhonfcpdgcmemkpcmnhnhemj). This extension turns Preview into a complete rendered-document review surface.

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

Open source: https://github.com/chienyuanchang/rich-diff-comments

—

This is an independent, third-party browser extension. It is not affiliated with, endorsed by, sponsored by, or otherwise connected to Microsoft Corporation. “Azure DevOps” is used only to identify the service this extension works with.
```

### Category

Developer Tools

### Language

English

## Privacy

### Single purpose

```
Add inline review comments and document navigation to rendered Markdown in Azure DevOps pull request Preview mode, so reviewers can comment, manage threads, scan changes, and navigate headings without switching back to source diff.
```

### Permission justification

This extension declares **no** entries in `permissions`. There are no Chrome API permissions to justify.

### Host permission justification

```
The extension runs only on Azure DevOps pull request pages. “https://dev.azure.com/*” covers current Azure DevOps organization URLs; “https://*.visualstudio.com/*” covers organizations using legacy Azure DevOps URLs. Access is required to read rendered Markdown Preview, inject the review interface, and make same-origin requests—using the browser-managed Azure DevOps session—to fetch pull request metadata, Markdown source, changed files, review threads and identity search results, and to create/reply/edit/delete comments or change thread status when the user requests it. No other host is accessed. No data is sent to third parties, and the extension contains no analytics or telemetry.
```

### Remote code use

**Answer:** No, this extension does not use remote code.

All JavaScript is bundled in the package (`content.js`, shared helper files, and the Azure DevOps adapter). There is no `eval`, dynamic code execution, remotely hosted script, WebAssembly download, or external runtime dependency. Azure DevOps responses are processed only as data.

### Data usage

Select only:

- ☑ **Authentication information** — the extension relies on the browser-managed Azure DevOps session for same-origin requests. It does not read or store passwords, raw session cookies, Personal Access Tokens, or OAuth tokens.
- ☑ **Website content** — the extension processes rendered Markdown, Markdown source, pull request metadata, changed-file information, review threads, and comments solely to provide the rendered review interface.
- ☑ **Personally identifiable information** — when the user invokes `@mention` autocomplete, the extension processes Azure DevOps identity search results such as display names and sign-in addresses solely to show matching teammates and submit the selected native mention.

Leave all other categories unchecked: Health information, Financial and payment information, Personal communications, Location, Web history, User activity.

Certifications—select all three:

- ☑ Data is not sold or transferred except for approved use cases.
- ☑ Data is not used or transferred for purposes unrelated to the extension's single purpose.
- ☑ Data is not used or transferred to determine creditworthiness or for lending.

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

## Notes for reviewer (under 2,000 characters)

```
This extension activates only on Azure DevOps pull request URLs under dev.azure.com or legacy *.visualstudio.com origins. It enhances Preview mode for changed Markdown files.

TEST PAGE
https://dev.azure.com/chienyuanchang/test-ado-md-comments/_git/test-ado-md-comments/pullrequest/1?_a=files

HOW TO TEST
1. Sign in to Azure DevOps and open the test pull request (or any accessible PR that changes a .md file).
2. Select Files while no Markdown Preview is open. The sidebar should appear immediately; choose Open Markdown Preview and confirm that it opens an available changed Markdown file in Preview.
3. Hover a paragraph or heading. A blue “+” appears. Clicking it opens the Markdown comment editor. Posting requires the signed-in account to have normal comment permission on that PR; read-only navigation can be tested without write permission.
4. In the editor, type `@` followed by at least two characters (spaces are supported). Select a person and confirm the posted conversation shows the readable name.
5. Existing conversations appear beside rendered content. Use Copy link on any visible comment and confirm the destination reaches that comment; use Copy Markdown and confirm the original Markdown reaches the clipboard. Table rows and fenced-code lines with conversations show persistent markers; activate a marker to open its thread. The sidebar contains Changes, Threads, and Outline tabs.
6. Cards and headings can navigate between Markdown files while retaining Preview. Use 1/2/3 to switch tabs, j/k for threads, [ and ] for changes, and t to collapse/expand the sidebar.
7. Change the Azure DevOps light/dark theme; the interface updates without remounting or losing a draft.

AUTHENTICATION
No credentials are bundled or requested. Same-origin API requests use the reviewer's existing browser-managed Azure DevOps session.

DEPENDENCIES
None. No backend, analytics, telemetry, remote code, or third-party service.

Privacy policy:
https://github.com/chienyuanchang/rich-diff-comments/blob/main/PRIVACY_ADO.md
```

## Distribution

- **Initial visibility:** Unlisted
- **Regions:** All regions

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
