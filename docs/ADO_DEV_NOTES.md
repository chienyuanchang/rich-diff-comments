# ADO Developer Notes

Implementation details, Azure DevOps API quirks, and DOM findings learned while porting the extension. Read this before non-trivial changes to the ADO extension — it documents non-obvious behavior of the ADO REST API and Preview surface.

**Companion docs:**
- [ADO_ADAPTER_PLAN.md](ADO_ADAPTER_PLAN.md) — master port plan + decision log
- [APPROACH.md](APPROACH.md) — shared architecture strategy (line mapping, DOM injection)
- [DEV_NOTES.md](DEV_NOTES.md) — GitHub-side equivalent

## High-level architecture

```
parsePRUrl()          → { org, project, repo, prId }
resolveIds()          → GET /_apis/git/repositories/{repo}?project=... → { projectId, repoId }
getPullRequest()      → GET /_apis/git/repositories/{repoId}/pullRequests/{id}
                                 → { sourceRefName, targetRefName, lastMergeSourceCommit }
getFileSource()       → GET /{projectId}/_apis/git/repositories/{repoId}/items?path=...&version=<branch>
buildFileLineMap()    → shared: mapBlocksToSourceLines(preview, sourceLines, filePath)
                        result: Map<element, {path, line}>
attachCommentButton() → `+` per block, sliding button for <pre> (per-line tracking)
listThreads()         → GET /_apis/git/repositories/{repoId}/pullRequests/{id}/threads
renderThreadBadge()   → `💬` badge/panel after mapped block
createThread()        → POST /threads with rightFileStart/rightFileEnd
reply/editComment/deleteComment → nested /comments endpoints
setThreadStatus()     → PATCH /threads/{id}  { status: 1 (active) | 2 (fixed) }
getConnectionData()   → GET /_apis/connectionData → authenticatedUser (identity)
```

All requests use `credentials: 'same-origin'` — session cookies only, no PAT, no OAuth.

Namespace convention: `.adrc-*` CSS classes, `window.ADORC` (adapter), `window.ADORC_probe` (DevTools), `[ADRC]` console prefix. Shared pure logic lives on `window.GRDC`.

## Content script world isolation

Manifest must declare `"world": "MAIN"`:

```json
"content_scripts": [{
  "matches": ["https://dev.azure.com/*/_git/*/pullrequest/*", ...],
  "js": [...],
  "css": ["styles.css"],
  "world": "MAIN"
}]
```

Without this, `window.ADORC_probe` is invisible to the default DevTools console context (isolated world). Trade-off: the content script shares scope with the page's JS, which is fine because our namespace (`ADORC`, `ADRC`, `adrc-`) doesn't collide with anything ADO uses.

## REST API version pinning

**Most endpoints work on `api-version=7.1`.** The exception:

- **`/_apis/connectionData` requires `7.1-preview.1`.** Passing plain `7.1` returns:
  ```
  HTTP 400 VssInvalidPreviewVersionException
  "The requested version 7.1 of the resource is under preview.
   The -preview flag must be supplied in the api-version for such requests.
   For example: 7.1-preview"
  ```

  Fix in [src/adapters/ado.js](../src/adapters/ado.js) `connectionDataUrl()` — pins this one endpoint to `7.1-preview.1` while leaving everything else on stable `7.1`.

If we later hit similar 400s on other endpoints, bump only that URL builder — don't lift the whole extension to preview.

## Identity model — IdentityRef has three matchable fields

Comments and connection data return an `IdentityRef` with **three usable identifiers**:

```js
{
  id: "16965b11-ea3d-6526-b731-4b31458c92aa",         // legacy TFS GUID
  descriptor: "msa.MTY5NjViMTEtZWEzZC03NTI2LWI3MzEtNGIzMTQ1OGM5MmFh",  // subject descriptor
  uniqueName: "chienyuanchang@outlook.com",           // typically email
  displayName: "Chien-Yuan Chang"
}
```

**Gotcha:** the `id` you get from `/_apis/connectionData → authenticatedUser` doesn't always equal the `id` on `comment.author` for threads posted by the SAME user. If you base64-decode the descriptor, the embedded GUID has a different version bit than the `id` field. Legacy TFS identity vs. subject descriptor are two different backends and ADO doesn't cross-reference them.

**Fix:** cache all three fields as `currentUserIdentity` and match `isOwnComment(c)` on ANY of `id`, `descriptor`, or `uniqueName`. Guaranteed at least one lines up.

**Debug helper:** run `await ADORC_probe.matchTest()` in DevTools — prints a `console.table` of every thread's first-comment author fields vs. the cached identity, with an `isOwn` verdict.

## Thread & comment shape

Threads are returned by `GET /threads`:

```js
{
  count: N,
  value: [
    {
      id: 4,
      status: "active" | "fixed" | "wontFix" | "closed" | "pending" | "byDesign" | "unknown",
      threadContext: {
        filePath: "/README.md",
        rightFileStart: { line: 8, offset: 1 },
        rightFileEnd:   { line: 8, offset: 4 }
      },
      comments: [
        {
          id: 1,
          author: { id, descriptor, uniqueName, displayName },
          content: "the markdown source",
          commentType: "text" | "system",
          publishedDate: "2026-07-...",
          lastContentUpdatedDate: "2026-07-...",   // === publishedDate if never edited
          isDeleted: false
        },
        ...
      ]
    }
  ]
}
```

**Filter out system threads.** ADO auto-creates threads for status changes, iteration updates, and policy violations. `adapter.isSystemThread(thread)` filters by `properties.CodeReviewThreadType || comments[0].commentType === "system"`.

**Resolved state** = `status: "fixed"` (not "resolved"). To toggle programmatically: PATCH `/threads/{id}` with `{ status: 1 }` (active) or `{ status: 2 }` (fixed). We collapse `fixed` threads to just a badge; unresolved ones auto-expand to a full panel.

**Comment editing** = PATCH `/threads/{id}/comments/{id}` with `{ content }`. `lastContentUpdatedDate !== publishedDate` marks an edit, which we render as `(edited)` next to the timestamp.

**Comment deletion** is soft. DELETE returns 200 with an empty body; the comment stays in the thread with `isDeleted: true`. We render it as `(This comment was deleted.)`.

## DOM quirks — table rows

**`<tr>` elements can't host children directly** (invalid HTML), so `GRDC.buttonAnchor(row)` returns the row's first `<td>` or `<th>` and we append the `+` button there.

**But** the `.adrc-hoverable:hover > .adrc-comment-btn { opacity: 1 }` CSS rule requires the button to be a **direct child** of the hovered `.adrc-hoverable`. If we put `.adrc-hoverable` on the `<tr>` (the mapped block), the button — one level down in a `<td>` — is *not* a direct child. Result: button stays at `opacity: 0` on hover.

**Fix:** put `.adrc-hoverable` on the *host* returned by `buttonAnchor` (the first cell for `<tr>`, the block itself for everything else). Same DOM shape the GitHub extension uses. See `attachCommentButton()` in [extensions/ado/content.js](../extensions/ado/content.js).

## DOM quirks — code blocks

Fenced code blocks render as `<pre><code><span>...</span>...</code></pre>` — no per-line wrapper elements. The extension:

1. **Maps `<pre>` to a single line** — mapper text-matches against the first content line inside the fence.
2. **Slides the `+` button vertically** on `mousemove` to track which line the cursor is over.
3. **Shows an editable line-number input** in the compose editor pre-filled with the tracked line.

**Two gotchas discovered:**

### 1. `pre.innerText.split('\n').length` over-counts

The DOM `innerText` includes highlighter decorations and trailing newlines that inflate the count vs. the real source. `findFenceRangeAroundLine(source, targetLine)` from [src/lib/codeBlocks.js](../src/lib/codeBlocks.js) parses fence markers directly from the raw source string and is authoritative — always prefer it.

### 2. DOM row count ≠ source line count

Even with the source-authoritative range, the *visual* DOM can render fewer (or more) rows than the source has content lines. Wrapping inflates DOM rows; stripped empty lines or highlighter merging shrinks them. Example from sandbox: 44 source lines → 35 DOM rows (~9 lines "compressed").

**Fix in `wireCodeBlockLineTracking`:**
```js
const scale = sourceRowCount / domRowCount;              // ~1.257 in the example
const resolvedLine = Math.min(sourceEnd, sourceStart + Math.round(clampedFraction * scale));
```

Linear interpolation across the block: row 0 → sourceStart, last DOM row → sourceEnd, no matter the visual density.

**Sub-row precision matters when `scale > 1`.** Using `Math.floor(yInText / lineHeight)` for line resolution would skip lines: adjacent source lines that share a DOM row become unreachable (moving one row down jumps by 2 source lines and skips one). We use the *fractional* row position for the line calculation while keeping the button snapped to whole DOM rows visually. Result: users can access every source line by moving the cursor within a row.

**Debug helper:** `ADORC_probe.codeBlock(index)` prints a table with sourceRange, domRows, innerTextLines, and computed scale for the Nth `<pre>` on the page.

### 3. Interior-line threads need expanded reverse map

`mapBlocksToSourceLines` only stores ONE entry per `<pre>` (its first content line). A thread anchored to line 222 inside a fence spanning 214–257 has no anchor in `currentLineToBlock` and its badge silently fails to render.

**Fix in `initButtonsForCurrentPreview`:** after each `<pre>` is attached, loop over its stored range and add `currentLineToBlock[line] = <pre>` for every interior line so any thread inside the fence renders under the same block.

## URL parsing

**PR URL** (browser): `/{org}/{project}/_git/{repo}/pullrequest/{id}[?path=/README.md]`
- `path` is optional; only present when viewing a specific file
- `project` and `repo` are URL slugs (names), not GUIDs

**Threads/comments endpoints** (org-scoped, no project needed):
```
/{org}/_apis/git/repositories/{repoId}/pullRequests/{id}/threads
```

**File source endpoint** (project-scoped, needed):
```
/{projectId}/_apis/git/repositories/{repoId}/items?path=/README.md&versionType=branch&version=<branch>
```

`projectId` and `repoId` are GUIDs — resolved once at init via `adapter.resolveIds(ctx)` which calls `GET /{org}/_apis/git/repositories/{repo}?project={project}`. Cached on the ctx object for the rest of the session.

Source branch is derived from `pr.sourceRefName` (strip `refs/heads/` prefix). Cached in `_sourceBranchPromise` inside content.js.

## Captured samples

Real payloads from the sandbox PR are stored in `local-only/ado-samples/` (git-ignored):

- `thread-create-response.json` — response to `POST /threads` for a new comment
- `all-probes.json` — combined output of every ADORC_probe endpoint against a sandbox PR

Regenerate via DevTools:
```js
await ADORC_probe.list()          // threads
await ADORC_probe.pr()            // PR metadata
await ADORC_probe.me()            // authenticated user
await ADORC_probe.detectLines('/README.md')   // line mapping
```

## Debug commands

Run in DevTools on any ADO PR page (extension loaded):

```js
ADORC_probe.list()                 // list all threads (system filtered)
ADORC_probe.me()                   // print authenticated user + cached identity
ADORC_probe.matchTest()            // isOwn verdict per thread
ADORC_probe.codeBlock(0)           // source-vs-DOM row math for Nth <pre>
ADORC_probe.detectLines('/x.md')   // block → source line map
ADORC_probe.pr()                   // PR metadata
ADORC_probe.reinit()               // re-attach buttons + badges without page reload
```

Console prefix `[ADRC]` — filter by that in DevTools to see only the extension's logs.
