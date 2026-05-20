# Developer Notes

Implementation details, GitHub internal data shapes, and debugging recipes learned while building this extension. Read this before non-trivial changes — it documents non-obvious behavior of GitHub's undocumented endpoints.

## High-level architecture

```
parsePRUrl()           → { owner, repo, pullNumber }
fetchRouteData()       → /pull/:n/changes (JSON) → diffSummaries, comparison, threads
buildLineMap()         → for each rich-diff file:
                          fetchRawSource()  → raw markdown text
                          buildSourceIndex()→ normalized string + line offsets
                          findTextInSource()→ rendered block → source line
                         result: Map<element, {path, line}>
attachCommentButtons() → render `+` on each mapped element
fetchExistingComments()→ resolve threads to (path, line) via diffSummary.markersMap
renderExistingComments() → render `💬` badges at nearest mapped block
postReviewComment()    → POST /pull/:n/page_data/create_review_comment
```

All requests use `credentials: 'include'` — session cookies only, no PAT.

## GitHub internal data shapes (verified against private PRs, 2026-05)

These come from undocumented endpoints. Field names may change without notice — always log and inspect first.

### `/pull/:n/changes` (JSON)

Send `Accept: application/json`, `X-Requested-With: XMLHttpRequest`, `GitHub-Verified-Fetch: true`. Response:

```js
{
  payload: {
    pullRequestsChangesRoute: {
      diffSummaries: [
        {
          path: "features/foo/bar.md",
          pathDigest: "b3bdec2e751b...",          // matches DOM id "diff-<digest>"
          changeType, linesAdded, linesDeleted, ...
          markersMap: {                            // ← review-thread index per line
            "R12":  { ...thread refs... },         //   right side, line 12
            "R85":  { ... },
            "L34":  { ... },                       //   left side, line 34
          }
        },
        ...
      ],
      comparison: {
        fullDiff: { baseOid: "...", headOid: "..." },  // commit SHAs to send when posting
        selectedRange, viewing
      },
      markers: {
        threads: {
          "<threadId>": {
            id, subjectType: "LINE", isResolved, viewerCanReply,
            commentsData: { comments: [{
              author, body, bodyHTML, createdAt, databaseId, url,
              currentDiffResourcePath,   // contains only "#r<commentId>" — NOT useful for line lookup
              ...30 other fields
            }] }
          }
        }
      }
    }
  }
}
```

**Critical insight:** thread payloads do **not** carry `path` or `line`. The only way to resolve them to (path, line) is via each `diffSummary.markersMap` whose keys are `R<line>` / `L<line>`. The values link back to threadIds — walk the structure to extract IDs.

**Multi-line ranges:** the `markersMap` entry uses the END line as its key (e.g. `R68`), and each `threads[]` element optionally carries a `start: "R57"` string with the start line. Example for a comment on lines 57–68:

```js
"R68": {
  "threads": [{ "id": 2168514608, "start": "R57" }],
  "annotations": [],
  "ctx": [54, 71]   // ← rendered-context window, NOT the comment range
}
```

If a thread entry lacks `start`, it's a single-line comment. The thread object itself (`route.markers.threads[<id>]`) has **no** range fields — `subjectType: "LINE"` is reported for both single and multi-line threads.

### Blob page HTML (raw source)

`GET https://github.com/<owner>/<repo>/blob/<sha>/<path>` returns full HTML. The raw file content lives in one of several `<script type="application/json">` tags:

- `data-target="react-app.embeddedData"` — modern blob view
- `data-target="react-partial.embeddedData"` — sometimes contains it instead

The blob payload (somewhere inside the JSON tree) contains either:
- `rawLines: ["line 1", "line 2", ...]` — preferred
- `rawBlob: "full text"` — fallback

`fetchRawSource()` walks all JSON `<script>` tags and recursively searches for these keys (see `findBlobInJson`). Do **not** assume a fixed JSON path — GitHub has changed it multiple times.

**Do not** fetch `raw.githubusercontent.com` from a `github.com` content script: it sets `Access-Control-Allow-Origin: *` which forbids credentialed requests. Use `github.com/blob/...` HTML instead.

### Posting a comment: `/pull/:n/page_data/create_review_comment`

```js
POST https://github.com/<owner>/<repo>/pull/<n>/page_data/create_review_comment
Headers: {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
  "GitHub-Verified-Fetch": "true",
  "Accept": "application/json"
}
Body: {
  comparisonStartOid: <baseOid>,
  comparisonEndOid:   <headOid>,
  path: "features/foo/bar.md",
  line: 92,
  side: "right",
  subjectType: "line",
  submitBatch: true,
  text: "comment body",
  positioning: { type: "line", baseCommitOid, commitOid, headCommitOid, line, path, type: "line" }
}
```

Response codes:
- `200/201` — success
- `422 {"error":"Line could not be resolved."}` — line is outside any diff hunk for that file. Either the wrong line was sent, or `comparisonStartOid` is wrong.
- `422` (other) — sometimes transient; we retry once.

**Critical:** `comparisonStartOid` must be the actual base OID (`fullDiff.baseOid`). Falling back to `headOid` makes the diff range empty and *everything* fails with "Line could not be resolved".

### Multi-line range comments

Same endpoint, different `subjectType`. Verified payload (captured 2026-05 from GitHub's native source-diff drag-comment):

```js
{
  comparisonStartOid: <baseOid>,
  comparisonEndOid:   <headOid>,
  text: "comment body",
  submitBatch: true,
  line: 68,                        // END line
  path: "features/foo/bar.md",
  positioning: {
    baseCommitOid: <baseOid>,
    headCommitOid: <headOid>,
    type: "multiline",             // lowercase, NOT "multiLine"
    startPath: "features/foo/bar.md",
    startLine: 57,
    startCommitOid: <headOid>,
    endPath:   "features/foo/bar.md",
    endLine:   68,
    endCommitOid:   <headOid>,
  },
  side: "right",
  startLine: 57,
  startSide: "right",
  subjectType: "multiline",        // lowercase
}
```

**Critical gotchas (each costs one round of 422):**

| Wrong | Right | Server error |
|---|---|---|
| `subjectType: "multiLine"` (camelCase) | `"multiline"` (lowercase) | 200 OK but stored as single-line |
| Missing `positioning.startCommitOid` | include both `startCommitOid` and `endCommitOid` | `Start commit oid parameter is invalid` |
| Missing `positioning.endCommitOid` | include it | `End commit oid parameter is invalid` |
| Missing `positioning.startPath` / `endPath` | include both | `Start/End path parameter is invalid: must not be blank` |
| Missing `positioning.endLine` | include it (= `line`) | `End line parameter is invalid: must be an integer > 0` |

When the range is entirely on the right side (the common case), `startCommitOid === endCommitOid === headOid`.

### LEFT-side comments (on deleted lines)

Same endpoint. Verified payload (captured 2026-05 from GitHub's native source-diff, commenting on a deleted line):

```js
{
  comparisonStartOid: <baseOid>,
  comparisonEndOid:   <headOid>,
  path: "test_md_files/sample-design-doc.md",
  line: 4,                            // OLD (base-file) line number
  side: "left",                       // lowercase
  subjectType: "line",
  submitBatch: true,
  text: "deleted line 4",
  positioning: {
    type: "line",
    baseCommitOid: <baseOid>,
    commitOid: <baseOid>,             // ← swaps to BASE (RIGHT-side uses head)
    headCommitOid: <headOid>,
    line: 4,                          // OLD line
    path,
  }
}
```

**Diff vs RIGHT-side payload (only three fields change):**

| Field | RIGHT | LEFT |
|---|---|---|
| `side` | `"right"` | `"left"` |
| `positioning.commitOid` | `headOid` | **`baseOid`** |
| `line` and `positioning.line` | head (post-change) line | **base (old) line** |

`comparisonStartOid`, `comparisonEndOid`, `positioning.baseCommitOid`, `positioning.headCommitOid` stay the same as RIGHT. Multi-line LEFT ranges are not yet captured — the same field-swap pattern is likely to apply (`startSide: "left"`, `positioning.startCommitOid` / `endCommitOid` swap to base, start/end lines from base) but should be verified with another captured payload before shipping.

## Resolving rendered block → source line

The hardest problem. Approach:

1. **Strip markdown** from the source (`stripMarkdown`) — removes headings, bold, lists, links, etc., to mirror what the renderer does.
2. **Normalize** both source and rendered text (`cleanRenderedText`): strip zero-width and bidi chars (`\u200b–\u200f` etc.), collapse whitespace, lowercase.
3. **Concatenate** all source lines into one string with a `lineOffsets[]` array tracking each line's start offset.
4. For each rendered block, take a chunk of its normalized text and `indexOf` from the **last successful match offset** forward (handles duplicate text by maintaining order).
5. Falls back to chunk lengths `[80, 50, 30, 20, 12]`. If none match, use last offset.

### Things that break matching

| Block type | Why it fails | Effect |
|---|---|---|
| Mermaid diagrams | rendered to SVG, no source text in DOM | next paragraph inherits stale `lastOffset` |
| Tables | `\|` separators stripped, but cell joining differs | partial match or miss |
| HTML blocks (`<details>`, etc.) | source contains HTML, rendered DOM doesn't | miss |
| Reference-style links | `[text][ref]` vs rendered text | usually matches via fallback chunks |
| Fenced code | should match literally, not via `stripMarkdown` | currently still goes through stripping |

### Snapping to valid hunks (TODO)

Best defense against `Line could not be resolved`: extract the file's hunk ranges from the diff data and either snap any line outside a hunk to the nearest in-hunk line, or hide the `+` button on out-of-hunk blocks. Currently we don't do this — relying on text matching being good enough.

**Failed approach to avoid repeating:** an early 1.0.1 attempt assumed `diffSummary.markersMap` keys (`R<n>`) were the authoritative set of commentable lines. They are **not** — `markersMap` only contains lines that have *existing markers* (review threads, annotations). A 500-line file with 3 review threads has 3 keys. So a snap window over `markersMap` keys ends up snapping to existing comments instead of to in-hunk lines, which is worse than not snapping at all. The code was removed; tracked as P1 in [FEATURES.md → Correctness](./FEATURES.md#correctness).

**Where the actual hunk lines live:** parse `comparison.fullDiff` (or re-fetch the unified diff) and walk each `@@ -a,b +c,d @@` hunk header to get `[c, c+d-1]` per right-side hunk. That ± a few lines of context is the real commentable set.

## Bogus file containers

Mermaid `<pre>graph TD ...</pre>` blocks inside a rendered diff sometimes get matched by the file-container selector if their content includes a `clipboard-copy[value]`. `looksLikePath()` rejects multi-line / whitespace-leading values; Strategy 2 in `getFilePath()` also requires the value to match a known PR file path.

If you see "Container path: graph TD\n..." in logs, the filter regressed.

## Heading-scoped collapse: walking cross-parent siblings

The collapse feature folds everything between a heading and the next heading of equal or higher level. Naïvely that's `heading.nextElementSibling` walking until a stopper, but **GitHub's prose-diff wraps each diff hunk in its own container** — a heading and the paragraphs that "belong to" it may live in different parent elements.

`siblingsToHide(heading)` in `content.js` therefore has two strategies:

1. **Direct siblings** under the same parent — works for short sections where the diff hunk encompasses the whole section.
2. **Cross-parent walk** — if strategy 1 finds nothing, walk up from `heading.parentElement` and continue collecting the parent's next-sibling chain, stopping at the rich-diff container boundary or a stopper heading (own level or a descendant heading at our level or higher).

This is why a single H2 click can fold "61 element(s)" — those 61 elements span many diff hunk containers, all collected via strategy 2. The state is held in a `WeakSet<HTMLHeadingElement>` so re-init after SPA navigation preserves what was collapsed.

## Inserted-block underline propagation (fixed in 1.0.2)

> Earlier versions of this section warned readers off as a "misperception trap". That warning was **wrong** — the underline really does bleed in, but through a CSS painting mechanism that `getComputedStyle` does not surface. Keeping the corrected explanation here so the next person doesn't repeat the misdiagnosis in either direction.

When reviewing a PR where a `.md` file is mostly *new* content, GitHub's prose-diff wraps inserted blocks in `<ins>` (and applies `text-decoration: underline` to inserted paragraphs, table cells, blockquotes, headings). If our comment UI is anchored to one of those blocks via `element.after(box)`, the new node ends up **inside the `<ins>`** because `.after()` only escapes the immediate sibling, not the underlined ancestor. CSS then paints the ancestor's underline across every inline descendant — including our header text, textarea placeholder, button labels, and rendered comment bodies.

**Why `getComputedStyle` was misleading.** The text-decoration `<ins>` paints is **not** reflected in any descendant's computed style:

```js
const t = document.querySelector('.grdc-comment-box .grdc-line-input');
console.log(getComputedStyle(t).textDecoration);   // 'none'   ← still 'none' even when visibly underlined
```

That's because `text-decoration` is **not inherited**; instead the *painting* propagates from the ancestor that declares the decoration across all in-flow inline descendants. Setting `text-decoration: none` on the descendant does nothing — the descendant isn't drawing the underline, the ancestor is. Only way out: make sure our injected UI is not a descendant of the underlined ancestor.

**The fix.** `siblingAnchor()` (content.js) now calls `topUnderlinedAncestor(element)` to walk up from the anchor, find the topmost ancestor with `tagName === 'INS' || 'U'`, bounded by `.markdown-body` / `.rich-diff-level-one` / `<body>`. If one is found, `.after()` is called on that ancestor instead of the original element, so the injected node lands outside the underline-painting scope. Visual position barely shifts because `<ins>` typically wraps a single block (one `<p>`, one `<li>`, one `<td>`'s text).

**Performance note.** An earlier iteration of `topUnderlinedAncestor` also called `getComputedStyle(cur).textDecorationLine` as a fallback when the tag check failed, to catch any non-`<ins>`/`<u>` element with `text-decoration: underline` applied via CSS. That triggered a style/layout recalc per ancestor — with ~50 threads on a page each calling `siblingAnchor()`, the recalcs added up to a visibly slower render. Dropped the `getComputedStyle` path because every case we've seen in production is `<ins>` (sometimes `<u>`). If a future GitHub markup uses underline via class (e.g. `<span class="diff-added">`), add the class name to the cheap check rather than re-introducing `getComputedStyle`.

**Failed approaches to avoid repeating:**

1. **`!important` text-decoration resets on every descendant** — does nothing. The descendant isn't drawing the underline.
2. **`isolation: isolate` / `contain: paint` on the box root** — affects stacking and clipping, not text decoration painting. Doesn't help.
3. **`display: inline-block` on the box root** — *would* break text-decoration propagation per spec (atomic inline boxes don't get ancestor decorations painted across them) but also breaks our block-level layout for the textarea.

The escape-the-ancestor approach in `siblingAnchor` is the smallest, most predictable fix.

## Mutation observer

GitHub's PR view is a SPA. Files load lazily as you scroll. The observer:

- Watches `document.body` for added subtrees containing `.markdown-body` or `.prose-diff .markdown-body`
- **Ignores our own injected nodes** (`.grdc-existing-thread`, `.grdc-comment-btn`, `.grdc-comment-box`, `.grdc-reply-box`) to avoid feedback loops
- Debounces re-init via `scheduleReinit()` (500ms)

If you add a new injected class, add it to the ignore list.

### MV3 gotcha: content scripts are NOT re-injected on SPA navigation

Chrome's Manifest V3 only injects a content script when the page **loads** with a matching URL. When GitHub does an SPA transition via `history.pushState` (e.g. clicking the **Files changed** tab from `/pull/<n>`), the URL changes but no `webNavigation.onCommitted` fires and the script is never injected. Symptoms reported by users:

- Land on `/pull/<n>` → click *Files changed* → URL becomes `/pull/<n>/files` → extension inactive.
- Hard refresh, or open `/pull/<n>/changes` directly → works.

Fixes (both needed):

1. **Broaden `manifest.json` `content_scripts.matches`** to `*/pull/*` so the script is injected on the PR overview too. (Currently it's `*/pull/*/files*` and `*/pull/*/changes*`.)
2. **Listen for SPA URL changes inside `content.js`** — Chrome dispatches `popstate` on back/forward but **nothing** on `pushState`/`replaceState`. Monkey-patch them to dispatch a custom event:

   ```js
   for (const m of ['pushState', 'replaceState']) {
     const orig = history[m];
     history[m] = function (...args) {
       const r = orig.apply(this, args);
       window.dispatchEvent(new Event('grdc:urlchange'));
       return r;
     };
   }
   window.addEventListener('popstate', () => window.dispatchEvent(new Event('grdc:urlchange')));
   ```

   Then in the `grdc:urlchange` handler, re-evaluate the URL: if it's now a Files/changes path and `init()` hasn't run yet, run it; on navigation away, tear down (clear injected nodes, disconnect observers) to avoid stale state.

3. **Re-init on rich-diff toggle**: even on a Files URL, the rich-diff DOM doesn't appear until the user clicks the document/page icon — at which point the existing `MutationObserver` does fire on `.rich-diff-level-one` appearance. That part already works.

Tracked as P0 in [FEATURES.md → Correctness](./FEATURES.md#correctness).

## CSS theming: always use Primer variables with a fallback chain

The extension's injected UI must work in both GitHub's light and dark themes (and on GitHub Enterprise installs that may still ship the legacy Primer CSS). Every color value in `styles.css` should use a **three-level fallback chain**:

```css
background: var(--bgColor-default, var(--color-canvas-default, #ffffff));
              ^^^^^^^^^^^^^^^^^   ^^^^^^^^^^^^^^^^^^^^^^^   ^^^^^^^
              new Primer (2024+)  legacy Primer (<2024)     literal hex
```

Why all three:

1. **New Primer names** (`--bgColor-default`, `--fgColor-muted`, `--button-primary-bgColor-rest`, etc.) are what GitHub.com currently defines on PR pages. These resolve to the right value in whichever theme the user has selected via Settings → Appearance.
2. **Legacy Primer names** (`--color-canvas-default`, `--color-fg-muted`, `--color-btn-primary-bg`, etc.) are still defined on older GitHub Enterprise Server installs and some other GitHub-hosted pages. Keeping them in the chain protects users on those deployments.
3. **Literal hex fallback** is the last line of defense — used only when neither variable is defined (e.g. a future GitHub redesign that removes both). Always pick the **light-theme** hex as the literal; never use a dark-mode hex as the fallback or light-mode users will see broken colors if the variables ever disappear.

### Common mappings

| What you want | New name | Legacy name | Literal (light) |
|---|---|---|---|
| Default text | `--fgColor-default` | `--color-fg-default` | `#1f2328` |
| Muted text | `--fgColor-muted` | `--color-fg-muted` | `#59636e` |
| Default background | `--bgColor-default` | `--color-canvas-default` | `#ffffff` |
| Subtle / secondary background | `--bgColor-muted` | `--color-canvas-subtle` | `#f6f8fa` |
| Overlay / popover background | `--overlay-bgColor` | `--color-canvas-overlay` | `#ffffff` |
| Default border | `--borderColor-default` | `--color-border-default` | `#d0d7de` |
| Muted border | `--borderColor-muted` | `--color-border-muted` | `#d8dee4` |
| Accent (link) text | `--fgColor-accent` | `--color-accent-fg` | `#0969da` |
| Solid accent fill (e.g. `+` button) | `--bgColor-accent-emphasis` | `--color-accent-emphasis` | `#0969da` |
| Subtle accent fill (e.g. badge) | `--bgColor-accent-muted` | `--color-accent-subtle` | `#ddf4ff` |
| Success text | `--fgColor-success` | `--color-success-fg` | `#2da44e` |
| Danger text | `--fgColor-danger` | `--color-danger-fg` | `#cf222e` |
| Attention (yellow) bg | `--bgColor-attention-muted` | `--color-attention-subtle` | `#fff8c5` |
| Attention border | `--borderColor-attention-muted` | `--color-attention-muted` | `#d4a72c` |
| Primary button (rest / hover / disabled) | `--button-primary-bgColor-rest` / `-hover` / `-disabled` | `--color-btn-primary-bg` / `-hover-bg` | `#1f883d` / `#1a7f37` |
| Default button (rest / hover) | `--button-default-bgColor-rest` / `-hover` | `--color-btn-bg` / `-hover-bg` | `#f6f8fa` / `#f3f4f6` |

### How to verify

In DevTools on a GitHub PR page (both light and dark themes), inject a probe element with our class and inspect computed styles:

```js
const probe = document.createElement('div');
probe.className = 'grdc-comment-box';
document.body.appendChild(probe);
console.log(getComputedStyle(probe).backgroundColor); // dark-mode: rgb(13, 17, 23) — light: rgb(255, 255, 255)
probe.remove();
```

If a freshly-added rule shows the literal hex in BOTH themes, the variable name is wrong or missing. Cross-check the full list of GitHub-defined variables with the diagnostic snippet in [the history of the dark-mode migration](#).

### How to discover GitHub's current variable names

GitHub's Primer team renames variables periodically. To enumerate every CSS custom property defined on a PR page (sorted, deduplicated, filtered to color-relevant ones), run this in the DevTools console:

```js
const vars = new Set();
for (const s of document.styleSheets) {
  try {
    for (const r of s.cssRules) {
      if (r.style) for (let i = 0; i < r.style.length; i++) {
        const p = r.style[i];
        if (p.startsWith('--') && /color|bg|fg|border/i.test(p)) vars.add(p);
      }
    }
  } catch {} // skip CORS-blocked stylesheets
}
console.log([...vars].sort().join('\n'));
```

The output is the universe of color tokens you have to choose from. When in doubt, pick the one whose name most directly describes what you want.

### When Primer tokens aren't defined at all (need `prefers-color-scheme` fallback)

The three-level chain assumes one of the two Primer variable names will be defined. **Empirically this is not always true** — on certain PR variants, blob-view-embedded diffs, and some Enterprise themes the `--bgColor-*` tokens simply aren't defined, so our literal hex fallback (`#ffffff`, `#eaf2fb`, etc.) fires *even in dark mode*. The Threads sidebar showed up as a glaring light bar on dark pages in this scenario.

Fix: layered defense via `@media (prefers-color-scheme: dark)` overrides at the bottom of `styles.css` for any opaque surface that the user will see in dark mode. Use `rgba()` for the dark values (not literal hex on the right-hand side of `background:`) so the `cssTheming.test.js` "standalone hex" lint rule still passes — the test only rejects bare hex assignments, not rgba.

Current scope: sidebar shell + header + list + cards + tabs + outline toolbar + inline thread badge. If a new opaque surface is added that uses `--bgColor-default` / `--bgColor-accent-subtle` / similar with a light-mode hex fallback, add a matching entry in the media block.

## Comment header data: avatar + role badge

Each comment in our thread renders an avatar + author-association role badge. Both come from the same `/pull/<n>/changes` route-data payload that already drives login / body / timestamp. Field names vary between GraphQL (camelCase) and REST (snake_case), so parse both:

```js
avatarUrl: c.author?.avatarUrl || c.author?.avatar_url || c.user?.avatar_url || c.user?.avatarUrl || '',
authorAssociation: c.authorAssociation || c.author_association || '',
```

**Avatar fallback:** if the payload doesn't include an avatar URL, derive one from the login via `https://avatars.githubusercontent.com/<login>?s=40`. This URL works for any public GitHub user without API auth — GitHub serves a redirect to the user's current avatar.

**Author association enum** (from GitHub's REST docs): `OWNER`, `MEMBER`, `COLLABORATOR`, `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, `FIRST_TIMER`, `MANNEQUIN`, `NONE`. We render a pill for the first six (matching what GitHub's native source-diff shows). `MANNEQUIN` (migrated-account placeholder) and `NONE` (no relationship) are suppressed because GitHub doesn't show a badge for those either. All pills share the same neutral chip styling — GitHub does NOT color-code per role.

**The `Author` pill is separate.** GitHub also renders an `Author` badge for the user who *opened the PR*. This isn't a field on the comment — it's a comparison between the comment author's login and the PR author's login. To support it we added `getPRAuthorLogin()` (alongside `getViewerLogin()`) which reads the PR author from the `.gh-header-meta a.author` link in the PR header DOM, with a fallback regex over embedded route-data JSON (`"pullRequest":{...,"author":{"login":"X"}`). Cached for the page's lifetime. If both probes fail, the Author pill simply doesn't render — no error.

When the comment author is both the repo owner AND the PR opener, both pills render side by side (`Owner` `Author`), matching GitHub native.

## Section collapse: peek inside sibling containers for boundary headings

`siblingsToHide(heading)` / `sectionRoots(heading)` walk forward from a heading, gathering elements until they hit a heading at the same or shallower level. The naive Strategy 1 (`heading.nextElementSibling` loop, check `cur.tagName`) is correct in flat HTML but **fails on GitHub's prose-diff** because the renderer occasionally groups later hunks inside their own wrapper `<div>`. Example:

```html
<h3>Phase 3</h3>
<p>Phase 3 content...</p>
<div class="prose-diff-hunk">
  <h3>Phase 4</h3>        <!-- boundary, but walker sees the <div>, not the <h3> -->
  <p>Phase 4 content...</p>
</div>
```

Strategy 1 sees the `<div>` as a non-heading and walks into Phase 4's content. Fix: also peek for any descendant heading at level <= ours inside each walker via `cur.querySelector('h1, h2, h3, h4, h5, h6')`, and stop when the first descendant is a boundary. This was missing from Strategy 1; Strategy 2 already had it. Both helpers now share the same boundary detection.

The fix is safe (won't over-fold) because:
- We only stop when the descendant level is `<=` ours. An `<h4>` inside a wrapper while we're folding an `<h3>` is interior content (level 4 > 3) and stays included.
- `querySelector` returns document-order first match, so it finds the topmost (most likely boundary-relevant) heading, not a deeply nested one.

## Keeping the threads sidebar in sync

The sidebar reads its data straight off the rendered thread DOM (`.grdc-existing-thread[data-grdc-*]`), not from `existingComments` or `routeData`. That means every mutation that affects what the sidebar shows must trigger a sidebar rebuild — but the *right* rebuild path differs by mutation type:

| Mutation | Refresh path | Why |
|---|---|---|
| Post new comment | `buildThreadsSidebar()` | New `.grdc-existing-thread` is already injected by the post handler; sidebar just needs to enumerate elements again. |
| Reply to thread | `buildThreadsSidebar()` | Same — existing thread's comment-count and snippet aren't sidebar inputs (sidebar shows the *head* snippet only). |
| **Edit comment** | `scheduleReinit()` | The sidebar snippet lives in `thread.dataset.grdcSnippet`, set during `renderThreadOnElement` from `head.body`. An edit changes the head body but doesn't update the dataset — `scheduleReinit` re-runs the full pipeline (route-data fetch → `renderExistingComments` → fresh dataset → `buildThreadsSidebar`). |
| **Delete comment** | `scheduleReinit()` | If the deleted comment was the thread head, the new head's body becomes the sidebar snippet — same dataset issue as edit. |
| Resolve / unresolve | `buildThreadsSidebar()` | The "resolved" tag in the card comes from `threadEl.classList.contains('grdc-thread-resolved')`, which the toggle already updates locally. No dataset refresh needed. |

**Rule of thumb:** if the mutation could change the *thread head's snippet text* or the *head comment's identity*, use `scheduleReinit()`. Otherwise `buildThreadsSidebar()` is enough and avoids the full route-data refetch.

The sidebar also auto-hides when the user toggles away from rich-diff:

```js
// In buildThreadsSidebar, before doing any work:
const richDiffVisible = Array.from(document.querySelectorAll('.prose-diff'))
  .some(el => el.offsetParent !== null);
if (!richDiffVisible) { sidebar?.remove(); return; }
```

`offsetParent === null` is the standard "is this hidden via display:none or a detached ancestor" probe — catches GitHub's source-diff toggle (which `display: none`s `.prose-diff` rather than removing it). A click listener on rich/source-diff toggles also re-runs `buildThreadsSidebar` after a 100ms delay so the sidebar appears immediately when toggling back to rich-diff.

## Debugging recipes

All extension logs are prefixed `[GRDC]`. Useful queries in DevTools:

```
[GRDC]                                 # everything
[GRDC] route-data                      # comment fetch result
[GRDC] Mapped                          # per-file mapping summary
[GRDC] NO MATCH                        # text matching failures (first 8 per file)
[GRDC] Resolved OIDs                   # what base/head we'll post with
[GRDC] Post failed                     # 422/etc response bodies
```

Common failure modes:

| Symptom | Likely cause |
|---|---|
| `text-hits: 0` | raw source fetch failed → mapping is line-estimation only |
| `Line could not be resolved` | line outside any diff hunk, or wrong baseOid |
| `Rendered 0 comment threads` | `markersMap` shape changed — re-dump via `markersMap first entry JSON` |
| Comments cluster at file top | match between thread and mapped block didn't find an exact line — `renderExistingComments` snaps to nearest |
| Bogus container with multi-line "path" | `looksLikePath` regression |
| `Blob HTML contained no recognizable raw source` | new JSON shape — extend `findBlobInJson` |

### Extension not reloading

If your console shows old log messages or old line numbers in stack traces:

1. `chrome://extensions/` → click reload icon on this extension's card
2. Hard-refresh the PR page: **Ctrl+Shift+R**

Just refreshing the tab is **not** enough — Chrome caches the loaded content script.

### Adding new diagnostic dumps

Pattern used throughout: log `Object.keys(x)` first, then `JSON.stringify(x[firstKey], null, 2)` of one entry. Avoid logging the whole structure — it's huge and DevTools truncates.

## How to add a new GitHub action (endpoint discovery recipe)

When you want the extension to do something it doesn't already do (e.g. edit a comment, react with 👍, mark a file as viewed), follow this procedure. It's the same one we used for `create_review_comment`, `resolve_thread`, `/preview`, and `/suggestions/...`.

**0. Sanity check.** First make sure GitHub's UI doesn't already provide the action on the same page. If it does, don't reinvent it — link to it instead. See [FEATURES.md → Won't do](./FEATURES.md#-wont-do-deliberate-trade-offs).

**1. Find the request GitHub itself makes.**

1. Open a PR in source-diff view (or whatever view exposes the native control).
2. DevTools → **Network** tab → filter by `page_data` (or whichever URL pattern shows up; try `suggestions`, `_render`, `preview`, etc.).
3. Click the native button (post, reply, resolve, react, …).
4. Inspect the request:
   - **URL** — the path right after `github.com/<owner>/<repo>/...`.
   - **Method** — almost always POST for state changes; GET for read-only.
   - **Payload** (Request → Payload tab → "view source") — the exact JSON / form body.
   - **Headers** that look non-default: `Content-Type`, `X-Requested-With`, `GitHub-Verified-Fetch`, `Scoped-CSRF-Token`, etc.

**2. Reproduce in the extension.**

Add a call site that builds the same request. For `page_data/*` endpoints, use the existing `pageDataPost(candidates, label)` helper — it logs every attempt so you can see status + response body in the console. Pattern:

```js
async function doFoo(arg) {
  return pageDataPost([
    { path: 'do_foo', body: { arg, ... } },
  ], `doFoo(${arg})`);
}
```

For non-`page_data` endpoints (preview renderer, suggestions, etc.), wire a direct `fetch()` — same `credentials: 'include'` + CSRF token pattern.

**3. Verify and trim.**

- Trigger the action via the extension. Watch the console for `[GRDC] doFoo(...) → POST do_foo status=...`.
- 200/201 → it works. **Trim the candidate list to just that one entry** (so we don't slow future calls with failed candidates) and add a `**VERIFIED:**` row in the table above with the exact payload shape and any gotchas.
- 4xx → read the response body for hints. GitHub's errors are usually shaped like `{"error": "Start commit oid parameter is invalid: ..."}` — the field name in the error tells you what's missing. Add it to the payload and retry.

**Common gotchas observed so far** (collected to save the next person a discovery round):

- **camelCase vs snake_case.** Internal endpoints almost always want camelCase (`inReplyTo`, `threadId`, `startLine`). Snake_case often returns `Path parameter is invalid: .` or `404 Not Found`.
- **Lowercase enum values.** `subjectType: "multiline"` not `"multiLine"`. Wrong case is silently accepted with 200 but the action is stored differently than expected.
- **Mirror everything for ranges.** Multi-line operations need both `startX` and `endX` versions of every field (`startLine` + `endLine`, `startPath` + `endPath`, `startCommitOid` + `endCommitOid`).
- **CSRF token required for `/preview`.** Read it from `<meta name="csrf-token">` and send as `Scoped-CSRF-Token` header.
- **No `api.github.com` from a content script.** It sends `Access-Control-Allow-Origin: *` which forbids credentialed requests. Use a same-origin `github.com/...` HTML scrape instead when you need data that's only available there.

**4. Document.**

- Add the verified URL + payload shape to the table in this file.
- Add a row to the changelog explaining what was discovered.
- If the action needs UI affordances (a button, drag gesture, etc.), update [FEATURES.md](./FEATURES.md) → Shipped section.

---

## Reply / Resolve endpoints (both verified)

These features are wired up via `pageDataPost(candidates, label)` which tries multiple candidate URLs/payload shapes per action and logs every attempt's status. Intent is to discover the real endpoint by watching the console after a real click — then trim the candidate list down to the one that returned 2xx.

Verified endpoints (relative to `/<owner>/<repo>/pull/<n>/page_data/`):

| Action | Candidates |
|---|---|
| Reply  | **VERIFIED:** `create_review_comment` with `{inReplyTo, text, submitBatch, comparisonStartOid, comparisonEndOid}` (camelCase `inReplyTo` is required — `in_reply_to` returns `Path parameter is invalid: .`) |
| Resolve / Unresolve | **VERIFIED:** `resolve_thread` / `unresolve_thread` with `{threadId}` (camelCase). Note: `resolve_review_thread` returns 422 HTML, and `resolve_thread` with snake_case `thread_id` returns `404 {"error":"Not Found"}`. |

And one non-page_data endpoint:

| Action | Endpoint |
|---|---|
| Markdown preview | **VERIFIED:** `POST https://github.com/preview` (form-urlencoded). Body: `text`, `authenticity_token` (from `<meta name="csrf-token">`), optional `repository=<owner>/<repo>` for repo-scoped features (mentions, #issues). Returns rendered HTML. **Note:** the repo-scoped variant `/<owner>/<repo>/preview` returns 422 even with the same body — use the global path. |
| @-mention suggestions | **VERIFIED:** `GET https://github.com/suggestions/pull_request/<prInternalId>?mention_suggester=1&user_avatar=1&repository_id=<repoId>`. Returns JSON array of mentionable users for that PR (login, name, avatar_tag). `repoId` comes from `<meta name="octolytics-dimension-repository_id">`. `prInternalId` is the **internal numeric** PR id (10 digits), not the user-visible PR number — see next row for how to obtain it. |
| PR internal id discovery | The internal `pullRequestId` is **not** consistently in the page's embedded JSON / data-attrs on a `/files` page — GitHub only emits it lazily when the user clicks their own native form. The reliable fallback: **same-origin** `GET https://github.com/<owner>/<repo>/pull/<n>` (cookie auth, ~50 KB) and regex-scrape `/pull_request/(\d{8,})/`, `"pullRequestId":"..."`, or `data-pull-request-id="..."` from the response HTML. Cached for the session. **Note:** `api.github.com/repos/.../pulls/<n>` returns the same id but is **CORS-blocked** for credentialed requests from a `github.com` content script. |

To discover a new endpoint: open DevTools → Network → filter `page_data`, perform the action in GitHub's native UI, see which URL it actually hits. Add to `pageDataPost` candidate list, verify with a real click, then trim to the working candidate.

**Submit-review is intentionally not implemented** — GitHub's native "Review changes" button on the Files-changed tab already covers it. See [FEATURES.md → Won't do](./FEATURES.md#-wont-do-deliberate-trade-offs).

If cookie endpoints stop working, fallback is GraphQL (`api.github.com/graphql`) with a PAT — mutations are `addPullRequestReviewComment` (with `inReplyTo`), `resolveReviewThread`, `unresolveReviewThread`. Would reuse existing PAT plumbing (`grdc_use_pat`).

## Thread state (resolved / outdated)

`route.markers.threads[<id>]` carries `isResolved` and (sometimes) `isOutdated` directly — we surface these in the badge label and dim resolved threads via `.grdc-thread-resolved`. Resolved threads collapse by default; unresolved threads auto-expand.

## Resolved issues (changelog)

History of bugs fixed and *why* the fix worked. Read this before re-touching the line-mapping or DOM-injection code — most of these are non-obvious.

### Comment box / inline rendering

| Issue | Root cause | Fix |
|---|---|---|
| `422 "Line could not be resolved"` on impossible line numbers (1.0.1) | When the text-matcher couldn't resolve a block (only ~12% hit rate on the sample design doc), we fell back to `lastLine + 1` to nudge forward. Long runs of misses produced monotonically incrementing fallbacks — e.g. line 409 in a 363-line file. POST → 422 from GitHub. An initial attempt to fix this assumed `diffSummary.markersMap` keys were the authoritative set of commentable lines and tried to snap to them — wrong: `markersMap` only contains existing-marker lines (3 keys for a 500-line file), so the snap silently moved comments onto unrelated lines. | (a) Removed the snap-to-markersMap code entirely — it was worse than no fix. (b) `buildLineMap` now reads `sourceLines.length` once per file as `maxLine` and clamps every fallback assignment via `Math.min(…, maxLine)`. Impossible line numbers can no longer leak. The comment still posts on an *approximate* line, but always a real line in the file. Real fix — better text-match coverage and hunk-aware `+` visibility — tracked separately in [FEATURES.md → Correctness](./FEATURES.md#correctness). |
| Extension didn't activate when clicking *Files changed* from `/pull/<n>` (1.0.1) | Manifest match was `*/pull/*/files*` only — Chrome didn't inject the script on `/pull/<n>`. GitHub's tab switch is `history.pushState`, which doesn't trigger re-injection. An initial attempt monkey-patched `history.pushState` to dispatch a custom event — but that **only patched the content script's isolated world**, while GitHub's React app calls `history.pushState` from the **page's main world**. Content scripts share the DOM but not JS globals; the patch never saw React's pushState calls, so the event never fired. | (a) Broadened `manifest.json` match to `*/pull/*`. (b) `setInterval(maybeInit, 400)` URL poll — reading `window.location.pathname` works fine across worlds, the poll is cheap, and 400 ms is below perceptual click-to-react latency. (c) Also listen for `popstate` (DOM events *do* fire across worlds) for instant back/forward response. `maybeInit()` de-dupes via a `lastInitPath` guard so the poll is a no-op when the URL hasn't changed. |
| Hunk snapping using `markersMap` keys snapped to existing-marker lines, not to in-hunk lines (1.0.1, removed) | See the consolidated row above (`422 "Line could not be resolved"` on impossible line numbers). This row left as a tombstone so the failed approach doesn't get re-attempted. | Removed. Real fix tracked in [FEATURES.md → Correctness](./FEATURES.md#correctness). |
| `+` glyph sat visually above the circle's center (1.0.1) | `.grdc-comment-btn` had a `+` *text character* as content. Two problems with text glyphs: (1) the `+` in most fonts has its optical center slightly above its typographic center \u2014 even with flex centering, the line-box centers but the glyph inside the line-box looks high. (2) Each host (paragraph, heading, list item, table cell, `<pre>`) has a different default line-height which inherits into the button. Flex + line-height tweaks reduced the offset but couldn't eliminate it across all hosts. | Replaced the text `+` with an inline SVG `+` icon (`<svg viewBox=\"0 0 14 14\"><path d=\"M7 1v12M1 7h12\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/></svg>`). The strokes cross at viewBox (7,7), the SVG fills 14\u00d714, and flex-centers inside the 22\u00d722 button \u2014 pixel-perfect regardless of host font or line-height. Bonus: `stroke=\"currentColor\"` so it inherits the button's white color. |
| Comment on a parent `<li>` rendered AFTER the entire nested list (1.0.1) | `renderThreadOnElement` uses `siblingAnchor(element).after(thread)`. For an `<li>`, `siblingAnchor` returned the element itself, so `.after(thread)` placed the thread *after* the closing `</li>` — past every nested bullet inside it. Comments on "Architecture" landed below "Impact Analysis" instead of right under "Architecture". | Extended `siblingAnchor`: when the element is an `<li>` that contains a direct-child nested `<ul>`/`<ol>`, return a proxy whose `.after(node)` inserts as the *previous sibling* of the nested list (i.e. inside the `<li>`, after the parent's own text but before any children). The proxy also implements `nextElementSibling` so `renderThreadOnElement`'s chaining logic for multiple threads on the same anchor still works. |\n| Edit own comments (1.0.1) | The `⋯` menu / edit affordance for review comments lives in source-diff view only; rich-diff users had to leave the page to fix typos in their own comments. | Captured endpoint via DevTools: `PUT /pull/<n>/page_data/update_review_comment?body_version=<sha256>` with body `{"body":"new text","commentId":"<dbId-as-string>"}`. **Two payload-shape gotchas:** (1) the field is `body` (not `text` like create_review_comment). (2) `commentId` must be a string. **`body_version`** is GitHub's per-comment hash, used as a conflict token. The 200 response includes a fresh `bodyVersion` for the updated body — we cache it on the local comment record so a second edit in the same session uses the new hash. The initial `/changes` fetch *may* include `bodyVersion` per comment; if so we use it. Otherwise we fall back to `sha256Hex(originalBody)` which matches in practice. UI: `⋯` menu on each comment whose author matches the viewer login (read from the `dotcom_user` cookie). Click Edit → inline editor with original body → Save invokes the endpoint and replaces the rendered body with the server's returned HTML. |
| Delete own comments (1.0.1) | Same gap as Edit — no `⋯` menu on the rich-diff page. | Captured endpoint via DevTools: `DELETE /pull/<n>/page_data/review_comments/<commentDbId>` (no body, returns 204 No Content). Added `deleteReviewComment(commentDbId)`. UI: same `⋯` menu, Delete item with `confirm()` dialog. On success the rendered comment is removed; if it was the only comment in the thread, the whole thread is removed. |
| Code-block fence range hint was wrong (1.0.1) | The `(code block, lines N–M)` hint counted rendered lines via `<pre>.innerText.split('\n').length`. Problems: (a) for long fenced blocks GitHub wraps the `<pre>` in a scrollable container, so innerText only contains the **currently rendered** rows (often ~15 of 40+). (b) The matcher's `info.line` for a `<pre>` is often the **fence line** (` ```yaml `) rather than the first content line — so even a correct count would start one line too high. Combined: hint read `194–237` for a block whose fences live at 195 and 240. | Added `findFenceRangeAroundLine(source, targetLine)` to the content script. Walks `rawSourceCache` line-by-line tracking ` ``` ` / `~~~` opens and closes, returns the content range (1-indexed, opening+1 .. closing−1) of the fence that contains or is closest to `targetLine`. `openCommentBox` now uses this range for the hint when `rawSource` is cached (falls back to innerText counting only if the raw source isn't available, e.g. on a file we haven't fetched yet). Result: hint shows the true block range regardless of how much of the block is visible or which row the user clicked. |\n| Code-block comments always anchored to the first line of the fence (1.0.1) | The `+` button for a `<pre>` block was fixed at `top: 4px` and clicking it called `openCommentBox(element, info)` with `info.line` = the fence's start line. To comment on line 50 of a 20-line block, the user had to manually edit the line input in the comment box header. Per-line `+` buttons inside `<pre>` aren't an option — they'd break GitHub's syntax-highlighting span structure. | On `mousemove` inside a `<pre>.grdc-hoverable`, measure `getComputedStyle(code).lineHeight` once, compute the cursor's row index as `Math.floor((e.clientY − codeRect.top) / lineHeight)` (clamped to `[0, codeLineCount−1]`), slide the `+` button vertically to that row's top via `btn.style.top`, and stash the resolved line on `btn.dataset.grdcLine`. The click handler reads `btn.dataset.grdcLine` and overrides `info.line` before opening the comment box. Net effect: hover the line you want, click `+`, the box opens on that exact line — no manual edit needed. |
| Nested `<li>` elements got no `+` button of their own (1.0.1) | Three combined problems: (1) `buildLineMap`'s block iteration had an early-return `if (block.tagName === "LI" && block.parentElement?.closest("li")) return;` — originally a defense against double-mapping the parent and its nested children. Effect: an outer ordered list item with a nested `<ul>` collapsed into one commentable block anchored to the outer `<li>`'s source line. Hovering over any nested bullet only surfaced the outer item's `+`. (2) After enabling per-bullet mapping, the default `+` positioning (`top: 50%; transform: translateY(-50%)`) anchored each `+` to the *vertical center* of its `<li>`. For an outer `<li>` whose box spans an entire nested list, that center lands somewhere in the middle of the nested content — visually overlapping the nested `<li>`'s own `+` button. (3) The hover-show rule was a *descendant* selector: `.grdc-hoverable:hover .grdc-comment-btn`. When you hovered a parent `<li>`, every `.grdc-comment-btn` *inside* it matched — including all the nested children's buttons. So hovering the parent showed every `+` in the subtree. | Three fixes: (a) Removed the early-return. Nested `<li>`s now map like any other block; the parent's `rawText` already strips the nested list's text content (`rawText.replace(nested.textContent, '')`) so parent and child don't compete for the same source line. (b) Added `li.grdc-hoverable .grdc-comment-btn { top: 4px; transform: none; }` to anchor the `+` to the first line of the `<li>` (matching the `<pre>` rule). (c) Changed `.grdc-hoverable:hover .grdc-comment-btn` (descendant) to `.grdc-hoverable:hover > .grdc-comment-btn` (direct child) so only the button belonging to the hovered element shows. Belt-and-braces: also added `.grdc-hoverable:has(.grdc-hoverable:hover) > .grdc-comment-btn { opacity: 0 }` to hide ancestor `+`s when a descendant is hovered (handles the case where hovering between rows still triggers ancestor `:hover`). Result: hovering any list item — flat or nested — shows exactly one `+` on that row. |
| Multiple threads on the same anchor element stacked in wrong order (1.0.1) | `renderExistingComments` iterated the `Map<threadId, comments[]>` in insertion order and each thread was inserted via `siblingAnchor(element).after(thread)`. Because `.after()` puts the new node *immediately* after the anchor, each insert pushed earlier inserts further down — net effect: last rendered thread ends up first under the anchor, i.e. reverse chronological order. The bug was most visible on tables and code blocks where every thread inside the container ends up stacked *after* the closing `</table>` / `</pre>` (we can't insert mid-table). It also affected the post-success render path when a new comment landed on a line that already had a thread, and the case where an existing thread + new comment anchored to different DOM elements on the same source line. | Three changes: (1) `renderExistingComments` now sorts threads with **primary line-asc, secondary createdAt-asc** — so threads under a table stack from row 1 → row N regardless of post timestamp, and threads on the same line keep chronological order. (2) `renderThreadOnElement` tags each thread with `data-grdc-anchor="<path>:<line>:<startLine>"` and does a **document-wide** `querySelectorAll` for previously-inserted threads with the same key, inserting after the last match. (3) When no matching peer exists for the new thread's anchor key (e.g. first thread on line 94 when threads for line 90 already render after the same `<pre>`), walk forward from the DOM anchor past **all** existing `.grdc-existing-thread` siblings before inserting. Without this, an `else` branch fell back to `siblingAnchor(element).after()`, which dropped the new thread immediately after the container and pushed every existing thread one slot further down — re-introducing the inverted order. |
| Existing comments rendered briefly then vanished after posting a new one (1.0.1) | After `postReviewComment` succeeds, GitHub's own React layer optimistically inserts a `.markdown-body` node into the page — our `MutationObserver` trips and calls `init()` again. On re-init, `buildLineMap` reads `block.textContent` from headings, paragraphs, and list items to text-match them against source. But by that point our `▾` collapse toggles and `+` comment buttons are already prepended to each block from the *previous* init. So `textContent` returns `"▾+overview"` instead of `"overview"`, the text-matcher logs `[GRDC] NO MATCH needle(10): "▾+overview"`, no block gets registered on that line, and existing threads anchored at that line have nowhere to render → they disappear. | Added `clearInjectedDom()`, called at the very top of `init()`. Removes every `grdc-*` injected node and class from the DOM before `buildLineMap` reads any text. The matcher now sees clean rendered prose on every re-init. |
| New comment didn't appear inline (had to refresh) | `postReviewCommentInternal` returned `{ok:true}` and discarded the JSON response body, so the success path had nothing to render | Parse `await res.json()` and return `{ok:true, data}`. Added `threadResponseToComments(data, path, line)` to map the response into the same shape as `fetchExistingComments`, then call `renderThreadOnElement` immediately on success. |
| Reply didn't appear inline | Same shape problem inside the reply submit handler | Reply handler now reads `result.data?.thread?.commentsData?.comments`, slices off the already-rendered prefix, and appends the new ones via `renderComment(c)`. Falls back to an optimistic local render if the response shape is unexpected. |
| Reply endpoint discovery was noisy (3 failed POSTs before 200) | Initial implementation tried 5 candidate URLs/payload shapes for `pageDataPost` | After verification, trimmed reply candidates to the only working one: `POST page_data/create_review_comment` with `{inReplyTo, text, submitBatch, comparisonStartOid, comparisonEndOid}`. Note the camelCase: `in_reply_to` (snake) returns `{"error":"Path parameter is invalid: ."}`. |
| Resolve endpoint discovery was noisy (3 failed POSTs before 200) | Same multi-candidate approach for `setThreadResolved` | Trimmed to verified: `POST page_data/{resolve,unresolve}_thread` with `{threadId}` (camelCase). `resolve_review_thread` returns 422 HTML; `resolve_thread` with snake `thread_id` returns `404 {"error":"Not Found"}`. |
| Preview tab couldn't render tables / task lists / mentions / emoji | Initial implementation used a 100-line inline renderer (toolbar output only). Tables and other GFM features failed. | Now POSTs raw markdown to `https://github.com/preview` (GitHub's own renderer) with cookies + CSRF token. Returns the exact HTML used by GitHub's native Preview tab. Falls back to the inline renderer if the request fails. **Discovery gotcha:** the repo-scoped `/<owner>/<repo>/preview` returns 422 — the global `/preview` works for any repo your session can see. |
| No `@mention` autocomplete in our comment box | We rolled our own editor and skipped autocomplete initially | Added `attachMentionsTo(textarea, container)`. Fetches the full mentionable-user list once per session via `GET /suggestions/pull_request/<prInternalId>?mention_suggester=1&user_avatar=1&repository_id=<repoId>` and filters client-side as the user types `@`. Cache pre-warmed during `init()` so first `@` keystroke is instant. |
| Mentions: PR internal id wasn't in embedded JSON | Initial discovery scanned `<script type="application/json">` for `pullRequestId` — turns out `/files` pages don't emit it (only `/pull/<n>` does, and only after the user opens GitHub's native form). | Added a 5-step discovery chain: embedded JSON → data-attrs → `/pull_request/<id>/` URL scan over `documentElement.innerHTML` → `routeData.markers.threads` walk → **fallback: same-origin fetch of `github.com/<owner>/<repo>/pull/<n>` HTML and regex out the id**. (Cannot use `api.github.com` — it sets `Access-Control-Allow-Origin: *` which forbids credentialed requests.) |
| Mentions dropdown clipped to one row | The reply box has `overflow: hidden` for its border-radius; the dropdown was a positioned-absolute child and got clipped to a single line | Append the dropdown to `<body>` and position it with `position: fixed` + `getBoundingClientRect()`. Re-positions on scroll / resize / textarea grow. |
| New reply briefly appeared then vanished | GitHub's own React UI optimistically inserts a `<.markdown-body>` node after a successful reply; our `MutationObserver` tripped, fired `scheduleReinit()`, and the re-init re-rendered threads from the **cached** `routeData` which didn't have the new reply yet — wiping our freshly-rendered inline reply. | Added `invalidateRouteData()` helper, called from every successful state-changing action (post, reply, resolve, unresolve). Re-init now re-fetches `/changes` JSON and renders accurate state. |
| Source-diff view shows stale thread list after posting from rich-diff (1.0.2) | When the user toggles from rich-diff back to source-diff on the same page after we post a comment, the new comment doesn't appear in source-diff until the page is refreshed. Same applies to reply/resolve/unresolve/edit/delete. Root cause: GitHub's source-diff React view holds an in-memory thread list populated at initial page load; our same-origin POST to `page_data/create_review_comment` (and friends) succeeds and persists server-side, but doesn't notify GitHub's React store. Our `invalidateRouteData()` helper refreshes *our own* cached `/changes` JSON so rich-diff re-renders correctly — but GitHub's source-diff has its own store we can't touch. | Added a module-level `sourceDiffDirty` flag, set by `invalidateRouteData()` (which is already called from every mutation success handler — post/reply/resolve/unresolve/edit/delete). Installed a `capture`-phase document `click` delegate (`looksLikeDiffToggle`) that matches buttons whose `aria-label` / `title` / `data-disable-with` / `data-tab-item` / textContent contains *source diff* / *rich diff* / *rendered diff* / *display the source* / *display the rich*. When the dirty flag is set and the user clicks such a toggle, we `setTimeout(reload, 50)` so GitHub's own navigation completes first, then a hard reload picks up fresh thread state for source-diff. Users staying in rich-diff are unaffected (no toggle click → no reload). The 50 ms delay was chosen because GitHub's diff-mode change is synchronous DOM swap — reload races would otherwise interrupt URL updates. |
| Multi-line range comments posted as **single-line** despite `startLine` in payload (200 OK, but rendered at the end line only) | `subjectType` and `positioning.type` were `"multiLine"` (camelCase). GitHub's page_data endpoint accepts the camelCase form silently but stores it single-line. | Use lowercase `"multiline"`. Also need `positioning.{startPath, endPath, startCommitOid, endCommitOid, endLine}` — see the verified payload section above. Range was discovered iteratively by reading the 422 messages (`Start commit oid parameter is invalid`, then `End commit oid...`, etc.). |
| Multi-line range threads displayed as single-line in our badge | Range bounds live in `markersMap.<endKey>.threads[].start` (a string like `"R57"`), NOT on the thread object itself (`route.markers.threads[<id>]` reports `subjectType: "LINE"` for both single and multi-line — they're indistinguishable from the thread alone) | `fetchExistingComments` now reads `start` from each `threads[]` entry inside `markersMap` and propagates it as `startLine` on the comment record. UI shows `lines N–M` in the badge and tints every block in the range. |
| Underlines bleeding into every text run inside our comment box, existing-thread body, and reply box (1.0.2) | GitHub's prose-diff wraps inserted blocks in `<ins>` (e.g. `<ins><p>…</p></ins>`). Our box was injected with `element.after(box)`, which puts the node after the `<p>` but **still inside** the `<ins>`. CSS `text-decoration` painted by an ancestor propagates across all in-flow inline descendants regardless of the descendant's own `text-decoration` value, and `getComputedStyle(descendant).textDecoration` is `'none'` even when the descendant is visibly underlined — because the descendant isn't drawing the underline, the ancestor is. (An earlier round of debugging concluded "not a bug" from that `getComputedStyle` check; that conclusion was wrong. See the corrected explanation in "Inserted-block underline propagation" above.) | Added `topUnderlinedAncestor(node)` helper that walks up from `node` and finds the topmost ancestor with `tagName === 'INS' || 'U'`, bounded by `.markdown-body` / `.rich-diff-level-one`. `siblingAnchor()` now returns that ancestor when present, so `.after()` lands the box *outside* the underline-painting scope. Tag-only walk (a brief detour through a `getComputedStyle` fallback was dropped — see Performance note in the section above). No CSS / Shadow-DOM changes. |
| Multi-line-on-same-block threads stacked out of order on code blocks (lines 90 / 94 / 91 rendered as 90, 94, 91 instead of 90, 91, 94) (1.0.2) | The 1.0.1 fix tagged each thread with `data-grdc-anchor="<path>:<line>:<startLine>"` and added a walker that, on a fresh post, skipped past existing `.grdc-existing-thread` siblings before inserting. Two problems that only surfaced once multiple per-line threads on the same `<pre>` existed: (1) the user's just-submitted `.grdc-comment-box` lingers for ~1.2 s after success showing the "✓ Comment posted" message, and it sits between `siblingAnchor` and the first existing thread. The walker bailed on the box (it wasn't an existing-thread sibling), so the new thread got inserted right after the anchor and pushed every other thread down — visually "newest-first". (2) Even with the box-skip in place, the walker only ever *appended* at the end of the stack, so posting on line 91 with existing threads on lines 90 / 94 produced 90, 94, 91 instead of 90, 91, 94. | Walker now skips past `.grdc-existing-thread`, `.grdc-comment-box`, AND `.grdc-reply-box` siblings, AND parses each existing thread's `:line:` out of its `data-grdc-anchor` (via the new pure `parseLineFromAnchor` helper in `src/lib/responses.js`). When the walker hits a thread whose line is **strictly greater** than the new thread's, it inserts BEFORE that thread (`.before(thread)`); otherwise it falls back to appending at the end. The anchor-key encoding/decoding pair (`buildAnchorKey` / `parseLineFromAnchor`) is now centralized in `responses.js` with 8 unit tests covering colon-in-path edge cases, missing-field fallbacks, and round-trips. |
| Collapsing a section hid only the comment badge, not the section content | After we render a `.grdc-existing-thread` as a direct sibling of the heading, `siblingsToHide`'s Strategy 1 found exactly one sibling (the thread) → `out.length === 1` → Strategy 2 (the cross-parent walk where the real content lives) never fired. | `siblingsToHide` now skips our own injected nodes (`grdc-existing-thread`, `grdc-comment-box`, `grdc-reply-box`, `grdc-comment-btn`) when both deciding "did Strategy 1 find anything" and when collecting what to hide. Result: thread badges remain visible across a collapse, and the cross-parent walk still finds the actual section content. |
| Unresolve always 401 "User is not authorized to resolve the conversation" | Click handler captured `isResolved` once at render time, so toggling Resolve → Unresolve still computed `!false === true` and re-hit `resolve_thread` on an already-resolved thread | Hold state in a mutable `currentResolved` variable scoped to the render. After a successful POST, flip `currentResolved` and recompute the button label / `grdc-thread-resolved` class. |

### Line mapping

| Issue | Root cause | Fix |
|---|---|---|
| Mermaid diagram source poisoned the forward-scan matcher — every block after a mermaid diagram landed at the diagram's line | Source concat included `mermaid` fence content (`graph TD ... A --> B ...`); rendered DOM had only `<svg>`, so the matcher latched onto mermaid text via fallback chunks and `lastOffset` got stuck inside the diagram | `buildSourceIndex()` now blanks out lines inside `mermaid` / `plantuml` / `dot` / `graphviz` fences before concat. `isDiagramBlock()` also skips them when iterating DOM blocks so they don't get a `+` button or contribute to `lastOffset`. |
| Unmatched blocks all snapped to **line 1** (especially `<tr>`, `<pre>`) | `findTextInSource` fallback returned `{line: 1, offset: lastOffset}` | Fallback now returns `findLineAtOffset(lineOffsets, lastOffset)` — i.e., the line corresponding to the last successful match. Plus per-block nudge: consecutive misses advance `lastLine` by 1 each so they don't all collapse to the same value. |
| `<tr>` text didn't tokenize cleanly → most rows missed match | `block.textContent` on `<tr>` concatenates cell text without separators in some browsers (`AB` instead of `A B`), but source has `|` (turned to space), so chunks like `enable_builtins()_markitdown.py` never matched | For `<tr>`, build the needle by joining `td/th` `textContent` with explicit spaces. |
| Table rows showed the same line as the header (e.g. all rows = 40 instead of 42, 43, 44, 45) | Even with text matching, the markdown divider line `\|---\|---\|` exists in source but is not a `<tr>` in the DOM, so per-row math was off-by-one and per-row matching was unreliable across short cell text | Match only the *first* `<tr>` of each table. For rows k≥1, compute `line = headerLine + (k - headerRowIndex) + 1`. The `+1` accounts for the `\|---\|` divider. Cached per-table in `tableHeaderLine: Map<table, {headerLine, rowIndex}>`. |
| Code-block (`<pre>`) `+` button was tied to the whole block — couldn't comment on a specific line | GitHub's prose-diff renders the entire fenced code as a single `<pre>` (no per-line wrappers we can reuse without breaking syntax highlighting) | Comment box line field is now an editable `<input type="number">`. For `<pre>`, the box also shows a hint like `(code block, lines 88–104)` derived from `code.textContent.split('\n').length` — user picks the exact line and posts. |
| `+` button never appeared on standalone paragraphs / blockquotes — only headings, list items, tables, and code blocks worked | The "skip nested P inside LI" filter was inverted: `block.closest("li") !== block && block.tagName === "P"` is **always true** for any `<p>` (`closest('li')` returns the LI ancestor or null, never the `<p>` itself), so every `<p>` got skipped | Replaced with `block.tagName === "P" && block.closest("li")` — only skip P when actually inside an LI. Reported by user: paragraphs like "Implement a ContentUnderstandingConverter" and blockquoted "Target repo" had no `+` button. |

### DOM injection

| Issue | Root cause | Fix |
|---|---|---|
| `+` button missing or jumping out of tables | `<button>` and `<div>` are not valid children of `<tr>` — browsers' HTML parser hoists them out of the table on insertion | Added `buttonAnchor(el)`: for `<tr>`, anchor the `+` to the first `<td>` (valid descendant). Added `siblingAnchor(el)`: for `<tr>`, place comment boxes / thread renders **after the parent `<table>`** instead of between rows. CSS positions the button inside `<td>` (`left: 2px`) since `-30px` falls outside the table. |
| Mutation observer fired on our own injected DOM, looping re-init | Observer watched all subtree additions, including our `+` buttons / comment boxes / thread badges | Ignore-list of CSS classes (`.grdc-existing-thread`, `.grdc-comment-btn`, `.grdc-comment-box`, `.grdc-reply-box`). When you add a new injected class, **add it to the ignore list** in `observe()`. |
| File container wrongly identified as a mermaid `<pre>` (`Container path: graph TD\n...` in logs) | `getFilePath()` Strategy 2 used any `clipboard-copy[value]` inside the container | `looksLikePath()` rejects multi-line / leading-whitespace / oversize values. Strategy 2 also requires the value to match a known PR file path from `pathDigestMap`. |

### Authentication / endpoint discovery

| Issue | Root cause | Fix |
|---|---|---|
| `Line could not be resolved` 422 on every post | `comparisonStartOid` was falling back to `headOid`, making the diff range empty | Always read `fullDiff.baseOid` from route data. If absent, scan embedded JSON for `*[Bb]ase[Oo]id` / `comparisonStartOid` / `mergeBaseOid`. Bail with a clear error if base OID truly can't be discovered. |
| `raw.githubusercontent.com` fetches blocked from content script | That host returns `Access-Control-Allow-Origin: *`, which forbids credentialed requests, so private files fail | Always fetch raw source via `github.com/<owner>/<repo>/blob/<sha>/<path>` HTML and extract from `embeddedData` JSON. |
| Raw source extraction broke when GitHub changed JSON shape | Hardcoded JSON path | `findBlobInJson()` recursively searches all `application/json` `<script>` tags for any object with `rawLines: []` or `rawBlob: ""`. |
| `stripMarkdown` left an orphan `!` for image syntax `![alt](url)` | Link regex `\[(...)\]\(...\)` ran before image regex `!\[(...)\]\(...\)`, eating the link half of the image and leaving the `!` behind | Run image regex BEFORE link regex. Caught by `tests/textMatch.test.js`. |

## Things to consider next

- **Hunk-aware `+` visibility** — hide `+` on blocks whose source line falls outside any diff hunk (eliminates 422 "Line could not be resolved" entirely). Needs parsing `comparison.fullDiff` for hunk ranges. Don't use `diffSummary.markersMap` as the source of truth — see the tombstone in the changelog above.
- **Improve text-match coverage** — current hit rate is ~12% on the sample design doc; the rest fall through to the now-capped fallback nudge. Better matching would reduce off-by-one anchor errors that lead to 422s.
- **Verify any newly-added page_data endpoint** — same approach as reply / resolve: capture the URL from DevTools Network panel while clicking GitHub's native control, add to `pageDataPost` candidate list, trim to verified.
- Better matching for fenced **prose** code blocks (currently still passes through `stripMarkdown`, which doesn't help with raw code).
- Better handling of HTML blocks (`<details>`, raw `<table>`) where source has HTML but rendered DOM doesn't.
- High-level overview of the matching strategy lives in [APPROACH.md](./APPROACH.md). Read that first if you're new to the codebase.

## Manual test checklist

Run through these after any non-trivial code change. Test on a PR with multiple markdown files, existing review comments, and at least one mermaid diagram.

### Unit tests (pure helpers)

- [ ] `npm test` passes (Node 18+; no `npm install` needed — uses built-in `node:test`)
- [ ] If you changed `src/lib/*.js`, the corresponding `tests/*.test.js` covers the change
- [ ] If you fixed a bug in a pure helper, add a regression test referencing the bug history

### Comment posting

- [ ] `+` button appears on hover for paragraphs, headings, list items, table rows, and code blocks
- [ ] `+` on a `<tr>` appears inside the first `<td>` (not floating outside / above the table)
- [ ] Inline comment box shows the correct file path and line number (cross-check against source diff)
- [ ] Line number field in the comment box is **editable** (number spinner, not read-only)
- [ ] On a `<pre>` code block, the box shows the line range hint `(code block, lines N–M)` and the user can pick any line in that range before posting
- [ ] Comment box for a `<tr>` is rendered **after the parent `<table>`**, not jammed between rows
- [ ] Comment posts successfully and appears in the source-diff view at the correct line
- [ ] **New comment renders inline immediately** (badge appears beneath the block) without needing to refresh
- [ ] Comment on the first line of a file works
- [ ] Comment on the last line of a file works
- [ ] Comment on a line immediately after a mermaid block posts to a valid line (no 422)
- [ ] Posting an empty comment is prevented (button does nothing)
- [ ] Cancel button closes the comment box without posting
- [ ] Error message is shown inline when post fails (e.g. line outside diff hunk)
- [ ] Multiple comments can be posted in sequence without page refresh

### Existing comment display

- [ ] Existing review threads appear as `💬 N comments` badges in the rich diff
- [ ] Badge click toggles the thread body open/closed
- [ ] Comments show correct author, body text, and relative timestamp
- [ ] "View on GitHub" link opens the correct discussion thread
- [ ] Multi-comment threads render all replies in order
- [ ] Comments on different files render under the correct file, not all under one
- [ ] Resolved threads show `· ✓ resolved` in badge and are collapsed by default
- [ ] Outdated threads show `· outdated` in badge
- [ ] Unresolved threads auto-expand on render
- [ ] Existing **multi-line** threads show `lines N–M` in the badge and tint every block in the range with a yellow left bar

### Multi-line range comments

- [ ] Mouse-down on a `+`, drag to a different block, release → opens comment box with `start – end` line inputs
- [ ] During drag, the **whole range** between anchor and cursor highlights yellow (live, follows cursor)
- [ ] Drag can release on **any text** in another block — doesn't need to land on a `+`
- [ ] Drag onto a block in a different file → cancels (no cross-file ranges)
- [ ] Submitted range comment posts with `subjectType: "multiline"` (one POST, status 200, payload includes `positioning.startCommitOid` / `endCommitOid` / `startPath` / `endPath` / `endLine`)
- [ ] After reload, the new thread shows `· lines N–M` in its badge (read from `markersMap.<key>.threads[].start`)

### Section collapse (heading-scoped)

- [ ] Hover any H1–H6 → `▾` chevron appears at the left of the heading text
- [ ] Click the chevron → all blocks under that heading down to the next heading at the same or higher level disappear; heading dims; chevron becomes `▸`
- [ ] Click again → section re-expands; chevron back to `▾`
- [ ] Long sections (~60+ elements crossing multiple diff hunk containers) collapse correctly — the cross-parent walk works (see DEV_NOTES → "Heading-scoped collapse")
- [ ] `+` comment button on a collapsed heading still opens a comment box
- [ ] After SPA navigation back to the same PR, previously-collapsed sections are restored (in-memory `WeakSet` state)
- [ ] After hard page reload, all sections are expanded again (state is in-memory only, by design)

### Reply / resolve

- [ ] Clicking **Reply** opens an inline reply box; submitting posts via the verified `create_review_comment` + `inReplyTo` endpoint (one POST, status 200)
- [ ] **New reply appears inline immediately** beneath the existing thread comments without refreshing
- [ ] Reply on a thread anchored to a `<tr>` renders correctly (after the table, not between rows)
- [ ] Clicking **Resolve** on an unresolved thread succeeds and updates the badge
- [ ] Clicking **Unresolve** on a resolved thread succeeds

(There is no in-extension submit-review button. Use GitHub's native "Review changes" button at the top-right of the Files-changed tab.)

### Line number accuracy

- [ ] Headings map to the correct source line (verify against source diff)
- [ ] List items (including nested) map to the correct line
- [ ] Table rows map to a reasonable line (within the table in source)
- [ ] **Each table data row gets a distinct line number** (header line + row offset + 1 for the `|---|` divider). Verify on a 4-row table: rows should land on N+2, N+3, N+4, N+5 where N is the header line.
- [ ] Code-block click pre-fills the line of the opening fence; the editable input + range hint covers every line up to the closing fence
- [ ] No block falls back to **line 1** when raw source was successfully fetched (check `[GRDC] NO MATCH` log — unmatched blocks should inherit the previous line, not reset to 1)
- [ ] Paragraphs after a mermaid block map to a valid line (not stuck at mermaid position)
- [ ] Content after a fenced code block maps correctly
- [ ] Long files (200+ lines) still have accurate mapping near the end

### Multi-file & edge cases

- [ ] All markdown files in the PR get `+` buttons (not just the first one)
- [ ] Non-markdown files (`.js`, `.py`, etc.) are ignored — no buttons or errors
- [ ] Mermaid diagram container is not treated as a file (no `graph TD...` in path logs)
- [ ] Files with no changed lines (context-only) don't break the extension
- [ ] SPA navigation: open a different PR without full page reload — extension re-initializes
- [ ] Lazy-loaded files (scroll down to expand) get buttons after they appear

### Private repo support

- [ ] Raw source is fetched successfully (console shows `Fetched raw source via embeddedData scan`)
- [ ] Existing comments load (console shows `route-data: N threads, N comments (path: N, line: N)`)
- [ ] Posting works without a PAT configured (uses session cookies)
