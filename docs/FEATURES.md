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

### Sidebar discoverability & multi-file workflow (1.0.3)

- [x] **Threads sidebar always available on PR rich-diff pages** — used to early-return whenever no `.prose-diff` was visible (e.g. `/changes` before any file was toggled, single-heading READMEs). Now renders on every PR `/files` / `/changes` page so the floating bar is always findable. Source-diff / rich-diff toggle no longer hides it. See [DEV_NOTES.md → Keeping the threads sidebar in sync](./DEV_NOTES.md#keeping-the-threads-sidebar-in-sync).
- [x] **Sidebar header matches GitHub's link blue** — header (and the collapsed bar) use `--fgColor-accent` (`#0969da` light, `#2f81f7` dark). Reads as native GitHub UI; the collapsed bar is unmistakable against any page background.
- [x] **Keyboard shortcuts to call back / reset the sidebar** — `t` toggles collapsed/expanded; `Shift+T` clears persisted position/size/collapsed state and re-docks. Both run before the "must have cards" guard so they work in collapsed and Outline-only modes.
- [x] **Sidebar can't get stranded offscreen after window resize** — stored position is clamped against the current viewport on load and on debounced `window.resize`. The clamped value is **never written back** to localStorage, so re-enlarging the window slides the sidebar back toward the original drop point instead of leaving it stuck at the shrunken-window position.
- [x] **"Render all Markdown files as rich-diff" one-click action** — sidebar header book icon and primary CTA in the empty-state Threads pane. Scans the page top-to-bottom (0.8 × viewport steps, 100 ms dwell) behind a `Loading Markdown files…` overlay to force GitHub's lazy-rendered file headers, clicks each per-file Source→Rendered toggle, then restores the user's scroll position. Auto-expands the sidebar if collapsed when clicked. Early-exits when every expected `.md` file (count from `routeData.diffSummaries`) has been seen. See [DEV_NOTES.md → Render-all-md-as-rich-diff](./DEV_NOTES.md#render-all-md-as-rich-diff-103).
- [x] **Fold H1 button in the Outline toolbar** — joins `Fold H2` / `Fold H3` / `Expand all`. Collapses each document to just its title — useful for a bird's-eye view of which files changed without reading bodies.
- [x] **Outline tab shows even on single-heading files** — threshold lowered from ≥ 3 to ≥ 1 heading (matches the outer sidebar visibility change).

### Testing

- [x] **196 unit tests** for pure helpers (line matching, response parsing, markersMap parsing, table arithmetic, markdown preview, HTML escaping, time formatting, sidebar helpers incl. `isMarkdownPath`, heading slugify, outline tree + thread attribution + fold-at-level) using Node's built-in `node:test` — zero dependencies
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
- [x] **~~P1~~ — Deleted blocks drift downstream line numbers** (fixed in 1.0.1) — rich-diff still renders deleted content (wrapped in `<del>` / GitHub's prose-diff delete markers). The DOM walker used to treat those blocks like any other: tried to text-match against the **post-change** source, failed (the text isn't in the new file), and fell through to the `lastLine + 1` nudge. That nudge advanced `lastLine` once per deleted block, so every subsequent block was anchored that many lines too early — cumulative downstream drift on any diff with deletions. Fix: new `isInDeletedBlock(el)` helper detects `<del>` ancestors via a cheap tag-only walk; `buildLineMap()` now early-returns on those blocks (no `+`, no `lastLine` consumed). Commenting on deleted lines directly is a separate follow-up — see below.
- [x] **~~P1~~ — Source-diff doesn't reflect just-posted comments without page refresh** (fixed in 1.0.2) — after a successful post/reply/resolve/unresolve/edit/delete from rich-diff, a `sourceDiffDirty` flag is set. A `capture`-phase document click delegate watches for the user clicking GitHub's rich/source diff toggle (heuristic match against `aria-label` / `title` / `data-*` / textContent). When dirty + toggle clicked, we `window.location.reload()` after a 50 ms delay so GitHub's own navigation runs first. Users staying in rich-diff are unaffected. See [DEV_NOTES.md → Resolved issues](./DEV_NOTES.md#comment-box--inline-rendering).
- [x] **~~P2~~ — Stray underline styling on our comment box** (fixed in 1.0.2) — GitHub's prose-diff renderer wraps inserted blocks in `<ins>` (e.g. `<ins><p>…</p></ins>`). Our box was inserted via `element.after(box)`, which puts the node after the `<p>` but **still inside** the `<ins>`. CSS `text-decoration` painted by an ancestor propagates across all inline descendants regardless of the descendant's own `text-decoration` value — so every text run inside our injected UI (header, textarea placeholder, button labels, existing-thread body) inherited the underline. Fix: `siblingAnchor()` walks up from the anchor and, if it finds an `<ins>` / `<u>` ancestor inside the diff container, escapes to the topmost such ancestor; `.after()` then lands the box *outside* the underline-painting scope. Tag-only walk (no `getComputedStyle`) so render speed is unaffected. No CSS / Shadow-DOM rewrite needed. See [DEV_NOTES.md → Resolved issues](./DEV_NOTES.md#comment-box--inline-rendering).
- [x] **~~P1~~ — Code-block fence range hint** (fixed in 1.0.1) — the `(code block, lines N–M)` hint in the comment box header now shows the **actual fence range** read from the raw markdown source (e.g. backticks at lines 195 and 240 → hint reads `lines 196–239`), regardless of where in the block the user clicked. See [DEV_NOTES.md → Resolved issues](./DEV_NOTES.md#comment-box--inline-rendering).
- [x] **~~P1~~ — Per-bullet `+` button inside ordered/nested lists** (fixed in 1.0.1) — see [DEV_NOTES.md → Resolved issues](./DEV_NOTES.md#comment-box--inline-rendering).
- [ ] **P0 — Inline marker on rows / lines that already have a comment (tables, code blocks, any block that can't host an inline thread)** — comments on table rows and (often) on code-block lines are correctly attributed to the right source line, but the thread badge / comment box is rendered *after* the `<table>` or `<pre>` because injecting block-level content into `<tr>` / `<td>` (or splitting a syntax-highlighted `<pre>`) would break GitHub's table CSS / highlighting and the HTML parser rejects sibling nodes inside `<tr>`. That works for posting and replying, but for a PR **author** reviewing a long table or a long code block it's hard to see *which* row or line has a comment — every thread stacks at the bottom of the block with no in-place hint.

  **Step 1 (the visual mark — recommended MVP):** for every row / line that has at least one thread, mark it inline. The mark must work for both `<tr>` (tables) and per-line spans inside `<pre>` (code blocks), and is the first thing a PR author needs ("a mark is the first step — one wants to *know* there is a comment, and correlate it to the specific line"). Three rendering options, ordered by recommendation:
  - **(a) Coloured left rail + row-background tint** on the `<tr>` / line. Uses the same accent colour as the comment box so the link is visually obvious. Lowest implementation cost, highest scannability at distance.
  - **(b) Highlighted text span** wrapping the cell text (or the relevant `<code>` line). Same accent colour as the comment box's background. Mimics Google-Docs-style inline comment highlights.
  - **(c) Small `💬` chip in the last `<td>`** (the previous proposal's option (a)). Cheap but easy to miss on wide tables.

  **Step 2 (clickable navigation):** clicking the mark scrolls to (and expands) the corresponding below-block thread — mirrors how the Threads sidebar cards already navigate via `scrollToWithStickyOffset`. Without Step 2 the mark still earns its slot: it answers "is there a comment here?" which is the immediate gap today.

  **Out of scope here (already considered separately):** truly inline thread bodies on `<tr>` / inside `<pre>` — covered by the more ambitious options below.
  - (d) Overlay an absolutely-positioned floating thread aligned to the row's / line's bounding rect. Highest fidelity but expensive (re-position on resize / scroll / wrap).
  - (e) Inject an extra full-width `<tr>` after the commented row containing a single-cell `colspan=N` host for the thread. Plays poorly with sticky table headers and screen readers.

  **Why P0:** user-research feedback from 2026-06 specifically called this out — "it's hard for PR author to view comments for long tables (and anything that cannot have inline comments)." Same gap exists today for fenced code blocks where multiple comments on different lines all stack below the `<pre>`. The Threads sidebar partly mitigates this (you can scan the global list), but the *in-context* signal is still missing.
- [x] **~~P2~~ — Click-Y to line-number inside code blocks** (fixed in 1.0.1) — hovering anywhere inside a `<pre>` slides the `+` button vertically to follow the cursor's row, and clicking opens the comment box anchored to the hovered line (instead of always the fence's first line). See [DEV_NOTES.md → Resolved issues](./DEV_NOTES.md#comment-box--inline-rendering).

  **Why the `+` is only at the top of a code block today:** a fenced code block renders as a single `<pre>` element. Our `+` anchors at the top of each commentable block (one button per DOM node). We deliberately don't inject per-line `+` buttons inside `<pre>` because (a) it would break GitHub's syntax-highlighting span structure, and (b) GitHub's review-comment API only anchors at line granularity — a per-line `+` doesn't unlock anything we couldn't already do via the editable line-number input. The escape hatch today is the `(code block, lines N–M)` hint and editable line input in the comment box header.
- [ ] **P2 — Better matching for fenced prose code blocks** — currently goes through `stripMarkdown` which doesn't help raw code; match on the first non-empty line instead.
- [ ] **P3 — Better handling of HTML blocks** (`<details>`, raw `<table>` in source) — currently inherits previous line on miss.

### Features

Features below are in scope when they cover a workflow gap **on the rich-diff page itself**. Users currently have to click "View on GitHub" and leave the page to do most of these — that's the gap we'd fill.

- [x] **~~P1~~ — Edit own comments inline** (shipped in 1.0.1; `Edit` promoted to a direct one-click header link in 1.4.0) — each comment posted by the current user shows an `Edit` link in its header, peer affordance to `GitHub ↗`. Click opens an inline editor; Save calls `PUT page_data/update_review_comment?body_version=<sha256>`. The `⋯` menu used to host Edit alongside Delete; now `⋯` is Delete-only because edit is the common action and one-click matters more than menu density. See [DEV_NOTES.md → Resolved issues](./DEV_NOTES.md#comment-box--inline-rendering).
- [x] **~~P1~~ — Delete own comments inline** (shipped in 1.0.1) — `⋯` menu → Delete (with confirm), calls `DELETE page_data/review_comments/<dbId>`. If the deleted comment was the only one in a thread, the whole thread is removed. See [DEV_NOTES.md → Resolved issues](./DEV_NOTES.md#comment-box--inline-rendering).
- [ ] **P2 — React to comments (👍, ❤️, 🎉, …)** — small reaction-row at the bottom of each rendered comment. GitHub's GraphQL reaction mutations or the matching `page_data` endpoint. Without this, users must leave the page to react.
- [x] **~~P2~~ — Preserve scroll position after reply submit** (fixed in 1.0.1) — after submitting a reply (or edit/delete/resolve) in an expanded thread, GitHub's React store optimistically inserted a new `.markdown-body` node which tripped our `MutationObserver` → `scheduleReinit()` → full `init()` rebuild. `clearInjectedDom()` plus the re-render briefly removed every block we'd previously sized, resetting the page to `scrollY = 0` and forcing the user to scroll back. Fix: `scheduleReinit()` now captures `window.scrollY` before its 500ms debounce window and restores it after `init()` finishes, via `requestAnimationFrame` plus a microtask fallback for backgrounded tabs. URL-navigation re-inits go through `maybeInit` directly and still land at top — the restore only fires for mutation-driven re-inits.
- [ ] **P2 — Floating prev/next comment nav** — *folds into the [Threads sidebar](#) v1 header.* Standalone item kept here in case the sidebar slips; if so, this ships as a small fixed bottom-right widget with `↑` / `↓` and a `3 / 12` count badge.
- [x] **~~P1~~ — Prev / next *change* navigation (jump between added / removed / modified blocks)** (shipped in Unreleased) — distinct from the existing prev/next *comment* navigation (`j` / `k` on the threads sidebar): change-nav walks the rendered DOM's `.added` / `.removed` / `<ins>` / `<del>` wrappers in document order; comment-nav walks the `💬` badges. **Shipped:** a third **Changes** tab in the sidebar lists every reading-unit block (paragraph, list item, table row, code block, heading, blockquote) that contains a change marker, with a kind glyph (`+` added / `−` removed / `±` mixed), a coloured left rail per kind, a file:line label when discoverable, and the first 90 chars of the changed text. Click a card or press `[` / `]` (vim's `[c` / `]c` convention for prev/next change) to jump; the target block briefly pulses so the user sees where they landed. Visible separately in the sidebar header is a `◀ N/M ▶` cluster that mirrors the keys without opening the Changes tab; it sits next to the existing thread `↑ ↓` cluster with a subtle divider so the two nav concepts read as separate. Both the tab and the header cluster auto-hide when the page has zero change markers (rare — the truly-empty PR). Pure helpers in [src/lib/changes.js](../src/lib/changes.js) with 32 unit tests. **From 2026-06 user feedback**: *"When open a MD for PR for the first time, one common navigation required is jump to the next diff or previous diff so that one can comment. Maybe consider navigations for prev/next changes, and also navigations to the prev/next comments."* (The comment-nav side of that ask was already shipped via the sidebar in 1.0.1.)
- [ ] **P2 — Make comment badges more visually distinct from rendered markdown** — *largely subsumed by the [Threads sidebar](#) v1 (the sidebar is the at-a-glance overview).* If a sidebar-less mode is ever needed, the inline tweaks would be: (a) stronger left-border accent into the page gutter, (b) more saturated badge background, (c) subtle background tint on the entire commented block. Resolved threads are especially easy to miss inline since they're dimmed — the sidebar surfaces them properly.
- [x] **~~P2~~ — TOC anchor jumps in rich-diff** (fixed in 1.0.1) — clicking a heading link in a rendered markdown TOC (e.g. `[Change Log](#change-log)`) did nothing on a PR's rich-diff view. On a blob view GitHub stamps each heading with `id="user-content-<slug>"` and runs a small redirect script that maps `#change-log` → scroll to `#user-content-change-log`. On `/pull/<n>/changes` GitHub strips those ids entirely — same PR can modify multiple files with identically-named headings, and duplicate `id` would be invalid HTML. So the fragment was unmatched and the browser didn't scroll. Fix: new `slugifyHeading(text)` helper in [src/lib/anchors.js](../src/lib/anchors.js) (10 unit tests) plus `tryScrollToHashAnchor()` in content.js: listens for `hashchange` and runs once on init; when the hash has no matching DOM target, walks every `<h1>`–`<h6>` inside `.prose-diff .markdown-body` and slug-matches textContent; first match wins, scoped to the file matching `?file=<path>` when present.
- [ ] **P2 — "Unresolved only" filter** — *folds into the [Threads sidebar](#) v1 as a toggle at the top of the list.* If the sidebar slips, this ships as a separate toolbar toggle that collapses all resolved threads in the file.
- [ ] **P2 — Comment on deleted lines (LEFT side)** — follow-up to the deleted-blocks drift fix in 1.0.1. GitHub's source-diff lets you comment on deleted lines by posting with `side: "left"` against the BASE file's old line number; in rich-diff we currently render no `+` on `<del>` / `.removed` blocks at all. **Payload now verified** — see [DEV_NOTES.md → LEFT-side comments](./DEV_NOTES.md#left-side-comments-on-deleted-lines): only three fields differ from the RIGHT payload (`side`, `positioning.commitOid` swaps to base, `line` becomes the old line). **MVP scope:**
  1. Fetch BASE source per file alongside head (parameterize `fetchRawSource(path, oid)`, add base cache).
  2. Hoist base-OID discovery so it's available during `buildLineMap` (currently only resolved on first post).
  3. Classify each block as KEPT / ADDED / REMOVED via the `.removed` / `.added` / `<del>` / `<ins>` wrappers already detected by `isInDeletedBlock`.
  4. Dual forward-scan: REMOVED blocks match against base index (yield `{side: 'LEFT', line: oldLine}`), ADDED match against head (`RIGHT`, new line), KEPT match against both and store `RIGHT`.
  5. Visually differentiate the `+` on REMOVED blocks (red vs blue) so the side is obvious.
  6. Thread `side` through `openCommentBox` → `postReviewCommentInternal` → payload; build LEFT payload per the verified shape above.
  7. Render existing LEFT threads (`parseMarkersMap` already extracts `L<n>` keys) on the corresponding `<del>` blocks by matching on `(side, line)`.

  **Deferred to a follow-up after MVP:** multi-line LEFT ranges (need a captured multi-line LEFT payload first); cross-side ranges (drag from a kept line into a deleted line — likely rejected by the API; gate the drag); table rows mixed kept/removed (current row-arithmetic helper assumes monotonic source lines and may drift on tables with deleted rows). **Risk acceptances:** base blob fetch can fail on force-pushed branches where the old base SHA is gone — degrade gracefully (no `+` on deleted blocks, same as today); ~2× initial network cost on files with deletions, parallelized like the head fetch.
- [ ] **P2 — Floating table of contents** — *folds into the [Threads sidebar](#) v1.1 as an Outline tab.* Heading tree with per-section thread counts (`Architecture · 3 💬`), click-to-jump, active-section highlight. Builds from the same `H1–H6` set we already enumerate for collapse toggles.
- [ ] **P2 — Collapse-all / expand-all by heading level with progressive disclosure** — *folds into the [Threads sidebar](#) v1.1 Outline tab toolbar.* Buttons like "Collapse to H2" / "Expand all" that drive the existing per-heading collapse logic, filtering by `headingLevel(el) >= N`.
- [ ] **P2 — Persistent collapse state per file** — *folds into the [Threads sidebar](#) v1.2.* Store `{prNumber, filePath, collapsedHeadingIds}` in `sessionStorage` and replay on render.
- [ ] **P2 — Keyboard navigation between threads** — *folds into the [Threads sidebar](#) v1.* `j` / `k` for next / previous, `h` / `l` for first / last. Single-key bindings; only active when the sidebar has threads and the user isn't typing. Avoids GitHub's `g j` / `g k` chord (their "go to bottom / top of page" shortcut).
- [ ] **P2 — Quick-reply textarea inline in the badge** — *folds into the [Threads sidebar](#) v1.2 as a one-line input on each thread card.* Inline-in-badge variant kept as fallback if the sidebar slips: a textarea + Reply button right on the `💬 N comments` badge for "+1" / "done" replies without expanding the full thread.
- [ ] **P2 — Character-range (sub-line) comments via metadata convention** — let users select a word or phrase within a line and anchor a comment to that exact substring instead of the whole line.

  GitHub's review-comment API only supports line-level anchoring, so we can't post a true sub-line range. Workaround: encode the character range as **structured metadata inside the comment body** (e.g. a hidden HTML comment or a fenced YAML block at the start: `<!-- grdc-anchor: { "text": "user_agent", "occurrence": 1 } -->`). The line/file is still GitHub's native anchor; the metadata tells us which substring to visually highlight.

  Render path: on render of an existing thread, parse the metadata, find the substring in the rendered block (`occurrence`-indexed to disambiguate duplicates), wrap it in a `<span class="grdc-anchor-highlight">`, and anchor the thread badge to that span instead of the block. Editing path: drag-select text → "Add comment on this selection" → we record the substring and occurrence into the comment body before posting.

  Constraints:
  - Comments edited from GitHub's native UI may strip or reformat the metadata. Tolerate missing metadata gracefully (fall back to line-level anchor).
  - The metadata must survive GitHub's markdown sanitizer — HTML comments do, fenced code blocks do; arbitrary `<span>` tags probably don't.
  - Other tooling (notifications, PR search) sees the literal metadata in the comment body. Keep it terse and clearly marked.
- [ ] **P3 — Hunk-aware `+` visibility** — originally assumed GitHub's review-comment API only accepts comments on lines inside a diff hunk (± 3 context), and that clicking `+` outside would 422 with `"Line could not be resolved."`. **Empirically this is not the case** — verified 2026-05 on a real PR: an unchanged span (lines 143–158) accepted a comment on line 149 with no error. GitHub's actual constraint appears to be "any line in the post-change file within the comparison range," which rich-diff already respects since it renders the full file. The 422 message still exists in our error handler but seems to fire only in narrower cases (out-of-bounds line numbers, LEFT side without proper side flag, etc.). Keeping this as P3 in case a future regression makes hunk-awareness actually necessary; otherwise no action needed. Early attempt warning: don't use `diffSummary.markersMap` keys as a stand-in for valid lines — `markersMap` is markers-only (typically 3–4 keys for a long file), not hunk lines.
- [ ] **P2 — Threads sidebar** (umbrella) — a single collapsible right-hand panel that consolidates several navigation/reading-aid items below into one place. Inspired by Google Docs comments sidebar and [community/discussions/160981](https://github.com/orgs/community/discussions/160981) ("have them show in the sidebar to the right"). The sidebar also acts as a *minimap* — scanning all threads at a glance is the main answer to the "badges blend into prose when scrolling" problem.

  **v1 cut (shipped in 1.0.1):** ✅
  - [x] Right-docked collapsible panel; collapsed state persists in `localStorage`.
  - [x] **Draggable** (grab header) and **resizable** (bottom-right corner); position and size persist in `localStorage`.
  - [x] List of all threads on the current page in DOM order: author, snippet of first comment, status tags (resolved / outdated), file:line.
  - [x] Click a card → smooth-scroll to thread + brief flash highlight on the badge.
  - [x] Header: `↑` `n / total` `↓` prev/next buttons. Count badge updates as the user navigates. Visible even when the panel is collapsed.
  - [x] Keyboard shortcuts: `j` / `k` for next / previous thread; `h` / `l` for first / last. Ignored when typing into inputs / textareas / contenteditable. Only active when at least one thread exists. Deliberately avoids the `g j` / `g k` chord because that's GitHub's own "go to bottom / top of page" binding.
  - [x] "Unresolved only" toggle filters the list; state persists in `localStorage`.
  - [x] Rebuilds after every `renderExistingComments()` so post/reply/resolve stay in sync.
  - [x] Auto-hides when there are 0 threads on the page.
  - [x] Pure helpers (`buildSnippet`, `clampDragPos`, `nextWrappingIndex`) extracted to [src/lib/sidebar.js](../src/lib/sidebar.js) with 21 unit tests.

  **v1.1 (shipped in 1.0.1):** ✅ Outline tab — second tab in the sidebar header (alongside `Threads`). Persists active tab in `localStorage`.
  - [x] **Heading tree** of every `<h1>`–`<h6>` across all rich-diff prose bodies on the page, indented by level. When the PR has multiple modified `.md` files, groups headings under a file-path label.
  - [x] **Per-section thread counts**: for each heading, count threads whose anchor line falls between that heading and the next same-or-shallower-level heading. Rendered as `Architecture 3 💬` pill. File-scoped so threads in one file don't leak into another file's counts.
  - [x] **Click a heading** → smooth-scroll using the same sticky-offset path as `tryScrollToHashAnchor` (refactored into shared `scrollToWithStickyOffset` helper).
  - [x] **Active-section highlight** via `IntersectionObserver` with `rootMargin: '-120px 0px -70% 0px'` so the section "becomes active" once its heading scrolls under the sticky bar.
  - [x] **Collapse-all / Expand-all toolbar**: smart-toggle buttons label themselves `Fold H2` ↔ `Unfold H2` (and likewise for H3) based on current state — if any H<N> section is currently expanded, clicking folds the rest; if all are folded, clicking unfolds them. `Expand all` resets everything. Buttons auto-hide when no headings exist at that level.
  - [x] **Per-row chevron** (`▾` / `▸`) on every outline entry — click to fold or expand THAT specific section. Doesn't trigger scroll-to (stops propagation).
  - [x] **Outline mirrors document collapse state**: when any section folds — from the sidebar chevron, the toolbar buttons, or the heading's own collapse chevron in the document — the sidebar hides the descendant rows of that section. They reappear on expand. Implemented via a `grdc-section-toggled` custom event dispatched from `toggleSection`; the sidebar listens once at script load and rebuilds its Outline pane on every fire.
  - [x] Auto-hides the Outline tab when the page has fewer than 3 headings (Threads remains the only tab).
  - [x] Pure helpers (`buildOutlineTree`, `attributeThreadsToHeadings`, `collapseHeadingsAtLevel`) extracted to [src/lib/outline.js](../src/lib/outline.js) with 21 unit tests.

  **v1.2:** Persistent collapse state per file (`sessionStorage`); inline quick-reply textarea on each thread card (one-line input + Reply button) for "+1" / "done" replies without expanding the full thread.

- [x] **Thread display polish** (shipped in 1.0.1) — visual + UX upgrades to bring the inline thread experience closer to GitHub's native source-diff thread:
  - **Avatars** in every comment header (20×20 round, sourced from the route-data payload or `avatars.githubusercontent.com/<login>` fallback).
  - **Role badges** — matches GitHub native exactly: all six `author_association` values that GitHub renders (`Owner` / `Member` / `Collaborator` / `Contributor` / `First-time contributor` / `First-timer`), plus a separate `Author` pill when the comment author is the PR opener (compared against the PR author login from the page header). All pills share the same neutral chip styling (GitHub doesn't color-code by role). Both can appear together (`Owner` `Author`).
  - **Reply tint** — replies (every comment after the head) get a slightly deeper blue wash than the head comment, providing a "this is nested under" cue without changing the existing indent + rail.
  - **Disclosure chevron on the thread badge** — every inline `▾ N comments · line X` pill now has a CSS-rotated chevron (16×16 Octicon SVG) that swaps to point right when the thread is collapsed. Clicking the badge toggles the body open/closed, matching GitHub's native `▾ Comment on line R9` disclosure.
  - **Badge prominence** — inline `N comments · line X` pill bumped to 14px / 500 weight, with a 3px accent left stripe, asymmetric pill shape, and light shadow lift so it doesn't get skimmed past while scrolling long markdown.
  - **VS Code-style fold gutter** — heading collapse chevron moved out of the heading text and into a dedicated left gutter (absolute-positioned). Heading text no longer shifts when the chevron appears on hover. Order in the gutter: `+` comment button, fold chevron, heading text.
  - **Sidebar header polish** — hamburger / prev-chevron / next-chevron / funnel icons are all proper Primer-style SVGs at 16px. Prev/next are grouped via a `.grdc-sidebar-nav` wrapper so they read as a pair. The "Unresolved only" filter is mirrored to a header funnel icon that fades in when the sidebar is collapsed (outline by default at 55% opacity, fully visible on hover, fills solid + accent color when the filter is on). Thread count moved to the far right with muted color / 11px / 0.75 opacity so it reads as a passive hint rather than a primary control.
  - **Sidebar hides on source-diff view.** When the user toggles from rich-diff back to source-diff, the sidebar disappears automatically — driven by an `offsetParent` visibility probe on `.prose-diff` plus a click hook on the rich/source-diff toggle that re-runs `buildThreadsSidebar()` after a short delay.
  - **Sidebar size sanity floor.** Transient narrow renders during initial paint could previously be persisted as the user's preferred size. Persisted width/height below the CSS `min-width: 220px` / `min-height: 120px` are now ignored on both write and read, so the sidebar always starts at a sensible width.
  - **Truncated-snippet pill.** Sidebar cards whose body was character-truncated by `buildSnippet` (raw body longer than 80 chars) now show a small accent-blue `…` chip in the bottom-right corner of the card body, instead of a faint trailing dot. CSS line-clamp (visual wrap > 2 lines) still adds the browser's native ellipsis. Caller-driven via a `.grdc-sidebar-card-body-truncated` class so cards whose snippet fits are unadorned.
  - **Sidebar stays in sync with every mutation.** Post / reply / edit / delete / resolve / unresolve all refresh the sidebar — edit and delete via `scheduleReinit()` (because they can change the head snippet or head identity), the others via direct `buildThreadsSidebar()`. See `docs/DEV_NOTES.md → "Keeping the threads sidebar in sync"` for the decision table.
  - **Dark mode safety net** — `@media (prefers-color-scheme: dark)` overrides for the sidebar shell, header, list, cards, tabs, outline toolbar, and inline thread badge. Fixes a glaring light bar that appeared on GitHub pages where Primer's `--bgColor-accent-subtle` / `--bgColor-default` tokens weren't defined and our literal hex fallbacks fired.

  **Deferred to follow-ups:** always-visible reply textarea (tracked as a P3 item below); reactions on comments (tracked as P2 below); v1.2 sidebar items (per-file collapse persistence, inline quick-reply).

  **Items this absorbs from the rest of the list:**
  - Floating prev/next comment nav → sidebar header.
  - Keyboard navigation between threads (`j`/`k`) → same buttons, keyboard-driven.
  - "Unresolved only" filter → sidebar toggle.
  - Make badges more visually distinct → sidebar provides the at-a-glance overview that inline badges can't.
  - Floating table of contents → v1.1 Outline tab.
  - Collapse-all / expand-all by heading level → v1.1 Outline toolbar.
  - Persistent collapse state per file → v1.2.
  - Quick-reply inline in the badge → v1.2 (moved into the sidebar card instead of the inline badge).
  - Live update when new comments post elsewhere → the sidebar is the natural surface for the live counter / new-thread notification.
- [ ] **P3 — Apply "Suggested change" blocks from rich-diff** — GitHub's `suggestion` code blocks render correctly inside our threads (via `bodyHTML`), but the **Apply suggestion** / **Add suggestion to batch** buttons are React-bound on GitHub's native UI and inert in our injected DOM. Implement a custom Apply button that posts the suggestion as a commit via the same endpoint GitHub's native UI uses (likely `POST page_data/apply_suggestion` or a GraphQL mutation — needs investigation). Without this, reviewers can read suggestions in rich-diff but must switch to source-diff to apply them, which breaks the workflow. Relevant to design-doc review use case described in [community/discussions/186730](https://github.com/orgs/community/discussions/186730).
- [ ] **P3 — Live update when new comments post elsewhere** — *the [Threads sidebar](#) is the natural surface for this.* Poll or subscribe (the page already has GitHub's own websocket) for new comments on this PR while the user is viewing the file, increment the sidebar count badge live, and merge them into the rendered threads without a hard refresh.
- [ ] **P3 — Always-visible reply textarea in threads** — match GitHub's source-diff thread UX where the "Write a reply" input is rendered inline at the bottom of every thread, always ready for typing. Today our thread shows a small **Reply** button that expands into a reply box on click. The native flow removes that click — the user can start typing immediately. Low risk; mostly a render-on-build change (no toggle state, reuse the existing reply box construction). Trade-off: more vertical real estate per thread when collapsed isn't worth it for active reviews, but our threads are inline in prose and already visually heavy, so removing one click is a net positive. Defer until other thread polish lands so we can ship them together.
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
- [x] **~~P2~~ — Promo tile redesign** (shipped 2026-06-12) — the 2026-06 review flagged two problems with the original tiles (`design/promo-tiles/*.png`): the near-black radial gradient clashed with the solid GitHub-blue speech-bubble icon, and the long tagline (`"Inline review comments on GitHub PR rich-diff (rendered markdown)."` — 9 words) was unreadable at thumbnail size. **Both fixed:** background swapped to a GitHub-blue radial gradient (`#388bfd` centre → `#0969da` edges) so the icon's own blue blends into the same palette; a white rounded-rect badge with a soft drop shadow now sits behind the icon so the same-colour icon doesn't disappear into the background; tagline shortened to `"Comment, reply, resolve in rendered markdown."` (6 words, verb-led, mirrors the store short description). Headline stayed `Markdown PR Comments / for GitHub` since it naturally aligns with the new short prefix in the manifest name. Helper `DrawRoundedBadge` factored into [`design/promo-tiles/generate.ps1`](../design/promo-tiles/generate.ps1) for the badge drawing. **Open follow-ups (non-blocking):** per-tile tagline hide on the smallest 440×280 tile (already getting tight), Tile-B headline re-cut to emphasise the new short brand prefix, and a light-mode palette variant for A/B testing — none blocking the next store update.
- [x] **~~P0~~ — Link from this repo back to the store listings** (shipped 2026-06-12) — the Chrome Web Store and Edge Add-ons listings have been live (Unlisted) since 1.0.1 / 1.0.0 respectively, but the repo's [README.md](../README.md), [INSTALL.md](../INSTALL.md), and `docs/PUBLISHING.md` Status table all still said "pending review", and the GitHub repo **About** sidebar had an empty Website field. End-users who found the repo via search couldn't tell the extension was even published. Fix: replaced the commented-out placeholder URLs with the real `https://chromewebstore.google.com/detail/markdown-pr-comments-for/bdkcmcdfnhonfcpdgcmemkpcmnhnhemj` and `https://microsoftedge.microsoft.com/addons/detail/agomibenjlnikaldoddminkjbokfocgb` URLs in both user-facing docs; updated the Status table in `docs/PUBLISHING.md` to "Live (Unlisted)" with the actual URLs and current published version; set the GitHub repo's *Website* field to the Chrome Web Store URL and added the topics `browser-extension`, `chrome-extension`, `edge-extension`, `code-review`, `markdown`, `pull-request`, `github` via `gh repo edit`. **From 2026-06 user feedback**: *"The github for the extension does not provide a link back to the chrome store."*
- [x] **~~P2~~ — Shorter display name for store tiles + browser toolbar** (shipped in 1.5.0) — the previous name *"Markdown PR Comments for GitHub"* (32 chars) truncated in narrow store carousels, the browser toolbar tooltip, and the `chrome://extensions/` card title. **Shipped:** renamed to **`Markdown PR — Markdown PR Comments for GitHub`** using the "Short — Long" pattern (precedent: *uBO — uBlock Origin*, *Vimium — The Hacker's Browser*, *Dark Reader — Dark mode for any website*). In narrow contexts the leftmost `Markdown PR` survives truncation as a glanceable prefix; in wide contexts (toolbar hover, store detail page, screen readers) the full descriptive name shows. **Risk mitigation:** both store listings are currently Unlisted (don't appear in store search), so the "generic prefix may match unrelated keyword searches" risk doesn't bite yet — if visibility flips to Public later and analytics show a hit, the rename is a single-line revert in `manifest.json`. **From 2026-06 user feedback**: *"One way for the naming is 'Markdown PR - Markdown PR Comments for GitHub'. I saw that people do that so that a shorter name can be used, while having the longer name to make it clear the use case."* Implementation touched: `manifest.json` `name`, README.md + INSTALL.md + PRIVACY.md page titles, both `*_SUBMISSION.md` templates under [.github/skills/rdc-publish-check/templates/](../.github/skills/rdc-publish-check/templates/), `content.js` PAT-prompt copy, and a `Changed` entry in `CHANGELOG.md` mirroring the 1.2.0 rename style. Promo tiles in `design/promo-tiles/` still show the old name and need a regeneration in a follow-up.

### Onboarding & first-run experience (2026-06 user feedback)

The extension's value is **not discoverable from the page itself** the first time a user lands on a PR after installing — the `+` only appears on hover, the threads sidebar may already be collapsed, the rich-diff toggle is GitHub-native (not ours), and the `t` / `j` / `k` / `n` / `p` shortcuts are invisible. The items here close that gap without changing any of the underlying features.

- [ ] **P1 — UI-based walkthrough on first activation** — a small overlay tour that fires once on the first PR Files-changed page the user opens after install. Spotlight + caption pointing to: (1) the GitHub document-icon toggle on a `.md` file header (*"Click here first to render Markdown as rich-diff"*), (2) the gutter `+` button on hover over a paragraph (*"Hover any block, click `+`, post a comment"*), (3) the threads sidebar on the right edge (*"All review threads listed here — press `t` to toggle"*), (4) the *Render all Markdown files as rich-diff* book icon in the sidebar header (*"One click opens every .md file"*). Each step has a `Skip tour` and a `Don't show again` link; final step ends with a `Got it` and a `See docs` link to [INSTALL.md](../INSTALL.md). Track seen-state in `chrome.storage.local['grdc_fre_seen']` (single boolean — re-show on major-version bumps if a tour step changes materially, gated by a separate `grdc_fre_version` int). Keep the implementation light: a single absolutely-positioned overlay div + a step-state machine in `content.js` (no `popup.html`, no extension page). **From 2026-06 user feedback**: *"A first-run experience is still very useful as it's really not obvious how to use this without a UI-based walk-through."* The text-only walkthroughs in README / INSTALL aren't enough — most users never read them.
- [ ] **P2 — "Reload to activate" prompt after install on an already-open PR tab** — when a user installs the extension while a PR page is already open in another tab, the content script does **not** activate on that tab until it's reloaded. Today this is silent — the user toggles back to the PR they were just trying to comment on, sees nothing happen, and has no idea a hard refresh is needed.

  **Today's mitigation (shipped):** a "📌 Just installed?" tip is placed at the end of both [Chrome](../.github/skills/rdc-publish-check/templates/CHROME_SUBMISSION.md) / [Edge](../.github/skills/rdc-publish-check/templates/EDGE_SUBMISSION.md) store descriptions, mirrored in [README.md → Install](../README.md#install) (blockquote callout) and [INSTALL.md → Just installed?](../INSTALL.md#just-installed) (dedicated section above "How to use it"). This catches users who read the store description before clicking Install.

  **Approach A — toolbar badge (considered & rejected 2026-06-12):** background service worker listening for `chrome.runtime.onInstalled` paints a red `!` via `chrome.action.setBadgeText` + tooltip via `chrome.action.setTitle`; content.js clears the badge on successful init. **Zero new permissions** (the `action` API is MV3-default and `chrome.tabs.query` reads URLs matching our existing `host_permissions` without needing the broader `tabs` permission). Fully prototyped, all 196 unit tests passing, preflight green. **Rejected because Chromium hides extension icons behind the puzzle-piece menu by default** — a brand-new install has not yet had its icon pinned to the toolbar, so the `!` badge is invisible to precisely the users it would help. Triggers a Chrome / Edge store re-review (manifest structural change adding `background.service_worker`) for a signal most users won't see. The implementation lives in git history at the previous commit on this branch if a future contributor wants to revisit.

  **Approach B — in-page banner (proposed, deferred):** add `scripting` + `tabs` permissions, then from the background worker call `chrome.scripting.executeScript` on every matching `https://github.com/*/pull/*` tab to inject a single-line top-of-page banner: *"Markdown PR Comments for GitHub was just installed / updated. Reload this tab to activate."* with an inline **Reload** button (`chrome.tabs.reload(tabId)`) and a `Dismiss` ✕. Auto-removes on next page load. Skip the banner on tabs where the content script is already alive (`onInstalled` → message-existing-content-script handshake distinguishes fresh installs from updates of an already-running script). **Defer cost:** `tabs` is classified as "Web history" in Chrome's data-usage form → privacy policy update + reduced install conversion. Auto-update on multi-tab users (10 PR tabs all flashing the banner) is its own noise problem to solve. **Revisit when:** user feedback specifically says the text-only tip in the store description is being missed and the silent-broken state is hurting adoption.

  **From 2026-06 user feedback**: *"A tip on hard-refresh is also useful if it is installed after the PR page is loaded."*

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

