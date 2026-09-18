# ADO Developer Notes

Implementation details, Azure DevOps API quirks, and DOM findings learned while porting the extension. Read this before non-trivial changes to the ADO extension — it documents non-obvious behavior of the ADO REST API and Preview surface.

**Companion docs:**
- [Shared feature roadmap](../FEATURES.md) — authoritative shared capability and parity status
- [ADO feature notes](./FEATURES.md) — ADO-specific feature mechanics and constraints
- [ADO_ADAPTER_PLAN.md](ADO_ADAPTER_PLAN.md) — historical port design, validation record, and decision log
- [GitHub approach](../github/APPROACH.md) — GitHub architecture strategy and shared matching background
- [GitHub developer notes](../github/DEV_NOTES.md) — GitHub-side equivalent

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

  Fix in [src/adapters/ado.js](../../src/adapters/ado.js) `connectionDataUrl()` — pins this one endpoint to `7.1-preview.1` while leaving everything else on stable `7.1`.

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

**Comment deletion** is soft. DELETE returns 200 with an empty body; the comment stays in the thread with `isDeleted: true`. Deleted-comment placeholders remain inside threads that have another visible comment so replies retain their context. Once every comment is deleted, the retained empty thread record is excluded from inline rendering, sidebar totals, Outline attribution, and navigation.

## Native `@mention` discovery — endpoint verified, payload pending

A live native ADO PR comment capture on 2026-09-17 showed that typing a mention
uses `POST /_apis/IdentityPicker/Identities`, not the previously assumed
`GET /_apis/identities?searchFilter=General&filterValue=...`. Selecting a person
also sends `PATCH /_apis/IdentityPicker/Identities/me/mru/common`, apparently to
update the current user's recent identities. The actual review comment still
posts through the normal pull-request `POST .../threads` endpoint.

`browser.events.data.microsoft.com/OneCollector` and `_apis/ClientTrace/Events`
are telemetry and are not part of mention behavior. The observed Contribution
Hierarchy query may support page context but should not be copied into the
extension unless payload evidence proves it is required.

The verified search request body contains `query`, identity types `user` and
`group`, operation scopes `ims` and `source`, result bounds 5–40, and requested
display/directory properties. The response is
`{ results: [{ queryToken, identities, pagingToken }] }`; useful fields include
`localId`, `displayName`, `entityType`, `active`, `subjectDescriptor`, `mail`,
`signInAddress`, `scopeName`, and `isMru`.

The native editor performs a second IdentityPicker lookup with the selected
uppercase `localId` and `queryTypeHint: "uid"`. It then stores the mention in
thread comment content as `@<LOCAL-ID-GUID>`. The create-thread response retains
that token verbatim and reports `identities: null`; therefore our inline renderer
must retain cached identity metadata or resolve unknown GUID tokens by UID to
show a readable name. No separate mention collection is required in the thread
payload. Extension requests must explicitly include
`?api-version=7.1-preview.1`; an ordinary JSON `POST` without a version is
rejected with HTTP 400, and stable `7.1` is rejected because IdentityPicker is a
preview resource. Keep this version separate from the adapter's stable API
version. Identity display metadata is resolved again when a short-lived PR
catalog snapshot is restored after cross-file route fallback; only raw thread
data is persisted, so snippets must not be built before UID hydration completes.
Notification delivery still needs explicit live confirmation.

## DOM quirks — table rows

**`<tr>` elements can't host children directly** (invalid HTML), so `GRDC.buttonAnchor(row)` returns the row's first `<td>` or `<th>` and we append the `+` button there.

**But** the `.adrc-hoverable:hover > .adrc-comment-btn { opacity: 1 }` CSS rule requires the button to be a **direct child** of the hovered `.adrc-hoverable`. If we put `.adrc-hoverable` on the `<tr>` (the mapped block), the button — one level down in a `<td>` — is *not* a direct child. Result: button stays at `opacity: 0` on hover.

**Fix:** put `.adrc-hoverable` on the *host* returned by `buttonAnchor` (the first cell for `<tr>`, the block itself for everything else). Same DOM shape the GitHub extension uses. See `attachCommentButton()` in [extensions/ado/content.js](../../extensions/ado/content.js).

## List-item button alignment — first-line centering

Manual testing on 2026-09-16 captured a single-line list item where the circular `+` button sat slightly below the center of the bullet text and its highlighted row. This was separate from the same item's incorrect source anchor.

List items cannot use the default `top: 50%` rule because an item may contain a nested list; centering against the complete subtree would move the parent button into its children. The old fixed `top: 4px` placed a 22px button three pixels below the center of ADO's 24px list line. The corrected rule inherits the list item's line height and calculates the top offset from one `lh`, centering on the first line regardless of the nested subtree's total height.

ADO browser coverage compares button geometry with the first line box for both a normal single-line paragraph and a list item. Table-cell and code-block rules remain unchanged.

## List-item mapping — prevent section-heading anchors

Manual testing on 2026-09-16 captured an ordered-list item whose visible `+` control opened a comment that ADO ultimately displayed on the preceding section heading rather than on the selected bullet (reported on the third bullet in the list). This is a source-anchor correctness defect, separate from the nearby visual button-alignment issue.

The shared mapper walks `p, h1–h6, li, tr, pre` in DOM order, removes nested-list text from a parent `<li>`, then forward-matches each block against the head source. Generic prose matching is unsafe for `<li>` because the same visible text can appear in a heading; failed earlier matches can also leave the search cursor before that heading.

The fix constrains `<li>` candidates to source lines beginning with a Markdown unordered, ordered, or task-list marker. If no valid candidate exists, the item follows the bounded unmatched-block fallback instead of being passed to the generic prose matcher. This preserves monotonic source order and prevents a textual heading match from stealing the list item's anchor.

Regression coverage includes both layers:

1. a shared mapper fixture with an unmatched rendered heading followed by an ordered list whose third item repeats the heading text; and
2. an ADO browser fixture that clicks the third unordered-list item and asserts `rightFileStart` and `rightFileEnd` both target that bullet's source line.

The original live PR still needs manual confirmation before this is considered release-validated. If it differs from the covered failure shape, capture the list DOM, raw Markdown, `ADORC_probe.detectLines(filePath)` output, and create-thread payload before broadening the matcher further.

## DOM quirks — code blocks

Fenced code blocks render as `<pre><code><span>...</span>...</code></pre>` — no per-line wrapper elements. The extension:

1. **Maps `<pre>` to a single line** — mapper text-matches against the first content line inside the fence.
2. **Slides the `+` button vertically** on `mousemove` to track which line the cursor is over.
3. **Shows an editable line-number input** in the compose editor pre-filled with the tracked line.

**Two gotchas discovered:**

### 1. `pre.innerText.split('\n').length` over-counts

The DOM `innerText` includes highlighter decorations and trailing newlines that inflate the count vs. the real source. `findFenceRangeAroundLine(source, targetLine)` from [src/lib/codeBlocks.js](../../src/lib/codeBlocks.js) parses fence markers directly from the raw source string and is authoritative — always prefer it.

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

## SPA file navigation reuses Preview DOM

ADO file navigation does **not** guarantee a new `.markdown-preview-container`.
When users switch files, ADO can:

1. update only `location.search` (`?path=/next.md`),
2. preserve the same Preview container element, and
3. replace only that container's heading/content children.

An element-only idempotency guard such as `container.dataset.adrcInitialized`
therefore goes stale: the next file inherits the prior file's initialized flag,
the outline keeps references to detached headings, click-to-scroll stops, and
scroll tracking remains bound to the prior file's content.

The ADO lifecycle is now keyed by **both**:

```js
routeKey = `${location.pathname}|${path}|${_a}`;
activePreviewContainer = getCurrentPreviewContainer();
```

On either route or active-container change, `resetPreviewContext()` removes
per-file injected UI, clears line/source/heading caches, invalidates in-flight
async initialization, re-detects the actual inner scroll container, and rebinds
the Outline scroll listener. A 250 ms route-key watcher complements the
`MutationObserver` because History API URL changes do not themselves emit DOM
mutations or `popstate` events.

Initialization also rejects stale async results if the route, Preview element,
or mapped child elements change while source is being fetched. This prevents a
slow response for file A from attaching buttons or outline rows to file B.

**Debug helper:** `ADORC_probe.outline()` reports the current headings and the
detected scroll container. After a file switch, both must reflect the new file.

### SPA pull-request navigation must replace the runtime context

ADO can also change `/pullrequest/<id>` with History API navigation while
retaining the entire document. This is a different lifecycle boundary from a
file or view change inside one PR. The content script parses its adapter context
once at load, and its repository IDs, PR metadata promises, source caches,
thread inventory, Changes catalog, and Outline catalog all belong to that
original PR. Reusing the closure after moving from PR A to PR B therefore sends
requests with PR A's ID and leaves PR A's sidebar cards visible on PR B.

The route watcher compares a normalized identity containing the origin,
organization, project, repository, and PR ID before doing any pending-jump or
file initialization work. A changed identity clears only PR-scoped session
entries (pending destinations, exact-route fallback, and catalog snapshot),
removes the stale sidebar, and reloads the current URL once. Chromium then
reinjects the scripts with PR B's context. Persistent sidebar placement, size,
active tab, and filter preferences remain in local storage. Pending navigation
and fallback records also carry the loaded PR identity, so a direct document
navigation that bypasses the old route watcher still rejects stale PR-A state.

Do not turn this into a partial in-place reset. Every old asynchronous request
would also need cancellation or an identity guard, and every mutable promise,
source cache, generation, DOM reference, and adapter-resolved ID would need to
be replaced atomically. A document reload is the safer PR boundary; same-PR
file/view navigation continues to use the warm in-memory catalogs without a
reload.

### Cross-file sidebar navigation must reapply Preview

The four-option file view mode (**Side-by-side / Inline / Raw content /
Preview**) is not encoded in the PR URL. A generic click on the first anchor
whose URL contains the desired `?path=` can select an ADO diff/card link and
remount the target file in Side-by-side mode, even when the reviewer started in
Preview.

Sidebar thread navigation therefore:

1. scores visible native `[role="treeitem"]` / `.bolt-tree-row` candidates
   by path and filename,
2. activates the row's `.bolt-tree-cell` content so ADO's React tree handles
   the file switch and preserves its sticky Preview state,
3. stores a pending `{threadId, path, requirePreview}` jump in session storage,
4. after the file route changes, detects whether a visible
   `.markdown-preview-container` exists,
5. if not, opens ADO's documented view-mode split button and selects the
   visible menu option whose label is `Preview` or begins with `Preview`, and
6. waits for route-aware Preview initialization before scrolling to and
   expanding the target inline thread.

The native tree remains the primary path. A clean same-PR GET is retained only
as a last resort after exact-row lookup, collapsed-ancestor expansion, and
virtual-tree materialization fail. That document fallback cannot replace ADO's
selected-file model reliably, so it is not treated as an alternative to native
selection. Use `ADORC_probe.fileTargets('/path/to/file.md')` to inspect row
discovery.

Do not add a made-up view-mode URL parameter: ADO currently keeps this in its
React/session state. The DOM fallback deliberately relies on user-visible mode
labels rather than unstable generated Fluent class names.

**Menu DOM detail:** `azure-devops-ui` renders contextual menu options as
`<tr class="bolt-menuitem-row bolt-list-row" role="menuitem">`; the visible
text is in a nested `.bolt-menuitem-cell-text`, while `aria-label` may be a
longer descriptive string beginning with the mode name. Match `Preview` or an
accessible label beginning with `Preview`, not strict whole-element text.

**Do not broadly scan/click page buttons while the menu is open.** An earlier
implementation mistook Side-by-side/Inline menu rows for the split-button
control and repeatedly clicked neighboring options, oscillating between modes.
The restore flow is one-shot per pending navigation: open only the documented
`.bolt-split-button-option`, click only the Preview menu row once, then wait for
the rendered container. Unknown menu DOM fails safely and is exposed through
`ADORC_probe.viewMode()`.

**2026-09-16 correction: the file-X jump was false Preview-menu discovery, not
a failed TreeEx selection.** A live trace from a bare Files route showed the
requested Markdown leaf found and accepted by the List selection model. The
route changed to that exact Markdown path. Two milliseconds later, Preview
restoration reported `preview-restore.option-clicked` for
`2026-06-01-preview`; the following `control.clicked` identified it as a
changed-file TreeEx row, not a menu item. ADO correctly activated that row and
returned to the extensionless file X.

The bug was a page-wide `.bolt-list-row` scan in mode-option discovery combined
with label matching that intentionally accepts accessible text ending in
`Preview`. Bolt uses List rows for both popup menus and the repository tree, so
any visible file/folder ending in `preview` could masquerade as the Preview
mode option before the view-mode popup had even opened. The apparent
before/after-file-X boundary came from which virtualized tree rows remained
materialized: moving far enough past X removed the decoy from the current
paint, allowing the real menu to open.

Mode options must therefore be discovered only inside a visible ADO
menu/callout/listbox root. Page-level List rows and TreeEx rows never qualify,
regardless of their label. The browser fixture includes an extensionless
`2026-06-01-preview` changed-file row and verifies that one-click setup remains
on the requested Markdown file while selecting the real Preview menu option.

These findings also separate earlier work by evidence. Native List-root
selection is still required and is what successfully selected the requested
Markdown leaf. Catalog preservation still protects the genuine final reload
fallback. The late-leaf/List-dispatcher readiness wait was supported only by
an artificial fixture and was removed before release. The removed
content-script/service-worker navigation experiment remains unnecessary
because changing the browser URL cannot solve either native selection or popup
misclassification.

**TreeEx recycles connected row elements during virtualization.** Live testing
on a large PR showed the same generated row element being reused for different
`data-row-index` values while the file-tree scroller moved. A remembered
descriptor can therefore still name the requested Markdown file while its
connected `row` now represents an unrelated folder. This was observed as every
navigation landing on an extensionless `openapi/2026-06-01-preview` directory.
Remembered entries are path snapshots only: activation requires the matched row
index to be present in the current paint, and the row is revalidated immediately
before each click, Enter, or double-click gesture.

**2026-09-16 root cause: ADO's selected-file model is separate from the URL.**
The repeatable sequence is: select a non-Markdown file, use extension navigation
to request Markdown, and observe ADO remain pinned to the non-Markdown file;
manually selecting a Markdown file and choosing Preview releases the lock until
another non-Markdown file is selected. URL changes, document reloads, and
browser-level tab updates all failed to replace that native selection. The
earlier startup explanation based on a recycled collapsed ancestor was therefore
incorrect, and that speculative ancestor-specific code was removed.

**An exact materialized row can require press events, not only `click()`.** A
live probe reconstructed the correct deeply nested Markdown leaf at score 240,
yet click-only activation left the route unchanged and forced the rejected URL
fallback. When the list-level selection path is unavailable or produces no
transition, the DOM fallback targets the freshly revalidated cell with a
complete pointer/mouse press-release-click sequence before trying keyboard and
double-click. This accommodates TreeEx consumers that select or activate from
`pointerdown` / `mousedown`.

**TreeEx selection and activation are distinct operations.** The published
`azure-devops-ui` List/TreeEx implementation handles a row click at the list
root, derives the row index from `event.target`, calls the selection model, and
only then performs single-click activation. The prior private-React fallback
walked arbitrary row/cell ancestors and called event handlers with only a
fabricated event. It could appear to request the right URL without supplying
the list row that ADO needs to replace its selected-file state.

The native path now locates the current TreeEx list root and invokes its single
click dispatcher once with the exact, freshly revalidated leaf as the event
target before trying DOM activation fallbacks. The list itself constructs the
real row payload and runs selection before activation. If no current list
dispatcher is discoverable, this private path is skipped rather than guessing
at component callbacks.

**Commit the exact fallback URL before reloading.** Live testing also showed the
legacy PR viewer restoring its previously selected folder during a direct
`location.assign()` to another file. The page visibly refreshed, but its
`?path=` returned to the old extensionless folder. The fallback now constructs
a clean same-PR URL. Further testing confirmed that pasting this exact URL into
the address bar works while script-driven assignment and replace/reload are
rewritten. The fallback therefore submits a plain browser-level GET form to the
PR path with only `path` and `_a=files`, matching a direct document navigation
instead of notifying ADO's SPA router first. A short-lived session marker
verifies that ADO retained the requested path; if ADO still rejects it, the
pending sidebar jump is released instead of repeatedly pinning navigation.

**2026-09-04 live result: the GET fallback is not stable during ADO startup.**
The new document initially loaded with the requested Markdown `?path=`, then
ADO's PR viewer rewrote it during hydration to its previously selected
extensionless directory (`openapi/2026-06-01-preview`). The subsequent
`Failed to fetch` inventory errors are consistent with requests being aborted
by that full-document navigation; they are symptoms, not evidence that MSAL or
the REST endpoints initiated the redirect. The browser's permissions-policy
`unload` warnings are emitted by ADO bundles and are unrelated.

**Cross-file sidebar cards remain real links, while ordinary clicks use the
shared native-tree-first router.** Changes, Threads, and Outline destinations
retain clean same-PR `href` values and `_top` as a manual fallback. Their click
handlers prevent the default so normal use updates ADO's native selected-file
state before Preview restoration instead of relying on URL navigation alone.

**A last-resort document navigation must carry the PR-wide catalogs across the
reload.** In-memory promises correctly deduplicate normal SPA file switches,
but the exact-route GET fallback creates a new JavaScript document and therefore
used to repeat changed-file discovery, every head/base source comparison, the
PR-wide Outline build, and thread discovery. Immediately before submitting the
fallback, the extension now writes a short-lived, PR-scoped session snapshot of
the normalized Markdown inventory, compact Changes stops, DOM-free Outline, and
thread data. The next document restores it only while the exact-route marker is
pending, then fetches just the active file source needed for line mapping.

The snapshot deliberately excludes raw Markdown source and stores only a
presence marker for each diff hunk's base/head lines. It expires with the
90-second navigation window, is capped at 1.5 million serialized characters,
and progressively drops thread, Outline, then detailed Changes data while
retaining lightweight file/version inventory whenever possible. Failure is
non-fatal: navigation still completes and the new document falls back to the
normal service requests.

The isolated content-script/service-worker navigation experiment was removed.
Live testing showed that changing the browser URL from outside the page still
left ADO's selected-file model pinned, so the extra manifest surface did not
address the failure. The exact-route GET remains only as a final fallback when
the native tree cannot expose a target; it is not used as a substitute for a
known materialized row's selection transition.

## Changes tab — source diff, not DOM markers

ADO Preview renders only the final document. Unlike GitHub rich diff, it does
not include `<ins>`, `<del>`, `.added`, or `.removed` markers, so the Changes tab
cannot discover edits by walking the rendered DOM.

The current ADO flow is:

1. fetch the cumulative changed-file inventory from the latest PR iteration,
2. fetch each Markdown file at that iteration's exact source/common commits,
3. compute dependency-free Myers line hunks with `diffLineHunks()`, and
4. resolve a stored hunk against the fresh rendered block map only when the
   reviewer navigates to that card.

### PR-wide inventory comes from the latest iteration

The authoritative file list is not the currently rendered Preview DOM. Use:

```text
GET /{org}/{project}/_apis/git/repositories/{repoId}/pullRequests/{prId}/iterations?api-version=7.1
GET /{org}/{project}/_apis/git/repositories/{repoId}/pullRequests/{prId}/iterations/{latest}/changes?$compareTo=0&$top=2000&$skip=0&api-version=7.1
```

`$compareTo=0` compares the latest iteration against its common source/target
commit and returns the cumulative PR inventory. Follow `nextSkip` / `nextTop`
until both are zero. `GitPullRequestChange` supplies `changeType`, `item.path`,
`changeTrackingId`, and (for renames) `originalPath` / `sourceServerItem`.

**Do not use response order as display order.** Live testing found that the
iteration endpoint can return entries in the reverse of ADO's left file tree.
When all relevant tree rows are materialized, order both Changes and Threads by
their native DOM order. If folders/virtualization hide any row, use stable path
order for the entire list rather than mixing two order systems. The current
file is highlighted in place; never move its group to the top, which makes the
list jump whenever the reviewer changes files.

Pin head reads to the latest iteration's `sourceRefCommit.commitId` and base
reads to `commonRefCommit.commitId`. Do not read moving branch/target tips for
PR-wide cards: either can advance between requests and create hunks that do not
belong to the inventory being displayed. Cache source requests by version and
path, not by path alone.

Only final/current Markdown paths are included. A rename from `.md` to `.txt`
is not a rendered-review change even though its old path was Markdown; a rename
from `.txt` to `.md` is included.

### Stable cards are DOM-free

PR-wide cards store path, source range, lifecycle, snippet, and source hunk—no
element reference. ADO renders one Preview at a time, so a node from a previous
file is necessarily stale. On navigation, activate the native ADO tree row,
wait for route-aware Preview initialization, and map the stored source hunk to
the fresh block→line map. The card catalog survives Preview resets.

Added, deleted, and renamed files receive one lifecycle summary (`NEW FILE`,
`DELETED`, `RENAMED`). Renames can also have content-hunk cards. Deleted files
have no head Preview, so their summary activates the native row without entering
the Preview-restoration retry loop.

### New-file handling no longer relies on a target 404

The earlier current-file implementation inferred a new file from a handled
target-commit 404. The PR-wide implementation trusts `changeType: "add"` from
the iteration changes resource and does not request a base version. This avoids
a noisy expected 404 and prevents an unexpected 404 on an edited or renamed
file from being misclassified as new. Source failures produce one `UNAVAILABLE`
card for that file while Changes, Threads, Outline, and inline review continue.

### Navigation must cross nested ADO scrollers

Some ADO file layouts require more than the nearest inferred overflow element
to move. Setting only that element's `scrollTop` worked for wholly new files but
could leave a valid, visible modified-file target stationary.

Changes, Threads, and Outline navigation now use native `scrollIntoView()`,
which traverses all required scroll ancestors. A temporary `scroll-margin-top`
preserves the sticky-header offset. Navigation checks for movement after two
animation frames and retries with immediate behavior if smooth scrolling never
starts. Before scrolling a Changes target, it also:

- re-resolves the block from the current line→block map (partial Preview
  rerenders can stale an earlier element reference), and
- expands every folded heading section containing the target.

**Debug helper:** `ADORC_probe.changes()` returns each stop's kind, lines,
snippet, tag, display, geometry, folded/connected state, and `lastScroll`
before/after diagnostics. `ADORC_probe.changes(index)` invokes a specific card.

### Persistent Preview change context reuses the Changes catalog

Preview highlighting performs no additional source requests. As each file's
Changes group is published, the active file's hunk stops are resolved through
the same live line-to-block map used by Changes navigation. Pure additions use
the success/green theme family and mixed replacement hunks use the existing
warning/brown family. If multiple hunks resolve to one rendered block—most
commonly a fenced code block—mixed takes precedence over added.

A newly added Markdown file has a summary stop rather than useful individual
hunks. Its Preview therefore receives one subtle file-level marker instead of
tinting every rendered block green; block-level color would add no location
information and would compete with reading and comment selection. Removed-only
hunks and deleted files have no head-side rendered block and are intentionally
not projected onto unrelated surviving content. Highlights are reapplied both
when progressive analysis publishes a group and when Preview remounts, making
the result independent of which operation finishes first.

## PR-wide Outline — source catalog, live active-file binding

ADO renders one Markdown Preview at a time, but Iteration M already fetches the
head source for every changed Markdown file. `extractMarkdownHeadings()` parses
ATX and Setext headings from those cached sources while ignoring fenced code.
The resulting PR-wide catalog stores only path, line, level, text, and a stable
`path::line::level` key—never a DOM node.

When a file is active, its rendered headings are matched back to the exact
source descriptors and gain the same stable key. Cross-file Outline clicks save
that key, activate the native ADO file-tree row, preserve/restore Preview, and
resolve the key against the newly mounted live headings before scrolling.

Rebuilding the PR-wide rows empties the Outline scroll container, which resets
its scroll position before the new rows are inserted. Every rebuild therefore
reapplies the pending destination key, or the retained active key after pending
navigation clears. This follows the destination element rather than restoring
an obsolete numeric offset. Explicit navigation centers the row to provide
context above and below; ordinary Preview scroll-follow resumes with minimal
nearest-edge movement so reading does not make the sidebar jump unnecessarily.

Per-heading thread counts use the shared source-line attribution helper and are
file-scoped. Per-row folds can be requested before a file is opened; the stable
fold-key set applies that intent when its live Preview mounts. Bulk Fold H1/H2/
H3 and Expand all intentionally affect only the active rendered file. Deleted,
no-heading, and source-error files remain as compact file-level states.

## ADO theme integration

The production `azure-devops-ui` package maps its SCSS aliases to live page
custom properties including `--background-color`, `--text-primary-color`,
`--text-secondary-color`, `--border-subtle-color`, `--communication-background`,
`--text-on-communication-background`, `--focus-border-color`, status colors,
and panel-shadow colors. Palette colors such as `--palette-primary-60` and
`--palette-neutral-2` are RGB channels and must be consumed as
`rgba(var(--palette-..., r, g, b), alpha)`.

ADRC aliases are defined on both `:root` and `body.adrc-theme-host`, then every
injected component references only those aliases. This lets ADO's in-app theme
custom properties win regardless of whether the host defines them on the root
or an inherited body scope. Because theme changes mutate CSS properties rather
than child DOM, they update in place and do not trigger Preview initialization
or lose editor/sidebar state.

`prefers-color-scheme: dark` is only a safety net for stripped/embedded pages
without host tokens. `forced-colors: active` maps aliases to Canvas, CanvasText,
Highlight, HighlightText, GrayText, and LinkText, with deterministic adjustment
on injected roots. Run `ADORC_probe.theme()` to print host tokens and computed
sidebar/thread/editor colors during live theme checks.

## Sidebar header parity — icons and scoped counters

The ADO header follows the GitHub v1.8 interaction model while retaining Fluent
colors, the ADO hide button, and clickable count buttons. Each navigation
cluster is ordered icon → count → previous → next. The document/diff icon and
overlapping-discussion icon jump to the first matching item in the current file,
or invoke global-next when that file has none. Previous/next buttons and
keyboard shortcuts continue walking the stable PR-wide lists.

Both Changes and filtered Threads use `buildScopedCounterState()`:

- `N/M (T)` — position in this file / items in this file / items in PR
- `N/M` — one-file list, where the parenthetical would be redundant
- `0/0 (T)` — current file has no items; the counter is visibly dimmed

The unresolved-only filter changes the Threads `T` because header navigation
walks only the visible filtered list. The Threads tab badge remains the
unfiltered PR thread count, which accurately describes the pane's underlying
data rather than the current header-navigation subset.

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
