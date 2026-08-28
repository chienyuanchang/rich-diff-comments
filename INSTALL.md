# Install Markdown PR Comments

## What it does

Adds inline review-comment buttons and navigation to rendered Markdown in pull requests. GitHub and Azure DevOps are shipped as separate browser extensions with service-specific permissions.

## Install for GitHub

**Chrome / Brave / Vivaldi / Arc / any Chromium browser:**

1. Go to: **<https://chromewebstore.google.com/detail/markdown-pr-comments-for/bdkcmcdfnhonfcpdgcmemkpcmnhnhemj>** — short link to share: **<https://aka.ms/md-pr>**
2. Click **Add to Chrome** → **Add extension**.

**Microsoft Edge:**

1. Go to: **<https://microsoftedge.microsoft.com/addons/detail/agomibenjlnikaldoddminkjbokfocgb>**
2. Click **Get** → **Add extension**.

That's it. The extension is now installed. No login, no setup, no token required.

## Just installed?

If you installed the extension while a GitHub PR was **already open in another tab**, the inline `+` buttons and threads sidebar won't appear on that tab until you reload it. **Hard-refresh** the tab with **Ctrl+Shift+R** (Windows / Linux) or **Cmd+Shift+R** (macOS) to activate the extension.

Tabs you open *after* installing work automatically — the tip above only matters for tabs that were already loaded.

## How to use it on GitHub

1. Open any GitHub Pull Request → click the **Files changed** tab.
2. For any modified `.md` file, click the small **document icon** in the file header to toggle **rich diff** (rendered markdown).
3. **Hover** over any paragraph, heading, list item, table row, or code block → a blue **`+`** button appears on the left.
4. Click **`+`** → write your comment in the box that pops up → click **Comment**.
   - The comment is posted as a real PR review comment, visible to everyone in GitHub's own "Conversation" tab.
5. Existing comments show up inline as a **💬 N comments** badge — click to expand, then **Reply** or **Resolve**.

### Power features

- **Multi-line range comments**: hold the `+` button on one block and drag to another block. A yellow band shows the range while you drag.
- **Changes tab + `[` / `]` keys**: jump straight to the next (or previous) changed block — paragraph, list item, table row, code block, heading. The sidebar's **Changes** tab lists every change with a `+` / `−` / `±` glyph and a snippet; the `◀ N/M ▶` counter in the sidebar header lets you skim without opening the tab. Press `{` / `}` (Shift+[ / Shift+]) to jump to the first or last change. Best way to scan a Markdown PR for the first time without re-reading the unchanged prose.
- **Sidebar tab shortcuts**: press `1`, `2`, or `3` to switch the sidebar to Changes, Threads, or Outline. Auto-expands the sidebar if collapsed.
- **Collapse sections**: click the small chevron next to any heading to fold that whole section. Useful for focusing on what's left to review.
- **`@mention`**: type `@` in the comment box to get GitHub's user autocomplete.
- **Markdown preview**: click the **Preview** tab in the comment box to see how your comment will render.
- **Cmd/Ctrl+Enter**: submit the comment without reaching for the mouse.

## Install for Azure DevOps

The first Chrome Web Store and Edge Add-ons listing links will be added after store approval. For pre-release testing:

1. Clone or download <https://github.com/chienyuanchang/rich-diff-comments>.
2. Open `chrome://extensions/` or `edge://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `extensions/ado/` folder.
5. If an Azure DevOps pull request was already open, hard-refresh it with **Ctrl+Shift+R** or **Cmd+Shift+R**.

No separate login, token, or Personal Access Token is required. The extension uses the Azure DevOps session already open in your browser.

## How to use it on Azure DevOps

1. Open an Azure DevOps pull request and select **Files**.
2. Open a changed Markdown file and choose **Preview** from the file-view selector. Preview remains selected as you move between Markdown files.
3. Hover a paragraph, heading, list item, table row, or code block. Click the blue **`+`** to create a real pull-request review comment.
4. Existing comments appear inline. Expand a thread to reply, resolve/reopen it, or edit/delete your own comments.
5. Use the sidebar:
   - **Changes** lists changed Markdown sections across the pull request, including new, deleted, and renamed file summaries.
   - **Threads** lists review conversations with an unresolved-only filter.
   - **Outline** lists headings from every changed Markdown file and can fold sections by heading level.

### Azure DevOps keyboard shortcuts

- `1` / `2` / `3`: open Changes / Threads / Outline
- `b`: open Outline
- `t`: collapse or expand the sidebar
- `Shift+T`: reset sidebar position and size
- `j` / `k`: next / previous thread; `h` / `l`: first / last thread
- `[` / `]`: previous / next change; `{` / `}`: first / last change
- **Cmd/Ctrl+Enter**: submit the active comment editor

## Privacy & security

- Uses the existing signed-in session for the selected service—no Personal Access Token needed.
- The GitHub extension sends requests only to GitHub; the Azure DevOps extension sends requests only to the active `dev.azure.com` or legacy `visualstudio.com` organization.
- No telemetry, no analytics, no backend.
- GitHub privacy policy: <https://github.com/chienyuanchang/rich-diff-comments/blob/main/PRIVACY.md>
- Azure DevOps privacy policy: <https://github.com/chienyuanchang/rich-diff-comments/blob/main/PRIVACY_ADO.md>

## Known limits

- Works on rendered Markdown only: GitHub **rich diff** or Azure DevOps **Preview**. Use each service's source-diff view for non-Markdown files.
- Mermaid / PlantUML diagrams render as images and can't be matched to source lines — comments near them may anchor to the previous block.
- The service may reject a comment if its source line is not reviewable in the current pull-request diff/iteration.

## Reporting bugs

File an issue at <https://github.com/chienyuanchang/rich-diff-comments/issues>.
