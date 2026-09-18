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

## ✅ Shipped

### Rendered commenting

| Capability | GitHub | Azure DevOps |
|---|---|---|
| Add a review comment from rendered paragraphs, headings, list items, table rows, and code blocks | ✅ GitHub v1.0.0 | ✅ ADO v1.2.0 |
| Create single-line and multi-line comments with editable source-line targets | ✅ GitHub v1.0.0 | ✅ ADO v1.0.0 |
| Track a specific line inside a fenced code block from the pointer position | ✅ | ✅ |
| Show new comments inline immediately without a manual refresh | ✅ | ✅ |
| Use the signed-in browser session without requiring a PAT | ✅ | ✅ |

### Threads and editor

| Capability | GitHub | Azure DevOps |
|---|---|---|
| Render existing conversations beside the corresponding rendered block | ✅ | ✅ |
| Reply, resolve/reopen, edit, and delete comments inline | ✅ | ✅ |
| Show resolved state and collapse resolved threads by default | ✅ | ✅ |
| Write with a Markdown toolbar, Write/Preview tabs, auto-grow, and Cmd/Ctrl+Enter | ✅ | ✅ |
| Render deleted-comment placeholders safely | ✅ | ✅ |
| Hide a thread after its last visible comment is deleted | N/A — deleted comments are omitted by the host response | ✅ ADO Unreleased |
| Preserve reading position while thread actions update the page | ✅ | ✅ |

### Changes, Threads, and Outline

| Capability | GitHub | Azure DevOps |
|---|---|---|
| Use a draggable, resizable, collapsible sidebar with persistent layout and selected tab | ✅ | ✅ |
| Browse PR-wide Changes, Threads, and Outline lists grouped in stable file order | ✅ | ✅ |
| Navigate changed rendered blocks with cards, counters, clicks, and keyboard shortcuts | ✅ | ✅ |
| Show one summary card for a newly added, deleted, or renamed Markdown file where applicable | ✅ | ✅ |
| Navigate threads globally and filter to unresolved conversations | ✅ | ✅ |
| Browse headings across changed Markdown files with per-section thread counts | ✅ | ✅ |
| Fold individual sections or bulk-fold by H1/H2/H3 level and expand all | ✅ Bulk actions affect all rendered files | ✅ Bulk actions affect the current file |
| Show file-scoped position with a PR-wide total and jump header icons to the current file first | ✅ | ✅ |
| Follow native file navigation and keep sidebar selection synchronized | ✅ | ✅ |
| Hide or stand down outside the host's changed-files review surface | ✅ | ✅ |

### Activation and lifecycle

| Capability | GitHub | Azure DevOps |
|---|---|---|
| Provide an obvious action when rendered Markdown is not active | ✅ Render all Markdown files | ✅ Open Markdown Preview, ADO v1.1.0 |
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
| Prevent diagrams, deleted content, and unmatched blocks from corrupting later line mappings | ✅ | ✅ where the content exists in Preview |
| Map table rows and fenced-code ranges without altering host markup | ✅ | ✅ |
| Handle YAML frontmatter without shifting the document's later line mappings | ✅ | △ Needs target-specific fixture validation |
| Build changed-block navigation from the host's available source information | ✅ Native rich-diff markers | ✅ Head/base source comparison |
| Keep diagnostic logging and local inspection hooks available without telemetry | ✅ | ✅ |

---

## 🚧 Planned / nice-to-have

### Correctness

- [x] **P0 — Keep ADO list-item comments anchored to the selected bullet**
  - **Outcome:** clicking `+` on an ordered or unordered list item creates the comment on that item's source line, never on the preceding section heading or another bullet.
  - **GitHub:** ✅ List items, including nested items, have dedicated mapping coverage.
  - **ADO:** ✅ ADO v1.2.0. List matching is restricted to Markdown list-marker lines so the selected bullet supplies the create-thread anchor.

- [x] **P2 — Center the comment button on single-line highlighted blocks**
  - **Outcome:** the `+` affordance is vertically centered on the text line and its hover/change highlight instead of appearing below it.
  - **GitHub:** ✅ No equivalent alignment issue observed.
  - **ADO:** ✅ ADO v1.2.0. List-item buttons center on the first rendered line, including items with nested content.

- [ ] **P0 — Inline markers for table rows and code lines that already have comments**
  - **Outcome:** a reviewer can see which exact row or code line has a conversation even though the thread body must remain below the containing table or code block.
  - **GitHub:** 📋 Planned.
  - **ADO:** 📋 Planned.
  - **MVP:** persistent accent rail/background on every affected row or line; clicking the marker scrolls to and expands the corresponding thread.
  - **Constraint:** do not inject invalid children into table rows or split syntax-highlighted code DOM.

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

- [ ] **P2 — ADO `@mention` autocomplete parity**
  - **Outcome:** typing `@` in a new comment, reply, or edit shows relevant people, supports keyboard selection, inserts the native ADO mention form, and preserves real linking and notifications after submission.
  - **GitHub:** ✅ Available with pre-warmed collaborator suggestions.
  - **ADO:** △ ADO v1.2.0 ships multi-word search, keyboard/mouse selection, native submission, readable inline rendering, Threads snippets, edits, and cross-file navigation. Notification delivery still needs confirmation from the mentioned account.
  - Use active user identities from IdentityPicker results, insert native GUID tokens for submission, and render readable display names in the extension instead of exposing tokens.
  - Reuse one accessible dropdown interaction across new comments, replies, and edits; cache successful lookups without exposing organization identities outside the active signed-in session.

- [ ] **P2 — Reactions on comments**
  - **GitHub:** 📋 Planned; mutation endpoint needs validation.
  - **ADO:** 📋 Planned; REST support needs investigation.

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

- [ ] **P3 — Evaluate active-file prioritization during startup**
  - **Outcome:** reviewers can begin commenting sooner without making Changes, Threads, or Outline feel noticeably slower or incomplete.
  - **GitHub:** — Rich diff supplies the rendered review surface and source positions directly; the same ADO startup tradeoff does not apply.
  - **ADO:** 📋 Deferred pending real timing evidence and UX evaluation.
  - Compare current parallel loading with active-file-first scheduling using `ADORC_probe.startup()` on small and large pull requests. Do not change scheduling unless the improvement in comment readiness clearly outweighs delayed PR-wide sidebar readiness.

- [x] **P1 — Keep the Outline focused on a cross-file heading destination**
  - **Outcome:** clicking a heading under another file opens that file and centers the selected heading in the Outline, providing context above and below instead of resetting the list to its top.
  - **GitHub:** ✅ All rendered files share one live document and Outline position follows the selected heading.
  - **ADO:** ✅ ADO v1.2.0. Outline rebuilds restore and center the selected destination after Preview reaches the requested file and heading.
  - Preserve stable file order and resume normal scroll-follow behavior after the explicit navigation completes.

- [ ] **P2 — Make bulk section-folding scope explicit and predictable**
  - **Outcome:** reviewers can tell whether Fold H1/H2/H3 and Expand all affect the current file or every Markdown file before applying the action.
  - **GitHub:** △ Shipped with PR-wide scope across all rendered Markdown files.
  - **ADO:** △ Shipped with current-file scope because Preview renders one file at a time.
  - Do not force identical mechanics without user evidence. First clarify the labels or expose an explicit scope choice; current-file scope is safer for focused review, while all-files scope is useful for PR-wide triage.

- [ ] **P2 — Dismiss and restore the sidebar without losing its layout**
  - **Outcome:** reviewers can remove the sidebar completely when they need the full page width, then restore it from a small launcher without losing its saved position and size.
  - **GitHub:** 📋 Planned; collapse and keyboard toggle are available, but there is no full-dismiss control or launcher.
  - **ADO:** ✅ The header × hides the sidebar and a launcher restores it.

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

### Target-specific opportunities

- [x] **P2 — Persistent rendered-diff highlighting in ADO Preview**
  - **GitHub:** ↔ Native rich diff already shows additions and removals.
  - **ADO:** ✅ ADO v1.2.0. Added and modified Preview highlights follow progressive analysis, file remounts, and ADO themes.
  - Show a subtle green file-level marker for a newly added Markdown file rather than tinting its entire document; for edited files, highlight only blocks mapped to added or mixed hunks.
  - Keep text readable in light, dark, and forced-colors themes, preserve comment/selection affordances, and reapply highlights after Preview remounts or progressive Changes analysis.
  - Removed content remains out of scope until ADO has a safe rendered representation for it; do not mark an unrelated surviving block as removed.

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