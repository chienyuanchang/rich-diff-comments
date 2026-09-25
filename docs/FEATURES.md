# Features & parity roadmap

This is the authoritative product roadmap for both browser-extension targets:

- **Markdown PR — Markdown PR Comments for GitHub**
- **Markdown PR — Azure DevOps PR Comments**

The goal is the same reviewer outcome on both services whenever the host platform makes that possible. Implementations do not need to be identical: GitHub rich diff and Azure DevOps Preview expose different DOM, navigation, identity, and API models.

Target-specific mechanics and constraints live in the small [GitHub feature notes](./github/FEATURES.md) and [Azure DevOps feature notes](./ado/FEATURES.md). Those pages do not duplicate priorities or status. Release history belongs in [CHANGELOG.md](../CHANGELOG.md) and [CHANGELOG_ADO.md](../CHANGELOG_ADO.md).

---

## How to use this roadmap

Every capability is defined once here from the user's perspective. Its two target cells expose parity gaps directly.

| Mark | Meaning |
|---|---|
| ✅ | Available in the target |
| △ | Partially available; follow-up remains |
| 📋 | Planned |
| ⏳ | Blocked on a platform capability or investigation |
| ↔ | Equivalent outcome supplied differently or natively by the host |
| — | Not applicable to that target |

Versions are independent and always target-qualified as **GitHub vX.Y.Z** or **ADO vX.Y.Z**.

Priority applies to the shared user outcome:

- **P0** — correctness or usability gap with frequent user impact
- **P1** — high value, planned next
- **P2** — useful follow-up
- **P3** — exploratory; build only with evidence of demand

### Documentation rule

- Update priority and target status **only here**.
- Add a target-note entry only when host behavior changes scope, acceptance criteria, or implementation risk.
- After shipping, condense the roadmap entry. Put user-visible release detail in the matching changelog, durable decisions in [GitHub approach](./github/APPROACH.md), and captured DOM/API findings in [GitHub developer notes](./github/DEV_NOTES.md) or [ADO developer notes](./ado/ADO_DEV_NOTES.md).

---

## 🎯 Current release plans

The targets version and release independently. These lists summarize the intended scope of each next release; the detailed shared outcomes and per-target statuses remain defined once in the roadmap sections below.

### Azure DevOps v1.5.0

- [ ] **Remove full sidebar dismissal and its restore launcher** — keep the sidebar's discoverable collapse/expand behavior instead of allowing it to enter a fully hidden state. Preserve the existing keyboard toggle and saved layout preferences.

No other scope is committed to v1.5.0 yet. Work-item creation, reactions, and sidebar quick reply remain later work.

### GitHub v1.12.0

- [x] **Copy Markdown for every rendered comment** — implemented, browser-tested, and live-validated; release pending. Copies only the original Markdown body, matching GitHub's native action without generated attribution, timestamps, links, or quote wrappers.

---

## ✅ Shipped

### Rendered commenting

| Capability | GitHub | Azure DevOps |
|---|---|---|
| Add a review comment from rendered paragraphs, headings, list items, table rows, and code blocks | ✅ GitHub v1.0.0 | ✅ ADO v1.2.0 |
| Create single-line and multi-line comments with editable source-line targets | ✅ GitHub v1.0.0 | ✅ ADO v1.0.0 |
| Track a specific line inside a fenced code block from the pointer position | ✅ | ✅ |
| Keep the comment button aligned with the selected rendered line | ✅ | ✅ ADO v1.2.0 |
| Show new comments inline immediately without a manual refresh | ✅ | ✅ |
| Use the signed-in browser session without requiring a PAT | ✅ | ✅ |

### Threads and editor

| Capability | GitHub | Azure DevOps |
|---|---|---|
| Render existing conversations beside the corresponding rendered block | ✅ | ✅ |
| Mark table rows and code lines that contain conversations and navigate among multiple threads at the same position | ✅ GitHub v1.11.0 | ✅ ADO v1.3.0 |
| Reply, resolve/reopen, edit or delete owned comments, and copy a stable link to any visible comment | ✅ GitHub v1.11.0 | ✅ ADO v1.4.0 |
| Show resolved state and collapse resolved threads by default | ✅ | ✅ |
| Write with a Markdown toolbar, Write/Preview tabs, auto-grow, and Cmd/Ctrl+Enter | ✅ | ✅ |
| Complete `@mention` names with keyboard and mouse selection and preserve host notifications | ✅ | ✅ ADO v1.2.0 |
| Render deleted-comment placeholders safely | ✅ | ✅ |
| Hide a thread after its last visible comment is deleted | N/A — deleted comments are omitted by the host response | ✅ ADO v1.3.0 |
| Preserve reading position while thread actions update the page | ✅ | ✅ |

### Changes, Threads, and Outline

| Capability | GitHub | Azure DevOps |
|---|---|---|
| Use a draggable, resizable, collapsible sidebar with persistent layout and selected tab | ✅ Resizing preserves tab scroll position | ✅ |
| Browse PR-wide Changes, Threads, and Outline lists grouped in stable file order | ✅ | ✅ |
| Navigate changed rendered blocks with cards, counters, clicks, and keyboard shortcuts | ✅ | ✅ |
| Show one summary card for a newly added, deleted, or renamed Markdown file where applicable | ✅ | ✅ |
| Navigate threads globally and filter to unresolved conversations | ✅ | ✅ |
| Browse headings across changed Markdown files with per-section thread counts | ✅ | ✅ |
| Keep the Outline focused when navigating to a heading in another file | ✅ | ✅ ADO v1.2.0 |
| Fold individual sections or bulk-fold by H1/H2/H3 level and expand all | ✅ Bulk actions affect all rendered files | ✅ Bulk actions affect the current file |
| Show file-scoped position with a PR-wide total and jump header icons to the current file first | ✅ | ✅ |
| Follow native file navigation and keep sidebar selection synchronized | ✅ | ✅ |
| Follow repeated rendered Table of Contents links even when the destination fragment is already active | ✅ GitHub v1.10.0 | ✅ No equivalent Preview issue observed |
| Hide or stand down outside the host's changed-files review surface | ✅ | ✅ |

### Activation and lifecycle

| Capability | GitHub | Azure DevOps |
|---|---|---|
| Provide an obvious action when rendered Markdown is not active | ✅ Render all Markdown files | ✅ Open Markdown Preview, ADO v1.1.0 |
| Explain when GitHub's large-PR mode prevents PR-wide rendering instead of showing a transient bulk action | ✅ GitHub v1.10.0 | — |
| Offer bulk rendering from empty Changes or Threads states only while eligible Markdown files still need rich diff | ✅ GitHub v1.11.0 | — |
| Move between changed Markdown files without rebuilding all PR-wide review data | ✅ | ✅ ADO v1.1.0 |
| Reject stale navigation and review state when the pull-request identity changes | ✅ | ✅ ADO v1.1.0 |
| Preserve sidebar layout and user preferences across navigation | ✅ | ✅ |
| Show compact loading feedback when the sidebar starts collapsed | — | ✅ ADO v1.2.0 |
| Support light and dark themes | ✅ | ✅ |
| Support Windows forced-colors/high-contrast mode | △ Browser fallback | ✅ |

### Mapping and correctness

| Capability | GitHub | Azure DevOps |
|---|---|---|
| Map rendered blocks to source lines with the shared forward-scan matcher | ✅ | ✅ |
| Keep comments on ordered and unordered list items anchored to the selected bullet | ✅ | ✅ ADO v1.2.0 |
| Prevent diagrams, deleted content, and unmatched blocks from corrupting later line mappings | ✅ | ✅ where the content exists in Preview |
| Map table rows and fenced-code ranges without altering host markup | ✅ | ✅ |
| Handle YAML frontmatter without shifting the document's later line mappings | ✅ | △ Needs target-specific fixture validation |
| Build changed-block navigation from the host's available source information | ✅ Native rich-diff markers | ✅ Head/base source comparison |
| Highlight added and modified rendered blocks persistently | ↔ Native rich diff already supplies this context | ✅ ADO v1.2.0 |
| Keep diagnostic logging and local inspection hooks available without telemetry | ✅ | ✅ |

---

## 🚧 Backlog

### Correctness

- [ ] **P1 — Improve rendered-block text-match accuracy**
  - **Outcome:** fewer comments rely on approximate fallback lines, especially in nested lists, blockquotes, fenced prose, and HTML-backed Markdown.
  - **GitHub:** 📋 Planned.
  - **ADO:** 📋 Planned through the shared matcher.
  - Establish a fixture baseline before changing the algorithm; preserve monotonic forward matching and safe source bounds.

- [ ] **P2 — Comment on deleted lines**
  - **GitHub:** 📋 Planned. The LEFT-side payload is known; work needs base-source mapping, side-aware anchors, and a distinct removed-line affordance.
  - **ADO:** ⏳ Blocked on a safe representation because Preview omits removed prose entirely.
  - Multi-line LEFT ranges, cross-side ranges, and mixed table-row deletion remain later follow-ups.

- [ ] **P2 — Match fenced prose/code blocks by their first useful source line**
  - **GitHub:** 📋 Planned.
  - **ADO:** 📋 Planned through the shared matcher.

- [ ] **P3 — Improve raw HTML block mapping**
  - **GitHub:** 📋 Exploratory for `<details>` and source HTML tables.
  - **ADO:** 📋 Exploratory where Preview emits a corresponding rendered block.

- [ ] **P3 — Add hunk-aware comment eligibility only if rejection evidence requires it**
  - **GitHub:** ↔ Real-PR testing has accepted comments on unchanged lines outside visible hunks; do not restrict buttons without a reproducible rejection.
  - **ADO:** ↔ No current fixture or live evidence requires an additional hunk gate.
  - Retain this as a monitoring decision so marker/thread maps are not mistaken for the set of valid review lines again.

### Review and collaboration

- [ ] **P2 — Turn a conversation into tracked work if demand justifies it**
  - **Outcome:** reviewers can carry a rendered-review conversation into the host's work-tracking system with its source link and useful context already attached.
  - **GitHub:** 📋 Exploratory. GitHub provides a native **Reference in new issue** action, but there is no usage evidence that duplicating it in rendered review would benefit enough reviewers.
  - **ADO:** ⏸ Exploratory and technically constrained. The native Issue/Epic/Task picker opens a private in-page contribution form rather than a reusable page route; formal PR/thread linking also lacks a captured supported relation payload.
  - **Constraint:** do not schedule implementation without user-demand evidence. If justified later, open the host's normal creation form so the reviewer confirms the final work item; do not depend on private application state or create tracked work silently.

- [ ] **P2 — Reactions on comments**
  - **Outcome:** reviewers can acknowledge a comment without adding a reply.
  - **GitHub:** 📋 Planned; native reactions exist, but the mutation endpoint needs validation.
  - **ADO:** 📋 Planned; the native thread surface exposes a Like/thumbs-up action, but extension support needs endpoint investigation.

- [ ] **P2 — Quote a comment into a reply**
  - **Outcome:** one action opens the rendered reply editor with the selected comment represented as a Markdown quote.
  - **GitHub:** 📋 Planned to match native **Quote reply** behavior.
  - **ADO:** 📋 Planned as a shared editor convenience; no equivalent action was present in the captured native toolbar.
  - Preserve attribution where useful, keep the quote editable, and use the existing reply submission path.

- [ ] **P2 — Copy a comment as Markdown**
  - **Outcome:** reviewers can copy the original Markdown body of a comment for reuse in another discussion or document.
  - **GitHub:** △ Implemented, browser-tested, and live-validated for GitHub v1.12.0; release pending. Matches native **Copy Markdown** behavior.
  - **ADO:** ✅ ADO v1.4.0. Added as a parity convenience even though it is absent from the captured native toolbar.
  - **Constraint:** copy only the stored Markdown body. Do not add generated attribution, timestamps, links, or quote markers; keep this distinct from Copy link, which copies a navigable destination.

- [ ] **P3 — Expose host-authorized moderation actions only when safely supported**
  - **GitHub:** ↔ Native **Hide** remains delegated to GitHub because availability and reason selection depend on repository moderation permissions.
  - **ADO:** — No corresponding action was present in the captured native toolbar.
  - Do not infer moderation permission from ordinary comment ownership or substitute Delete for Hide.

- [ ] **P2 — Quick reply from a sidebar thread card**
  - **GitHub:** 📋 Planned.
  - **ADO:** 📋 Planned.
  - Keep the input compact and reuse the existing editor and submission paths.

- [ ] **P2 — Character-range comments through portable metadata**
  - **Outcome:** visually highlight a selected phrase while retaining the host's native line-level review anchor.
  - **GitHub:** 📋 Exploratory.
  - **ADO:** 📋 Exploratory.
  - Metadata must survive host rendering/editing and degrade cleanly to the native line anchor when absent.

- [ ] **P3 — Apply suggested-change blocks from the rendered review surface**
  - **GitHub:** 📋 Exploratory; GitHub's native React-bound controls cannot be reused directly.
  - **ADO:** ⏳ Investigate whether an equivalent review suggestion model exists.

- [ ] **P3 — Live arrival of comments posted elsewhere**
  - **GitHub:** 📋 Exploratory.
  - **ADO:** 📋 Exploratory.
  - The Threads pane is the preferred notification and merge surface.

- [ ] **P3 — Always-visible inline reply editor**
  - **GitHub:** 📋 Exploratory.
  - **ADO:** 📋 Exploratory.
  - Evaluate the reduced click cost against the permanent vertical space added to every expanded thread.

### Navigation and focus

- [ ] **P2 — Use discoverable sidebar collapse instead of full dismissal**
  - **Outcome:** reviewers can reclaim page space without creating a fully hidden state that is difficult to discover or recover from.
  - **GitHub:** ✅ The existing collapse control and `t` shortcut provide the intended outcome; do not add a full-dismiss button or separate launcher.
  - **ADO:** 📋 Targeted for ADO v1.5.0. Remove the header × full-dismiss action and separate restore launcher, keeping collapse/expand as the sole space-saving behavior.
  - **Constraint:** preserve the existing keyboard toggle and saved position, size, active tab, filter, and collapsed state. Removing full dismissal must not reset the reviewer's sidebar layout.

- [ ] **P3 — Evaluate active-file prioritization during startup**
  - **Outcome:** reviewers can begin commenting sooner without making Changes, Threads, or Outline feel noticeably slower or incomplete.
  - **GitHub:** — Rich diff supplies the rendered review surface and source positions directly; the same ADO startup tradeoff does not apply.
  - **ADO:** 📋 Deferred pending real timing evidence and UX evaluation.
  - Compare current parallel loading with active-file-first scheduling using `ADORC_probe.startup()` on small and large pull requests. Do not change scheduling unless the improvement in comment readiness clearly outweighs delayed PR-wide sidebar readiness.

- [ ] **P2 — Make bulk section-folding scope explicit and predictable**
  - **Outcome:** reviewers can tell whether Fold H1/H2/H3 and Expand all affect the current file or every Markdown file before applying the action.
  - **GitHub:** △ Shipped with PR-wide scope across all rendered Markdown files.
  - **ADO:** △ Shipped with current-file scope because Preview renders one file at a time.
  - Do not force identical mechanics without user evidence. First clarify the labels or expose an explicit scope choice; current-file scope is safer for focused review, while all-files scope is useful for PR-wide triage.

- [ ] **P1 — Current-file focus for Changes and Threads**
  - **Outcome:** reduce sidebar clutter while reviewing one file without corrupting global navigation state.
  - **GitHub:** 📋 Planned; a rebuild-on-scroll implementation was attempted and reverted.
  - **ADO:** 📋 Planned.
  - Prefer collapsible file groups or a presentation-only filter. Do not rebuild card arrays on file-boundary scroll events or share click-navigation pin state with natural scrolling. See [GitHub feature notes](./github/FEATURES.md#current-file-focus).

- [ ] **P2 — Extend Changes navigation beyond Markdown**
  - **GitHub:** 📋 Planned; group visible source-diff lines into hunk-level cards rather than one card per line.
  - **ADO:** 📋 Planned; use ADO source-diff destinations for files without Preview.
  - Keep Outline Markdown-only and avoid eagerly expanding large collapsed diffs in the MVP.

- [ ] **P2 — Persist section-collapse state per file for the browser session**
  - **GitHub:** 📋 Planned.
  - **ADO:** 📋 Planned.
  - Scope state by service, repository, pull request, file, and stable heading key.

### Onboarding

- [ ] **P1 — First-activation walkthrough**
  - **GitHub:** 📋 Planned around rich-diff activation, the block `+`, the sidebar, and render-all.
  - **ADO:** 📋 Planned around Open Markdown Preview, the block `+`, and the sidebar.
  - The tour must be dismissible, keyboard-accessible, and versioned so materially changed steps can be shown again deliberately.

- [ ] **P2 — Prompt to refresh a pull-request tab that was already open during installation**
  - **GitHub:** △ Documentation currently explains the required refresh.
  - **ADO:** △ The same Chromium content-script limitation applies.
  - Do not add broad tab/scripting permissions without evidence that the documentation is insufficient. A hidden toolbar badge is not an adequate prompt.

### Engineering quality backlog

These items protect both targets but are not user-visible features and do not belong in either changelog.

- [ ] Add focused DOM-injection tests for button/thread anchors and mutation-observer exclusions.
- [ ] Pin sanitized response fixtures for target endpoint normalization where mocked browser routes do not already cover the shape.
- [ ] Consider live throwaway-PR automation only if fixture suites stop catching a recurring host integration failure; never require credentials for the default test run.

---

## Intentional platform differences

Parity means the same useful outcome, not identical controls or internal behavior.

| Area | GitHub | Azure DevOps |
|---|---|---|
| Rendered surface | Rich diff is selected per file. | Preview is PR-wide and sticky. |
| Activation | Render every changed Markdown file as rich diff. | Open the selected or first changed Markdown file in Preview once. |
| Comment preview | Prefer GitHub's server renderer; bundled fallback. | Use the bundled local renderer. |
| Change discovery | Read native added/removed rich-diff markers. | Compare head and target Markdown because Preview has no markers. |
| File navigation | Synchronize GitHub anchor destinations and add an active-row treatment. | Drive ADO's native virtual TreeEx selection and rely on its selected-row state. |
| PR lifecycle | Reinitialize as GitHub replaces route and diff DOM. | Reload once on direct PR-to-PR SPA navigation to replace the complete runtime context. |
| Roles and outdated state | GitHub provides author-association and outdated-thread fields. | ADO has a GUID identity model and different thread-tracking semantics; do not invent GitHub-style labels. |
| Rendered thread scope | Markdown rich-diff files. | Markdown Preview files; non-Markdown threads have no rendered destination. |

---

## 🚫 Won't do (deliberate trade-offs)

The extensions fill gaps in rendered Markdown review. They do not replace native pull-request review surfaces.

- ❌ **Submit, approve, request changes, vote, or complete a full review.** Use the host's native pull-request controls.
- ❌ **Replace native viewed-state or whole-PR file navigation.** Use the host's file tree and viewed controls where available.
- ❌ **Duplicate line commenting in source diff.** Both services already provide it.
- ❌ **Replace the host's rendered-document surface.** The extensions augment GitHub rich diff and ADO Preview rather than becoming Markdown-rendering applications.
- ❌ **Clone host comment-form DOM.** Interactive behavior is tied to private application state; the extensions use their own stable editor instead.
- ❌ **Upload images through undocumented attachment endpoints.** Use the host's native editor when an upload is required.
- ❌ **Split or rewrite syntax-highlighted `<pre>` markup into permanent per-line wrappers.** Use overlays or non-destructive marks for code-line affordances.
- ❌ **Require a PAT or separate sign-in by default.** Existing signed-in browser sessions are the primary authentication path.
- ❌ **Promise perfect block matching for every renderer edge case.** Editable line targets remain the safety net while shared matching improves.
- ❌ **Build a VS Code extension for the same workflow.** The browser targets reuse the review pages, authentication, rendering, and native navigation that already exist.

Target-specific delegated behavior is documented in [GitHub feature notes](./github/FEATURES.md#github-specific-delegation) and [Azure DevOps feature notes](./ado/FEATURES.md#ado-specific-delegation).

---

## Documentation ownership

| Question | Source of truth |
|---|---|
| What should both products do, and what is each target's status? | This roadmap |
| How does GitHub differ? | [GitHub feature notes](./github/FEATURES.md) |
| How does Azure DevOps differ? | [Azure DevOps feature notes](./ado/FEATURES.md) |
| What changed for users in a release? | [GitHub changelog](../CHANGELOG.md) or [ADO changelog](../CHANGELOG_ADO.md) |
| Why is the architecture shaped this way? | [GitHub approach](./github/APPROACH.md) and the [ADO design/validation record](./ado/ADO_ADAPTER_PLAN.md) |
| What endpoint, DOM, or debugging detail was observed? | [GitHub developer notes](./github/DEV_NOTES.md) or [ADO developer notes](./ado/ADO_DEV_NOTES.md) |
| How is a target packaged and published? | [Publishing & Distribution](./PUBLISHING.md) |