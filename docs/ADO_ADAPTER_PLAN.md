# ADO adapter — design & dev plan

Plan for extending this extension to Azure DevOps pull requests. Living doc — decisions here are proposals until validated by the probes in §11.

Related docs:
- [APPROACH.md](./APPROACH.md) — the GitHub strategy this ports from
- [FEATURES.md](./FEATURES.md) — the GitHub feature set this aims to match
- [DEV_NOTES.md](./DEV_NOTES.md) — where ADO-specific "gotcha" findings will land as we hit them

---

## 1. Motivation

The GitHub extension solves *"you can read the rendered markdown but you can't comment on it."* ADO has a related but **worse** problem: rendered markdown in PRs may not be a first-class review surface **at all**, depending on the current UI (§11.A). Porting is high-leverage because:

- ~66% of the code is DOM-agnostic and portable as-is (audit in previous session; see `src/lib/`).
- ADO users doing design-doc reviews have no good alternative today.
- Same codebase → improvements to the pure text-matching / outline / sidebar logic benefit both extensions automatically.

## 2. Goals

**In scope for v1 (ADO):**

- Ship a **separate Chromium extension** (Chrome + Edge) that runs on `dev.azure.com/*` and `*.visualstudio.com/*`.
- Feature parity with the GitHub extension's **P0 review surface** — see §7.
- Reuse `src/lib/` unchanged where possible; extract DOM selectors into a config the adapters share.
- One repo, two extensions (monorepo-lite; see §5).

**Non-goals for v1:**

- Native ADO Marketplace extension (`vss-extension.json` + SDK). Different auth model, different install story, deferred until browser-extension traction is proven.
- Feature parity for polish surfaces (preview tab, @mentions, render-all-md) — these depend on ADO API/DOM surfaces we haven't mapped yet.
- Cross-org / on-prem TFS support. Cloud ADO only.
- Any change to the GitHub extension's shipped behavior beyond the mechanical refactor described in §5.

## 3. Architecture decision: browser extension, not native Marketplace

Two paths were considered:

| | Browser extension (chosen) | Native ADO Marketplace |
|---|---|---|
| Code reuse from GitHub extension | ~66% direct | ~40% (only pure `src/lib/`) |
| Auth | Unknown until probe (§11.B) | SDK handles it, `SDK.getAccessToken()` |
| Install friction | User self-installs from Web Store | Org admin must approve per-org |
| Survives ADO UI redesigns | Fragile (CSS selectors) | Robust (SDK is a stable contract) |
| Time to prototype | ~1–2 days if auth cooperates | ~2 weeks |
| Publish cost | Chrome $5 one-time (already paid), Edge free | Free |

**Decision: browser extension first.** Native Marketplace is a possible follow-up if adoption warrants and if we hit a wall with browser-side auth or DOM stability.

## 4. Feature parity strategy

Match the GitHub extension **from the reader's perspective**, not from the internal architecture perspective. The user's mental model is *"click a block, leave a comment, done"* — everything else is plumbing.

Priority tiers (matching the convention in FEATURES.md):

- **P0** — ship blockers. Without these, the extension has no reason to exist.
- **P1** — fast-follow within a couple of releases. Users notice they're missing.
- **P2** — polish. Nice-to-have; ADO parity with the full GitHub feature set.
- **P3** — future / speculative. May never happen.

The matrix is in §7.

## 5. Repo structure (proposed refactor)

Small refactor of the current tree, done **before** any ADO code lands, so the GitHub extension keeps working unchanged while we split the adapter layer out.

**Today:**

```
rich-diff-comments/
├── manifest.json          ← GitHub extension
├── content.js             ← GitHub-specific adapter + entry
├── styles.css
├── src/lib/               ← pure logic (portable)
└── icons/
```

**Proposed:**

```
rich-diff-comments/
├── src/
│   ├── lib/               ← unchanged, shared
│   └── adapters/
│       ├── github.js      ← today's content.js, minus entry code
│       └── ado.js         ← new
├── extensions/
│   ├── github/
│   │   ├── manifest.json  ← moved from root
│   │   ├── content.js     ← thin entry: imports adapters/github + lib
│   │   ├── styles.css
│   │   └── icons/
│   └── ado/
│       ├── manifest.json  ← new
│       ├── content.js
│       ├── styles.css     ← ADO-themed variant (Fluent-ish, not Primer)
│       └── icons/
├── scripts/
│   └── package.ps1 -Target github|ado    ← parameterized allowlist
├── tests/                 ← shared; new tests get an `ado*` prefix
├── docs/                  ← this file lives here
└── package.json
```

**Chrome/Edge dev-load points at `extensions/github/` or `extensions/ado/`** (not the repo root anymore).

**Manifests can't reference `../../src/`** — Chrome rejects extension files above the manifest folder. Two options:
- **(A) Copy at build.** `scripts/package.ps1` and a small `scripts/dev-sync.ps1` copy `src/lib/` and needed adapter files into each `extensions/{target}/` before dev-load or packaging. Source of truth stays at the root; extension folders are effectively build output (git-ignored).
- **(B) Symlinks.** Works locally, brittle for packaging. Rejected.

**Chosen: (A) copy at build.** Add `extensions/*/src/` to `.gitignore`; the copy step becomes part of the loop.

### Splitting content.js — what stays vs. what moves

`content.js` today mixes three concerns:

1. **Init lifecycle** (SPA nav observer, feature-flag checks, first-render bootstrap) — stays in `extensions/github/content.js` as the entry point.
2. **GitHub adapter surface** (URL parsing, API calls, DOM selectors, payload shapes) — moves to `src/adapters/github.js`.
3. **Cross-cutting UI orchestration** (mounting comment boxes, wiring the sidebar, keyboard shortcuts) — moves to `src/lib/` if pure, or `src/adapters/github.js` if it depends on selectors.

Landmark boundary: **any function that references a `.markdown-body` / `.js-*` / `dotcom_user` cookie / `page_data/*` URL belongs in the adapter, not the lib.**

## 6. Auth strategy

**Decides the timeline.** Everything downstream depends on which of these three works:

### Option 1: Cookie auth (same-origin fetch to ADO REST API) — probe first

Content script on `dev.azure.com/*` calls `/{org}/{project}/_apis/git/repositories/{repo}/pullRequests/{id}/threads?api-version=7.1` with credentials. If ADO accepts session cookies for this endpoint (as it does for its own web UI), we're done — zero user setup.

**Unknown:** ADO's REST API is documented as requiring Bearer/Basic auth, but the web UI itself uses cookie-based session state. Whether the API accepts cookie auth for same-origin calls is the exact question §11.B answers.

### Option 2: PAT paste in options page

User generates a PAT in ADO with `vso.code_write` scope, pastes it into the extension options. Extension sends it as `Authorization: Basic {base64(':' + pat)}`.

Reliable but bad UX. PATs expire (max 1 year, default 90 days); users have to know how to generate them.

### Option 3: OAuth 2.0 via background service worker

Register an OAuth app at [app.vsaex.visualstudio.com/app/register](https://app.vsaex.visualstudio.com/app/register). Background worker handles auth-code flow, stores refresh token, injects Bearer into API calls.

Best UX, biggest implementation effort (~2 extra days). Requires public app registration with a real client secret handling story (which is awkward for a distributed browser extension — see [OAuth for public clients](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/oauth) for the workaround).

### Decision tree

```
Run auth probe on a real ADO PR (§11.B).
├── If cookie POST returns 200 → Option 1. Ship.
├── If it returns 401/403 with cookies alone
│   ├── If a Bearer token from the browser's session storage works → Option 1 (bearer-from-cookies variant)
│   └── Otherwise → Option 2 for v1, Option 3 for v2.
└── If ADO's CSRF requires a specific header we can read from the page (like `X-VSS-ForceMsaPassThrough` or session tokens) → Option 1 with extra header.
```

## 7. Feature parity matrix

Compared to the GitHub extension's shipped feature set (see FEATURES.md § Shipped).

| # | GitHub feature | ADO priority | ADO notes |
|---|---|---|---|
| 1 | `+` button on paragraphs / headings / list items / tables / code blocks in rendered markdown | **P0** | Requires §11.A to be answered — is there even a rendered-markdown PR view? |
| 2 | Click `+` → post comment → real PR thread on correct source line | **P0** | Endpoint: `POST /_apis/git/.../threads` with `threadContext.rightFileStart.line` |
| 3 | Existing threads shown as `💬` badges on matching block | **P0** | List: `GET /_apis/git/.../threads` |
| 4 | Reply to thread inline | **P1** | `POST /_apis/git/.../threads/{id}/comments` |
| 5 | Resolve / unresolve | **P1** | `PATCH /_apis/git/.../threads/{id}` with `status: 2` (fixed) / `1` (active) |
| 6 | Multi-line range comments | **P1** | `threadContext.rightFileStart.line` + `rightFileEnd.line` |
| 7 | Editable line-number input (for code blocks) | **P1** | Same UI, different DOM host |
| 8 | Table-row arithmetic | **P1** | Pure lib code; only needs adapter to hand it the right container |
| 9 | Comment editor with markdown toolbar | **P1** | Reuse `src/lib/sidebar.js` toolbar; drop the Preview tab initially |
| 10 | Preview tab (server-rendered) | **P2** | Depends on whether ADO exposes a `POST /_apis/git/.../preview` equivalent (probably not — likely need to render locally with `src/lib/markdownPreview.js`) |
| 11 | `@mention` autocomplete | **P2** | `GET /_apis/identities?searchFilter=General&filterValue={q}` |
| 12 | Threads sidebar | **P1** | Pure UI — port as-is |
| 13 | Outline tab | **P1** | Pure lib code |
| 14 | Section collapse by heading | **P2** | Pure lib code — trivial once §11.A is answered |
| 15 | Render-all-md-as-rich-diff button | **N/A** | Not needed on ADO. The Raw/Preview toggle is a **single, sticky, PR-wide setting** — pick Preview once and every `.md` file in the PR renders. GitHub's per-file toggle is what forced this feature; ADO doesn't have that problem. |
| 16 | Keyboard shortcuts (`t`, `Shift+T`, `1`/`2`/`3`) | **P2** | Pure UI |
| 17 | SPA navigation handling | **P0** | ADO is a heavier SPA than GitHub; expect this to be more work |
| 18 | Diagnostic logging (`[GRDC]` prefix) | **P0** | Copy pattern, change prefix to `[ADRC]` or similar |
| 19 | Author-role badges (`OWNER` / `MEMBER` / etc.) | **P3** | ADO's identity model is different — no `author_association` equivalent. Skip for v1. |
| 20 | Resolved-thread dim / auto-collapse | **P1** | Same UI logic; different status enum values |
| 21 | **Client-side diff highlighting in Preview** *(ADO-only)* | **P2** | ADO's Preview shows only the final rendered file with no visual indication of what changed (confirmed §11.A.1). Extension can fetch both source versions, run `stripMarkdown` on each, and mark changed blocks in the DOM with green/red bars. **Feature ADO doesn't have at all** — headline differentiator for the ADO extension. |

**v1 launch = everything marked P0 + P1.** ~14 features. Absent P2/P3.

### 7.1 Iterations H + I — Threads sidebar + integrated Outline (complete, 2026-08-26)

Build the navigation shell in one pass, then add Changes as a third tab in the
next iteration. The standalone Outline proved heading collection, ADO's inner
scroll-container behavior, and route-aware file switching; this iteration moves
that working behavior into the durable sidebar instead of maintaining two panels.

**Scope for this iteration:**

- One fixed floating `.adrc-sidebar` with **Threads** and **Outline** tabs.
- Header collapse toggle; collapsed mode keeps the header/tabs reachable.
- Drag by the header and resize from the lower-right corner.
- Persist position, size, collapsed state, active tab, visibility, and the
  unresolved-only filter in `localStorage`, with viewport clamping on restore.
- Threads pane is PR-wide: file path, source line/range, author, timestamp,
  status, and an 80-character first-comment snippet per card.
- Unresolved-only filter persists and affects only the Threads pane.
- Current-file cards are grouped first; the card nearest the active reading
  position is highlighted while scrolling.
- Clicking a current-file card scrolls to and expands its inline thread.
- Clicking a card for another file activates ADO's native file-tree row, then
  resumes the pending thread jump after route-aware Preview initialization.
  There is deliberately no generic-anchor or full-page URL fallback because
  either can remount the target file in Inline / Side-by-side mode.
- Existing standalone Outline rows move into the Outline tab unchanged:
  hierarchy indentation, click-to-scroll, active-heading tracking, and SPA file
  refresh. `b` shows the sidebar, expands it, and selects Outline.
- Injecting or updating the sidebar must not trigger Preview reinitialization.

**Explicitly deferred:** Changes tab/content, Changes counters, `[` / `]`
navigation, full shortcut suite, and multi-file Outline aggregation.

**Acceptance result:** state survives reload and ADO SPA file switches; no
duplicate sidebars or stale heading/thread references; current-file and
cross-file card clicks land on the intended inline thread without leaving
Preview. Manually verified on the sandbox PR. Automated result: 324 / 324
unit/static tests and 21 / 21 Playwright tests.

### 7.2 Iteration J — Changes tab (complete, 2026-08-26)

ADO Preview renders only the final document and exposes no `<ins>` / `<del>` /
`.added` / `.removed` markers. Therefore the GitHub Changes detector cannot be
ported directly. Build ADO Changes from a source comparison instead:

1. reuse the head source already fetched for line mapping,
2. fetch the same path at `lastMergeTargetCommit.commitId` (preferred) or the
   PR target branch as a fallback,
3. compute dependency-free line diff hunks in `src/lib/changes.js`, and
4. map each hunk's head-line range to reading blocks using the existing
   block→source-line map.

**Scope for this iteration:**

- Add **Changes** as the first sidebar tab, matching GitHub tab order:
  Changes / Threads / Outline. New installs default to Changes; existing saved
  tab state remains respected.
- Current-file Changes only. Cross-file aggregation waits until we cache line
  maps / sources for files that have not been opened.
- One card per affected rendered reading block, source ordered and deduplicated.
- Cards show `+` added, `−` removed, or `±` mixed; source line/range; and an
  80–90 character snippet.
- Clicking a card smooth-scrolls to the rendered block, highlights the active
  card, and briefly pulses the target block.
- Active card follows the actual ADO inner scroll container.
- Recompute after each route-aware Preview initialization; reject stale async
  base-source results when the user switches files during fetch.
- Added file / base-path 404: compare against empty source (all rendered blocks
  are additions). Deletion-only hunk: anchor to the next rendered block, or the
  previous block at EOF, and use deleted base text for the snippet.
- Base-source failure other than not-found: show a non-blocking Changes error;
  Threads, Outline, and inline comments continue working.
- No runtime diff dependency. Pure line-diff / block-mapping algorithms receive
  unit coverage in `tests/changes.test.js`.

**Explicitly deferred:** PR-wide Changes aggregation, deleted-file summary
cards, rename-aware old-path lookup, `[` / `]` shortcuts and header prev/next
cluster (full keyboard/navigation iteration), and semantic suppression of
Markdown syntax-only changes.

**Acceptance result:** changed headings, paragraphs, lists, table rows, and code
blocks appear once in source order; added/removed/mixed labels are correct;
card click and scroll tracking work through ADO's nested scrolling; file
switches rebuild without stale cards; and failure states do not affect Threads
or Outline. Manually verified on both a wholly new document and a partially
modified README. Automated result: 344 / 344 unit/static tests and 21 / 21
Playwright tests.

## 8. DOM adapter surface — what actually needs writing

Per the audit from the previous session, the new work is:

### 8.1 Selectors config (extend, don't rewrite)

Extract the hard-coded GitHub selectors in `src/lib/changes.js`, `src/lib/lineMap.js`, `src/lib/sectionCollapse.js` into a shared config object that both adapters populate:

```js
// src/lib/config.js (new)
export const GITHUB_SELECTORS = {
  richDiff: '.markdown-body, .prose-diff',
  insertedBlock: 'ins, .added',
  deletedBlock: 'del, .removed',
  frontmatterTable: '.prose-diff table:first-of-type',
  headingAnchorSuffix: '.anchor',    // GitHub's trailing anchor link inside <h*>
  // ...
};

export const ADO_SELECTORS = {
  richDiff: '.markdown-preview-container',   // confirmed 2026-07-22 from live DOM
  insertedBlock: null,                        // ADO Preview has no diff annotations (§11.A.1)
  deletedBlock: null,                         //   → our own diff-highlighting feature will inject them (§7 row 21)
  frontmatterTable: null,                     // TBD — test with a frontmatter-having file
  headingAnchorSuffix: '.shareHeaderAnchor',  // ADO's equivalent trailing anchor
  fileCard: '.repos-changes-viewer .bolt-card.bolt-card-white',  // one per file
  viewModeButton: 'button[aria-label="Preview"]',
  // ...
};
```

`sectionCollapse.js` already takes a `richDiffSelector` param — extend the same pattern to the other two files.

### 8.2 ADO adapter (`src/adapters/ado.js`)

Structured to mirror `src/adapters/github.js`:

```js
export function detectPRContext() { /* parse dev.azure.com URL */ }
export async function fetchThreads(ctx) { /* GET .../threads */ }
export async function createThread(ctx, { line, body, side }) { /* POST .../threads */ }
export async function addReply(ctx, threadId, body) { /* POST .../comments */ }
export async function setThreadStatus(ctx, threadId, resolved) { /* PATCH */ }
export function findMarkdownFileContainers(root) { /* returns rendered-markdown elements */ }
export async function getSourceMarkdown(ctx, filePath) { /* GET items?path=... */ }
```

Return-value shapes should match what `src/adapters/github.js` produces so `src/lib/` code doesn't care which adapter fed it. This is the contract — nail it before writing UI code.

### 8.3 New entry point (`extensions/ado/content.js`)

Thin. ~50 lines:

```js
import { init } from '../../src/lib/init.js';   // extracted from today's content.js
import * as adapter from '../../src/adapters/ado.js';
import { ADO_SELECTORS } from '../../src/lib/config.js';

init({ adapter, selectors: ADO_SELECTORS, logPrefix: '[ADRC]' });
```

## 9. Line mapping considerations for ADO

The forward-scan matcher in `src/lib/textMatch.js` and `src/lib/lineMap.js` doesn't care where the DOM came from — it just needs `{ blockElement, textContent }` pairs and the raw source text. So core mapping *should* work unchanged. Expected differences worth flagging as risks:

- **Frontmatter rendering.** GitHub renders `---`/`---` YAML as a 2-column table. ADO likely renders it differently (or not at all). If ADO strips frontmatter → the current frontmatter-masking logic is fine. If ADO renders it as prose → we may need a new masking rule.
- **Mermaid / diagrams.** ADO may not render mermaid at all in PR view. If they show as `<code>` blocks with the raw source visible → the current diagram-fence-blanking rule still works. If they show as SVG → same as GitHub. Confirm which.
- **Task lists.** Different DOM shape between the two. `src/lib/textMatch.js`'s `stripMarkdown()` should handle both since it operates on the source, not the DOM — but the DOM traversal in `content.js` today assumes GitHub's `<li>.task-list-item` wrapper. Adapter needs to normalize.
- **Table alignment separator (`|---|`).** Both renderers should hide it in the DOM. Table-row arithmetic in `src/lib/tableRows.js` is pure math and should be unaffected.

## 10. Testing strategy

Match FEATURES.md's convention:

- **Unit tests** (Node:test, in `tests/`) — any adapter logic that's pure (URL parsing, response-shape normalization) gets tests. Naming: `tests/adoAdapter.test.js`, `tests/adoResponses.test.js`, etc.
- **Playwright e2e** (in `tests/e2e/`) — capture ADO rich-diff HTML fixtures (§11 will provide the raw pages), test `+` button visibility, click behavior, line mapping. New fixtures in `tests/e2e/fixtures/ado-*.html`.
- **`npm test:all`** stays the single command; preflight adds an `-Adapter ado` flag or runs both by default.
- Don't add tests for the adapter's HTTP layer until §11.B settles auth — mocking the wrong shape wastes work.

## 11. Open questions — probes to run before writing code

**Do these first, in this order. Each blocks downstream work.**

### A. Does ADO PR "Files" view have a rendered-markdown mode? *(blocks §7 P0 items 1–3, §8.1, §8.3)*

**Answered 2026-07-22: YES.**

Findings:

- **Edited `.md` files** get a four-option view mode dropdown in the file header: **Side-by-side**, **Inline**, **Raw content**, **Preview**. Preview is the rendered-markdown mode we target.
- **Unedited `.md` files** in the PR (touched but not diffed? or context-only?) don't get all four options — behavior worth confirming during adapter work.
- The toggle is a **single, sticky, PR-wide setting** — pick Preview once and it applies to every `.md` file for the rest of the PR session. This is *better* than GitHub, and it kills the need for the "render all md as rich-diff" feature (§7 row 15 marked N/A).
- ADO's markdown renderer supports the `[[_TOC_]]` extension — headings become clickable anchors and the auto-TOC works. That means our outline-extraction code (which just walks `h1`–`h6` DOM nodes) should port unchanged.

**DOM shape captured 2026-07-22** from a live Preview render (`README.md` in the sandbox PR):

- **Container**: `<div class="markdown-content markdown-editor-preview flex-grow markdown-preview-container scroll-hidden markdown-preview-checkbox-indent">`. Cleanest selector: **`.markdown-preview-container`** (or `.markdown-content.markdown-preview-container` if we want to be defensive).
- **Headings**: `<h1 id="user-content-getting-started">Getting Started<a href="..." class="shareHeaderAnchor" ...></a></h1>`.
- **Heading ID convention**: `id="user-content-{slug}"` — **identical to GitHub's convention**. Our `src/lib/anchors.js` slugify + our outline extraction should work with zero changes.
- **Anchor link class**: `.shareHeaderAnchor` (GitHub uses `.anchor`). Adapter concern: our button-attachment code that inserts a `+` next to headings may need to walk past this trailing anchor.
- **Standard tags**: `<h1>`–`<h6>`, `<p>`, `<ol>`, `<li>` — no unusual wrappers observed. No `.js-*` internal marker classes like GitHub sprays around. Cleaner DOM overall.
- **Layout parent**: `.repos-changes-viewer .bolt-card.bolt-card-white` — the card that wraps a single-file preview. Multiple files means multiple `.bolt-card` blocks stacked. Adapter iteration walks these.
- **View-mode dropdown button**: `button[aria-label="Preview"]` — useful for detecting current mode. The split-button dropdown for changing modes: adjacent `bolt-split-button-option`.
- **Route ID references discovered in `<script class="vss-contribution-data">`**: `ms.vss-code-web.pull-request-details-route`, `ms.vss-code-web.pull-request-details-page-component`. Confirms SPA routing model — no full page reload on file switch.

### A.1 Sub-question: does Preview show diff annotations, or just the modified rendering? *(shapes UX expectations)*

**Answered 2026-07-22: JUST THE MODIFIED RENDERING.**

Sandbox test: replaced "Latest releases" with "test replace" and added a new "Section to Add" heading. Switched to Preview:

- The `<ol>` shows `<li>test replace</li>` — no visual indication it changed from a previous value.
- The deleted list item ("Latest releases") is not shown at all.
- The new heading ("Section to Add") is rendered normally alongside pre-existing headings, no highlight or badge.

**Implication:** Preview is a "final rendered" view, not a "diff-annotated rendered" view. Two consequences:

1. **Commenting UX is actually simpler than GitHub's.** Every block is commentable regardless of change status — no need for the extension to distinguish "added / removed / unchanged" surfaces the way GitHub's rich-diff forces us to.
2. **Real differentiator opportunity.** The extension could compute rendered-block diffs client-side (fetch both source versions, run `stripMarkdown` on both, mark changed blocks in the DOM with green/red bars). This is a feature *ADO doesn't have at all*. Adds ~1–2 days of work but becomes a headline capability. Tracked as new **§7 row 21** below and a proposed P2 for v1.1.

### B. Auth probe *(blocks §6 decision)*

In DevTools console on an ADO PR page:

```js
fetch('/_apis/git/repositories/{repoId}/pullRequests/{prId}/threads?api-version=7.1', {
  method: 'POST',
  credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    comments: [{ parentCommentId: 0, content: 'auth probe', commentType: 1 }],
    status: 1,
    threadContext: { filePath: '/README.md', rightFileStart: { line: 1, offset: 1 }, rightFileEnd: { line: 1, offset: 1 } }
  })
}).then(r => console.log(r.status, r.headers.get('content-type')));
```

- `200 / 201` → Option 1 works. Delete the throwaway thread from the UI.
- `401 / 403` → capture the response headers; check for `WWW-Authenticate` hints, then fall back to Option 2/3.
- `400` with a validation error → auth is fine, request shape is wrong; iterate on the payload and re-run.

### C. Existing-thread listing shape *(blocks §7 P0 item 3)*

```js
fetch('/_apis/git/repositories/{repoId}/pullRequests/{prId}/threads?api-version=7.1', {
  credentials: 'same-origin'
}).then(r => r.json()).then(console.log);
```

Capture the shape. Interested in: `threadContext.filePath`, `threadContext.rightFileStart.line`, `comments[]`, `status`, `isDeleted`, `pullRequestThreadContext.trackingCriteria` (ADO tracks threads across commits — different model from GitHub's outdated-thread concept).

### D. SPA route detection *(blocks §7 P0 item 17)*

Navigate between PR files without a full reload. What DOM changes? `MutationObserver` on which root? Are there ADO-specific route events like GitHub's `pjax:end`? A `history.pushState` monkey-patch will work as fallback but native events are cheaper.

### E. Repo/PR/file identifiers in URL and DOM *(blocks §8.2 `detectPRContext`)*

ADO PR URL shape: `https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{prId}?_a=files`.

But the REST API needs `repositoryId` (GUID), not repo name. Where does the loaded page expose it? Options: embedded `<script>` JSON blob, meta tag, or an initial-config fetch. Capture with:

```js
JSON.stringify(Object.keys(window)).match(/[a-z]*[Cc]onfig[a-z]*/g)
```

and inspect the promising ones.

## 12. Rollout plan

1. **Sandbox ready** — done (`chienyuanchang` org, README PR staged).
2. **Run probes A–E** in the sandbox PR. Capture findings into DEV_NOTES.md under a new `## Azure DevOps` section.
3. **Repo refactor** (§5) as a standalone PR that touches zero behavior. All 288 tests still pass. GitHub extension zip byte-identical (verified via preflight).
4. **Selector config extraction** (§8.1) as a second standalone PR.
5. **`src/adapters/ado.js` skeleton + auth** — no UI yet, just callable from DevTools.
6. **P0 features** (matrix rows 1–3, 17–18). Manual test in sandbox PR. First installable Chrome/Edge build.
7. **Private alpha** — install locally, dogfood on the sandbox and one or two internal test PRs.
8. **P1 features** (matrix rows 4–9, 12–13, 20). Second alpha build.
9. **Store submission prep** — new `CHROME_SUBMISSION_ADO.md` / `EDGE_SUBMISSION_ADO.md`, new privacy statement scoped to ADO endpoints, new listing copy, new promo tiles reusing the existing icon design.
10. **Public v1.0** — ship to Web Store + Edge Add-ons under a distinct extension name (e.g. "Markdown PR Comments for Azure DevOps").
11. **P2 features** as follow-up minor releases, driven by user feedback.

## 13. Risks & unknowns (short version)

| Risk | Likelihood | Mitigation |
|---|---|---|
| ADO has no rendered-markdown PR view (§11.A negative) | Medium | Inject own rendered view; bigger scope but bigger differentiation |
| Cookie auth blocked (§11.B negative) | Medium-high | Fall back to PAT paste; add OAuth as v2 |
| ADO DOM churn breaks selectors between our releases | Medium | Selector config in one place (§8.1); e2e fixtures catch regressions |
| GitHub extension's shipped behavior changes during refactor | Low | Refactor is a standalone PR; all 288 tests + full manual smoke before merge |
| ADO threading semantics differ enough to leak into `src/lib/` | Low-medium | Normalize in the adapter return shape (§8.2); keep lib pure |
| End users need corporate ADO org admin to install a browser extension | Very low | Browser extensions install per-user; no ADO permission needed to *use* the extension (only to *comment*, which the user already has if they can post in the UI) |

## 14. Decision log

Append as decisions get made / revised.

- **2026-07-22** — Chose browser-extension path over native ADO Marketplace extension (§3).
- **2026-07-22** — Chose monorepo-lite structure over separate repo (§5). Rationale: `src/lib/` sharing is the whole win.
- **2026-07-22** — Chose copy-at-build over symlinks for the shared `src/` (§5). Rationale: store-packaging safety.
- **2026-07-22** — §11.A answered YES: ADO has a Preview mode on edited `.md` files (four-option dropdown: Side-by-side / Inline / Raw content / Preview). Straight port, not injected-view scope.
- **2026-07-22** — Dropped §7 row 15 ("render all md as rich-diff") from the ADO scope. ADO's Preview toggle is PR-wide and sticky, so the problem the feature solved on GitHub doesn't exist here.
- **2026-07-22** — Confirmed ADO markdown renderer supports `[[_TOC_]]` and heading anchors; outline extraction should port unchanged.
- **2026-07-22** — §11.A.1 answered: Preview shows *final rendered only*, no diff annotations. Simpler commenting UX than GitHub. Added §7 row 21 ("client-side diff highlighting") as an ADO-only P2 differentiator.
- **2026-07-22** — Captured concrete DOM shape from sandbox PR: container `.markdown-preview-container`, heading IDs `user-content-{slug}` (matches GitHub — `src/lib/anchors.js` ports unchanged), trailing anchor `.shareHeaderAnchor`, per-file wrapper `.repos-changes-viewer .bolt-card`.
- **2026-07-22** — API URL pattern uses **project GUID**, not project name: `/{org}/{projectId}/_apis/git/repositories/{repoId}/...`. Adapter's `detectPRContext` must resolve project + repo GUIDs; both are available on the page — sandbox exposes `73c3ed77-d171-4732-9839-62c8f27fbfb4` (project) and `9362a044-225f-4afc-a7ca-5f9a11ec2ab1` (repo).
- **2026-07-22** — Auth is MSAL-based (silent token acquisition on page load, per console logs). Content-script cookie-auth may or may not be sufficient; §11.B probe still needs to run.
- **2026-07-22** — **§11.B read probe answered: cookie auth works.** GET `/{org}/_apis/git/repositories/{repoId}/pullRequests/{prId}/threads?api-version=7.1` with `credentials: 'same-origin'` returned `200` with `{value: [...], count: 2}`. Response header `x-vss-userdata: {userId}:{email}` confirms ADO authenticated the request via session cookies alone — no `Authorization: Bearer` needed. §6 Option 1 is our path; PAT / OAuth deferred to fallback status only.
- **2026-07-22** — **§11.B write probe answered: cookie auth works for POST too.** POST to the same endpoint with `Content-Type: application/json` and a real `threadContext.filePath` + `rightFileStart.line` payload returned `200` with a full thread object. No CSRF token required, no MSAL bearer required. Count went from 2 to 3 to confirm. Full raw response captured at `local-only/ado-samples/thread-create-response.json`. Auth story fully unblocked.
- **2026-07-22** — **P1 endpoint probes complete.** Reply / resolve / unresolve / edit-comment / delete-comment all verified in one batch. Full captured shapes at `local-only/ado-samples/all-probes.json`. Key learnings folded into §15 below: (a) system threads have no `status` and no `threadContext` (filter them out of user thread lists); (b) POST-reply and PATCH-comment return only the affected comment, while PATCH-thread returns the full thread — adapter cache must handle both patterns; (c) DELETE-comment soft-deletes: comment stays in the array with `isDeleted: true` and no `content`.
- **2026-07-22** — **§12 step 3 (repo refactor) complete.** GitHub extension physically moved into `extensions/github/`; new `scripts/dev-sync.ps1` mirrors `src/lib/*.js` and `PRIVACY.md` into each target folder before packaging; `scripts/package.ps1`, `preflight.ps1`, `release-prep.ps1`, `github-release.ps1` all parameterized on `-Target github|ado` (default github) and updated to read from the new paths. Test files updated for the moved `styles.css` / `content.js` locations; e2e helper resolves shared `src/lib/*` from repo root and extension-specific files from `extensions/github/`. Verification: **284 / 284 unit tests pass**, **20 / 20 e2e tests pass in isolation** (1 pre-existing cross-file mouse-state flake in full-suite runs, not caused by the refactor), zip build at 127.5 KB with 20 correct top-level entries, preflight `-VerifyZip` green (also fixed a latent path-separator bug where `Compress-Archive` stores backslashes but manifest paths use forward slashes). Docs updated to point at the new layout in Batch 2. Batch 1 was a standalone commit with zero user-visible behavior change.
- **2026-07-22** — **§12 step 5 (ADO adapter skeleton) complete + end-to-end validated.** `src/adapters/ado.js` implements the P0+P1 endpoint surface (parsePRUrl, resolveIds, listThreads, createThread, reply, resolveThread/unresolveThread, editComment, deleteComment) with cookie-authenticated fetches. `extensions/ado/` loads on `dev.azure.com/*/_git/*/pullrequest/*` and legacy `*.visualstudio.com` URLs. **No UI yet** — `content.js` is a thin bootstrap that parses the PR context and exposes `window.ADORC_probe` for DevTools testing. Manifest declares `"world": "MAIN"` so the probe is visible in the console's default context without users having to change context (chrome.* APIs unavailable in MAIN world, but skeleton doesn't use them — revisit if we later need `chrome.storage` or messaging). `scripts/dev-sync.ps1` extended to also mirror `src/adapters/<target>.js`. Tests: 300 unit tests passing (16 new adapter tests covering URL parsing, path normalization, system-thread filter, URL builders). Package: 43 KB zip, 21 correct top-level entries. **Manual smoke test on the sandbox PR**: `probe.ready()` resolved the repo GUID via the org's repos API; `probe.list()` returned 4 threads and correctly filtered 2 system RefUpdate threads out to leave 2 user threads; `probe.create()` created a new thread (id 5) on `/README.md:3`; `probe.resolve(5)` flipped it to `status: "fixed"`; `probe.delete(5, 1)` soft-deleted its root comment. Full adapter path is production-viable — ready to layer UI on top.
- **2026-07-22** — **Line-mapping validated on ADO with zero `src/lib/` changes.** Added `getPullRequest()` and `getFileSource()` to the adapter plus `pullRequestUrl()` / `itemUrl()` builders (project-scoped items endpoint with `versionDescriptor.version=<branch>` + `includeContent=true`). Wired `src/lib/textMatch.js` + `tableRows.js` + `lineMap.js` into the ADO manifest so `window.GRDC.mapBlocksToSourceLines` is available in-page. New `probe.detectLines(filePath)` fetches the file source at the PR's source branch, runs the block→line matcher against the visible `.markdown-preview-container`, and `console.table`s the result. **Sandbox test result**: **14/14 blocks mapped to correct source lines** on the sandbox PR's README.md — including the modified list item (line 8 "test replace"), a newly added H1 heading (line 17 "Section to Add"), and its new paragraph (line 18). Log: `[GRDC] Mapped 14 elements for /README.md (source-matched: true, text-hits: 13)`. This proves the entire pure-logic port from the audit works on ADO's DOM without modification — same forward-scan text matcher, same edge-case handling. Tests: 305 passing (5 new URL-builder tests for `pullRequestUrl` and `itemUrl` covering project scope, missing-project fallback, versionDescriptor, path normalization). Ready to start P0 UI (`+` button + comment box).
- **2026-08-26** — **Iterations H + I complete: Threads sidebar + integrated Outline.** Replaced the standalone Outline panel with one draggable, resizable, persistent sidebar containing PR-wide Threads and current-file Outline tabs. Threads support file grouping, unresolved-only filtering, active-thread tracking, same-file scroll/expand, and cross-file pending jumps. Live testing exposed that generic `?path=` anchors / `window.location.assign()` remount ADO and reset Preview to Inline or Side-by-side (visible as a second MSAL/content-script initialization). Final architecture activates the native `[role="treeitem"]` / `.bolt-tree-row` cell instead, retains a one-shot safe Preview-menu restoration fallback, and intentionally fails with a toast when no materialized tree row exists rather than abandoning Preview. Manual sandbox result: same-file and cross-file thread navigation work while staying in Preview; Outline remains route-aware. Validation: 324 / 324 unit/static tests and 21 / 21 Playwright tests.
- **2026-08-26** — **Iteration J complete: current-file Changes tab.** Because ADO Preview exposes no diff markers, Changes compares the already-fetched head Markdown with the same path at `lastMergeTargetCommit`, computes dependency-free Myers line hunks, and maps those hunks to the existing rendered block→line map. Cards show added / removed / mixed kind, line range, and snippet; active cards follow ADO's real scroll surface. A target-commit `404` is expected for a newly added file and is treated as an empty base (all rendered blocks added). Live testing also proved that one inferred scroll container is insufficient on some modified-file layouts; final navigation re-resolves the current block, expands containing folded sections, uses native `scrollIntoView()` to traverse nested ADO scrollers, preserves sticky offset with `scroll-margin-top`, and verifies/falls back when smooth scrolling does not start. Manually verified on a new 155-block design document and three modified README blocks. Validation: 344 / 344 unit/static tests and 21 / 21 Playwright tests.

## 15. Appendix — ADO thread response shape (redacted)

Captured 2026-07-22 from the sandbox PR. Real fixture (with identity IDs) lives at `local-only/ado-samples/thread-create-response.json` (git-ignored). Use this as the shape reference when writing the adapter's `normalizeThread()` — the output shape our `src/lib/` code expects should be equivalent to what `src/adapters/github.js` produces from GitHub's response.

### Thread object (top level)

| Field | Type | Notes |
|---|---|---|
| `id` | int | Per-PR thread ID (integer, not GUID). Sequential. |
| `status` | string | `"active"` / `"fixed"` / `"wontFix"` / `"closed"` / `"byDesign"` / `"pending"` / `"unknown"`. **Note asymmetry**: create-request sends `status: 1` (int), response returns `"active"` (string). Send int, receive string. |
| `isDeleted` | bool | Soft-delete flag |
| `publishedDate` | ISO8601 string | Thread creation time |
| `lastUpdatedDate` | ISO8601 string | Any comment add/edit/status change |
| `comments` | array | See below |
| `threadContext` | object | See below — file + line anchoring |
| `pullRequestThreadContext` | object | ADO cross-iteration tracking (see below) |
| `properties.Microsoft.TeamFoundation.Discussion.UniqueID` | wrapper | Server-generated GUID. Don't send on create; don't rely on for our own logic. |
| `identities` | object or null | Mentioned users. `null` in the sample. |
| `_links` | object | HATEOAS — `self`, `repository`. Not needed for adapter logic. |

### `threadContext` — where the thread is anchored

| Field | Type | Notes |
|---|---|---|
| `filePath` | string | Leading slash: `/README.md`. Normalize in adapter. |
| `rightFileStart.line` | int | 1-based. Line in the **modified** version. |
| `rightFileStart.offset` | int | 1-based **column**. Use `1` for full-line comments. |
| `rightFileEnd.line` | int | Same, for range end. Equals start for single-line. |
| `rightFileEnd.offset` | int | Column end. |
| `leftFileStart.*` / `leftFileEnd.*` | optional | Present when comment is on the *original* side (for deleted lines). Not observed in the sample. |

### `pullRequestThreadContext` — ADO's cross-iteration tracking

ADO tracks a PR as a sequence of "iterations" (pushes to the source branch). This block records which iteration a thread was created against and lets ADO decide if a thread is still relevant after a subsequent push.

| Field | Type | Notes |
|---|---|---|
| `iterationContext.firstComparingIteration` | int | "From" iteration when the thread was created |
| `iterationContext.secondComparingIteration` | int | "To" iteration |
| `changeTrackingId` | int | ADO's internal handle for tracking a thread across iterations. Not something we set. |

**Adapter implication:** ADO has no direct equivalent of GitHub's `isOutdated`. Instead, threads may become "orphaned" (their anchored lines don't exist in the current iteration). We'll need a heuristic — probably "line no longer exists in current rendered markdown" — to derive an equivalent "outdated" flag for our UI's dimming logic.

### `comments[]` — individual comments in the thread

| Field | Type | Notes |
|---|---|---|
| `id` | int | Per-thread comment ID (1-based ordinal) |
| `parentCommentId` | int | `0` for top-level; comment ID for replies |
| `content` | string | **Raw markdown**, not rendered HTML. ADO doesn't return a `bodyHTML` equivalent — we'll need to render client-side using `src/lib/markdownPreview.js`. |
| `commentType` | string | `"text"` (normal), `"codeChange"`, `"system"` (auto-added lifecycle events) |
| `author` | object | See below |
| `publishedDate`, `lastUpdatedDate`, `lastContentUpdatedDate` | ISO8601 strings | Note the extra `lastContentUpdatedDate` (edits) vs. `lastUpdatedDate` (any change) |
| `_links` | object | Comment/thread/repo/PR self-links |

**Adapter implication:** GitHub returns pre-rendered `bodyHTML`, ADO returns raw `content`. Our `renderCommentBody(comment)` helper needs to branch: return `bodyHTML` on GitHub, run `content` through the markdown renderer on ADO. This is exactly what `src/lib/markdownPreview.js` exists for.

### `author` object — identity

| Field | Type | Notes |
|---|---|---|
| `id` | GUID string | Stable identity ID |
| `displayName` | string | Human-readable |
| `uniqueName` | string | Email or MSA identifier |
| `descriptor` | string | Internal identity descriptor (`msa.{base64}`, `aad.{base64}`, etc.) |
| `imageUrl` | URL | Avatar |
| `_links.avatar.href` | URL | Also avatar (usually same as `imageUrl`) |

**No `author_association` equivalent** (no OWNER / MEMBER / CONTRIBUTOR roles) — confirms §7 row 19 stays P3.

### Create-request payload (minimum viable)

```json
{
  "comments": [
    { "parentCommentId": 0, "content": "...", "commentType": 1 }
  ],
  "status": 1,
  "threadContext": {
    "filePath": "/path/to/file.md",
    "rightFileStart": { "line": N, "offset": 1 },
    "rightFileEnd":   { "line": M, "offset": 1 }
  }
}
```

Int enum reference:
- `status`: `1` = active, `2` = fixed, `3` = wontFix, `4` = closed, `5` = byDesign, `6` = pending
- `commentType`: `1` = text, `2` = codeChange, `3` = system

## 16. Appendix — P1 endpoint reference

Captured 2026-07-22 in a single probe batch. Full raw fixture: `local-only/ado-samples/all-probes.json`.

### Endpoint URL summary

| Operation | Method | Path |
|---|---|---|
| List all threads | `GET` | `/{org}/_apis/git/repositories/{repoId}/pullRequests/{prId}/threads?api-version=7.1` |
| Create thread | `POST` | `/{org}/_apis/git/repositories/{repoId}/pullRequests/{prId}/threads?api-version=7.1` |
| Reply to thread | `POST` | `/{org}/_apis/git/repositories/{repoId}/pullRequests/{prId}/threads/{threadId}/comments?api-version=7.1` |
| Resolve / Unresolve | `PATCH` | `/{org}/_apis/git/repositories/{repoId}/pullRequests/{prId}/threads/{threadId}?api-version=7.1` → `{ "status": 2 }` or `{ "status": 1 }` |
| Edit comment | `PATCH` | `/{org}/_apis/git/repositories/{repoId}/pullRequests/{prId}/threads/{threadId}/comments/{commentId}?api-version=7.1` → `{ "content": "..." }` |
| Delete comment | `DELETE` | `/{org}/_apis/git/repositories/{repoId}/pullRequests/{prId}/threads/{threadId}/comments/{commentId}?api-version=7.1` |

All accept cookie auth (`credentials: 'same-origin'`). No CSRF header required. No `Authorization: Bearer` required.

### Response-shape asymmetry (matters for adapter cache)

| Operation | Response body | Adapter action after success |
|---|---|---|
| `POST` thread (create) | Full new thread with all comments | Insert into cache directly |
| `POST` comment (reply) | **Just the created comment** | Splice into cached parent thread's `comments[]`; OR re-fetch thread |
| `PATCH` thread (resolve/unresolve) | Full updated thread | Replace cached thread |
| `PATCH` comment (edit) | **Just the updated comment** | Replace matching comment in cached thread |
| `DELETE` comment | **Empty body, 200 status** | Locally set `isDeleted: true` + drop `content`; or re-fetch thread |

Mirror this in the adapter's return shape so `src/lib/` code always receives "here's a normalized thread" — don't leak the raw asymmetry upward.

### System threads — filter these out of the user thread list

ADO auto-generates threads for lifecycle events (branch pushes, PR status changes, policy evaluations, etc.). In the sandbox PR we saw two `"CodeReviewThreadType": "RefUpdate"` threads for the initial push and one subsequent push.

Distinguishing marks:

| Field | User thread | System thread |
|---|---|---|
| `commentType` (on comments[0]) | `"text"` | `"system"` |
| `threadContext` | Object with `filePath` + `rightFileStart` | `null` |
| `pullRequestThreadContext` | Object with `iterationContext` | `null` |
| `status` | `"active"` / `"fixed"` / etc. | **Field entirely absent** |
| `properties.CodeReviewThreadType` | Absent | `"RefUpdate"`, `"StatusUpdate"`, `"CommitsPushed"`, etc. |
| `author.descriptor` | `msa.*` or `aad.*` | `s2s.*` (service-to-service) |
| `author.uniqueName` | Email address | Empty string `""` |

**Simplest reliable filter** in the adapter: `thread.threadContext != null` — catches all file-anchored user threads and rejects everything else. If we later want a "Timeline" UI showing system events (like GitHub's PR event log), we can revisit.

### Soft-deleted comments — render placeholder or skip

DELETE on a comment doesn't remove it from the array. It:

- Sets `isDeleted: true` on the comment
- Removes the `content` field entirely (not blanked — the key is absent)
- Leaves author, timestamps, and `commentType` intact

Adapter's comment renderer must branch on `isDeleted`:

```js
if (comment.isDeleted) {
  return renderDeletedPlaceholder(comment);  // GitHub-style "This comment was deleted"
}
return renderMarkdown(comment.content);
```

### `identities` object on system threads

System threads reference user IDs via numeric string keys inside `properties.*`:

```json
"properties": {
  "CodeReviewRefUpdatedByIdentity": { "$type": "System.String", "$value": "1" }
},
"identities": {
  "1": { "displayName": "...", "uniqueName": "...", ... }
}
```

The `"1"` in the property value is a lookup key into the `identities` map on the same thread. We don't need this for v1 (system threads are filtered out) but it's worth remembering if we later build the timeline view.

### Edit metadata — how to show "(edited)" on a comment

After `PATCH` on a comment:

- `publishedDate` is **unchanged** (creation time)
- `lastContentUpdatedDate` moves forward when content is edited
- `lastUpdatedDate` also moves forward (matches `lastContentUpdatedDate` for content edits)

Derived rule for the adapter: `isEdited = comment.lastContentUpdatedDate !== comment.publishedDate`. Present as `(edited)` next to the timestamp, matching GitHub's convention.

