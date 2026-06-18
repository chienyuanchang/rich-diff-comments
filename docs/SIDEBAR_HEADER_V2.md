# Sidebar Header v2 — Design Doc

**Status:** Approved (2026-06-17). Implemented; book-button behaviour clarified 2026-06-17 to match the spec's "Toggle outline".
**Source:** User-provided mockup ("Navigation UI — Design Summary (Final)") in the 2026-06-17 conversation.
**Implements:** Visual refresh + book-button behaviour realignment of the sidebar header introduced in 1.5.0; ships as 1.6.0.

## Scope

**Visual refresh + one behaviour change.** Reorder header icons per the mockup, swap icon shapes, switch chevron orientation, tighten spacing — and align the book button with the spec's "Toggle outline" intent (the previous "render-all-md" function is preserved as a side-effect).

What changes:

- Header element **order** and **icon shapes** per the mockup
- Chevrons swap from `↑ ↓` to `< >`
- Spacing, height, opacity tiers follow the mockup spec
- Diff and Thread icons become **clickable shortcuts** (mockup explicitly calls this out)
- **Book icon now switches to the Outline tab** (per the spec's "Toggle outline" label). Rendering all `.md` files happens as a side-effect so the Outline pane has headings to show. New `b` keyboard shortcut.

What stays the same:

- Body tabs (Changes / Threads / Outline) — same order, same content, same keyboard shortcuts (`1`/`2`/`3`)
- Other keyboard shortcuts (`[`/`]` for changes, `j`/`k` for threads, `t` for collapse, etc.)
- The funnel icon still toggles the "Unresolved only" thread filter
- The collapse / expand toggle (`≡`)
- All localStorage state (collapsed, position, size, active tab)
- All permissions

## Reference mockup

User-provided mockup in the 2026-06-17 conversation. The bar consists of (left → right):

```
┌─────────────────────────────────────────────────────────────────────┐
│  ≡  │  📖  │  📄  1/3  <  >  │  💬  2/5  <  >  ▽                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Final layout (locked)

Left-to-right inside the 16 px horizontal padding, 48 px tall:

| # | Class | Visual | Action |
|---|---|---|---|
| 1 | `grdc-sidebar-collapse` | `≡` (hamburger) | Toggle sidebar collapse/expand (existing) |
| - | separator | `│` (1×24 px) | — |
| 2 | `grdc-sidebar-render-md` | book | **Show Outline** — switches to the Outline tab. Side-effect: also renders any not-yet-rendered `.md` files so the Outline pane has headings to show. Keyboard: `b`. |
| - | separator | `│` | — |
| 3a | `grdc-sidebar-diff-icon` | `📄` (file-diff) | **NEW shortcut** — go to next diff (or first if none in view) |
| 3b | `grdc-sidebar-changes-count` | `1/3` | Informational (existing class kept) |
| 3c | `grdc-sidebar-prev-change` | `<` | Previous diff (existing; chevron rotated 90°) |
| 3d | `grdc-sidebar-next-change` | `>` | Next diff (existing; chevron rotated 90°) |
| - | separator | `│` | — |
| 4a | `grdc-sidebar-thread-icon` | `💬` (comment-discussion) | **NEW shortcut** — go to next thread (or first if none in view) |
| 4b | `grdc-sidebar-count` | `2/5` | Informational (existing class kept) |
| 4c | `grdc-sidebar-prev` | `<` | Previous thread (existing; chevron rotated 90°) |
| 4d | `grdc-sidebar-next` | `>` | Next thread (existing; chevron rotated 90°) |
| 5 | `grdc-sidebar-header-filter` | `▽` (funnel) | Toggle "Unresolved only" filter (existing — moved to end per user request) |

Body tabs (unchanged): Changes / Threads / Outline.

## Behaviour

| Click | Effect |
|---|---|
| `≡` | Toggle sidebar collapsed/expanded |
| `book` | **Show Outline** — switch to the Outline tab. If any `.md` files aren't yet rendered, render them first (so the Outline pane has headings). If the panel is collapsed, expand it. Idempotent: clicking again while already on Outline still runs the render check, then stays on Outline. |
| `📄` (diff icon) | **NEW**: go to next diff. If no diff currently in view → go to first diff. |
| `📄` count `1/3` | Nothing (informational) |
| `< >` (in diff group) | Previous / Next diff (same as `[` / `]`) |
| `💬` (thread icon) | **NEW**: go to next thread. If no thread currently in view → go to first thread. |
| `💬` count `2/5` | Nothing (informational) |
| `< >` (in thread group) | Previous / Next thread (same as `j` / `k`) |
| `▽` (funnel) | Toggle "Unresolved only" filter |

Keyboard shortcuts: unchanged — plus a new `b` for the book button ("show Outline").

## Visual style (from mockup)

### Color

| Element | Colour |
|---|---|
| Icons & chevrons (interactive) | `#FFFFFF` (100% white) |
| Count text (informational) | `rgba(255, 255, 255, 0.6)` (60% white) |
| Separators | `rgba(255, 255, 255, 0.24)` (24% white) |

Background unchanged: GitHub-accent blue (`var(--fgColor-accent, #0969da)`).

### States

| State | Treatment |
|---|---|
| Default | Per colour table above |
| Hover (interactive) | Subtle background highlight, e.g. `rgba(255, 255, 255, 0.1)` rounded |
| Active / pressed | Slightly stronger background, e.g. `rgba(255, 255, 255, 0.2)` |

### Layout

| Property | Value |
|---|---|
| Bar height | 48 px |
| Horizontal padding (left & right) | 16 px |
| Icon size (visual) | 20 px |
| Count text size | 16 px, font-weight 500-600 |
| Gap between groups (separator to separator) | 16 px |
| Gap between icon and count | 8 px |
| Gap between count and left chevron | 8 px |
| Gap between chevrons | 6-8 px |
| Click target (icons & chevrons) | 32 × 32 px minimum |
| Separator height | 24 px (60% of bar) |
| Separator width | 1 px |

## What changes from 1.5.0

| 1.5.0 | v2 | Notes |
|---|---|---|
| Header order: `[≡] [↑±N/M↓] │ [↑💬N/M↓] [funnel] [book]` | New order: `[≡] │ [book] │ [📄 N/M < >] │ [💬 N/M < >] [funnel]` | Book moves to slot 2. Funnel moves to end. |
| Chevrons `↑ ↓` (vertical) | `< >` (horizontal) | Mockup spec |
| `±` glyph for changes | `📄` icon (file-diff) — also clickable | New SVG; mockup spec; icon becomes a shortcut |
| `💬` glyph for threads (emoji char) | `💬` SVG icon (comment-discussion) — also clickable | Proper SVG instead of emoji char; mockup spec; icon becomes a shortcut |
| Counts at default white opacity | 60% white | Mockup spec — informational items dim |
| Separators 1 px wide, white 25% | 1 px × 24 px, 24% white | Mockup spec |
| Header height ~30 px | 48 px | Mockup spec |
| Click targets vary | 32 × 32 px minimum | Mockup spec — accessibility |

## What stays the same from 1.5.0

- Tabs: Changes / Threads / Outline order, content, switching keys (`1`/`2`/`3`)
- Other keyboard shortcuts unchanged (`[`/`]`/`j`/`k`/`h`/`l`/`{`/`}`/`t`/`Shift+T`); `b` is added
- Funnel function: toggle Unresolved-only
- localStorage keys: `grdc_sidebar_tab`, `grdc_sidebar_collapse`, `grdc_sidebar_pos`, `grdc_sidebar_size`, `grdc_sidebar_filter`
- Body cards, empty-state CTAs, scroll-into-view behaviour
- Collapsed state: still shows the header strip with both nav clusters
- No new permissions

## Icon sources

Using inline SVG paths matching the mockup's visual style. Closest Octicon equivalents:

- `≡` — existing custom hamburger (no change)
- book — existing custom split-rounded book (no change)
- `📄` — Octicon `file-diff` (or simplified file-with-tabs variant)
- `💬` — Octicon `comment-discussion`
- `<` `>` — same Octicon chevron paths as today, oriented horizontally
- `▽` — existing custom funnel (no change)

## Implementation impact

| File | Change |
|---|---|
| [content.js](../content.js) | Rewrite header `innerHTML` template with new order, new icons, new SVG chevron orientation, and `aria-label` updates. Add click handlers on the diff/thread icons so they call `changesJump(+1)` / `sidebarJump(+1)`. |
| [styles.css](../styles.css) | New header rules: 48 px height, 16 px padding, exact 8/8/6 gaps, 32 × 32 click targets via padding, three-tier white opacity, 1 × 24 px separators, hover/active states. |
| [tests/collapsedSidebar.test.js](../tests/collapsedSidebar.test.js) | Class names preserved → tests should mostly still pass. Bumped min-height assertion if needed. |
| [tests/sidebarSelectors.test.js](../tests/sidebarSelectors.test.js) | Class names preserved → no change. |
| [tests/e2e/keyboardShortcuts.spec.js](../tests/e2e/keyboardShortcuts.spec.js) | Add a test: clicking `📄` icon navigates to next/first diff; clicking `💬` icon navigates to next/first thread. |
| [CHANGELOG.md](../CHANGELOG.md) | New `[Unreleased] → Changed` entry: "Sidebar header refreshed per the v2 design spec — see docs/SIDEBAR_HEADER_V2.md." |

Existing files NOT affected:

- Pure helpers in `src/lib/` — no navigation logic changes
- `manifest.json` — no permission changes
- [README.md](../README.md), [INSTALL.md](../INSTALL.md) — no user-facing behaviour change (keyboard shortcuts unchanged)

## "Go to next or first if none in view" — implementation note

The mockup's behaviour spec says: *"If no diff is currently in view, clicking the Diff icon or the Next diff will take you to the first diff."*

This is a small but important behavioural addition. Today, `changesJump(+1)` wraps from the last item back to the first (modulo arithmetic). The mockup wants a different rule:

```
if (no item currently active in viewport):
    jump to first
else:
    jump to next (wrapping at end is fine)
```

"Currently active in viewport" means: the item the user last navigated to (`changesCurrentIdx`) is still visible in the document. If they've scrolled away from it, "next" should mean "first one I haven't seen yet", which is usually item 1.

Pragmatic implementation: track whether a navigation has happened since the last page load / file change. If never → next click is "first". Otherwise → next click is "+1 with wrap".

Simpler still: if `changesCurrentIdx === 0` AND we haven't actually scrolled to it yet, treat first click as "go to first". This is implicit in the current `nextChangeIndex` function when starting from `0`.

I'll use the simpler interpretation: **the very first click of the Diff/Thread icon scrolls to item 1**. Subsequent clicks behave like the chevron `>`. This matches the chevron's existing behaviour (which already goes to item 1 first).

## Migration / backward compatibility

- localStorage state preserved.
- Keyboard shortcuts preserved (`[`/`]` / `j`/`k` / `h`/`l` / `{`/`}` / `1`/`2`/`3` / `t` / `Shift+T`).
- No new permissions.
- Store re-review likely needed because screenshots in the listing show the old header; refresh `design/screenshots/` and update both submission templates.

## Test plan

After implementation:

1. Static CSS tests still pass (class names preserved).
2. Selector contract tests still pass.
3. New e2e test: click diff icon → next diff; click thread icon → next thread.
4. Manual smoke test on a real PR with multiple `.md` files + multiple threads.
5. Resize the sidebar narrow → header items wrap gracefully (or stay above the existing `min-width: 300px` collapsed floor).
