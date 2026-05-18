# Approach: Commenting on Rendered Markdown in GitHub PRs

This doc explains the **strategy** behind the extension — what problem we're solving, what we tried, what works, and what we deliberately gave up on. For low-level details (data shapes, endpoint candidates, debugging recipes, individual bug fixes), see [DEV_NOTES.md](./DEV_NOTES.md).

## The problem

GitHub's PR "Files changed" view has two modes for a `.md` file:

1. **Source diff** — raw markdown with line numbers. You can comment on any line. Ugly to read for prose/design docs.
2. **Rich diff** (rendered) — beautiful prose. **No way to comment.** Existing review threads are hidden too.

For repos where the primary artifact is a markdown design doc, this forces reviewers to flip back to source diff, mentally re-render, and comment on raw `|---|` table dividers and mermaid fence syntax. The extension's goal: **make rich diff a first-class review surface** — comment on what you read, see existing threads where they were placed in the source.

## Core challenge: rendered-block → source-line mapping

Everything else is plumbing. The fundamental problem is:

> Given a `<p>` / `<h2>` / `<tr>` / `<pre>` in the rendered DOM, **which source line did it come from?**

GitHub's prose-diff DOM has no `data-line` attribute. We have to derive the line ourselves. Without that, we can't:

- Post a new review comment (`POST create_review_comment` requires `line: <int>`)
- Anchor an existing review thread (each thread carries a line number; we need to find the matching DOM block)

## What we tried

### 1. ❌ Source-map approach (abandoned)

Markdown renderers don't emit source maps. `markdown-it` has a `map: [start, end]` token attribute but GitHub renders server-side — we can't intercept the renderer.

### 2. ❌ Walk GitHub's React props (abandoned)

GitHub's React components attach internal props (`__reactProps$<hash>`) to DOM nodes. In theory we could read them. In practice they're minified, the hash changes per build, and the data we need (source line) isn't actually in props — it's resolved at render-time and discarded.

### 3. ✅ Text matching (current approach)

Fetch the raw source. Strip markdown formatting from both source and rendered text. For each rendered block, find its text in the source. Return the line offset.

This is what most "render markdown in side-by-side preview" tools do internally. The novelty is doing it for an *external* renderer (GitHub's) we don't control.

## The matching pipeline

```
DOM block  ─┐
            ├─►  cleanRenderedText()  ─► normalized needle
            │     (strip zero-width, lowercase, collapse whitespace)
            │
Raw source ─┼─►  buildSourceIndex()   ─► { concat, lineOffsets[] }
            │     (stripMarkdown +    
            │      blank mermaid fences +
            │      normalize as above)
            │
            └─►  findTextInSource(needle, lastOffset)
                  • indexOf forward from last successful match
                  • fall back to shorter chunks [80, 50, 30, 20, 12]
                  • if no match: return findLineAtOffset(lastOffset)
                                 (i.e. inherit previous line)
                  • per-block nudge: consecutive misses advance lastLine + 1
```

**Key insight**: maintain `lastOffset` across blocks and search forward from it. This handles duplicate text correctly (the second "Overview" heading won't match the first) and naturally degrades when one block fails to match.

### Why text matching, not AST matching?

We don't have GitHub's AST. We'd have to re-render the markdown locally with `markdown-it` and pray it matches GitHub's output byte-for-byte. It doesn't (GitHub has custom extensions, emoji, autolink rules, mermaid). Text matching after `stripMarkdown` is more robust and ~50 lines of code.

## Special cases that broke pure text matching

These are the hard-won lessons. Each one used to be a bug. See [DEV_NOTES.md#resolved-issues-changelog](./DEV_NOTES.md#resolved-issues-changelog) for the actual fixes.

| Case | Problem | Strategy |
|---|---|---|
| **Mermaid diagrams** | Rendered as `<svg>` (no prose), but source has `graph TD ... A --> B` text. Forward-scan matcher latches onto mermaid source via fallback chunks and `lastOffset` gets stuck inside the diagram. Every block *after* lands on the diagram's last line. | Blank out lines inside `mermaid` / `plantuml` / `dot` / `graphviz` fences in `buildSourceIndex`. Skip diagram blocks in iteration too. |
| **Tables** | `<tr>.textContent` joins cells without separators in some browsers (`AB` not `A B`). Cells are short and similar — text matching is unreliable. The `\|---\|` divider exists in source but not in DOM. | Build needle by joining `td/th` `textContent` with explicit spaces. Match only the **first** `<tr>`; compute subsequent rows arithmetically as `headerLine + rowIndex + 1` (the `+1` is the divider). |
| **Code blocks** | Rendered as a single `<pre>` — no per-line wrappers without breaking GitHub's syntax highlighting. | The `+` button anchors to the start of the block. The comment box has an **editable line input** with a hint like `(code block, lines 88–104)`. User picks the exact line. |
| **Paragraphs in `<blockquote>`** | They're still `<p>` — original filter buggily skipped all `<p>`. | Only skip `<p>` when it's actually inside an `<li>`. |
| **Unmatched blocks (any reason)** | Naive fallback would return `line: 1`, dropping every unmatched comment at the file top. | Fallback returns `findLineAtOffset(lastOffset)` (inherit previous line); plus a per-block nudge so consecutive misses don't all collapse. |
| **HTML blocks** (`<details>`, raw `<table>` in source) | Source has HTML, rendered DOM has the rendered form — text doesn't line up. | Currently unhandled. Same fallback as above (inherit previous line). |

## DOM injection: not all elements are equal

The `+` button and the comment box have to live somewhere in the page. Two non-obvious constraints:

1. **`<button>` and `<div>` are not valid children of `<tr>`.** The HTML parser silently hoists them out of the table on insertion. The button disappears or jumps to a weird spot. → `buttonAnchor(tr)` returns the first `<td>`; `siblingAnchor(tr)` returns the parent `<table>` (so comment boxes / thread renders go *after* the table, not between rows).

2. **Our own injected nodes trigger the `MutationObserver`** that watches for new files loading via SPA navigation. Without a filter we loop infinitely. → Explicit ignore-list of CSS classes; every new injected class must be added.

## Authentication: piggybacking on the browser session

The extension reuses the user's existing logged-in github.com session — same identity, same permissions as any click they make in the GitHub UI.

### How it works

When you load `github.com/<owner>/<repo>/pull/<n>/files`, the browser already holds a session cookie (`user_session`, `_gh_sess`, etc.) that GitHub treats as your identity. Our content script is **injected into the same origin** — so every `fetch()` it makes is same-origin and, with `credentials: 'include'`, the cookies flow automatically.

```
content.js (in github.com page)
   │ fetch('https://github.com/.../page_data/create_review_comment',
   │       { credentials: 'include', body: {...} })
   ↓
github.com  ← cookies attached → "this request is from <user>"
   ↓
review comment posted as <user>
```

From GitHub's server's perspective, the request is identical to one fired by their own React UI when you click the native `+` button in source-diff. We call the same internal endpoints that GitHub's UI already calls.

### How we discovered the endpoints

Each `page_data/*` URL was found by:

1. Open a PR in normal source-diff view.
2. DevTools → Network → filter by `page_data`.
3. Click the corresponding native button (post comment, reply, resolve thread).
4. Inspect the request: URL, payload shape, required headers.
5. Reproduce it with `fetch()` from the extension.

For each action we initially shipped a "candidate list" of guessed URLs/payload shapes and logged every attempt. The first one returning 2xx got promoted to the only candidate. Verified shapes for reply and resolve are in [DEV_NOTES.md → Reply / Resolve endpoints](./DEV_NOTES.md#reply--resolve-endpoints-both-verified).

### CSRF tokens

Some endpoints (notably the markdown `/preview` renderer) also require a CSRF token. GitHub puts one on every page for its own form submissions:

```html
<meta name="csrf-token" content="...">
```

We read it from there and forward it as `Scoped-CSRF-Token` / `authenticity_token`.

### Same-origin CORS gotcha (for `api.github.com`)

The one place same-origin doesn't reach is `api.github.com`. It returns `Access-Control-Allow-Origin: *`, which **forbids credentialed requests** (browsers refuse to send cookies to a server that claims to allow "any origin"). So a content script on `github.com` can't call `api.github.com/repos/.../pulls/<n>` with cookies — it would fail on private repos.

When we needed the internal numeric `pullRequestId` for `@mention` lookups, the documented path through `api.github.com` was blocked. Instead we fetch `github.com/<owner>/<repo>/pull/<n>` HTML (same origin, cookies flow, private repos work) and regex out the id. Documented in [DEV_NOTES.md → @-mention suggestions](./DEV_NOTES.md#reply--resolve-endpoints-both-verified).

### Permissions

Every request still goes through GitHub's normal authorization checks server-side:

- **Can the user see this PR?** → cookie answers
- **Can the user comment on this line?** → server validates on the POST
- **Can the user resolve this thread?** → 401 "User is not authorized" if not

Two practical consequences:

- The extension **does nothing for logged-out users** — no cookies, every fetch fails.
- The extension **only works on repos the user can see** — private repos work for collaborators, not for outsiders.

### When this could break

GitHub could:

- Rotate any `page_data/*` URL → we'd hit 404, the candidate-list pattern flags it in the console, and we re-discover.
- Add a new CSRF header → we'd start hitting 422 with a clear error.
- Move to `SameSite=Strict` cookies + `Origin` checks → unlikely (their own UI depends on the same setup), but a content script extension would still satisfy both.
- Remove the `page_data/*` endpoints entirely → the **PAT fallback** (`localStorage['grdc_use_pat'] = '1'`) keeps things working via the public REST API.

### PAT fallback

For users who can't rely on cookies (corporate single-sign-on edge cases, or if they want to use a service account), `localStorage['grdc_use_pat'] = '1'` switches everything to the public REST API and prompts for a Personal Access Token. Disabled by default — it's strictly worse UX for normal use (token setup, expiry management, no `@mention` autocomplete, etc.).


## Inline rendering: avoid the refresh

Every successful POST returns the new/updated thread in its response body. Rather than re-fetching `/changes` and re-rendering everything, we:

1. Parse the response (`{ thread: { commentsData: { comments: [...] } } }`)
2. Map it through `threadResponseToComments(data, path, line)` into the same shape `fetchExistingComments` produces
3. Call `renderThreadOnElement(element, comments)` directly

So a new comment, reply, or resolve toggle all appear immediately — no page refresh, no duplicate fetch.

## What we deliberately don't do

- **Render markdown ourselves.** GitHub already does this perfectly. Reusing their DOM is simpler and always up to date.
- **Re-implement `+ comment` for source-diff view.** GitHub already provides it. We only fill the gap in rich-diff.
- **Use the public GitHub REST/GraphQL API by default.** It works but requires a PAT and breaks the "just works for private repos" promise. PAT path is kept as opt-in fallback.
- **Try to match every block with perfect accuracy.** The editable line input is the escape hatch — if matching is slightly off, the user fixes it in one click before posting.
- **Build a VS Code extension.** The browser extension is ~1000 lines and gets rendering / auth / navigation / non-md files for free from GitHub. A VS Code version would be 10× the code for marginal gain.

## Limits

- Lines outside any diff hunk are rejected by GitHub with `422 "Line could not be resolved"`. We don't currently snap to the nearest in-hunk line — TODO.
- HTML blocks (`<details>`, raw `<table>`) inherit previous line on miss.
- Mermaid diagrams have no `+` button (they're SVG with no source-line correspondence).

## When to read what

- **You're new to the codebase** — start here.
- **You're an end user installing it** — [INSTALL.md](../INSTALL.md) — store install + usage walkthrough.
- **You're hunting a specific bug** — [DEV_NOTES.md → Resolved issues (changelog)](./DEV_NOTES.md#resolved-issues-changelog).
- **You're planning the next feature** — [FEATURES.md](./FEATURES.md) — Shipped / Planned (with P0–P3 priorities) / Won't-do.
- **You're adding a new GitHub action** (e.g. edit-comment, react, mark-as-viewed) — [DEV_NOTES.md → How to add a new GitHub action](./DEV_NOTES.md#how-to-add-a-new-github-action-endpoint-discovery-recipe) for the step-by-step recipe. **First check if GitHub's UI already exposes the action on the same rich-diff page** — if so, don't reinvent it; see [FEATURES.md → Won't do](./FEATURES.md#-wont-do-deliberate-trade-offs).
- **GitHub changed something and matching broke** — [DEV_NOTES.md → Debugging recipes](./DEV_NOTES.md#debugging-recipes). Check `[GRDC] NO MATCH` logs first.
- **You're shipping a new version to the store** — [PUBLISHING.md](./PUBLISHING.md) — submission flow, store-listing copy, permissions justifications, gotchas, packaging script.
- **You're changing a pure helper** — add a test in `tests/`. Run with `npm test`. Pure logic lives in `src/lib/*.js`; the extension and Node tests both consume those modules.
