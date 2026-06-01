# Install Markdown PR Comments for GitHub

## What it does

Adds inline review-comment buttons to GitHub's **rich-diff** (rendered markdown) view on Pull Request pages — letting you comment, reply, resolve threads, and collapse sections without flipping to source-diff.

## Install

> *Chrome Web Store and Edge Add-ons listings are pending review. Until they're live, see the developer-mode install in [README.md](README.md#for-local-development).*

<!-- Once the listings are approved, replace this block with:

**Chrome / Brave / Vivaldi / Arc / any Chromium browser:**

1. Go to: **<https://chromewebstore.google.com/detail/rich-diff-comments-for-github/...>**
2. Click **Add to Chrome** → **Add extension**.

**Microsoft Edge:**

1. Go to: **<https://microsoftedge.microsoft.com/addons/detail/...>**
2. Click **Get** → **Add extension**.

That's it. The extension is now installed. No login, no setup, no token required.

-->

## How to use it

1. Open any GitHub Pull Request → click the **Files changed** tab.
2. For any modified `.md` file, click the small **document icon** in the file header to toggle **rich diff** (rendered markdown).
3. **Hover** over any paragraph, heading, list item, table row, or code block → a blue **`+`** button appears on the left.
4. Click **`+`** → write your comment in the box that pops up → click **Comment**.
   - The comment is posted as a real PR review comment, visible to everyone in GitHub's own "Conversation" tab.
5. Existing comments show up inline as a **💬 N comments** badge — click to expand, then **Reply** or **Resolve**.

### Power features

- **Multi-line range comments**: hold the `+` button on one block and drag to another block. A yellow band shows the range while you drag.
- **Collapse sections**: click the small chevron next to any heading to fold that whole section. Useful for focusing on what's left to review.
- **`@mention`**: type `@` in the comment box to get GitHub's user autocomplete.
- **Markdown preview**: click the **Preview** tab in the comment box to see how your comment will render.
- **Cmd/Ctrl+Enter**: submit the comment without reaching for the mouse.

## Privacy & security

- Uses **your existing GitHub session** — no Personal Access Token needed.
- Sends data **only to `github.com`** (never to any third party).
- No telemetry, no analytics, no backend.
- Full privacy policy: <https://github.com/chienyuanchang/rich-diff-comments/blob/main/PRIVACY.md>

## Known limits

- Works on **rich-diff view only**. Switch back to source-diff for non-markdown files.
- Mermaid / PlantUML diagrams render as images and can't be matched to source lines — comments near them may anchor to the previous block.
- GitHub only allows comments on lines that are inside a diff hunk; out-of-hunk lines are rejected with *"Line could not be resolved"*.

## Reporting bugs

File an issue at <https://github.com/chienyuanchang/rich-diff-comments/issues>.
