# Features & Roadmap

What works today, what's planned, and what we deliberately won't do.

---

## ✅ Shipped

### Core: rendered-diff commenting

- [x] **`+` button on every commentable block** in rich diff — paragraphs (incl. blockquoted), headings (H1–H6), list items (nested too), table rows, code blocks
- [x] **Click `+` → write a comment → posts as a real PR review comment** on the correct source line
- [x] **Multi-line range comments** — **drag** the `+` from one block down to any other block (matches GitHub's source-diff gesture). The full range is highlighted yellow while dragging. Release into a comment box with both start and end line inputs editable; submit creates a real multi-line PR review comment via `subjectType: "multiline"`. Existing multi-line threads display the source-line range in the badge (`💬 1 comment · lines 19–38`) and tint every block in the range with a persistent yellow left bar. **The badge is anchored at the START line of the range** — this deliberately differs from GitHub's source-diff (which anchors at the end line) because rich-diff has no visible line numbers; placing the badge at the top of the highlighted range makes it the entry point into the comment, not its terminator.
- [x] **Editable line number** in the comment box — for code blocks (where `<pre>` can't be split per-line), a line-range hint `(code block, lines N–M)` lets the user pick the exact line
- [x] **Comment posts inline immediately** — no refresh needed; the new `💬` badge appears under the block within a click

### Existing review threads on the rendered view

- [x] **`💬 N comments` badge** anchored at the rendered block matching each thread's source line
- [x] **Full reply chain** rendered inside the badge with author, body, relative timestamp, and "View on GitHub" link
- [x] **Resolved state** — badge shows `· ✓ resolved`, thread dimmed and collapsed by default
- [x] **Outdated state** — badge shows `· outdated`
- [x] **Unresolved threads auto-expand** on render

### Reply / resolve

- [x] **Reply** inline via verified `create_review_comment` + `inReplyTo` endpoint; new reply appears immediately, no refresh
- [x] **Resolve / Unresolve** via verified `resolve_thread` / `unresolve_thread` endpoints; badge updates immediately. Resolve auto-collapses the thread body; Unresolve re-expands it (matches the initial-render rule that resolved threads load collapsed).

(Submit a full review is intentionally **not** here — use GitHub's native "Review changes" button. See "Won't do" below.)

### Comment / reply editor

- [x] **GitHub-style chrome** — Write/Preview tabs, markdown toolbar (Heading / B / I / `<>` / Link / Quote / unordered list / numbered list / task list), action bar with Cancel + Comment buttons. CSS uses GitHub's `--color-*` variables so it follows light/dark theme.
- [x] **Cmd+Enter / Ctrl+Enter submits**
- [x] **Auto-grow textarea**, capped at 400px
- [x] **Selection wrapping** by toolbar buttons (or insert + select placeholder when nothing is selected)
- [x] **Preview tab uses GitHub's own renderer** (`POST /preview` with cookies + CSRF token) — full GFM: tables, task lists, emoji, @mentions, #issues. Falls back to a built-in inline renderer if the request fails.
- [x] **`@mention` autocomplete** — type `@` to get a live dropdown of repo collaborators (same data source as GitHub's native form, fetched once and cached for the session, **pre-warmed during init** so the first `@` keystroke is instant). Up/Down to navigate, Tab/Enter to insert, Esc to dismiss.
- [x] **Existing comment bodies render via `bodyHTML`** from GitHub's response — same renderer the source-diff view uses.

### Reading-progress aids

- [x] **Collapse / expand sections by heading** — hover any `<h1>`–`<h6>` to reveal a `▾` chevron; click to fold every block under that heading down to the next heading of the same or higher level. Click again to expand. State is per-heading, in-memory only (lost on page reload by design — sessions are short and persisting would need IndexedDB). The `+` comment button on collapsed headings keeps working. Use case: hide already-reviewed sections while scrolling between the remaining ones.

### Quality of life

- [x] **Cookie auth** — no PAT required; works for public **and** private repos via session cookies
- [x] **PAT fallback** — opt-in via `localStorage['grdc_use_pat'] = '1'` for power users
- [x] **SPA navigation handling** — `MutationObserver` re-initializes when GitHub lazy-loads files or you navigate to another PR
- [x] **Diagnostic logging** — every action prefixes `[GRDC]` in console; clear "skipping source-diff" hint when user forgot to toggle rich-diff

### Line mapping

- [x] **Forward-scan text matching** against raw source (no source map needed)
- [x] **Mermaid / PlantUML / DOT / Graphviz fence content blanked** so it doesn't poison `lastOffset`
- [x] **Table-row arithmetic** — first row text-matched, remaining rows computed as `headerLine + rowIndex + 1` (accounts for `|---|` divider not present in DOM)
- [x] **Code-block range hint** derived from `<code>.textContent.split('\n').length`
- [x] **`<tr>` button anchoring** — button injected into `<td>` (not `<tr>` directly, which the HTML parser rejects); comment boxes / threads placed *after* `<table>`
- [x] **Unmatched-block fallback** inherits previous line (no longer collapses to line 1)
- [x] **Standalone paragraphs and blockquotes** get `+` buttons (the original P-skip filter was inverted and skipped them all)

### Testing

- [x] **74 unit tests** for pure helpers (line matching, response parsing, markersMap parsing, table arithmetic, markdown preview, HTML escaping, time formatting) using Node's built-in `node:test` — zero dependencies
- [x] **Regression tests** for every bug in the changelog
- [x] **Manual test checklist** in DEV_NOTES for DOM/network paths not covered by unit tests

---

## 🚧 Planned / nice-to-have

> **Scope rule:** Anything GitHub's PR UI already provides **on the same rich-diff page** is intentionally out of scope. We only fill gaps that exist when the user is in rich-diff mode (commenting on rendered blocks, seeing existing threads at rendered positions). For things that *only* exist on other GitHub pages (Conversation tab, source-diff view) — edit/delete/react, reaction picker — see [Features](#features) below: those are in scope because the user has to leave rich-diff to do them today.

**Priority key:** **P0** = next up (real bug, frequent user impact). **P1** = high value, planned. **P2** = useful, do when convenient. **P3** = exploratory / defer until something regresses.

### Correctness

- [x] **~~P0~~ — `+` glyph not vertically centered in the blue circle** (fixed in 1.0.1) — see [DEV_NOTES.md → Resolved issues](./DEV_NOTES.md#comment-box--inline-rendering).
- [x] **~~P0~~ — New comments on the same line rendered newest-first instead of oldest-first** (fixed in 1.0.1) — see [DEV_NOTES.md → Resolved issues](./DEV_NOTES.md#comment-box--inline-rendering).
- [x] **~~P0~~ — SPA-navigation activation** (fixed in 1.0.1) — see [DEV_NOTES.md → Resolved issues](./DEV_NOTES.md#comment-box--inline-rendering).
- [x] **~~P0~~ — Out-of-file line numbers from runaway fallback** (fixed in 1.0.1) — see [DEV_NOTES.md → Resolved issues](./DEV_NOTES.md#comment-box--inline-rendering).
- [x] **~~P0~~ — Disappearing comments after re-init** (fixed in 1.0.1) — see [DEV_NOTES.md → Resolved issues](./DEV_NOTES.md#comment-box--inline-rendering).
- [ ] **P1 — Improve text-match rate** — today's matcher hits only ~12% of blocks on the sample design doc (`14 / 117 text-hits`). The remaining 103 blocks fall through to the `lastLine + 1` nudge (now capped at the source line count). They still anchor to *approximate* line numbers, so a `+` on paragraph X may post on the line immediately after the matched block before it. Common miss sources: nested lists, blockquoted paragraphs, `<details>` summaries, code blocks. Improving this would also reduce 422s since fewer comments would target unchanged regions by accident.
- [x] **~~P1~~ — Deleted blocks drift downstream line numbers** (fixed in 1.0.3) — rich-diff still renders deleted content (wrapped in `<del>` / GitHub's prose-diff delete markers). The DOM walker used to treat those blocks like any other: tried to text-match against the **post-change** source, failed (the text isn't in the new file), and fell through to the `lastLine + 1` nudge. That nudge advanced `lastLine` once per deleted block, so every subsequent block was anchored that many lines too early — cumulative downstream drift on any diff with deletions. Fix: new `isInDeletedBlock(el)` helper detects `<del>` ancestors via a cheap tag-only walk; `buildLineMap()` now early-returns on those blocks (no `+`, no `lastLine` consumed). Commenting on deleted lines directly is a separate follow-up — see below.
- [x] **~~P1~~ — Source-diff doesn't reflect just-posted comments without page refresh** (fixed in 1.0.2) — after a successful post/reply/resolve/unresolve/edit/delete from rich-diff, a `sourceDiffDirty` flag is set. A `capture`-phase document click delegate watches for the user clicking GitHub's rich/source diff toggle (heuristic match against `aria-label` / `title` / `data-*` / textContent). When dirty + toggle clicked, we `window.location.reload()` after a 50 ms delay so GitHub's own navigation runs first. Users staying in rich-diff are unaffected. See [DEV_NOTES.md → Resolved issues](./DEV_NOTES.md#comment-box--inline-rendering).
- [x] **~~P2~~ — Stray underline styling on our comment box** (fixed in 1.0.2) — GitHub's prose-diff renderer wraps inserted blocks in `<ins>` (e.g. `<ins><p>…</p></ins>`). Our box was inserted via `element.after(box)`, which puts the node after the `<p>` but **still inside** the `<ins>`. CSS `text-decoration` painted by an ancestor propagates across all inline descendants regardless of the descendant's own `text-decoration` value — so every text run inside our injected UI (header, textarea placeholder, button labels, existing-thread body) inherited the underline. Fix: `siblingAnchor()` walks up from the anchor and, if it finds an `<ins>` / `<u>` ancestor inside the diff container, escapes to the topmost such ancestor; `.after()` then lands the box *outside* the underline-painting scope. Tag-only walk (no `getComputedStyle`) so render speed is unaffected. No CSS / Shadow-DOM rewrite needed. See [DEV_NOTES.md → Resolved issues](./DEV_NOTES.md#comment-box--inline-rendering).
- [x] **~~P1~~ — Code-block fence range hint** (fixed in 1.0.1) — the `(code block, lines N–M)` hint in the comment box header now shows the **actual fence range** read from the raw markdown source (e.g. backticks at lines 195 and 240 → hint reads `lines 196–239`), regardless of where in the block the user clicked. See [DEV_NOTES.md → Resolved issues](./DEV_NOTES.md#comment-box--inline-rendering).
- [x] **~~P1~~ — Per-bullet `+` button inside ordered/nested lists** (fixed in 1.0.1) — see [DEV_NOTES.md → Resolved issues](./DEV_NOTES.md#comment-box--inline-rendering).
- [ ] **P1 — In-table anchoring for table-row threads** — comments on a table row are correctly attributed to the right source line, but the thread badge / comment box is currently rendered *after* the `<table>` element (because injecting block-level content into `<tr>`/`<td>` would break GitHub's table CSS and the HTML parser rejects sibling nodes inside `<tr>`). As a result, multiple comments on different rows all stack below the table. Possible approaches: (a) render an in-row indicator (e.g. a small badge in the last `<td>`) that scrolls/expands the corresponding below-table thread, (b) overlay an absolutely-positioned floating thread aligned to the row's bounding rect, (c) inject an extra full-width `<tr>` after the commented row containing a single-cell `colspan=N` host for the thread.
- [x] **~~P2~~ — Click-Y to line-number inside code blocks** (fixed in 1.0.1) — hovering anywhere inside a `<pre>` slides the `+` button vertically to follow the cursor's row, and clicking opens the comment box anchored to the hovered line (instead of always the fence's first line). See [DEV_NOTES.md → Resolved issues](./DEV_NOTES.md#comment-box--inline-rendering).

  **Why the `+` is only at the top of a code block today:** a fenced code block renders as a single `<pre>` element. Our `+` anchors at the top of each commentable block (one button per DOM node). We deliberately don't inject per-line `+` buttons inside `<pre>` because (a) it would break GitHub's syntax-highlighting span structure, and (b) GitHub's review-comment API only anchors at line granularity — a per-line `+` doesn't unlock anything we couldn't already do via the editable line-number input. The escape hatch today is the `(code block, lines N–M)` hint and editable line input in the comment box header.
- [ ] **P2 — Better matching for fenced prose code blocks** — currently goes through `stripMarkdown` which doesn't help raw code; match on the first non-empty line instead.
- [ ] **P3 — Better handling of HTML blocks** (`<details>`, raw `<table>` in source) — currently inherits previous line on miss.

### Features

Features below are in scope when they cover a workflow gap **on the rich-diff page itself**. Users currently have to click "View on GitHub" and leave the page to do most of these — that's the gap we'd fill.

- [x] **~~P1~~ — Edit own comments inline** (shipped in 1.0.1) — `⋯` menu on each comment posted by the current user opens an inline editor; Save calls `PUT page_data/update_review_comment?body_version=<sha256>`. See [DEV_NOTES.md → Resolved issues](./DEV_NOTES.md#comment-box--inline-rendering).
- [x] **~~P1~~ — Delete own comments inline** (shipped in 1.0.1) — `⋯` menu → Delete (with confirm), calls `DELETE page_data/review_comments/<dbId>`. If the deleted comment was the only one in a thread, the whole thread is removed. See [DEV_NOTES.md → Resolved issues](./DEV_NOTES.md#comment-box--inline-rendering).
- [ ] **P2 — React to comments (👍, ❤️, 🎉, …)** — small reaction-row at the bottom of each rendered comment. GitHub's GraphQL reaction mutations or the matching `page_data` endpoint. Without this, users must leave the page to react.
- [x] **~~P2~~ — Preserve scroll position after reply submit** (fixed in 1.0.3) — after submitting a reply (or edit/delete/resolve) in an expanded thread, GitHub's React store optimistically inserted a new `.markdown-body` node which tripped our `MutationObserver` → `scheduleReinit()` → full `init()` rebuild. `clearInjectedDom()` plus the re-render briefly removed every block we'd previously sized, resetting the page to `scrollY = 0` and forcing the user to scroll back. Fix: `scheduleReinit()` now captures `window.scrollY` before its 500ms debounce window and restores it after `init()` finishes, via `requestAnimationFrame` plus a microtask fallback for backgrounded tabs. URL-navigation re-inits go through `maybeInit` directly and still land at top — the restore only fires for mutation-driven re-inits.
- [ ] **P2 — Floating prev/next comment nav** — small floating button cluster (e.g. bottom-right) with `↑` / `↓` to jump to the previous / next thread in the file. Long design docs can have a dozen+ threads scattered across hundreds of lines and there's no way to find them without scrolling the whole file. Build from the same thread set we already render. Optionally show a count badge (`3 / 12`). Companion to the planned floating TOC.
- [ ] **P2 — Make comment badges more visually distinct from rendered markdown** — the `💬 N comments` badge and resolved-thread chrome currently blend into the rendered prose (they sit inline with paragraphs and use muted GitHub tokens), so when scrolling quickly with the mouse wheel or scrollbar it's easy to miss them entirely. In source-diff view comments stand out because the surrounding code is visually distinct from prose; in rich-diff they don't. Options: (a) stronger left-border accent that extends into the page gutter, (b) a small fixed-position "minimap" / scroll-track indicator showing where threads live in the file, (c) a more saturated badge background, (d) subtle background tint on the entire commented block. Applies to both unresolved and resolved threads — resolved ones are even easier to miss today since they're dimmed.
- [ ] **P2 — "Unresolved only" filter** — toolbar toggle that collapses all resolved threads in the file. Useful on long-running review docs with dozens of resolved threads.
- [ ] **P2 — Comment on deleted lines (LEFT side)** — follow-up to the deleted-blocks drift fix in 1.0.3. GitHub's source-diff lets you comment on deleted lines by posting with `side: "left"` against the BASE file's old line number; in rich-diff we currently render no `+` on `<del>` / `.removed` blocks at all. **Payload now verified** — see [DEV_NOTES.md → LEFT-side comments](./DEV_NOTES.md#left-side-comments-on-deleted-lines): only three fields differ from the RIGHT payload (`side`, `positioning.commitOid` swaps to base, `line` becomes the old line). **MVP scope:**
  1. Fetch BASE source per file alongside head (parameterize `fetchRawSource(path, oid)`, add base cache).
  2. Hoist base-OID discovery so it's available during `buildLineMap` (currently only resolved on first post).
  3. Classify each block as KEPT / ADDED / REMOVED via the `.removed` / `.added` / `<del>` / `<ins>` wrappers already detected by `isInDeletedBlock`.
  4. Dual forward-scan: REMOVED blocks match against base index (yield `{side: 'LEFT', line: oldLine}`), ADDED match against head (`RIGHT`, new line), KEPT match against both and store `RIGHT`.
  5. Visually differentiate the `+` on REMOVED blocks (red vs blue) so the side is obvious.
  6. Thread `side` through `openCommentBox` → `postReviewCommentInternal` → payload; build LEFT payload per the verified shape above.
  7. Render existing LEFT threads (`parseMarkersMap` already extracts `L<n>` keys) on the corresponding `<del>` blocks by matching on `(side, line)`.

  **Deferred to a follow-up after MVP:** multi-line LEFT ranges (need a captured multi-line LEFT payload first); cross-side ranges (drag from a kept line into a deleted line — likely rejected by the API; gate the drag); table rows mixed kept/removed (current row-arithmetic helper assumes monotonic source lines and may drift on tables with deleted rows). **Risk acceptances:** base blob fetch can fail on force-pushed branches where the old base SHA is gone — degrade gracefully (no `+` on deleted blocks, same as today); ~2× initial network cost on files with deletions, parallelized like the head fetch.
- [ ] **P2 — Floating table of contents** — sticky side panel listing every heading in every modified `.md` file in the PR, with click-to-jump scroll. Useful on long design docs where reviewers want to skip to a specific section. Build from the same `H1–H6` set we already enumerate for collapse toggles. Should respect the user's current scroll position (highlight active section) and auto-hide on short files. Optionally show per-section thread counts (`Architecture · 3 💬`).
- [ ] **P2 — Collapse-all / expand-all by heading level with progressive disclosure** — toolbar buttons like "Collapse to H2" / "Expand all" that fold every heading at level N or deeper while keeping levels above N visible. e.g. on a doc with H1→H2→H3 nesting, "Collapse to H2" leaves all H1s and H2s expanded but folds every H3 section. Builds on the existing per-heading collapse — just iterate `fileLineMap` filtering by `headingLevel(el) >= N`. Companion to the floating TOC: collapse all sections, then expand only what you want.
- [ ] **P2 — Persistent collapse state per file** — section collapse state currently resets on tab switch / hard refresh. Store `{prNumber, filePath, collapsedHeadingIds}` in `sessionStorage` and replay on render.
- [ ] **P2 — Keyboard navigation between threads** — `j` / `k` to jump to next / previous thread in the file (respecting GitHub's existing keybindings — probably mount on a unique chord like `g j` / `g k`).
- [ ] **P2 — Quick-reply textarea inline in the badge** — without expanding the full thread. One-line input + Reply button right on the `💬 N comments` badge. Saves a click on "+1" / "done" replies.
- [ ] **P2 — Character-range (sub-line) comments via metadata convention** — let users select a word or phrase within a line and anchor a comment to that exact substring instead of the whole line.

  GitHub's review-comment API only supports line-level anchoring, so we can't post a true sub-line range. Workaround: encode the character range as **structured metadata inside the comment body** (e.g. a hidden HTML comment or a fenced YAML block at the start: `<!-- grdc-anchor: { "text": "user_agent", "occurrence": 1 } -->`). The line/file is still GitHub's native anchor; the metadata tells us which substring to visually highlight.

  Render path: on render of an existing thread, parse the metadata, find the substring in the rendered block (`occurrence`-indexed to disambiguate duplicates), wrap it in a `<span class="grdc-anchor-highlight">`, and anchor the thread badge to that span instead of the block. Editing path: drag-select text → "Add comment on this selection" → we record the substring and occurrence into the comment body before posting.

  Constraints:
  - Comments edited from GitHub's native UI may strip or reformat the metadata. Tolerate missing metadata gracefully (fall back to line-level anchor).
  - The metadata must survive GitHub's markdown sanitizer — HTML comments do, fenced code blocks do; arbitrary `<span>` tags probably don't.
  - Other tooling (notifications, PR search) sees the literal metadata in the comment body. Keep it terse and clearly marked.
- [ ] **P3 — Hunk-aware `+` visibility** — originally assumed GitHub's review-comment API only accepts comments on lines inside a diff hunk (± 3 context), and that clicking `+` outside would 422 with `"Line could not be resolved."`. **Empirically this is not the case** — verified 2026-05 on a real PR: an unchanged span (lines 143–158) accepted a comment on line 149 with no error. GitHub's actual constraint appears to be "any line in the post-change file within the comparison range," which rich-diff already respects since it renders the full file. The 422 message still exists in our error handler but seems to fire only in narrower cases (out-of-bounds line numbers, LEFT side without proper side flag, etc.). Keeping this as P3 in case a future regression makes hunk-awareness actually necessary; otherwise no action needed. Early attempt warning: don't use `diffSummary.markersMap` keys as a stand-in for valid lines — `markersMap` is markers-only (typically 3–4 keys for a long file), not hunk lines.
- [ ] **P3 — Google-Docs-style threads sidebar** — a collapsible right-hand panel listing every thread in the file with author avatar, snippet of the first comment, status (open / resolved / outdated), and click-to-jump. Requested in [community/discussions/160981](https://github.com/orgs/community/discussions/160981) ("it would be nice to have them show in the sidebar to the right … similar to how Google Docs comments work"). Complements the planned floating TOC (heading-based) and prev/next nav (sequential) by giving a single overview of all conversations. Build from the same thread set we already render; updates live when threads are added / replied / resolved.
- [ ] **P3 — Apply "Suggested change" blocks from rich-diff** — GitHub's `suggestion` code blocks render correctly inside our threads (via `bodyHTML`), but the **Apply suggestion** / **Add suggestion to batch** buttons are React-bound on GitHub's native UI and inert in our injected DOM. Implement a custom Apply button that posts the suggestion as a commit via the same endpoint GitHub's native UI uses (likely `POST page_data/apply_suggestion` or a GraphQL mutation — needs investigation). Without this, reviewers can read suggestions in rich-diff but must switch to source-diff to apply them, which breaks the workflow. Relevant to design-doc review use case described in [community/discussions/186730](https://github.com/orgs/community/discussions/186730).
- [ ] **P3 — Live update when new comments post elsewhere** — poll or subscribe (the page already has GitHub's own websocket) for new comments on this PR while the user is viewing the file, and merge them into the rendered threads without a hard refresh.
- [ ] **P3 — GitHub-style comment box UX** — see "Native-style comment box" spec below. (Real gap because we render our own comment box; GitHub's native one stays in source-diff view. Level 1 visual parity and Level 2 cheap functional bits have shipped; remaining items are explicitly deferred or out-of-scope.)

### Testing infrastructure

- [ ] **jsdom + fetch mock tests** for DOM-injection helpers (`buttonAnchor`, `siblingAnchor`, mutation observer ignore list)
- [ ] **Recorded fixture tests** for `fetchExistingComments` and `pageDataPost` response parsing — pin JSON fixtures from a real PR
- [ ] **Playwright e2e** against a throwaway public PR (defer until something regresses)

### Distribution

- [ ] **Publish to Chrome Web Store** — submission pending review.
- [ ] **Publish to Edge Add-ons** — submission pending review.
- [x] **Icon + screenshots** for the store listing
- [ ] **Permissions audit** — narrow `host_permissions` if possible

---

## 🚫 Won't do (deliberate trade-offs)

GitHub's PR UI already provides these on the same rich-diff page — duplicating them adds maintenance burden without value:

- ❌ **Submit a full review** (Approve / Request changes / Comment) — top-right green **"Review changes"** button on the Files-changed tab.
- ❌ **Mark file as viewed** — per-file **"Viewed"** checkbox in the file header.
- ❌ **Multi-file navigator** — left-side file tree + "Jump to file" dropdown.
- ❌ **Drag-and-drop image upload in our comment box** — relies on an undocumented multipart upload endpoint + a custom React element. Use GitHub's native comment box (in source-diff view) when you need it. (Markdown preview and `@mentions` — originally on this list — were shipped using GitHub's own renderer / suggestions endpoints.)

> Edit/delete/react were previously in this list under the rationale that the `…` menu is one click away via our "View on GitHub" link. Moved to [Features](#features) because that link leaves the rich-diff page, which is exactly the workflow break the extension exists to fix.

Other design trade-offs:

- ❌ **Render markdown ourselves.** GitHub already does this perfectly. Reusing their DOM is simpler and always up to date.
- ❌ **Re-implement `+` on source-diff view.** GitHub already provides it. We only fill the gap in rich-diff.
- ❌ **Per-line wrappers inside `<pre>` code blocks.** Would break GitHub's syntax highlighting. The editable line input is the escape hatch.
- ❌ **Try to match every block with perfect accuracy.** The editable line input is the safety net — user fixes off-by-one in one click before posting.
- ❌ **Use the public GitHub REST/GraphQL API by default.** Works but requires a PAT and breaks "just works for private repos". Kept as opt-in fallback.
- ❌ **Build as a VS Code extension.** The browser extension is ~1000 lines and gets rendering / auth / navigation / non-md file diff for free from GitHub. A VS Code version would be 10× the code for marginal gain.

---

## Spec: Native-style comment box (shipped — retained for historical context)

Three fidelity levels were considered. Level 1 + cheap parts of Level 2 are now shipped (see [Comment / reply editor](#comment--reply-editor) above). Level 3 was explicitly skipped — see "Why we don't clone GitHub's native form" below.

### Level 1 — visual parity (shipped ✅)

Restyle `.grdc-comment-box` to match GitHub's native review-comment box.

- [x] Header bar with **Write** / **Preview** tabs
- [x] Markdown toolbar row above the textarea
- [x] Bottom action row: `Cancel` (left), primary action right-aligned
- [x] GitHub native tokens: `--color-canvas-subtle`, `--color-border-default`, `--color-btn-primary-bg`, `--color-fg-default`
- [x] 6px border-radius, GitHub system font stack, padding matching `.timeline-comment-form`
- [x] Same restyle applied to the reply box

### Level 2 — cheap functional bits (shipped ✅)

| Feature | Status |
|---|---|
| **Cmd+Enter / Ctrl+Enter submits** | ✅ |
| **Auto-grow textarea** (capped at 400 px) | ✅ |
| **Toolbar buttons wrap selection** | ✅ |

Nine toolbar buttons shipped: **Heading**, **B**, **I**, **`<>`** (inline code), **Link**, **Quote**, **unordered list**, **numbered list**, **task list**.

### Level 2 — skip these (diminishing returns)

- **Drag-and-drop image upload** — multipart upload to `github.com/upload/policies/assets`, undocumented.
- **Slash commands** (`/cc`, `/saved-replies`) — each is a separate undocumented endpoint.
- **`#issue` / `:emoji:` autocomplete** — each is a separate suggestions endpoint. Could be added with the same pattern as `@mentions` if there's demand.

(Markdown preview tab and `@mention` autocomplete — originally listed here as "skip, defer" — were shipped using GitHub's own `POST /preview` and `GET /suggestions/...` endpoints. See [DEV_NOTES.md](./DEV_NOTES.md) for endpoint details.)

### Level 3 — explicitly NOT doing: clone GitHub's native form

**Tempting because** GitHub's native comment box already has everything we'd otherwise have to build: markdown toolbar, Write/Preview tabs, `@mention` autocomplete, drag-and-drop image upload, slash commands, saved replies. Why reinvent?

**Why we don't:** cloning the DOM gives you a *dead shell*. The modern GitHub comment form is rendered with **Primer React** (you can see it in DevTools — the textarea has a class like `prc-Textarea-TextArea-<hash>`; `prc-` = Primer React Components). Each interactive bit dies on a clone:

| Feature | Why it dies on a `cloneNode(true)` |
|---|---|
| Markdown toolbar (B / I / `<>` / list / link) | Buttons dispatch React synthetic events. The cloned button has no React fiber attached — clicks fire DOM events that go nowhere. |
| Write / Preview tabs | Preview tab fetches markdown via an internal page_data render endpoint. The fetch is triggered by a React state change on the original mount — the clone has no state. |
| `@mention` / `#issue` / emoji autocomplete | Built on a custom element (`<text-expander-element>` or similar) that reads its config from React props passed at mount time. Clone the DOM and the element is inert. |
| Drag-and-drop image upload | Bound to a `<file-attachment-element>` whose `drop` handler is set up by React effects on mount. Clone has no handler. |
| Slash commands (`/cc`, `/saved-replies`) | Same pattern — React-driven keyboard handlers. |
| Submit | The native submit hits GitHub's internal store and triggers its own optimistic render, but its hidden inputs (`authenticity_token`, line/side/commit-oid) were populated when the *original* form was opened. The clone's tokens are stale → 422 on submit. |

You can't even cleanly intercept the native submit — if you `preventDefault` you lose the form's internal state cleanup; if you let it through, GitHub posts to its store *and* your overlay tries to post too.

**What you could actually get from a clone:** the visual styling. Which is exactly Level 1 — copying the CSS. So just copy the CSS.

**Bottom line:** functional parity requires GitHub's React component runtime to be alive on your cloned element. That runtime is undocumented, minified, and changes build-to-build. Maintenance burden far outweighs the saved code. Visual parity (Level 1) gets you 90% of the perceived "feels native" with none of the risk.

### Implementation order (history)

1. CSS-only restyle of `.grdc-comment-box` and `.grdc-reply-box` to match `.timeline-comment-form`. ✅
2. Cmd+Enter + auto-grow event handlers. ✅
3. Toolbar buttons + selection wrap — one helper `wrapSelection(textarea, before, after)`, nine button click handlers (Heading / B / I / `<>` / Link / Quote / unordered list / numbered list / task list). ✅

(There's no "Start a review" split — submit-review is intentionally delegated to GitHub's native "Review changes" button. See "Won't do" above.)

Acceptance criteria (all met at ship time):

- [x] Comment box visually matches GitHub's native form
- [x] Cmd+Enter (Mac) and Ctrl+Enter (Win/Linux) both submit
- [x] Textarea grows as you type, capped before it pushes the page around
- [x] Each toolbar button wraps the current selection (or inserts at cursor if no selection) and restores focus
- [x] Same restyle applied to reply box
- [x] No regression in existing functionality — line input still editable, code-block range hint still shows, posting still renders inline immediately

