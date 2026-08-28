# Chrome Web Store submission — Azure DevOps v1.0.0

> Canonical living submission document for the separate Azure DevOps extension.
> Paste each fenced section into the Chrome Web Store Developer Console.
> Dashboard: <https://chrome.google.com/webstore/devconsole>

## Submission notes

This is the first release of the Azure DevOps target. It is packaged separately from the existing GitHub extension and requests access only to Azure DevOps pull request origins. The package declares no Chrome API permissions, loads no remote code, has no backend, and contains no analytics or telemetry.

## Package

- **Zip:** `rdc-ado-1.0.0.zip`
- **Manifest version:** `1.0.0`
- **Release folder:** `releases/ado/1.0.0/`

## Product details

### Title

```
Markdown PR Comments for Azure DevOps
```

### Summary (132-character limit)

```
Comment on rendered Markdown in Azure DevOps PRs with inline threads, Changes, Outline, and keyboard navigation.
```

### Description

```
🆕 First release — v1.0.0 (2026-08-28)

• Review rendered Markdown directly: comment on paragraphs, headings, lists, tables, and individual code-block lines without leaving Preview.
• Navigate every Markdown change, thread, and heading across the pull request from one keyboard-friendly sidebar.
• Reply, resolve, reopen, edit, and delete review comments inline; light, dark, and high-contrast themes are supported.

📌 Just installed? Hard-refresh (Ctrl+Shift+R / Cmd+Shift+R) any Azure DevOps pull request tab that was already open when you clicked Add to Chrome. New tabs work automatically.

—

Azure DevOps Preview makes Markdown design documents, plans, READMEs, and ADRs easy to read—but reviewing them still means switching back to source diff to find the right line and conversation. This extension turns Preview into a complete rendered-document review surface.

What it does:

• Hover a paragraph, heading, list item, table row, or code block and click the blue “+” to create a real Azure DevOps pull request comment on the matching source line.
• Drag between rendered blocks to comment on a multi-line range. Inside fenced code, move the “+” to target an individual source line.
• See existing review conversations beside the rendered section they belong to. Expand a thread to reply, resolve or reopen it, and edit or delete your own comments.
• Write in Markdown with formatting controls, Write/Preview tabs, automatic textarea growth, and Cmd/Ctrl+Enter submission.
• Changes tab: scan changed Markdown sections across every file in the pull request. New, deleted, and renamed files receive clear summaries; click a card or use keyboard shortcuts to navigate while remaining in Preview.
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
The extension runs only on Azure DevOps pull request pages. “https://dev.azure.com/*” covers current Azure DevOps organization URLs; “https://*.visualstudio.com/*” covers organizations using legacy Azure DevOps URLs. Access is required to read the rendered Markdown Preview page, inject the review interface, and make same-origin requests—using the browser-managed Azure DevOps session—to fetch pull request metadata, Markdown source, changed files and review threads, and to create/reply/edit/delete comments or change thread status when the user requests it. No other host is accessed. No data is sent to third parties, and the extension contains no analytics or telemetry.
```

### Remote code use

**Answer:** No, this extension does not use remote code.

All JavaScript is bundled in the package (`content.js`, shared helper files, and the Azure DevOps adapter). There is no `eval`, dynamic code execution, remotely hosted script, WebAssembly download, or external runtime dependency. Azure DevOps responses are processed only as data.

### Data usage

Select only:

- ☑ **Authentication information** — the extension relies on the browser-managed Azure DevOps session for same-origin requests. It does not read or store passwords, raw session cookies, Personal Access Tokens, or OAuth tokens.
- ☑ **Website content** — the extension processes rendered Markdown, Markdown source, pull request metadata, changed-file information, review threads, and comments solely to provide the rendered review interface.

Leave all other categories unchecked: Personally identifiable information, Health information, Financial and payment information, Personal communications, Location, Web history, User activity.

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
2. Select Files, open a changed Markdown file, and choose Preview from the file-view menu.
3. Hover a paragraph or heading. A blue “+” appears. Clicking it opens the Markdown comment editor. Posting requires the signed-in account to have normal comment permission on that PR; read-only navigation can be tested without write permission.
4. Existing conversations appear beside rendered content. The sidebar contains Changes, Threads, and Outline tabs. Cards and headings can navigate between Markdown files while retaining Preview.
5. Use 1/2/3 to switch tabs, j/k for threads, [ and ] for changes, and t to collapse/expand the sidebar.
6. Change the Azure DevOps light/dark theme; the interface updates without remounting or losing a draft.

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

First public release.

### v1.0.0 — 2026-08-28

#### Added

- Review and comment on rendered Markdown blocks and precise code-block lines in Azure DevOps Preview.
- Read and manage inline review conversations with Markdown editing and range comments.
- Navigate pull-request-wide Changes, Threads, and Outline views with mouse or keyboard.
- Fold rendered document sections and view section-level thread counts.
- The complete interface follows Azure DevOps light, dark, and high-contrast themes.
- File groups remain in Azure DevOps file-tree order, and scoped counters show both current-file progress and pull-request totals.
